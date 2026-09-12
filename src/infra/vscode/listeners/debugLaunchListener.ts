import * as vscode from "vscode";
import { applySceneCommand } from "../controllers/applyScene";
import { resolveLaunchBoundScenes } from "../../../core/launchResolver";
import { getWorkspaceRoot, loadScenesConfig } from "../../storage/jsonFileSceneRepository";
import { sceneStateManager } from "../../../core/sceneStateManager";

/**
 * 调试启动联动服务 (Debug Launch Listener)
 * 职责：专职负责在调试配置启动前，依据三级优先级推导关联场景，并在满足非重复条件时幂等激活目标场景
 */
export function registerDebugLaunchService(): vscode.Disposable {
	return vscode.debug.registerDebugConfigurationProvider("*", {
		async resolveDebugConfiguration(
			_folder: vscode.WorkspaceFolder | undefined,
			config: vscode.DebugConfiguration,
		) {
			const autoActivate = vscode.workspace
				.getConfiguration("sceneBreakpoints")
				.get<boolean>("autoActivateOnLaunch", true);

			if (autoActivate && config) {
				const workspaceRoot = getWorkspaceRoot(false);
				if (workspaceRoot) {
					const scenesConfig = loadScenesConfig(workspaceRoot);
					const targetScenes = resolveLaunchBoundScenes(
						scenesConfig,
						config.name,
						config.env?.DEBUG_SCENE,
					);

					if (targetScenes.length > 0) {
						// 幂等守卫 (Idempotency Guard): 若当前已激活的场景集合与目标完全一致，跳过切换
						const currentActives = sceneStateManager.getActiveScenes();
						const isIdentical =
							currentActives.length === targetScenes.length &&
							currentActives.every((s, idx) => s === targetScenes[idx]);

						if (!isIdentical) {
							await applySceneCommand(targetScenes);
						}
					}
				}
			}
			return config;
		},
	});
}

export const registerDebugLaunchCoordinator = registerDebugLaunchService;
