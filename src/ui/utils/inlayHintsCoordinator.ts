import * as vscode from "vscode";

/**
 * 检查当前宿主 Inlay Hints 是否处于 Always-On 常驻显示模式
 */
export function isInlayHintsAlwaysOn(): boolean {
	const currentInlay = vscode.workspace.getConfiguration("editor.inlayHints").get<string>("enabled");
	return currentInlay === "on";
}

/**
 * 切换 Inlay Hints 显示模式 (在 "on" 与 "offUnlessPressed" 之间互斥切换)
 */
export async function toggleInlayHintsMode(): Promise<boolean> {
	const conf = vscode.workspace.getConfiguration("editor.inlayHints");
	const cur = conf.get<string>("enabled");
	const next = cur === "on" ? "offUnlessPressed" : "on";
	await conf.update("enabled", next, vscode.ConfigurationTarget.Global);
	const msg = next === "on"
		? vscode.l10n.t("Line Annotations (Inlay Hints) are now Always-On.")
		: vscode.l10n.t("Line Annotations (Inlay Hints) now show on holding Ctrl+Alt.");
	void vscode.window.showInformationMessage(msg);
	return next === "on";
}

/**
 * 若当前 Inlay Hints 处于非 Always-On 状态且用户首次激活场景，弹出温和引导卡片
 */
export async function promptInlayHintsModeIfFirstTime(globalState?: vscode.Memento): Promise<void> {
	try {
		if (isInlayHintsAlwaysOn()) return;

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
	} catch (err: unknown) {
		console.warn("[inlayHintsCoordinator] Failed to prompt inlay hints mode:", err);
	}
}

/**
 * Inlay Hints 宿主配置与用户引导协调服务
 */
export const inlayHintsCoordinator = {
	isAlwaysOn: isInlayHintsAlwaysOn,
	toggleMode: toggleInlayHintsMode,
	promptIfFirstTime: promptInlayHintsModeIfFirstTime,
};
