import * as vscode from "vscode";
import { exportScene } from "../../../application/exportScene";
import { getWorkspaceRoot, loadScenesConfig } from "../../storage/jsonFileSceneRepository";
import { sceneStateManager } from "../../../domain/sceneStateManager";

/**
 * 场景导出控制器 (Export Scene Controller)
 * 职责：负责 VS Code 弹窗输入场景名、选择追加/覆盖模式，调用 exportSceneUseCase 执行落盘并刷新状态机
 */
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

	// 2. 询问是否覆盖或追加（若场景已存在）
	const config = loadScenesConfig(workspaceRoot);
	let mode: "overwrite" | "append" = "overwrite";

	if (config.scenes[targetScene] && config.scenes[targetScene].length > 0) {
		const action = await vscode.window.showQuickPick(
			[
				{ label: vscode.l10n.t("Overwrite Existing Scene"), value: "overwrite" as const },
				{ label: vscode.l10n.t("Append to Existing Scene"), value: "append" as const },
			],
			{
				placeHolder: vscode.l10n.t("Scene [{0}] already exists. Choose action:", targetScene),
			},
		);

		if (!action) return;
		mode = action.value;
	}

	// 3. 调用 Application 用例执行导出保存
	const result = await exportScene({
		workspaceRoot,
		targetScene,
		mode,
	});

	if (result.success) {
		sceneStateManager.setActiveScene(targetScene, result.count);
		await vscode.commands.executeCommand("sceneBreakpoints.refreshView");
		vscode.window.showInformationMessage(
			vscode.l10n.t("Successfully exported {0} active breakpoint(s) to scene [{1}]!", result.count, targetScene),
		);
	}
}
