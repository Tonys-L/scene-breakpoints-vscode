import * as vscode from "vscode";
import { applySceneBreakpoints } from "../../infra/vscode/vscodeBreakpointBridge";
import { getWorkspaceRoot, loadScenesConfig, saveScenesConfig } from "../../infra/storage/jsonFileSceneRepository";
import { mergeScenesBreakpoints, upsertBreakpointToScene } from "../../core/sceneOperations";
import { getSupportedFormatsTemplate, parseScenePayload, serializeScenePayload } from "../payloadSerializer";
import { sceneStateManager } from "../../core/sceneStateManager";
import { SceneNode } from "../../infra/vscode/sceneTreeProvider";
import { applySceneCommand } from "./applyScene";

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
	if (target) {
		if (typeof target === "string") {
			targetScene = target.trim();
		} else if (target.sceneName) {
			targetScene = target.sceneName;
		}
	}

	if (!targetScene) {
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
 * 从系统剪贴板解析并导入场景断点，支持同名覆盖、追加与重命名
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
		const viewFormatAction = vscode.l10n.t("View Supported Formats");
		const action = await vscode.window.showErrorMessage(
			vscode.l10n.t("Failed to import scene from clipboard: {0}", parseResult.error),
			viewFormatAction,
		);
		if (action === viewFormatAction) {
			const doc = await vscode.workspace.openTextDocument({
				language: "jsonc",
				content: getSupportedFormatsTemplate(),
			});
			await vscode.window.showTextDocument(doc, { preview: true });
		}
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

	// 记录展开状态，使导入后树视图刷新时新场景自动展开断点列表
	SceneNode.expandedScenes.add(finalSceneName);

	saveScenesConfig(workspaceRoot, config);

	// 立即通知调试侧边栏树视图更新 DOM（由于 Content Hash Guard 会拦截内部写盘的 fileWatcher，必须在此主动调度刷新）
	await vscode.commands.executeCommand("sceneBreakpoints.refreshView");

	// 若当前导入覆盖或追加的场景正处于激活状态，立即将更新后的断点集合注入编辑器 DAP，并保持多场景集合不退化
	if (sceneStateManager.isSceneActive(finalSceneName)) {
		const activeScenes = sceneStateManager.getActiveScenes();
		const merged = mergeScenesBreakpoints(config, activeScenes);
		await applySceneBreakpoints(workspaceRoot, activeScenes.join("+"), merged);
		sceneStateManager.setActiveScenes(activeScenes, merged.length);
	}

	const activateAction = vscode.l10n.t("Activate Scene");
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			"Successfully imported scene [{0}] with {1} breakpoint(s)!",
			finalSceneName,
			config.scenes[finalSceneName].length,
		),
		activateAction,
	);

	if (choice === activateAction) {
		await applySceneCommand(finalSceneName);
	}
}
