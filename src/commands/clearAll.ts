import { clearAllBreakpoints } from "../breakpointAdapter";
import { sceneStateManager } from "../sceneStateManager";
import { getWorkspaceRoot, loadScenesConfig, saveScenesConfig } from "../configManager";
import { syncCoordinator } from "../syncCoordinator";

export async function clearAllCommand(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(false);
	if (workspaceRoot) {
		const config = loadScenesConfig(workspaceRoot);
		if (config.activeScenes && config.activeScenes.length > 0) {
			config.activeScenes = [];
			syncCoordinator.markInternalSaving();
			saveScenesConfig(workspaceRoot, config);
		}
	}
	await clearAllBreakpoints();
	sceneStateManager.setActiveScene(undefined);
}
