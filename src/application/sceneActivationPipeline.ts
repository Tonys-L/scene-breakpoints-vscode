import type { ApplySceneResult, IBreakpointBridge, ILineReader, ISceneRepository } from "#src/domain/ports";
import { Breakpoint } from "#src/domain/models/breakpoint";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";
import { HealingEngine } from "#src/domain/services/healingEngine";
import { expandScenes, type ResolvedStep } from "#src/domain/services/sceneResolver";
import { computeTopologyHash } from "#src/domain/services/activeScenesDiffResolver";
import { sceneStateManager } from "./sceneStateManager";
import { activeBreakpointIndex } from "./activeBreakpointIndex";
import { appEventBus } from "./eventBus";
import type { SceneBreakpoint, SourceSceneBreakpoint } from "#src/domain/types";

export interface SceneActivationDeps {
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	lineReader?: ILineReader;
	/**
	 * 外部编辑待决信号 (INV-031 命令路径门控)：磁盘内容相对最近一次内部写盘基线发生漂移
	 */
	isExternalPendingEdit?: () => boolean;
	/**
	 * 指纹冲突裁决回调 (INV-031)：返回 "disk" 保留磁盘行号 / "fingerprint" 维持自愈回滚；
	 * 缺失时维持现状静默自愈（向后兼容）
	 */
	resolveFingerprintConflict?: FingerprintConflictResolver;
	/**
	 * 冲突检测显式启用标记 (INV-031 watcher 路径门控)：外部文件变更事件显式下发
	 */
	conflictDetection?: "enabled";
}

export type FingerprintConflictResolution = "disk" | "fingerprint";

export interface FingerprintConflictInfo {
	/** 断点所在文件（工程相对路径） */
	file: string;
	/** 磁盘声明行号（用户外部编辑后） */
	registeredLine: number;
	/** 旧指纹匹配行号 */
	fingerprintLine: number;
}

export type FingerprintConflictResolver = (
	info: FingerprintConflictInfo,
) => Promise<FingerprintConflictResolution | undefined> | FingerprintConflictResolution | undefined;

/**
 * 指纹冲突门控选项：enabled 为门控开关（watcher 显式标记 ∨ 命令路径磁盘漂移信号）
 */
export interface FingerprintConflictGuard {
	enabled?: boolean;
	onConflict?: FingerprintConflictResolver;
}

/**
 * 冲突裁决决策：true = 磁盘行号优先；false = 维持自愈回滚现状
 * 裁决回调缺失 → 维持现状（向后兼容）；回调返回 undefined（用户关闭弹窗）→ 缺省磁盘优先 (INV-031)
 */
async function resolveConflictDecision(
	onConflict: FingerprintConflictResolver | undefined,
	bp: Breakpoint,
	fingerprintLine: number,
): Promise<boolean> {
	if (!onConflict) return false;
	const decision = await onConflict({
		file: bp.file || "",
		registeredLine: bp.line || 0,
		fingerprintLine,
	});
	return decision !== "fingerprint";
}

export interface ExecuteSceneActivationParams {
	workspaceRoot: string;
	targetScenes: string[];
	deps: SceneActivationDeps;
}

export interface ActivateSceneResult {
	success: boolean;
	validTargetScenes: string[];
	missingScenes: string[];
	loadedCount: number;
	healedCount: number;
	enrichedCount?: number;
	unmatchedCount: number;
	unmatchedBreakpoints?: SourceSceneBreakpoint[];
}

/**
 * 当磁盘中的 activeScenes 与当前激活不一致时，执行单向优先落盘 (INV-010)
 */
export function syncDiskActiveScenesIfNeeded(
	workspaceRoot: string,
	catalog: SceneCatalog,
	currentDiskActives: string[] | undefined,
	validTargetScenes: string[],
	sceneRepository: ISceneRepository,
): void {
	const isSameActive =
		Array.isArray(currentDiskActives) &&
		currentDiskActives.length === validTargetScenes.length &&
		currentDiskActives.every((s, i) => s === validTargetScenes[i]);

	if (!isSameActive) {
		sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
	}
}

