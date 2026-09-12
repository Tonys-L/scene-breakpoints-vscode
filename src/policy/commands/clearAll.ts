import { clearAllBreakpoints } from "../../infra/vscode/vscodeBreakpointBridge";
import { sceneStateManager } from "../../core/sceneStateManager";
import { getWorkspaceRoot, loadScenesConfig, saveScenesConfig } from "../../infra/storage/jsonFileSceneRepository";
import { saveLoopGuard } from "../saveLoopGuard";

export async function clearAllCommand(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(false);
	if (workspaceRoot) {
		const config = loadScenesConfig(workspaceRoot);
		if (config.activeScenes && config.activeScenes.length > 0) {
			config.activeScenes = [];
			saveLoopGuard.markInternalSaving();
			saveScenesConfig(workspaceRoot, config);
		}
	}
	await clearAllBreakpoints();
	sceneStateManager.setActiveScene(undefined);
}
