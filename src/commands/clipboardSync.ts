import * as vscode from "vscode";
import { applySceneBreakpoints } from "../breakpointAdapter";
import {
	getWorkspaceRoot,
	loadScenesConfig,
	mergeScenesBreakpoints,
	parseScenePayload,
	saveScenesConfig,
	serializeScenePayload,
	upsertBreakpointToScene,
} from "../configManager";
import { sceneStateManager } from "../sceneStateManager";
import type { SceneNode } from "../sceneTreeProvider";

/**
 * 复制指定场景至系统剪贴板 (以标准 JSON 格式共享)
 */
export async function copySceneToClipboardCommand(target?: SceneNode | string): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(true);
	if (!workspaceRoot) return;

	const config = loadScenesConfig(workspaceRoot);
	const sceneNames = Object.keys(config.scenes || {});
	if (sceneNames.length === 0) {
		vscode.window.showWarningMessage(vscode.l10n.t("No scenes configured in debug-scenes.json yet"));
		return;
	}

	let targetScene: string | undefined;
	if (typeof target === "string" && target.trim()) {
		targetScene = target.trim();
	} else if (target && typeof (target as SceneNode).sceneName === "string") {
		targetScene = (target as SceneNode).sceneName;
	} else {
		// 命令面板调用时弹出场景选择列表
		const picked = await vscode.window.showQuickPick(
			sceneNames.map((name) => ({
				label: `$(symbol-event) ${name}`,
				description: vscode.l10n.t("{0} breakpoint(s)", config.scenes[name]?.length || 0),
				sceneName: name,
			})),
			{
				placeHolder: vscode.l10n.t("Select a scene to copy to clipboard"),
			},
		);
		if (!picked) return;
		targetScene = picked.sceneName;
	}

	const breakpoints = config.scenes[targetScene] || [];
	if (breakpoints.length === 0) {
		vscode.window.showWarningMessage(
			vscode.l10n.t("Scene [{0}] has no breakpoints to copy.", targetScene),
		);
		return;
	}

	const payloadStr = serializeScenePayload(targetScene, breakpoints);
	await vscode.env.clipboard.writeText(payloadStr);

	vscode.window.showInformationMessage(
		vscode.l10n.t("Scene [{0}] copied to clipboard ({1} breakpoint(s))!", targetScene, breakpoints.length),
	);
}

/**
 * 从系统剪贴板读取并安全导入场景配置
 */
export async function importSceneFromClipboardCommand(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(true);
	if (!workspaceRoot) return;

	const clipboardText = await vscode.env.clipboard.readText();
	if (!clipboardText || !clipboardText.trim()) {
		vscode.window.showWarningMessage(
			vscode.l10n.t("Clipboard is empty or does not contain valid text."),
		);
		return;
	}

	const parseResult = parseScenePayload(clipboardText);
	if (!parseResult.success) {
		vscode.window.showErrorMessage(
			vscode.l10n.t("Failed to import scene from clipboard: {0}", parseResult.error),
		);
		return;
	}

	const config = loadScenesConfig(workspaceRoot);
	let finalSceneName = parseResult.sceneName;
	const importedBreakpoints = parseResult.breakpoints;

	// 处理同名场景冲突
	if (config.scenes[finalSceneName] && config.scenes[finalSceneName].length > 0) {
		const action = await vscode.window.showQuickPick(
			[
				{
					label: vscode.l10n.t("Overwrite Existing Scene"),
					description: vscode.l10n.t("Replace existing [{0}] completely", finalSceneName),
					value: "overwrite",
				},
				{
					label: vscode.l10n.t("Append & Merge Breakpoints"),
					description: vscode.l10n.t("Keep existing breakpoints and upsert imported ones", finalSceneName),
					value: "append",
				},
				{
					label: vscode.l10n.t("Rename Imported Scene"),
					description: vscode.l10n.t("Save under a new scene name", finalSceneName),
					value: "rename",
				},
			],
			{
				placeHolder: vscode.l10n.t("Scene [{0}] already exists. Choose action:", finalSceneName),
			},
		);

		if (!action) return;

		if (action.value === "rename") {
			const newName = await vscode.window.showInputBox({
				prompt: vscode.l10n.t("Enter new scene identifier (e.g. user-login or auth-verify)"),
				value: `${finalSceneName}-copy`,
				validateInput: (val) => {
					if (!val || !val.trim()) return vscode.l10n.t("Scene name cannot be empty");
					return null;
				},
			});
			if (!newName || !newName.trim()) return;
			finalSceneName = newName.trim();
			config.scenes[finalSceneName] = importedBreakpoints;
		} else if (action.value === "append") {
			for (const bp of importedBreakpoints) {
				upsertBreakpointToScene(config, finalSceneName, bp);
			}
		} else {
			// overwrite
			config.scenes[finalSceneName] = importedBreakpoints;
		}
	} else {
		config.scenes[finalSceneName] = importedBreakpoints;
	}

	saveScenesConfig(workspaceRoot, config);

	// 若当前导入覆盖或追加的场景正处于激活状态，立即将更新后的断点集合注入编辑器 DAP，并保持多场景集合不退化
	if (sceneStateManager.isSceneActive(finalSceneName)) {
		const activeScenes = sceneStateManager.getActiveScenes();
		const merged = mergeScenesBreakpoints(config, activeScenes);
		await applySceneBreakpoints(workspaceRoot, activeScenes.join("+"), merged);
		sceneStateManager.setActiveScenes(activeScenes, merged.length);
	}

	vscode.window.showInformationMessage(
		vscode.l10n.t(
			"Successfully imported scene [{0}] with {1} breakpoint(s)!",
			finalSceneName,
			config.scenes[finalSceneName].length,
		),
	);
}
