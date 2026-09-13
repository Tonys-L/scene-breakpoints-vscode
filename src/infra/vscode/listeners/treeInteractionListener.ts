import * as vscode from "vscode";
import { syncBreakpointEnabledToEditor } from "../vscodeBreakpointBridge";
import { getWorkspaceRoot, loadScenesConfig, saveScenesConfig } from "../../storage/jsonFileSceneRepository";
import { sceneStateManager } from "../../../domain/sceneStateManager";
import { BreakpointNode, SceneNode, SceneTreeDataProvider, type SceneTreeItem } from "../sceneTreeProvider";
import { saveLoopGuard } from "../../storage/saveLoopGuard";
import type { SceneBreakpoint } from "../../../domain/types";

const syncCoordinator = saveLoopGuard;

/**
 * 树视图交互与复选框协同服务 (Tree Interaction Listener)
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

			const config = loadScenesConfig(workspaceRoot);
			let hasChanges = false;
			const affectedBreakpoints: { node: BreakpointNode; sceneName: string; bp: SceneBreakpoint }[] = [];

			for (const [item, state] of e.items) {
				if (item instanceof BreakpointNode && item.sceneName && typeof item.index === "number") {
					const list = config.scenes[item.sceneName];
					if (list && list[item.index]) {
						const targetBp = list[item.index];
						const newEnabled = state === vscode.TreeItemCheckboxState.Checked;
						if (targetBp.enabled !== newEnabled) {
							targetBp.enabled = newEnabled;
							item.breakpoint.enabled = newEnabled; // 同步更新内存实体属性
							hasChanges = true;
							affectedBreakpoints.push({ node: item, sceneName: item.sceneName, bp: targetBp });
						}
					}
				}
			}

			if (hasChanges) {
				syncCoordinator.markInternalSaving();
				saveScenesConfig(workspaceRoot, config);

				// 局部精准刷新受影响的断点节点属性，绝不刷新整树
				for (const { node } of affectedBreakpoints) {
					node.updateAppearance();
					treeDataProvider.refresh(node);
				}

				// 若对应场景处于激活状态，实时就地同步编辑器原生断点
				for (const { sceneName, bp } of affectedBreakpoints) {
					if (sceneStateManager.isSceneActive(sceneName)) {
						await syncBreakpointEnabledToEditor(workspaceRoot, bp, bp.enabled ?? true);
					}
				}
			}
		}),
	);

	return vscode.Disposable.from(...disposables);
}

export const registerTreeInteractionCoordinator = registerTreeInteractionService;
