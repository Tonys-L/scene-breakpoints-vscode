import { collectCurrentBreakpoints } from "../breakpointAdapter";
import { getWorkspaceRoot, loadScenesConfig, saveScenesConfig, upsertBreakpointToScene } from "../configManager";
import { sceneStateManager } from "../sceneStateManager";
import type { SceneBreakpoint } from "../types";

export async function exportSceneCommand(): Promise<void> {
	const currentBreakpoints = vscode.debug.breakpoints;
	if (!currentBreakpoints || currentBreakpoints.length === 0) {
		vscode.window.showWarningMessage(vscode.l10n.t("No active breakpoints found in current workspace. Please set some breakpoints first."));
		return;
	}

	const workspaceRoot = getWorkspaceRoot(true);
	if (!workspaceRoot) return;

	// 1. 输入新场景名称
	const sceneName = await vscode.window.showInputBox({
		prompt: vscode.l10n.t("Enter scene identifier to export current breakpoints to (e.g. order-flow-debug)"),
		placeHolder: "order-flow-debug",
		validateInput: (value) => {
			if (!value || !value.trim()) return vscode.l10n.t("Scene name cannot be empty");
			return null;
		},
	});

	if (!sceneName || !sceneName.trim()) return;
	const targetScene = sceneName.trim();

	// 2. 逆向提取当前全部断点
	const exportedBps = await collectCurrentBreakpoints(workspaceRoot);

	// 3. 询问是否覆盖或追加（若场景已存在）
	const config = loadScenesConfig(workspaceRoot);
	if (config.scenes[targetScene] && config.scenes[targetScene].length > 0) {
		const action = await vscode.window.showQuickPick(
			[
				{ label: vscode.l10n.t("Overwrite Existing Scene"), value: "overwrite" },
				{ label: vscode.l10n.t("Append to Existing Scene"), value: "append" },
			],
			{
				placeHolder: vscode.l10n.t("Scene [{0}] already exists. Choose action:", targetScene),
			},
		);

		if (!action) return;

		if (action.value === "append") {
			for (const bp of exportedBps) {
				upsertBreakpointToScene(config, targetScene, bp);
			}
		} else {
			config.scenes[targetScene] = exportedBps;
		}
	} else {
		config.scenes[targetScene] = exportedBps;
	}

	saveScenesConfig(workspaceRoot, config);

	// 4. 同步全局场景状态机 (驱动状态栏并复位脏状态)
	sceneStateManager.setActiveScene(targetScene, exportedBps.length);

	vscode.window.showInformationMessage(
		vscode.l10n.t("Successfully exported {0} active breakpoint(s) to scene [{1}]!", exportedBps.length, targetScene),
	);
}
