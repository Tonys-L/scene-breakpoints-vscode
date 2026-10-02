import * as vscode from "vscode";

/**
 * 若当前 Inlay Hints 处于非 Always-On 状态且用户首次激活场景，弹出温和引导卡片
 */
export async function promptInlayHintsModeIfFirstTime(globalState?: vscode.Memento): Promise<void> {
	try {
		const currentInlay = vscode.workspace.getConfiguration("editor.inlayHints").get<string>("enabled");
		if (currentInlay === "on") return;

		const STATE_KEY = "sceneBreakpoints.inlayHintsPromptDismissed";
		if (globalState && globalState.get<boolean>(STATE_KEY)) return;

		const btnEnable = vscode.l10n.t("Enable Always-On");
		const btnKeep = vscode.l10n.t("Hold Ctrl+Alt is Fine");
		const btnNever = vscode.l10n.t("Don't Ask Again");

		const selected = await vscode.window.showInformationMessage(
			vscode.l10n.t(
				"Scene Breakpoints: Line annotations are currently in shortcut mode. Would you like to enable always-on display?",
			),
			btnEnable,
			btnKeep,
			btnNever,
		);

		if (globalState) {
			await globalState.update(STATE_KEY, true);
		}

		if (selected === btnEnable) {
			await vscode.workspace
				.getConfiguration("editor.inlayHints")
				.update("enabled", "on", vscode.ConfigurationTarget.Global);
			void vscode.window.showInformationMessage(
				vscode.l10n.t("Line Annotations (Inlay Hints) are now Always-On."),
			);
		}
	} catch {
		// 忽略异常
	}
}
