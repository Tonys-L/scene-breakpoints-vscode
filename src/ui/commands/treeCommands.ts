import * as path from "node:path";
import * as vscode from "vscode";
import { sceneManager, breakpointManager } from "#src/application";
import { sceneStateManager } from "#src/application/sceneStateManager";
import type { SceneTreeDataProvider } from "#src/ui/views/sceneTreeProvider";
import { BreakpointNode, type SceneNode } from "#src/ui/views/treeNodes";
import { findBreakpointLineInJson } from "#src/ui/locators/sceneJsonLocator";
import { applySceneCommand } from "./sceneCommands";
import { runWithWorkspace } from "#src/ui/utils/commandRunner";
import { promptSceneName, confirmModalAction } from "#src/ui/utils/promptHelpers";

function registerSceneActivationCommands(): vscode.Disposable[] {
	const handleToggleSceneItem = async (node?: SceneNode) => {
		if (node?.sceneName) {
			const nextScenes = sceneStateManager.toggleScene(node.sceneName);
			await applySceneCommand(nextScenes);
		}
	};
	return [
		vscode.commands.registerCommand("sceneBreakpoints.applySceneItem", handleToggleSceneItem),
		vscode.commands.registerCommand("sceneBreakpoints.toggleSceneActivation", handleToggleSceneItem),
	];
}

function registerSceneCrudCommands(treeDataProvider: SceneTreeDataProvider): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand("sceneBreakpoints.refreshView", () => {
			treeDataProvider.refresh();
		}),
		vscode.commands.registerCommand("sceneBreakpoints.createNewScene", async () => {
			await runWithWorkspace(true, async (workspaceRoot) => {
				const target = await promptSceneName({
					prompt: vscode.l10n.t("Enter new scene identifier (e.g. auth-flow)"),
					placeHolder: "auth-flow",
				});
				if (!target) return;

				const ok = await sceneManager.createScene(workspaceRoot, target);
				if (ok) {
					void vscode.window.showInformationMessage(vscode.l10n.t("Created empty scene [{0}]", target));
				} else {
					void vscode.window.showWarningMessage(vscode.l10n.t("Scene [{0}] already exists", target));
				}
			});
		}),
		vscode.commands.registerCommand("sceneBreakpoints.renameSceneItem", async (node?: SceneNode) => {
			if (!node?.sceneName) return;
			await runWithWorkspace(true, async (workspaceRoot) => {
				const newName = await promptSceneName({
					prompt: vscode.l10n.t("Enter new identifier for scene [{0}]", node.sceneName),
					value: node.sceneName,
				});
				if (!newName || newName === node.sceneName) return;

				const renamed = await sceneManager.renameScene(workspaceRoot, node.sceneName, newName);
				if (renamed) {
					void vscode.window.showInformationMessage(
						vscode.l10n.t("Renamed scene [{0}] to [{1}]", node.sceneName, newName),
					);
				}
			});
		}),
		vscode.commands.registerCommand("sceneBreakpoints.deleteSceneItem", async (node?: SceneNode) => {
			if (!node?.sceneName) return;
			await runWithWorkspace(true, async (workspaceRoot) => {
				const confirmed = await confirmModalAction(
					vscode.l10n.t("Are you sure you want to delete scene [{0}]? This action cannot be undone.", node.sceneName),
					vscode.l10n.t("Delete"),
				);
				if (!confirmed) return;

				const deleted = await sceneManager.deleteScene(workspaceRoot, node.sceneName);
				if (deleted) {
					void vscode.window.showInformationMessage(vscode.l10n.t("Deleted scene [{0}]", node.sceneName));
				}
			});
		}),
		vscode.commands.registerCommand("sceneBreakpoints.duplicateScene", async (node?: SceneNode) => {
			if (!node?.sceneName) return;
			await runWithWorkspace(true, async (workspaceRoot) => {
				const target = await promptSceneName({
					prompt: vscode.l10n.t("Enter target identifier for duplicated scene"),
					value: `${node.sceneName}-copy`,
				});
				if (!target) return;

				const duplicated = await sceneManager.duplicateScene(workspaceRoot, node.sceneName, target);
				if (duplicated) {
					void vscode.window.showInformationMessage(
						vscode.l10n.t("Duplicated scene [{0}] as [{1}]", node.sceneName, target),
					);
				} else {
					void vscode.window.showWarningMessage(vscode.l10n.t("Scene [{0}] already exists", target));
				}
			});
		}),
	];
}

