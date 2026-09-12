import { clearAllBreakpoints } from "../adapters/breakpointAdapter";
import { sceneStateManager } from "../core/sceneStateManager";
import { getWorkspaceRoot, loadScenesConfig, saveScenesConfig } from "../config/configManager";
import { syncService } from "../services/syncService";
const syncCoordinator = syncService;

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
