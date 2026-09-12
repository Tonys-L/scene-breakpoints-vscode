import * as vscode from "vscode";
import { externalChangeUseCase } from "../../../application/externalChangeUseCase";

/**
 * AI 激活协同服务 (AI Activation Listener)
 * 职责：专职负责监听与响应外部 debug-scenes.json 变动的副作用调度，驱动 UI/状态栏，并调用 externalChangeUseCase 纯用例
 */
export async function handleExternalScenesFileChange(workspaceRoot: string): Promise<void> {
	const allowAiActivation = vscode.workspace
		.getConfiguration("sceneBreakpoints")
		.get<boolean>("allowAiFileActivation", false);

	await externalChangeUseCase({
		workspaceRoot,
		allowAiActivation,
		isDebuggingActive: !!vscode.debug.activeDebugSession,
		onPendingMessage: () => {
			vscode.window.setStatusBarMessage(
				vscode.l10n.t("$(alert) Breakpoint changes pending. Will apply on next debug session."),
				5000,
			);
		},
	});
}
