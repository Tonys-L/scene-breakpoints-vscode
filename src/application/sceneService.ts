import type { IBreakpointBridge, ISceneRepository } from "../domain/ports";
import { computeBreakpointsTopologyHash, resolveActiveScenesDiff } from "../domain/activationResolver";
import { mergeScenesBreakpoints, upsertBreakpointToScene } from "../domain/sceneOperations";
import { sceneStateManager } from "../domain/sceneStateManager";
import type { SceneBreakpoint, SourceSceneBreakpoint } from "../domain/types";
import { jsonFileSceneRepository } from "../infra/storage/jsonFileSceneRepository";
import { saveLoopGuard as defaultLoopGuard } from "../infra/storage/saveLoopGuard";
import { vscodeBreakpointBridge } from "../infra/vscode/vscodeBreakpointBridge";

/**
 * 内部私有单写者串行互斥队列
 * 职责：彻底阻断用户多命令连击、文件 Watcher、断点反向同步与调试启动等多源并发导致的交错竞态
 */
class SerialQueue {
	private currentQueue: Promise<any> = Promise.resolve();

	public run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.currentQueue.then(task, task);
		this.currentQueue = result.catch(() => {});
		return result;
	}
}

const queue = new SerialQueue();

// ==============================
// 1. 场景激活 (Activate Scene)
// ==============================

