import * as vscode from "vscode";
import { getWorkspaceRoot } from "./workspaceRoot";

export type WorkspaceCommandHandler<T> = (workspaceRoot: string) => Promise<T> | T;

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
	} catch (error: any) {
		const message = error?.message || String(error);
		void vscode.window.showErrorMessage(
			vscode.l10n.t("Command failed: {0}", message),
		);
		return undefined;
	}
}
