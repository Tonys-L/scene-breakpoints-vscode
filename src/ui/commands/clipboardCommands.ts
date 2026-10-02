import * as vscode from "vscode";
import { sceneManager } from "#src/application";
import { runWithWorkspace } from "#src/ui/utils/commandRunner";
import {
	getSupportedFormatsTemplate,
	decodeScenePayload as parseScenePayload,
	encodeScenePayload as serializeScenePayload,
} from "#src/domain/services/scenePayloadCodec";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { SceneNode } from "#src/ui/views/sceneTreeProvider";
import { applySceneCommand } from "./sceneCommands";

/**
 * 复制指定场景至系统剪贴板 (以标准 JSON 格式共享)
 */
export async function copySceneToClipboardCommand(target?: SceneNode | string): Promise<void> {
	await runWithWorkspace(true, async (workspaceRoot) => {
		const config = sceneManager.loadScenesConfig(workspaceRoot);
		const sceneNames = Object.keys(config.scenes || {});
		if (sceneNames.length === 0) {
			void vscode.window.showWarningMessage(vscode.l10n.t("No scenes configured in debug-scenes.json yet"));
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
			void vscode.window.showWarningMessage(
				vscode.l10n.t("Scene [{0}] has no breakpoints to copy.", targetScene),
			);
			return;
		}

		const payloadStr = serializeScenePayload(targetScene, breakpoints);
		await vscode.env.clipboard.writeText(payloadStr);

		void vscode.window.showInformationMessage(
			vscode.l10n.t("Scene [{0}] copied to clipboard ({1} breakpoint(s))!", targetScene, breakpoints.length),
		);
	});
}

/**
 * 从系统剪贴板解析并导入场景断点，支持同名覆盖、追加与重命名
 */
export async function importSceneFromClipboardCommand(): Promise<void> {
	await runWithWorkspace(true, async (workspaceRoot) => {
		const clipboardText = await vscode.env.clipboard.readText();
		if (!clipboardText || !clipboardText.trim()) {
			void vscode.window.showWarningMessage(
				vscode.l10n.t("Clipboard is empty or does not contain valid text."),
			);
			return;
		}

		const parseResult = parseScenePayload(clipboardText);
		if (!parseResult.success) {
			const errorMsg = (parseResult as { success: false; error: string }).error;
			const viewFormatAction = vscode.l10n.t("View Supported Formats");
			const action = await vscode.window.showErrorMessage(
				vscode.l10n.t("Failed to import scene from clipboard: {0}", errorMsg),
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

		const config = sceneManager.loadScenesConfig(workspaceRoot);
		const target = await resolveImportTargetScene(config.scenes || {}, parseResult.sceneName);
		if (!target) return;

		const { sceneName: finalSceneName, mode } = target;
		const importedBreakpoints = parseResult.breakpoints;
		await sceneManager.importScene(workspaceRoot, finalSceneName, importedBreakpoints, mode);

		// 记录展开状态，使导入后树视图响应 scenes:changed 事件刷新时新场景自动展开断点列表
		SceneNode.expandedScenes.add(finalSceneName);

		// 若当前导入覆盖或追加的场景正处于激活状态，立即重新激活更新后的断点集合
		if (sceneStateManager.isSceneActive(finalSceneName)) {
			await applySceneCommand(sceneStateManager.getActiveScenes());
		}

		const activateAction = vscode.l10n.t("Activate Scene");
		const choice = await vscode.window.showInformationMessage(
			vscode.l10n.t(
				"Successfully imported scene [{0}] with {1} breakpoint(s)!",
				finalSceneName,
				importedBreakpoints.length,
			),
			activateAction,
		);

		if (choice === activateAction) {
			await applySceneCommand(finalSceneName);
		}
	});
}

async function resolveImportTargetScene(
	scenes: Record<string, unknown>,
	initialName: string,
): Promise<{ sceneName: string; mode: "overwrite" | "append" } | null> {
	const existing = scenes[initialName];
	if (!existing || (Array.isArray(existing) && existing.length === 0)) {
		return { sceneName: initialName, mode: "overwrite" };
	}

	const action = await vscode.window.showQuickPick(
		[
			{
				label: vscode.l10n.t("Overwrite Existing Scene"),
				description: vscode.l10n.t("Replace existing [{0}] completely", initialName),
				value: "overwrite" as const,
			},
			{
				label: vscode.l10n.t("Append & Merge Breakpoints"),
				description: vscode.l10n.t("Keep existing breakpoints and upsert imported ones", initialName),
				value: "append" as const,
			},
			{
				label: vscode.l10n.t("Rename Imported Scene"),
				description: vscode.l10n.t("Save under a new scene name", initialName),
				value: "rename" as const,
			},
		],
		{ placeHolder: vscode.l10n.t("Scene [{0}] already exists. Choose action:", initialName) },
	);

	if (!action) return null;

	if (action.value === "rename") {
		const newName = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter new scene identifier (e.g. user-login or auth-verify)"),
			value: `${initialName}-copy`,
			validateInput: (val) => (!val || !val.trim() ? vscode.l10n.t("Scene name cannot be empty") : null),
		});
		if (!newName || !newName.trim()) return null;
		return { sceneName: newName.trim(), mode: "overwrite" };
	}

	return { sceneName: initialName, mode: action.value };
}
