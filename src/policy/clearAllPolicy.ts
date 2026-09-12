import type { IBreakpointBridge, ISceneRepository } from "../core/ports";
import { sceneStateManager } from "../core/sceneStateManager";
import { jsonFileSceneRepository } from "../infra/storage/jsonFileSceneRepository";
import { saveLoopGuard as defaultLoopGuard } from "../infra/storage/saveLoopGuard";
import { vscodeBreakpointBridge } from "../infra/vscode/vscodeBreakpointBridge";

export interface ClearAllPolicyParams {
	workspaceRoot?: string;
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
}

/**
 * 清空场景与断点核心用例 (Clear All Policy)
 * 职责：纯策略编排，清空配置中的 activeScenes、清空宿主原生断点并复位状态机 SSOT
 */
export async function clearAllPolicy(params: ClearAllPolicyParams = {}): Promise<void> {
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
