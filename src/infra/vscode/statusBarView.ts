import * as vscode from "vscode";
import { sceneStateManager } from "../../domain/sceneStateManager";

let statusBarItem: vscode.StatusBarItem | undefined;

export function getStatusBarItem(): vscode.StatusBarItem | undefined {
	return statusBarItem;
}

export function initStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
	statusBarItem.command = "sceneBreakpoints.showMenu";

	// 初始渲染
	renderStatusBar(sceneStateManager.getActiveScenes(), sceneStateManager.getIsDirty());
	statusBarItem.show();

	// 订阅状态机变化事件 (响应式视图渲染)
	const sub = sceneStateManager.onDidChangeState((state) => {
		renderStatusBar(state.activeScenes, state.isDirty);
	});

	context.subscriptions.push(statusBarItem, sub);
	return statusBarItem;
}

export function formatScenesLabel(scenes: string[]): string {
	if (scenes.length === 0) return "(None)";
	if (scenes.length === 1) return `[${scenes[0]}]`;

	// 智能长度自适应：若总字符数 <= 28，优先完整展示所有场景链（如 [auth + order + pay]）
	const fullLabel = `[${scenes.join(" + ")}]`;
	if (fullLabel.length <= 28) {
		return fullLabel;
	}

	// 若超长但有 3 个以上场景，尝试保留前 2 个并折叠剩余项
	if (scenes.length > 2) {
		const prefixTwo = `[${scenes[0]} + ${scenes[1]}, +${scenes.length - 2}]`;
		if (prefixTwo.length <= 28) {
			return prefixTwo;
		}
	}

	// 最终优雅回退：保留首个场景并折叠剩余项
	return `[${scenes[0]}, +${scenes.length - 1}]`;
}

function renderStatusBar(activeScenes: string[], isDirty = false): void {
	if (!statusBarItem) return;

	if (activeScenes.length > 0) {
		const label = formatScenesLabel(activeScenes);
		const fullNames = activeScenes.join(", ");
		if (isDirty) {
			statusBarItem.text = `$(circle-filled) Scene: ${label}*`;
			statusBarItem.color = "#cca700";
			statusBarItem.tooltip = vscode.l10n.t(
				"Current Scene: [{0}] (Unsaved temporary breakpoints present. Click or Ctrl+Alt+S to open Menu)",
				fullNames,
			);
		} else {
			statusBarItem.text = `$(circle-filled) Scene: ${label}`;
			statusBarItem.color = "#49c998";
			statusBarItem.tooltip = vscode.l10n.t(
				"Current Scene: [{0}] (Click or Ctrl+Alt+S to open Scene Menu)",
				fullNames,
			);
		}
	} else {
		statusBarItem.text = `$(circle-outline) Scene: (None)`;
		statusBarItem.color = undefined;
		statusBarItem.tooltip = vscode.l10n.t("No scene active (Click or Ctrl+Alt+S to open Scene Menu)");
	}
}

