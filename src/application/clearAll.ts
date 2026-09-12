import type { IBreakpointBridge, ISceneRepository } from "../domain/ports";
import { sceneStateManager } from "../domain/sceneStateManager";
import { jsonFileSceneRepository } from "../infra/storage/jsonFileSceneRepository";
import { saveLoopGuard as defaultLoopGuard } from "../infra/storage/saveLoopGuard";
import { vscodeBreakpointBridge } from "../infra/vscode/vscodeBreakpointBridge";
import { useCaseQueue } from "./useCaseQueue";

export interface ClearAllParams {
	workspaceRoot?: string;
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
}

/**
 * 清空场景与断点 (Clear All)
 * 职责：纯业务流程编排，受串行队列保护，清空权威持久化配置 activeScenes、清空宿主原生断点并复位内存投影
 */
export async function clearAll(params: ClearAllParams = {}): Promise<void> {
	return useCaseQueue.run(async () => {
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
	});
}

export const clearAllUseCase = clearAll;
export type ClearAllUseCaseParams = ClearAllParams;

export const clearAllPolicy = clearAll;
export type ClearAllPolicyParams = ClearAllParams;
