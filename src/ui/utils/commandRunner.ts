import * as path from "node:path";
import * as vscode from "vscode";

export type WorkspaceCommandHandler<T> = (workspaceRoot: string) => Promise<T> | T;

export type ActiveEditorCommandHandler<T> = (
	editor: vscode.TextEditor,
	workspaceRoot: string,
) => Promise<T> | T;

/**
 * 获取当前 VS Code 打开的工作区物理根路径 (UI 展示层专用，内置可选缺失告警)
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

/**
 * 命令执行上下文辅助函数 (Command Runner)
 * 职责：统一拦截工作区缺失校验、统一异常捕获与国际化告警，消除各命令样板代码
 */
export async function runWithWorkspace<T>(
	handler: WorkspaceCommandHandler<T>,
): Promise<T | undefined>;
export async function runWithWorkspace<T>(
	warnIfMissing: boolean,
	handler: WorkspaceCommandHandler<T>,
): Promise<T | undefined>;
export async function runWithWorkspace<T>(
	warnOrHandler: boolean | WorkspaceCommandHandler<T>,
	maybeHandler?: WorkspaceCommandHandler<T>,
): Promise<T | undefined> {
	const warnIfMissing = typeof warnOrHandler === "boolean" ? warnOrHandler : true;
	const handler = typeof warnOrHandler === "function" ? warnOrHandler : maybeHandler!;

	const workspaceRoot = getWorkspaceRoot(warnIfMissing);
	if (!workspaceRoot) {
		return undefined;
	}

	try {
		return await handler(workspaceRoot);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(
			vscode.l10n.t("Command failed: {0}", message),
		);
		return undefined;
	}
}

/**
 * 活动编辑器命令执行上下文辅助函数 (Active Editor Command Runner)
 * 职责：统一拦截活动编辑器缺失校验、自动推导目标工作区或文件目录、统一异常捕获与国际化告警
 */
export async function runWithActiveEditor<T>(
	handler: ActiveEditorCommandHandler<T>,
): Promise<T | undefined> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		void vscode.window.showWarningMessage(vscode.l10n.t("No active editor file detected"));
		return undefined;
	}

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	const workspaceRoot = workspaceFolder
		? workspaceFolder.uri.fsPath
		: getWorkspaceRoot(false) || path.dirname(editor.document.fileName);

	try {
		return await handler(editor, workspaceRoot);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(
			vscode.l10n.t("Command failed: {0}", message),
		);
		return undefined;
	}
}
