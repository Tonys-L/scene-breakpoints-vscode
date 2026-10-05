import type { ApplySceneResult, IBreakpointBridge, ILineReader, ISceneRepository } from "#src/domain/ports";
import { Breakpoint } from "#src/domain/models/breakpoint";
import { Scene } from "#src/domain/models/scene";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";
import { HealingEngine } from "#src/domain/services/healingEngine";
import { computeTopologyHash } from "#src/domain/services/activeScenesDiffResolver";
import { sceneStateManager } from "./sceneStateManager";
import { activeBreakpointIndex } from "./activeBreakpointIndex";
import { appEventBus } from "./eventBus";
import type { SceneBreakpoint, SourceSceneBreakpoint } from "#src/domain/types";

export interface SceneActivationDeps {
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	lineReader?: ILineReader;
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
 * 将自愈和富化后的最新行号与指纹回写持久化至各个所属场景 (INV-004, INV-010)
 */
export function persistHealedBackfill(
	workspaceRoot: string,
	catalog: SceneCatalog,
	validTargetScenes: string[],
	applyResult: ApplySceneResult,
	mergedBreakpoints: Breakpoint[],
	sceneRepository: ISceneRepository,
): void {
	const candidateInstances = applyResult.healedBreakpoints?.length
		? applyResult.healedBreakpoints.map((b: SceneBreakpoint | Breakpoint) =>
			b instanceof Breakpoint ? b : new Breakpoint(b),
		)
		: mergedBreakpoints;
	for (const sName of validTargetScenes) {
		catalog.getScene(sName)?.backfillHealed(candidateInstances);
	}
	sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
}

/**
 * 应用层前置自愈与指纹富化计算管道 (INV-003)
 */
export async function enrichAndHealBreakpoints(
	workspaceRoot: string,
	breakpoints: Breakpoint[],
	lineReader?: ILineReader,
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
				bp.updateLine(healResult.healedLine);
				healedCount++;
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

	// 2. 聚合多场景断点并去重 (先到先得策略 INV-001, INV-011)
	const activeScenes = validTargetScenes.map((name) => catalog.getScene(name)).filter((s): s is Scene => !!s);
	const mergedBreakpoints = Scene.merge(activeScenes).getBreakpoints();

	// 2.1 应用层前置自愈与指纹富化管道 (Healing & Fingerprint Enrich Pipeline)
	const {
		healedCount: appHealedCount,
		enrichedCount: appEnrichedCount,
		unmatched: unmatchedBreakpoints,
	} = await enrichAndHealBreakpoints(workspaceRoot, mergedBreakpoints, lineReader);

	// 同步状态机脱靶失联警告 (INV-004)
	sceneStateManager.setUnmatchedBreakpoints(
		unmatchedBreakpoints.map((bp) => `${bp.file.replace(/\\/g, "/")}:${bp.line}`),
	);

	const bpsToLoad = mergedBreakpoints.map((b) => b.toJSON());
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

	// 6. 自愈与指纹补齐持久化闭环
	if (healedCount > 0 || enrichedCount > 0) {
		persistHealedBackfill(workspaceRoot, catalog, validTargetScenes, applyResult, mergedBreakpoints, sceneRepository);
	}

	appEventBus.emit("scene:activated", { workspaceRoot, activeScenes: validTargetScenes });

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