/**
 * 将自愈和富化后的最新行号与指纹回写持久化至各个定义场景 (INV-004, INV-010, INV-030.6)
 * 溯源路由：输入为带溯源的展开流，回写目标为 ownerScenes 唯一集 —— 含未被激活的被引用场景
 */
export function persistHealedBackfill(
	workspaceRoot: string,
	catalog: SceneCatalog,
	_validTargetScenes: string[], // 保留参数（事件/日志用），回写路由不依赖
	applyResult: ApplySceneResult,
	resolved: ResolvedStep[],
	sceneRepository: ISceneRepository,
): void {
	const candidateInstances = applyResult.healedBreakpoints?.length
		? applyResult.healedBreakpoints.map((b: SceneBreakpoint | Breakpoint) =>
			b instanceof Breakpoint ? b : new Breakpoint(b),
		)
		: resolved.map((s) => s.breakpoint); // 无 DAP healed 时回退到展开流实体（原地变更等价物）
	// 同源多引用经 INV-011 去重后 ownerScenes 天然唯一 → 单次回写
	const ownerScenes = [...new Set(resolved.map((s) => s.ownerScene))];
	for (const owner of ownerScenes) {
		catalog.getScene(owner)?.backfillHealed(candidateInstances);
	}
	sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
}

/**
 * 应用层前置自愈与指纹富化计算管道 (INV-003)
 * 冲突门控 (INV-031)：门控开启且自愈判定漂移时，交由裁决回调决定磁盘行号优先或指纹自愈回滚
 */
export async function enrichAndHealBreakpoints(
	workspaceRoot: string,
	breakpoints: Breakpoint[],
	lineReader?: ILineReader,
	conflict?: FingerprintConflictGuard,
): Promise<{ healedCount: number; enrichedCount: number; unmatched: SourceSceneBreakpoint[] }> {
	let healedCount = 0;
	let enrichedCount = 0;
	const unmatched: SourceSceneBreakpoint[] = [];
	if (!lineReader) return { healedCount, enrichedCount, unmatched };

	for (const bp of breakpoints) {
		if (bp.type === "function") continue;
		const fullPath = bp.resolveFullPath(workspaceRoot);
		if (!fullPath) continue;
		try {
			const lines = await lineReader.readLines(fullPath);
			if (!lines || lines.length === 0) continue;
			if (bp.enrich(lines)) enrichedCount++;
			const healResult = HealingEngine.heal(lines, bp.line!, bp.contextSnippet);
			if (healResult.isHealed) {
				if (conflict?.enabled && (await resolveConflictDecision(conflict.onConflict, bp, healResult.healedLine))) {
					// 磁盘行号优先：保留用户重锚定行号，作废旧指纹并按磁盘声明行重提取 (INV-031)
					bp.contextSnippet = undefined;
					if (bp.enrich(lines)) enrichedCount++;
				} else {
					bp.updateLine(healResult.healedLine);
					healedCount++;
				}
			} else if (healResult.status === "unmatched") {
				unmatched.push(bp.toJSON() as SourceSceneBreakpoint);
			}
		} catch {
			// 容错：读取源码异常时不阻断激活主流程
		}
	}
	return { healedCount, enrichedCount, unmatched };
}

/**
 * 执行多场景激活主工作流编排 (Scene Activation Pipeline)
 */