export interface ActivateSceneParams {
	workspaceRoot: string;
	targetScenes: string[];
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
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

async function doActivateScene(params: ActivateSceneParams): Promise<ActivateSceneResult> {
	const {
		workspaceRoot,
		targetScenes: rawTargetScenes,
		sceneRepository = jsonFileSceneRepository,
		breakpointBridge = vscodeBreakpointBridge,
		loopGuard = defaultLoopGuard,
	} = params;

	const config = sceneRepository.loadScenesConfig(workspaceRoot);
	const sceneNames = Object.keys(config.scenes || {});

	// 1. 过滤幽灵场景与有效性校验 (INV-009)
	const validTargetScenes: string[] = [];
	const missingScenes: string[] = [];

	for (const target of rawTargetScenes) {
		const matched = sceneNames.find((s) => s.toLowerCase() === target.toLowerCase());
		if (matched) {
			validTargetScenes.push(matched);
		} else {
			missingScenes.push(target);
		}
	}

	if (validTargetScenes.length === 0) {
		return {
			success: false,
			validTargetScenes: [],
			missingScenes,
			loadedCount: 0,
			healedCount: 0,
			unmatchedCount: 0,
		};
	}

	// 2. 聚合多场景断点并去重 (INV-001, INV-011)
	const bpsToLoad = mergeScenesBreakpoints(config, validTargetScenes);
	const primarySceneLabel = validTargetScenes.length === 1 ? validTargetScenes[0] : validTargetScenes.join(" + ");

	// 3. 权威持久化 SSOT 写入约束：先落盘 activeScenes，确保磁盘始终是权威 SSOT (INV-010)
	const currentDiskActives = config.activeScenes;
	const isSameActive =
		Array.isArray(currentDiskActives) &&
		currentDiskActives.length === validTargetScenes.length &&
		currentDiskActives.every((s, i) => s === validTargetScenes[i]);

	if (!isSameActive) {
		config.activeScenes = validTargetScenes;
		loopGuard.markInternalSaving();
		sceneRepository.saveScenesConfig(workspaceRoot, config);
	}

	// 4. 装配断点至宿主调试器 (INV-002, INV-005)
	const applyResult = await breakpointBridge.applySceneBreakpoints(
		workspaceRoot,
		primarySceneLabel,
		bpsToLoad,
	);

	const { loadedCount, healedCount } = applyResult;
	const enrichedCount = applyResult.enrichedCount || 0;
	const healedBreakpoints = applyResult.healedBreakpoints;
	const unmatchedCount = (applyResult as any).unmatchedBreakpoints?.length || 0;

	// 5. 将持久化结果投影更新至内存状态机，驱动 UI 渲染 (INV-004)
	sceneStateManager.setActiveScenes(validTargetScenes, loadedCount);

	// 6. 自愈与指纹补齐持久化闭环 (Self-Healing & Fingerprint Persistence Loopback)
	if ((healedCount > 0 || enrichedCount > 0) && healedBreakpoints) {
		let hasPersisted = false;
		if (validTargetScenes.length === 1) {
			config.scenes[validTargetScenes[0]] = healedBreakpoints;
			hasPersisted = true;
		} else {
			for (const sceneName of validTargetScenes) {
				const sceneList = config.scenes[sceneName];
				if (!Array.isArray(sceneList)) continue;
				for (const item of sceneList) {
					if (item.type === "function") continue;
					const srcItem = item as SourceSceneBreakpoint;
					const normSrcFile = srcItem.file ? srcItem.file.replace(/\\/g, "/") : "";
					const matched = healedBreakpoints.find(
						(h): h is SourceSceneBreakpoint => {
							if (h.type === "function") return false;
							const normHFile = h.file ? h.file.replace(/\\/g, "/") : "";
							if (normHFile !== normSrcFile) return false;
							if (srcItem.contextSnippet?.current) {
								return h.contextSnippet?.current === srcItem.contextSnippet.current;
							}
							return h.line === srcItem.line;
						},
					);
					if (matched) {
						if (srcItem.line !== matched.line) {
							srcItem.line = matched.line;
							hasPersisted = true;
						}
						if (!srcItem.contextSnippet && matched.contextSnippet) {
							srcItem.contextSnippet = matched.contextSnippet;
							hasPersisted = true;
						}
					}
				}
			}
		}
		if (hasPersisted) {
			loopGuard.markInternalSaving();
			sceneRepository.saveScenesConfig(workspaceRoot, config);
		}
	}

	return {
		success: true,
		validTargetScenes,
		missingScenes,
		loadedCount,
		healedCount,
		enrichedCount,
		unmatchedCount,
		unmatchedBreakpoints: applyResult.unmatchedBreakpoints,
	};
}

export async function activateScene(params: ActivateSceneParams): Promise<ActivateSceneResult> {
	return queue.run(() => doActivateScene(params));
}

// ==============================
// 2. 添加断点 (Add Breakpoint)
// ==============================

export interface AddBreakpointParams {
	workspaceRoot: string;
	targetScene: string;
	breakpoint: SceneBreakpoint;
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
}

export interface AddBreakpointResult {
	success: boolean;
	isImmediatelyApplied: boolean;
}

async function doAddBreakpoint(params: AddBreakpointParams): Promise<AddBreakpointResult> {
	const {
		workspaceRoot,
		targetScene,
		breakpoint,
		sceneRepository = jsonFileSceneRepository,
		breakpointBridge = vscodeBreakpointBridge,
		loopGuard = defaultLoopGuard,
	} = params;

	const config = sceneRepository.loadScenesConfig(workspaceRoot);
	if (!config.scenes) {
		config.scenes = {};
	}

	// 1. 唯一性查重覆盖 (INV-001)
	upsertBreakpointToScene(config, targetScene, breakpoint);

	// 2. 标记内部保存并持久化到权威 SSOT
	loopGuard.markInternalSaving();
	sceneRepository.saveScenesConfig(workspaceRoot, config);

	// 3. 即刻点亮判断：若目标场景当前已处于激活状态，实时增量注入并更新内存投影
	let isImmediatelyApplied = false;
	if (sceneStateManager.isSceneActive(targetScene)) {
		await breakpointBridge.applySingleBreakpointToEditor(workspaceRoot, breakpoint);
		sceneStateManager.setBaselineBreakpointCount(sceneStateManager.getBaselineBreakpointCount() + 1);
		isImmediatelyApplied = true;
	}

	return {
		success: true,
		isImmediatelyApplied,
	};
}

export async function addBreakpoint(params: AddBreakpointParams): Promise<AddBreakpointResult> {
	return queue.run(() => doAddBreakpoint(params));
}

// ==============================
// 3. 清空场景与断点 (Clear All)
// ==============================

export interface ClearAllParams {
	workspaceRoot?: string;
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
}

async function doClearAll(params: ClearAllParams = {}): Promise<void> {
	const {
		workspaceRoot,
		sceneRepository = jsonFileSceneRepository,
		breakpointBridge = vscodeBreakpointBridge,
		loopGuard = defaultLoopGuard,
	} = params;

	if (workspaceRoot) {
		const config = sceneRepository.loadScenesConfig(workspaceRoot);
		if (config.activeScenes && config.activeScenes.length > 0) {
			config.activeScenes = [];
			loopGuard.markInternalSaving();
			sceneRepository.saveScenesConfig(workspaceRoot, config);
		}
	}

	await breakpointBridge.clearAllBreakpoints();
	sceneStateManager.setActiveScene(undefined);
}

export async function clearAll(params: ClearAllParams = {}): Promise<void> {
	return queue.run(() => doClearAll(params));
}

// ==============================
// 4. 逆向导出断点至场景 (Export Scene)
// ==============================

export interface ExportSceneParams {
	workspaceRoot: string;
	targetScene: string;
	mode: "overwrite" | "append";
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
}

export interface ExportSceneResult {
	success: boolean;
	count: number;
}

async function doExportScene(params: ExportSceneParams): Promise<ExportSceneResult> {
	const {
		workspaceRoot,
		targetScene,
		mode,
		sceneRepository = jsonFileSceneRepository,
		breakpointBridge = vscodeBreakpointBridge,
		loopGuard = defaultLoopGuard,
	} = params;

	const exportedBps = await breakpointBridge.collectCurrentBreakpoints(workspaceRoot);
	if (exportedBps.length === 0) {
		return { success: false, count: 0 };
	}

	const config = sceneRepository.loadScenesConfig(workspaceRoot);
	if (!config.scenes) {
		config.scenes = {};
	}

	if (mode === "overwrite" || !config.scenes[targetScene]) {
		config.scenes[targetScene] = exportedBps;
	} else {
		for (const bp of exportedBps) {
			upsertBreakpointToScene(config, targetScene, bp);
		}
	}

	loopGuard.markInternalSaving();
	sceneRepository.saveScenesConfig(workspaceRoot, config);

	return {
		success: true,
		count: exportedBps.length,
	};
}

export async function exportScene(params: ExportSceneParams): Promise<ExportSceneResult> {
	return queue.run(() => doExportScene(params));
}

// ==============================
// 5. 响应外部文件变更 (Handle External Change)
// ==============================

export interface HandleExternalChangeParams {
	workspaceRoot: string;
	allowAiActivation: boolean;
	isDebuggingActive: boolean;
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	onPendingMessage?: () => void;
}

export interface HandleExternalChangeResult {
	action: "applied" | "cleared" | "pending" | "noop";
	targetScenes?: string[];
}

async function doHandleExternalChange(params: HandleExternalChangeParams): Promise<HandleExternalChangeResult> {
	const {
		workspaceRoot,
		allowAiActivation,
		isDebuggingActive,
		sceneRepository = jsonFileSceneRepository,
		breakpointBridge = vscodeBreakpointBridge,
		onPendingMessage,
	} = params;

	const config = sceneRepository.loadScenesConfig(workspaceRoot);
	const currentActives = sceneStateManager.getActiveScenes();

	const diff = resolveActiveScenesDiff({
		allowAiActivation,
		currentActiveScenes: currentActives,
		rawActiveScenes: config.activeScenes,
		scenesDict: config.scenes,
	});

	if (diff.shouldApply) {
		if (diff.action === "apply") {
			await doActivateScene({
				workspaceRoot,
				targetScenes: diff.targetScenes,
				sceneRepository,
				breakpointBridge,
			});
			return { action: "applied", targetScenes: diff.targetScenes };
		} else if (diff.action === "clear") {
			await doClearAll({
				workspaceRoot,
				sceneRepository,
				breakpointBridge,
			});
			return { action: "cleared" };
		}
	} else if (currentActives.length > 0 && !sceneStateManager.isApplyingScene()) {
		// 核心断点拓扑 Diff
		const merged = mergeScenesBreakpoints(config, currentActives);
		const newTopologyHash = computeBreakpointsTopologyHash(merged);

		if (newTopologyHash === sceneStateManager.getLastAppliedTopologyHash()) {
			return { action: "noop" };
		}

		// 调试会话保护 (策略 A: 挂起策略，不打断开发者调试心流)
		if (isDebuggingActive) {
			sceneStateManager.setPendingTopologyUpdate(true);
			if (onPendingMessage) {
				onPendingMessage();
			}
			return { action: "pending" };
		}

		// 拓扑发生实质变更且非调试中，重刷装配
		await breakpointBridge.applySceneBreakpoints(
			workspaceRoot,
			currentActives.join("+"),
			merged,
		);
		sceneStateManager.setLastAppliedTopologyHash(newTopologyHash);
		return { action: "applied", targetScenes: currentActives };
	}

	return { action: "noop" };
}

export async function handleExternalChange(params: HandleExternalChangeParams): Promise<HandleExternalChangeResult> {
	return queue.run(() => doHandleExternalChange(params));
}

// ==============================
// 场景服务聚合对象 (Scene Service)
// ==============================

export const sceneService = {
	activate: activateScene,
	addBreakpoint,
	clearAll,
	exportScene,
	handleExternalChange,
};
