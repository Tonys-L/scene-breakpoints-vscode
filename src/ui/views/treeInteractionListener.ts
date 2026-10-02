import * as vscode from "vscode";
import { breakpointManager } from "#src/application";
import { getWorkspaceRoot } from "#src/ui/utils/workspaceRoot";
import { sceneStateManager } from "#src/application/sceneStateManager";

import { BreakpointNode, SceneNode, type SceneTreeDataProvider, type SceneTreeItem } from "./sceneTreeProvider";

/**
 * 树视图交互与复选框协同控制器 (Tree Interaction Controller)
 * 职责：专职负责树节点折叠/展开记忆、状态机变动响应式重绘，以及用户点击原生复选框时的写盘与局部精准 0 闪烁属性刷新
 */
export function registerTreeInteractionService(
	treeView: vscode.TreeView<SceneTreeItem>,
	treeDataProvider: SceneTreeDataProvider,
): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	// 1. 记录用户手动展开/折叠的场景状态，防止任何刷新导致折叠状态被重置
	disposables.push(
		treeView.onDidExpandElement((e) => {
			if (e.element instanceof SceneNode) {
				SceneNode.expandedScenes.add(e.element.sceneName);
			}
		}),
		treeView.onDidCollapseElement((e) => {
			if (e.element instanceof SceneNode) {
				SceneNode.expandedScenes.delete(e.element.sceneName);
			}
		}),
	);

	// 2. 状态机全局变更时响应式重绘树视图
	disposables.push(
		sceneStateManager.onDidChangeState(() => {
			treeDataProvider.refresh();
		}),
	);

	// 3. 监听用户点击树节点原生复选框事件 (对齐 VS Code 原生 Breakpoints 面板)
	disposables.push(
		treeView.onDidChangeCheckboxState(async (e) => {
			const workspaceRoot = getWorkspaceRoot(true);
			if (!workspaceRoot) return;

			for (const [item, state] of e.items) {
				if (item instanceof BreakpointNode && item.sceneName && typeof item.index === "number") {
					const newEnabled = state === vscode.TreeItemCheckboxState.Checked;
					const result = await breakpointManager.toggleBreakpoint(
						workspaceRoot,
						item.sceneName,
						item.index,
						newEnabled,
					);

					if (result.success) {
						item.breakpoint.enabled = result.newEnabled;
						item.updateAppearance();
						treeDataProvider.refresh(item);
					}
				}
			}
		}),
	);

	return vscode.Disposable.from(...disposables);
}

export const registerTreeInteractionCoordinator = registerTreeInteractionService;
