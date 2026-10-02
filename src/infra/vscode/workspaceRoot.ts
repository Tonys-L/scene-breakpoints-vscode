import * as vscode from "vscode";

/**
 * 获取当前 VS Code 打开的工作区物理根路径 (VS Code 宿主适配器)
 * 职责：专职负责与 VS Code 工作区环境交互提取 workspaceRoot，提供统一的根目录探测
 */
export function getWorkspaceRoot(warnIfMissing = false): string | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		if (warnIfMissing) {
			void vscode.window.showWarningMessage(
				vscode.l10n.t("Please open a workspace folder to use Scene Breakpoints."),
			);
		}
		return undefined;
	}
	return folders[0].uri.fsPath;
}
