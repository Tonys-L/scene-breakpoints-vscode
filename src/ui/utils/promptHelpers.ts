import * as vscode from "vscode";
import { getSupportedFormatsTemplate } from "#src/domain/services/scenePayloadCodec";

export interface PromptSceneNameOptions {
	prompt: string;
	value?: string;
	placeHolder?: string;
}

/**
 * 统一弹出场景名称输入框，内置必填校验与首尾空白修剪
 */
export async function promptSceneName(options: PromptSceneNameOptions): Promise<string | undefined> {
	const result = await vscode.window.showInputBox({
		prompt: options.prompt,
		value: options.value,
		placeHolder: options.placeHolder,
		validateInput: (value) => {
			if (!value || !value.trim()) {
				return vscode.l10n.t("Scene name cannot be empty");
			}
			return null;
		},
	});
	return result?.trim() ? result.trim() : undefined;
}

/**
 * 统一弹出模态确认对话框
 */
export async function confirmModalAction(message: string, confirmLabel: string): Promise<boolean> {
	const choice = await vscode.window.showWarningMessage(
		message,
		{ modal: true },
		confirmLabel,
	);
	return choice === confirmLabel;
}

/**
 * 统一弹出多场景勾选面板
 */
export async function promptSelectScenes(
	sceneNames: string[],
	sceneCounts: Record<string, number>,
	currentActiveScenes: string[],
): Promise<string[] | undefined> {
	const items = sceneNames.map((name) => ({
		label: name,
		description: vscode.l10n.t("{0} breakpoint(s)", sceneCounts[name] || 0),
		picked: currentActiveScenes.includes(name),
	}));

	const picked = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		placeHolder: vscode.l10n.t("Select one or more debug scenes to activate (check to layer breakpoints)"),
	});

	if (picked === undefined) return undefined;
	return picked.map((it) => it.label);
}

export interface PromptSceneCollisionOptions {
	sceneName: string;
	allowRename?: boolean;
}

export type SceneCollisionDecision =
	| { mode: "overwrite" | "append"; sceneName: string }
	| null;

/**
 * 统一弹出场景已存在时的冲突处置决策面板 (覆盖 / 追加 / 重命名)
 */
export async function promptSceneCollision(
	options: PromptSceneCollisionOptions,
): Promise<SceneCollisionDecision> {
	const items: Array<{
		label: string;
		description?: string;
		value: "overwrite" | "append" | "rename";
	}> = [
		{
			label: vscode.l10n.t("Overwrite Existing Scene"),
			description: vscode.l10n.t("Replace existing [{0}] completely", options.sceneName),
			value: "overwrite",
		},
		{
			label: vscode.l10n.t("Append & Merge Breakpoints"),
			description: vscode.l10n.t("Keep existing breakpoints and upsert imported ones", options.sceneName),
			value: "append",
		},
	];

	if (options.allowRename) {
		items.push({
			label: vscode.l10n.t("Rename Imported Scene"),
			description: vscode.l10n.t("Save under a new scene name", options.sceneName),
			value: "rename",
		});
	}

	const action = await vscode.window.showQuickPick(items, {
		placeHolder: vscode.l10n.t("Scene [{0}] already exists. Choose action:", options.sceneName),
	});

	if (!action) return null;

	if (action.value === "rename") {
		const newName = await promptSceneName({
			prompt: vscode.l10n.t("Enter new scene identifier (e.g. user-login or auth-verify)"),
			value: `${options.sceneName}-copy`,
		});
		if (!newName) return null;
		return { sceneName: newName, mode: "overwrite" };
	}

	return { sceneName: options.sceneName, mode: action.value };
}

/**
 * 统一展示场景导入失败格式错误，并提供查看支持模板的引导
 */
export async function showPayloadFormatError(errorMsg: string): Promise<void> {
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
}
