import type { IBreakpointBridge, ISceneRepository } from "../domain/ports";
import { upsertBreakpointToScene } from "../domain/sceneOperations";
import { sceneStateManager } from "../domain/sceneStateManager";
import type { SceneBreakpoint } from "../domain/types";
import { jsonFileSceneRepository } from "../infra/storage/jsonFileSceneRepository";
import { saveLoopGuard as defaultLoopGuard } from "../infra/storage/saveLoopGuard";
import { vscodeBreakpointBridge } from "../infra/vscode/vscodeBreakpointBridge";
import { useCaseQueue } from "./useCaseQueue";

export interface AddBreakpointUseCaseParams {
	workspaceRoot: string;
	targetScene: string;
	breakpoint: SceneBreakpoint;
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
}

export interface AddBreakpointUseCaseResult {
	success: boolean;
	isImmediatelyApplied: boolean;
}

/**
 * 添加断点到场景核心用例 (Add Breakpoint Use Case)
 * 职责：纯业务用例编排，受串行队列保护，向配置场景中 upsert 断点并落盘；若场景正处于激活态，驱动即刻点亮并刷新内存投影基准数
 */
export async function addBreakpointUseCase(
	params: AddBreakpointUseCaseParams,
): Promise<AddBreakpointUseCaseResult> {
	return useCaseQueue.run(async () => {
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
	});
}

export const addBreakpointPolicy = addBreakpointUseCase;
export type AddBreakpointPolicyParams = AddBreakpointUseCaseParams;
export type AddBreakpointPolicyResult = AddBreakpointUseCaseResult;
