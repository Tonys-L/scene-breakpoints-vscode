import type { IBreakpointBridge, ISceneRepository } from "../core/ports";
import { upsertBreakpointToScene } from "../core/sceneOperations";
import { sceneStateManager } from "../core/sceneStateManager";
import type { SceneBreakpoint } from "../core/types";
import { jsonFileSceneRepository } from "../infra/storage/jsonFileSceneRepository";
import { saveLoopGuard as defaultLoopGuard } from "../infra/storage/saveLoopGuard";
import { vscodeBreakpointBridge } from "../infra/vscode/vscodeBreakpointBridge";

export interface AddBreakpointPolicyParams {
	workspaceRoot: string;
	targetScene: string;
	breakpoint: SceneBreakpoint;
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
}

export interface AddBreakpointPolicyResult {
	success: boolean;
	isImmediatelyApplied: boolean;
}

/**
 * 添加断点到场景核心用例 (Add Breakpoint Policy)
 * 职责：纯策略编排，向配置场景中 upsert 断点并落盘；若场景正处于激活态，驱动即刻点亮并刷新基准数
 */
export async function addBreakpointPolicy(
	params: AddBreakpointPolicyParams,
): Promise<AddBreakpointPolicyResult> {
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

	// 2. 标记内部保存并持久化
	loopGuard.markInternalSaving();
	sceneRepository.saveScenesConfig(workspaceRoot, config);

	// 3. 即刻点亮判断：若目标场景当前已处于激活状态，实时增量注入
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
