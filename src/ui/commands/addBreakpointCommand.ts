import * as path from "node:path";
import * as vscode from "vscode";
import { sceneManager, breakpointManager } from "#src/application";
import { extractContextSnippet } from "#src/domain/services/healingEngine";
import type { BreakpointType, FunctionSceneBreakpoint, SceneBreakpoint, SourceSceneBreakpoint } from "#src/domain/types";

/**
 * 在当前编辑器光标所在行向指定场景添加断点
 */
interface BpTypeItem extends vscode.QuickPickItem {
	type: BreakpointType;
}

interface BpDetailParams {
	bpType: BreakpointType;
	condition?: string;
	hitCondition?: string;
	logMessage?: string;
	functionName?: string;
	description?: string;
}

/**
 * 引导用户选择已有场景或新建场景
 */
async function promptTargetScene(workspaceRoot: string): Promise<string | undefined> {
	const config = sceneManager.loadScenesConfig(workspaceRoot);
	const existingScenes = Object.keys(config.scenes || {});

	const sceneQuickPickItems = [
		...existingScenes.map((s) => ({ label: `$(symbol-event) ${s}`, sceneName: s })),
		{ label: vscode.l10n.t("$(add) [New Scene...]"), sceneName: "__NEW__" },
	];

	const selectedSceneItem = await vscode.window.showQuickPick(sceneQuickPickItems, {
		placeHolder: vscode.l10n.t("Select a scene to add the current line breakpoint to"),
	});
	if (!selectedSceneItem) return undefined;

	let targetScene = selectedSceneItem.sceneName;
	if (targetScene === "__NEW__") {
		const newSceneName = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter new scene identifier (e.g. user-login or auth-verify)"),
			validateInput: (value) => (!value || !value.trim() ? vscode.l10n.t("Scene name cannot be empty") : null),
		});
		if (!newSceneName) return undefined;
		targetScene = newSceneName.trim();
		if (!config.scenes[targetScene]) {
			config.scenes[targetScene] = [];
		}
	}
	return targetScene;
}

/**
 * 引导用户选择断点类型
 */
async function promptBreakpointType(): Promise<BreakpointType | undefined> {
	const typeItems: BpTypeItem[] = [
		{ label: `$(debug-breakpoint) ${vscode.l10n.t("Line Breakpoint")}`, description: vscode.l10n.t("Pause execution when hit"), type: "line" },
		{ label: `$(debug-breakpoint-conditional) ${vscode.l10n.t("Conditional Breakpoint")}`, description: vscode.l10n.t("Pause when expression evaluates to true"), type: "condition" },
		{ label: `$(debug-breakpoint-data) ${vscode.l10n.t("Hit Count Breakpoint")}`, description: vscode.l10n.t("Pause when hit count condition is satisfied"), type: "hitCount" },
		{ label: `$(debug-breakpoint-log) ${vscode.l10n.t("Logpoint")}`, description: vscode.l10n.t("Print log message to debug console without pausing"), type: "logpoint" },
		{ label: `$(debug-breakpoint-function) ${vscode.l10n.t("Function Breakpoint")}`, description: vscode.l10n.t("Pause when a named function is invoked"), type: "function" },
	];

	const selectedTypeItem = await vscode.window.showQuickPick(typeItems, {
		placeHolder: vscode.l10n.t("Select breakpoint type"),
	});
	return selectedTypeItem?.type;
}

/**
 * 收集断点特定类型的参数与业务描述
 */
async function promptBreakpointParams(
	bpType: BreakpointType,
	fileNameOnly: string,
	currentLine: number,
): Promise<BpDetailParams | undefined> {
	let condition: string | undefined;
	let hitCondition: string | undefined;
	let logMessage: string | undefined;
	let functionName: string | undefined;

	if (bpType === "condition") {
		condition = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter condition expression (e.g. user.isAdmin === true)"),
			placeHolder: "user.isAdmin === true",
		});
		if (condition === undefined) return undefined;
	} else if (bpType === "hitCount") {
		hitCondition = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter hit count condition (e.g. > 5 or % 10 === 0)"),
			placeHolder: "> 5",
		});
		if (hitCondition === undefined) return undefined;
	} else if (bpType === "logpoint") {
		logMessage = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter log message to print (supports {var} interpolation)"),
			placeHolder: "User state: {user.name}, retries: {retryCount}",
		});
		if (logMessage === undefined) return undefined;
	} else if (bpType === "function") {
		functionName = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter function name to break on"),
			placeHolder: "handleUserAuthentication",
			validateInput: (v) => (!v || !v.trim() ? vscode.l10n.t("Function name cannot be empty") : null),
		});
		if (!functionName) return undefined;
	}

	const description = await vscode.window.showInputBox({
		prompt: vscode.l10n.t("Enter breakpoint description (optional, current line: {0}:{1})", fileNameOnly, currentLine),
		placeHolder: vscode.l10n.t("e.g. Check steering message injection in decision loop"),
	});

	return { bpType, condition, hitCondition, logMessage, functionName, description };
}

/**
 * 构造断点条目数据
 */
function createBreakpointEntry(
	params: BpDetailParams,
	editor: vscode.TextEditor,
	relativeFilePath: string,
	fileNameOnly: string,
	currentLine: number,
): SceneBreakpoint {
	if (params.bpType === "function") {
		return {
			type: "function",
			functionName: params.functionName!.trim(),
			condition: params.condition?.trim() || undefined,
			hitCondition: params.hitCondition?.trim() || undefined,
			desc: params.description?.trim() || undefined,
		} as FunctionSceneBreakpoint;
	}

	const contextSnippet = extractContextSnippet(editor.document, editor.selection.active.line);
	return {
		type: params.bpType,
		file: relativeFilePath.includes("/") ? relativeFilePath : fileNameOnly,
		line: currentLine,
		condition: params.condition?.trim() || undefined,
		hitCondition: params.hitCondition?.trim() || undefined,
		logMessage: params.logMessage?.trim() || undefined,
		desc: params.description?.trim() || undefined,
		contextSnippet,
	} as SourceSceneBreakpoint;
}

export async function addBreakpointCommand(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		void vscode.window.showWarningMessage(vscode.l10n.t("No active editor file detected"));
		return;
	}

	const fullFilePath = editor.document.fileName;
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(editor.document.fileName);
	const relativeFilePath = path.relative(workspaceRoot, fullFilePath).replace(/\\/g, "/");
	const fileNameOnly = path.basename(fullFilePath);
	const currentLine = editor.selection.active.line + 1; // 1-indexed

	const targetScene = await promptTargetScene(workspaceRoot);
	if (!targetScene) return;

	const bpType = await promptBreakpointType();
	if (!bpType) return;

	const params = await promptBreakpointParams(bpType, fileNameOnly, currentLine);
	if (!params) return;

	const newEntry = createBreakpointEntry(params, editor, relativeFilePath, fileNameOnly, currentLine);
	await breakpointManager.addBreakpoint(workspaceRoot, targetScene, newEntry);

	const summaryLabel = bpType === "function" ? (params.functionName || "") : `${fileNameOnly}:${currentLine}`;
	void vscode.window.showInformationMessage(
		vscode.l10n.t("Saved breakpoint to scene [{0}]: {1}:{2} {3}", targetScene, summaryLabel, bpType, newEntry.desc ? `("${newEntry.desc}")` : ""),
	);
}
