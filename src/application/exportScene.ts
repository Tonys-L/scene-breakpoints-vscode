import type { IBreakpointBridge, ISceneRepository } from "../domain/ports";
import { upsertBreakpointToScene } from "../domain/sceneOperations";
import { jsonFileSceneRepository } from "../infra/storage/jsonFileSceneRepository";
import { saveLoopGuard as defaultLoopGuard } from "../infra/storage/saveLoopGuard";
import { vscodeBreakpointBridge } from "../infra/vscode/vscodeBreakpointBridge";
import { useCaseQueue } from "./useCaseQueue";

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

/**
 * 逆向导出断点至场景 (Export Scene)
 * 职责：纯业务流程编排，受串行队列保护，采集当前编辑器断点并持久化写入权威 SSOT 指定场景
 */
export async function exportScene(
	params: ExportSceneParams,
): Promise<ExportSceneResult> {
	return useCaseQueue.run(async () => {
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
	});
}

export const exportSceneUseCase = exportScene;
export type ExportSceneUseCaseParams = ExportSceneParams;
export type ExportSceneUseCaseResult = ExportSceneResult;

export const exportScenePolicy = exportScene;
export type ExportScenePolicyParams = ExportSceneParams;
export type ExportScenePolicyResult = ExportSceneResult;
