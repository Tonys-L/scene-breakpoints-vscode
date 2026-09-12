import * as vscode from "vscode";
import { getWorkspaceRoot } from "../../storage/jsonFileSceneRepository";
import { sceneStateManager } from "../../../core/sceneStateManager";
import { handleExternalScenesFileChange } from "./aiActivationListener";

/**
 * 调试会话生命周期服务 (Session Lifecycle Listener)
 * 职责：专职负责监听调试会话终止事件，失效清空核心拓扑快照，并在存在挂起的外部拓扑更新时自动补发装配重刷
 */
export function registerSessionLifecycleService(): vscode.Disposable {
	return vscode.debug.onDidTerminateDebugSession(async () => {
		// 调试会话结束后，核心断点拓扑快照失效清空
		sceneStateManager.clearLastAppliedTopologyHash();
		// 调试会话结束后，若存在挂起的断点拓扑更新，平滑自动执行重刷
		if (sceneStateManager.isPendingTopologyUpdate()) {
			sceneStateManager.setPendingTopologyUpdate(false);
			const workspaceRoot = getWorkspaceRoot(false);
			if (workspaceRoot) {
				await handleExternalScenesFileChange(workspaceRoot);
			}
		}
	});
}

export const registerSessionLifecycleCoordinator = registerSessionLifecycleService;
