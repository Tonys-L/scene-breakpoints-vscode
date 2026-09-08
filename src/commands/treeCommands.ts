import * as vscode from "vscode";
import { syncBreakpointEnabledToEditor } from "../breakpointAdapter";
import {
	deleteSceneFromConfig,
	duplicateSceneInConfig,
	getWorkspaceRoot,
	loadScenesConfig,
	renameSceneInConfig,
	removeBreakpointFromConfig,
	saveScenesConfig,
	setAllBreakpointsEnabledInScene,
	toggleBreakpointEnabledInConfig,
} from "../configManager";
import { sceneStateManager } from "../sceneStateManager";
import { BreakpointNode, SceneNode, SceneTreeDataProvider } from "../sceneTreeProvider";
import { syncCoordinator } from "../syncCoordinator";
import { applySceneCommand } from "./applyScene";

/**
 * 注册侧边栏场景管理树视图相关的所有用户交互与上下文命令
 */
export function registerTreeCommands(
	context: vscode.ExtensionContext,
	treeDataProvider: SceneTreeDataProvider,
): void {
	// 1. 刷新树视图
	const refreshViewCmd = vscode.commands.registerCommand("sceneBreakpoints.refreshView", () => {
		treeDataProvider.refresh();
	});

	// 2. 新建空白场景
	const createNewSceneCmd = vscode.commands.registerCommand("sceneBreakpoints.createNewScene", async () => {
		const workspaceRoot = getWorkspaceRoot(true);
		if (!workspaceRoot) return;

		const sceneName = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter new scene identifier (e.g. auth-flow)"),
			placeHolder: "auth-flow",
			validateInput: (v) => (!v || !v.trim() ? vscode.l10n.t("Scene name cannot be empty") : null),
		});
		if (!sceneName) return;

		const config = loadScenesConfig(workspaceRoot);
		const target = sceneName.trim();
		if (!config.scenes[target]) {
			config.scenes[target] = [];
			syncCoordinator.markInternalSaving();
			saveScenesConfig(workspaceRoot, config);
			treeDataProvider.refresh();
			vscode.window.showInformationMessage(vscode.l10n.t("Created empty scene [{0}]", target));
		} else {
			vscode.window.showWarningMessage(vscode.l10n.t("Scene [{0}] already exists", target));
		}
	});

	// 3. 应用或叠加场景
	const applySceneItemCmd = vscode.commands.registerCommand(
		"sceneBreakpoints.applySceneItem",
		async (node?: SceneNode) => {
			if (node && node.sceneName) {
				const nextScenes = sceneStateManager.toggleScene(node.sceneName);
				await applySceneCommand(nextScenes);
			}
		},
	);

	// 4. 切换场景激活状态
	const toggleSceneActivationCmd = vscode.commands.registerCommand(
		"sceneBreakpoints.toggleSceneActivation",
		async (node?: SceneNode) => {
			if (node && node.sceneName) {
				const nextScenes = sceneStateManager.toggleScene(node.sceneName);
				await applySceneCommand(nextScenes);
			}
		},
	);

	// 5. 重命名场景
	const renameSceneItemCmd = vscode.commands.registerCommand(
		"sceneBreakpoints.renameSceneItem",
		async (node?: SceneNode) => {
			if (!node || !node.sceneName) return;
			const workspaceRoot = getWorkspaceRoot(true);
			if (!workspaceRoot) return;

			const newName = await vscode.window.showInputBox({
				prompt: vscode.l10n.t("Enter new identifier for scene [{0}]", node.sceneName),
				value: node.sceneName,
				validateInput: (v) => (!v || !v.trim() ? vscode.l10n.t("Scene name cannot be empty") : null),
			});
			if (!newName || newName.trim() === node.sceneName) return;

			const config = loadScenesConfig(workspaceRoot);
			const renamed = renameSceneInConfig(config, node.sceneName, newName.trim());
			if (renamed) {
				syncCoordinator.markInternalSaving();
				saveScenesConfig(workspaceRoot, config);
				const currentActives = sceneStateManager.getActiveScenes();
				if (currentActives.includes(node.sceneName)) {
					const updated = currentActives.map((s) => (s === node.sceneName ? newName.trim() : s));
					sceneStateManager.setActiveScenes(updated);
				}
				treeDataProvider.refresh();
				vscode.window.showInformationMessage(
					vscode.l10n.t("Renamed scene [{0}] to [{1}]", node.sceneName, newName.trim()),
				);
			}
		},
	);

	// 6. 删除场景
	const deleteSceneItemCmd = vscode.commands.registerCommand(
		"sceneBreakpoints.deleteSceneItem",
		async (node?: SceneNode) => {
			if (!node || !node.sceneName) return;
			const workspaceRoot = getWorkspaceRoot(true);
			if (!workspaceRoot) return;

			const confirmText = vscode.l10n.t("Delete");
			const choice = await vscode.window.showWarningMessage(
				vscode.l10n.t("Are you sure you want to delete scene [{0}]? This action cannot be undone.", node.sceneName),
				{ modal: true },
				confirmText,
			);
			if (choice !== confirmText) return;

			const config = loadScenesConfig(workspaceRoot);
			const deleted = deleteSceneFromConfig(config, node.sceneName);
			if (deleted) {
				syncCoordinator.markInternalSaving();
				saveScenesConfig(workspaceRoot, config);
				const currentActives = sceneStateManager.getActiveScenes();
				if (currentActives.includes(node.sceneName)) {
					const remaining = currentActives.filter((s) => s !== node.sceneName);
					sceneStateManager.setActiveScenes(remaining);
				}
				treeDataProvider.refresh();
				vscode.window.showInformationMessage(vscode.l10n.t("Deleted scene [{0}]", node.sceneName));
			}
		},
	);

	// 7. 移除单个断点
	const removeBpItemCmd = vscode.commands.registerCommand(
		"sceneBreakpoints.removeBreakpointItem",
		async (node?: BreakpointNode) => {
			if (!node || typeof node.index !== "number" || !node.sceneName) return;
			const workspaceRoot = getWorkspaceRoot(true);
			if (!workspaceRoot) return;

			const config = loadScenesConfig(workspaceRoot);
			const removed = removeBreakpointFromConfig(config, node.sceneName, node.index);
			if (removed) {
				syncCoordinator.markInternalSaving();
				saveScenesConfig(workspaceRoot, config);
				treeDataProvider.refresh();
			}
		},
	);

	// 8. 切换单个断点启用/禁用状态 (内联按钮)
	const toggleBpItemCmd = vscode.commands.registerCommand(
		"sceneBreakpoints.toggleBreakpointItem",
		async (node?: BreakpointNode) => {
			if (!node || typeof node.index !== "number" || !node.sceneName) return;
			const workspaceRoot = getWorkspaceRoot(true);
			if (!workspaceRoot) return;

			const config = loadScenesConfig(workspaceRoot);
			const toggled = toggleBreakpointEnabledInConfig(config, node.sceneName, node.index);
			if (toggled) {
				const updatedBp = config.scenes[node.sceneName]?.[node.index];
				if (updatedBp) {
					node.breakpoint.enabled = updatedBp.enabled;
					node.updateAppearance();
				}
				syncCoordinator.markInternalSaving();
				saveScenesConfig(workspaceRoot, config);
				treeDataProvider.refresh(node);

				// 若该断点所属场景当前处于激活状态，实时就地同步 VS Code 编辑器原生断点启用状态
				if (updatedBp && sceneStateManager.isSceneActive(node.sceneName)) {
					await syncBreakpointEnabledToEditor(workspaceRoot, updatedBp, updatedBp.enabled ?? true);
				}
			}
		},
	);

	// 9. 批量启用场景内所有断点
	const enableAllBreakpointsInSceneCmd = vscode.commands.registerCommand(
		"sceneBreakpoints.enableAllBreakpointsInScene",
		async (node?: SceneNode) => {
			if (!node || !node.sceneName) return;
			const workspaceRoot = getWorkspaceRoot(true);
			if (!workspaceRoot) return;

			const config = loadScenesConfig(workspaceRoot);
			const changed = setAllBreakpointsEnabledInScene(config, node.sceneName, true);
			if (changed) {
				syncCoordinator.markInternalSaving();
				saveScenesConfig(workspaceRoot, config);
				treeDataProvider.refresh(node);

				if (sceneStateManager.isSceneActive(node.sceneName)) {
					const list = config.scenes[node.sceneName] || [];
					for (const bp of list) {
						await syncBreakpointEnabledToEditor(workspaceRoot, bp, true);
					}
				}
				vscode.window.showInformationMessage(vscode.l10n.t("Enabled all breakpoints in scene [{0}]", node.sceneName));
			}
		},
	);

	// 10. 批量禁用场景内所有断点
	const disableAllBreakpointsInSceneCmd = vscode.commands.registerCommand(
		"sceneBreakpoints.disableAllBreakpointsInScene",
		async (node?: SceneNode) => {
			if (!node || !node.sceneName) return;
			const workspaceRoot = getWorkspaceRoot(true);
			if (!workspaceRoot) return;

			const config = loadScenesConfig(workspaceRoot);
			const changed = setAllBreakpointsEnabledInScene(config, node.sceneName, false);
			if (changed) {
				syncCoordinator.markInternalSaving();
				saveScenesConfig(workspaceRoot, config);
				treeDataProvider.refresh(node);

				if (sceneStateManager.isSceneActive(node.sceneName)) {
					const list = config.scenes[node.sceneName] || [];
					for (const bp of list) {
						await syncBreakpointEnabledToEditor(workspaceRoot, bp, false);
					}
				}
				vscode.window.showInformationMessage(vscode.l10n.t("Disabled all breakpoints in scene [{0}]", node.sceneName));
			}
		},
	);

	// 11. 克隆/复制场景副本
	const duplicateSceneCmd = vscode.commands.registerCommand(
		"sceneBreakpoints.duplicateScene",
		async (node?: SceneNode) => {
			if (!node || !node.sceneName) return;
			const workspaceRoot = getWorkspaceRoot(true);
			if (!workspaceRoot) return;

			const defaultTargetName = `${node.sceneName}-copy`;
			const newName = await vscode.window.showInputBox({
				prompt: vscode.l10n.t("Enter target identifier for duplicated scene"),
				value: defaultTargetName,
				validateInput: (v) => (!v || !v.trim() ? vscode.l10n.t("Scene name cannot be empty") : null),
			});
			if (!newName) return;

			const config = loadScenesConfig(workspaceRoot);
			const target = newName.trim();
			if (config.scenes[target]) {
				vscode.window.showWarningMessage(vscode.l10n.t("Scene [{0}] already exists", target));
				return;
			}

			const duplicated = duplicateSceneInConfig(config, node.sceneName, target);
			if (duplicated) {
				syncCoordinator.markInternalSaving();
				saveScenesConfig(workspaceRoot, config);
				treeDataProvider.refresh();
				vscode.window.showInformationMessage(
					vscode.l10n.t("Duplicated scene [{0}] as [{1}]", node.sceneName, target),
				);
			}
		},
	);

	context.subscriptions.push(
		refreshViewCmd,
		createNewSceneCmd,
		applySceneItemCmd,
		toggleSceneActivationCmd,
		renameSceneItemCmd,
		deleteSceneItemCmd,
		removeBpItemCmd,
		toggleBpItemCmd,
		enableAllBreakpointsInSceneCmd,
		disableAllBreakpointsInSceneCmd,
		duplicateSceneCmd,
	);
}