export async function executeSceneActivation(
	params: ExecuteSceneActivationParams,
): Promise<ActivateSceneResult> {
	const { workspaceRoot, targetScenes, deps } = params;
	const { sceneRepository, breakpointBridge, lineReader } = deps;
	if (!sceneRepository || !breakpointBridge) {
		throw new Error("SceneService: sceneRepository and breakpointBridge must be configured");
	}

	lineReader?.clearCache?.();

	const config = sceneRepository.loadScenesConfig(workspaceRoot);
	const catalog = new SceneCatalog(config);

	// 1. 过滤幽灵场景与有效性校验 (INV-009)
	const actResult = catalog.activate(targetScenes);
	if (!actResult.success) {
		return {
			success: false,
			validTargetScenes: [],
			missingScenes: actResult.missingScenes,
			loadedCount: 0,
			healedCount: 0,
			unmatchedCount: 0,
		};
	}

	const validTargetScenes = actResult.validTargetScenes;
	const missingScenes = actResult.missingScenes;

	// 2. 场景组合解析：展开引用为纯断点流 (INV-030.1/30.2)
	//    成环在此抛出 CircularReferenceError —— 早于任何状态机写入 / DAP 下发 / 磁盘落盘 (§5.3)
	//    悬空/禁用降级为 warnings，不阻断激活 (INV-030.4/30.5)
	const { steps: resolvedSteps, warnings: resolveWarnings } = expandScenes(catalog, validTargetScenes);
	const mergedBreakpoints = resolvedSteps.map((s) => s.breakpoint);

	// 2.1 应用层前置自愈与指纹富化管道 (Healing & Fingerprint Enrich Pipeline)
	//     冲突门控 (INV-031)：watcher 显式标记 ∨ 命令路径磁盘漂移信号
	const conflictEnabled =
		deps.conflictDetection === "enabled" || (deps.isExternalPendingEdit?.() ?? false);
	const {
		healedCount: appHealedCount,
		enrichedCount: appEnrichedCount,
		unmatched: unmatchedBreakpoints,
	} = await enrichAndHealBreakpoints(workspaceRoot, mergedBreakpoints, lineReader, {
		enabled: conflictEnabled,
		onConflict: deps.resolveFingerprintConflict,
	});

	// 同步状态机脱靶失联警告 (INV-004)
	sceneStateManager.setUnmatchedBreakpoints(
		unmatchedBreakpoints.map((bp) => `${bp.file.replace(/\\/g, "/")}:${bp.line}`),
	);

	const bpsToLoad = mergedBreakpoints.map((b) => b.raw);
	const primarySceneLabel = validTargetScenes.length === 1 ? validTargetScenes[0] : validTargetScenes.join(" + ");

	// 3. 权威持久化 SSOT 写入约束：若 activeScenes 变化，先落盘 (INV-010)
	syncDiskActiveScenesIfNeeded(workspaceRoot, catalog, config.activeScenes, validTargetScenes, sceneRepository);

	// 4. 装配断点至宿主调试器 (INV-002, INV-005)
	sceneStateManager.setApplyingState(true);
	let applyResult;
	try {
		applyResult = await breakpointBridge.applySceneBreakpoints(workspaceRoot, primarySceneLabel, bpsToLoad);
	} finally {
		sceneStateManager.setApplyingState(false);
	}

	const loadedCount = applyResult.loadedCount;
	const healedCount = appHealedCount + (applyResult.healedCount || 0);
	const enrichedCount = appEnrichedCount + (applyResult.enrichedCount || 0);
	const finalUnmatched = unmatchedBreakpoints.length > 0 ? unmatchedBreakpoints : applyResult.unmatchedBreakpoints;
	const unmatchedCount = finalUnmatched?.length || 0;

	// 5. 将持久化结果投影更新至内存状态机，驱动 UI 渲染 (INV-004)
	sceneStateManager.setLastAppliedTopologyHash(computeTopologyHash(bpsToLoad));
	activeBreakpointIndex.sync(workspaceRoot, catalog.toJSON().scenes, validTargetScenes);
	sceneStateManager.setActiveScenes(validTargetScenes, loadedCount);

	// 6. 自愈与指纹补齐持久化闭环：按 ownerScene 溯源路由回写
	if (healedCount > 0 || enrichedCount > 0) {
		persistHealedBackfill(workspaceRoot, catalog, validTargetScenes, applyResult, resolvedSteps, sceneRepository);
	}

	appEventBus.emit("scene:activated", { workspaceRoot, activeScenes: validTargetScenes });

	// 解析警告事件（悬空/禁用）：UI 订阅后以 Warning 级通知展示，不阻断激活 (INV-030.4/30.5)
	if (resolveWarnings.length > 0) {
		appEventBus.emit("scene:resolve-warnings", { workspaceRoot, warnings: resolveWarnings });
	}

	return {
		success: true,
		validTargetScenes,
		missingScenes,
		loadedCount,
		healedCount,
		enrichedCount,
		unmatchedCount,
		unmatchedBreakpoints: finalUnmatched,
	};
}
