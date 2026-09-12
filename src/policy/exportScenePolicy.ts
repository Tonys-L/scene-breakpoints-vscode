import type { IBreakpointBridge, ISceneRepository } from "../core/ports";
import { upsertBreakpointToScene } from "../core/sceneOperations";
import { jsonFileSceneRepository } from "../infra/storage/jsonFileSceneRepository";
import { saveLoopGuard as defaultLoopGuard } from "../infra/storage/saveLoopGuard";
import { vscodeBreakpointBridge } from "../infra/vscode/vscodeBreakpointBridge";

export interface ExportScenePolicyParams {
	workspaceRoot: string;
	targetScene: string;
	mode: "overwrite" | "append";
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
}

export interface ExportScenePolicyResult {
	success: boolean;
	count: number;
}

/**
 * 逆向导出断点至场景核心用例 (Export Scene Policy)
 * 职责：纯策略编排，采集当前编辑器断点并落盘保存至指定场景
 */
export async function exportScenePolicy(
	params: ExportScenePolicyParams,
): Promise<ExportScenePolicyResult> {
	const {
		workspaceRoot,
		targetScene,
		mode,
		sceneRepository = jsonFileSceneRepository,
		breakpointBridge = vscodeBreakpointBridge,
		loopGuard = defaultLoopGuard,
	} = params;

	const exportedBps = breakpointBridge.collectCurrentBreakpoints(workspaceRoot);
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
