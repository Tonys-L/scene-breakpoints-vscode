import * as vscode from "vscode";
import {
	getWorkspaceRoot,
	loadScenesConfig,
	saveScenesConfig,
	syncEditorBreakpointChangesToConfig,
} from "../config/configManager";
import { sceneStateManager } from "../core/sceneStateManager";
import { SceneTreeDataProvider } from "../providers/sceneTreeProvider";
import { syncCoordinator } from "./syncService";

/**
 * 断点全双工同步与脏状态服务 (Breakpoint Sync Service)
 * 职责：专职负责监听 VS Code 编辑器原生断点变动事件，受原子锁与内部写盘防回环保护，将启用/禁用变更反向同步至激活场景并检查脏状态
 */
export function registerBreakpointSyncService(
	treeDataProvider: SceneTreeDataProvider,
): vscode.Disposable {
	return vscode.debug.onDidChangeBreakpoints(async (event) => {
		if (sceneStateManager.isApplyingScene()) {
			return;
		}

		const currentCount = vscode.debug.breakpoints.length;
		if (currentCount === 0) {
			sceneStateManager.setActiveScene(undefined, 0);
			return;
		}

		if (event.changed && event.changed.length > 0) {
			const activeScenes = sceneStateManager.getActiveScenes();
			if (activeScenes.length > 0) {
				const workspaceRoot = getWorkspaceRoot(false);
				if (workspaceRoot) {
					const config = loadScenesConfig(workspaceRoot);
					const hasUpdated = syncEditorBreakpointChangesToConfig(
						config,
						activeScenes,
						event.changed,
						workspaceRoot,
					);
					if (hasUpdated) {
						syncCoordinator.markInternalSaving();
						saveScenesConfig(workspaceRoot, config);
						treeDataProvider.refresh();
					}
				}
			}
		}

		sceneStateManager.checkDirtyWithCount(currentCount);
	});
}

export const registerBreakpointSyncCoordinator = registerBreakpointSyncService;

