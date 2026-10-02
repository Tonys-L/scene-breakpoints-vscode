import * as vscode from "vscode";

/**
 * 获取当前 VS Code 打开的工作区物理根路径 (UI 专用适配器)
 */
export function getWorkspaceRoot(showPrompt = false): string | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (folders && folders.length > 0) {
		return folders[0].uri.fsPath;
	}
	if (showPrompt) {
		void vscode.window.showWarningMessage(
			vscode.l10n.t("Please open a workspace folder to use Scene Breakpoints.")
		);
	}
	return undefined;
}