function registerBreakpointMutationCommands(): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand("sceneBreakpoints.removeBreakpointItem", async (node?: BreakpointNode) => {
			if (!node || typeof node.index !== "number" || !node.sceneName) return;
			await runWithWorkspace(true, async (workspaceRoot) => {
				await breakpointManager.removeBreakpoint(workspaceRoot, node.sceneName, node.index);
			});
		}),
		vscode.commands.registerCommand("sceneBreakpoints.toggleBreakpointItem", async (node?: BreakpointNode) => {
			if (!node || typeof node.index !== "number" || !node.sceneName) return;
			await runWithWorkspace(true, async (workspaceRoot) => {
				const result = await breakpointManager.toggleBreakpoint(workspaceRoot, node.sceneName, node.index);
				if (result.success) {
					node.breakpoint.enabled = result.newEnabled;
					node.updateAppearance();
				}
			});
		}),
		vscode.commands.registerCommand("sceneBreakpoints.enableAllBreakpointsInScene", async (node?: SceneNode) => {
			if (!node?.sceneName) return;
			await runWithWorkspace(true, async (workspaceRoot) => {
				const changed = await breakpointManager.setAllEnabled(workspaceRoot, node.sceneName, true);
				if (changed) {
					void vscode.window.showInformationMessage(vscode.l10n.t("Enabled all breakpoints in scene [{0}]", node.sceneName));
				}
			});
		}),
		vscode.commands.registerCommand("sceneBreakpoints.disableAllBreakpointsInScene", async (node?: SceneNode) => {
			if (!node?.sceneName) return;
			await runWithWorkspace(true, async (workspaceRoot) => {
				const changed = await breakpointManager.setAllEnabled(workspaceRoot, node.sceneName, false);
				if (changed) {
					void vscode.window.showInformationMessage(vscode.l10n.t("Disabled all breakpoints in scene [{0}]", node.sceneName));
				}
			});
		}),
		vscode.commands.registerCommand("sceneBreakpoints.revealInConfigFile", async (node?: BreakpointNode) => {
			if (!node?.sceneName || !node.breakpoint) return;
			await runWithWorkspace(true, async (workspaceRoot) => {
				const configPath = path.join(workspaceRoot, ".vscode", "debug-scenes.json");
				try {
					const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
					const editor = await vscode.window.showTextDocument(doc, { preview: false });
					const targetLine = findBreakpointLineInJson(doc.getText(), node.sceneName, node.breakpoint!);

					const lineIdx = Math.max(0, targetLine - 1);
					const pos = new vscode.Position(lineIdx, 0);
					const range = new vscode.Range(pos, pos);
					editor.selection = new vscode.Selection(pos, pos);
					editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
				} catch (err: any) {
					void vscode.window.showWarningMessage(
						vscode.l10n.t("Failed to read debug-scenes.json: {0}", err?.message || String(err)),
					);
				}
			});
		}),
	];
}

function resolveTargetNode(
	node: BreakpointNode | undefined,
	treeView?: vscode.TreeView<any>,
): BreakpointNode | undefined {
	if (node instanceof BreakpointNode && typeof node.index === "number") return node;
	const selected = treeView?.selection?.[0];
	if (selected instanceof BreakpointNode && typeof selected.index === "number") return selected;
	return undefined;
}

function calculateTargetIndex(
	direction: "up" | "down" | "top" | "bottom",
	currentIndex: number,
	listLength: number,
): number {
	if (direction === "top") return 0;
	if (direction === "bottom") return listLength - 1;
	if (direction === "up") return Math.max(0, currentIndex - 1);
	return Math.min(listLength - 1, currentIndex + 1);
}

async function executeMove(
	rawNode: BreakpointNode | undefined,
	direction: "up" | "down" | "top" | "bottom",
	treeDataProvider: SceneTreeDataProvider,
	treeView?: vscode.TreeView<any>,
): Promise<void> {
	const node = resolveTargetNode(rawNode, treeView);
	if (!node || typeof node.index !== "number" || !node.sceneName) return;

	await runWithWorkspace(true, async (workspaceRoot) => {
		const moved = await breakpointManager.moveBreakpoint(workspaceRoot, node.sceneName, node.index, direction);

		if (moved && treeView) {
			const config = sceneManager.loadScenesConfig(workspaceRoot);
			const list = config.scenes[node.sceneName] || [];
			const targetIndex = calculateTargetIndex(direction, node.index, list.length);

			setTimeout(async () => {
				try {
					const children = await treeDataProvider.getBreakpointNodes(node.sceneName);
					const updatedNode = children.find((c) => c.index === targetIndex);
					if (updatedNode) {
						await treeView.reveal(updatedNode, { select: true, focus: true });
					}
				} catch {
					// 忽略 reveal 失败
				}
			}, 50);
		}
	});
}

function registerBreakpointReorderCommands(
	treeDataProvider: SceneTreeDataProvider,
	treeView?: vscode.TreeView<any>,
): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand("sceneBreakpoints.moveBreakpointUp", async (node?: BreakpointNode) => {
			await executeMove(node, "up", treeDataProvider, treeView);
		}),
		vscode.commands.registerCommand("sceneBreakpoints.moveBreakpointDown", async (node?: BreakpointNode) => {
			await executeMove(node, "down", treeDataProvider, treeView);
		}),
		vscode.commands.registerCommand("sceneBreakpoints.moveBreakpointToTop", async (node?: BreakpointNode) => {
			await executeMove(node, "top", treeDataProvider, treeView);
		}),
		vscode.commands.registerCommand("sceneBreakpoints.moveBreakpointToBottom", async (node?: BreakpointNode) => {
			await executeMove(node, "bottom", treeDataProvider, treeView);
		}),
	];
}

/**
 * 注册侧边栏场景管理树视图相关的所有用户交互与上下文命令
 */
export function registerTreeCommands(
	context: vscode.ExtensionContext,
	treeDataProvider: SceneTreeDataProvider,
	treeView?: vscode.TreeView<any>,
): void {
	context.subscriptions.push(
		...registerSceneActivationCommands(),
		...registerSceneCrudCommands(treeDataProvider),
		...registerBreakpointMutationCommands(),
		...registerBreakpointReorderCommands(treeDataProvider, treeView),
	);
}
