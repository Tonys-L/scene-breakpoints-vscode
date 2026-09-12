import * as path from "node:path";
import * as vscode from "vscode";
import { applySingleBreakpointToEditor } from "../adapters/breakpointAdapter";
import { loadScenesConfig, saveScenesConfig, upsertBreakpointToScene } from "../config/configManager";
import { extractContextSnippet } from "../core/healingAdapter";
import { sceneStateManager } from "../core/sceneStateManager";
import type { BreakpointType, FunctionSceneBreakpoint, SceneBreakpoint, SourceSceneBreakpoint } from "../core/types";

export async function addBreakpointCommand(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage(vscode.l10n.t("No active editor file detected"));
		return;
	}

	const fullFilePath = editor.document.fileName;
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(editor.document.fileName);
	const relativeFilePath = path.relative(workspaceRoot, fullFilePath).replace(/\\/g, "/");
	const fileNameOnly = path.basename(fullFilePath);
	const currentLine = editor.selection.active.line + 1; // 1-indexed

	// 1. 选择目标场景
	const config = loadScenesConfig(workspaceRoot);
	const existingScenes = Object.keys(config.scenes || {});

	const sceneQuickPickItems = [
		...existingScenes.map((s) => ({ label: `$(symbol-event) ${s}`, sceneName: s })),
		{ label: vscode.l10n.t("$(add) [New Scene...]"), sceneName: "__NEW__" },
	];

	const selectedSceneItem = await vscode.window.showQuickPick(sceneQuickPickItems, {
		placeHolder: vscode.l10n.t("Select a scene to add the current line breakpoint to"),
	});

	if (!selectedSceneItem) return;

	let targetScene = selectedSceneItem.sceneName;
	if (targetScene === "__NEW__") {
		const newSceneName = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter new scene identifier (e.g. user-login or auth-verify)"),
			validateInput: (value) => {
				if (!value || !value.trim()) return vscode.l10n.t("Scene name cannot be empty");
				return null;
			},
		});
		if (!newSceneName) return;
		targetScene = newSceneName.trim();
		if (!config.scenes[targetScene]) {
			config.scenes[targetScene] = [];
		}
	}

	// 2. 选择断点类型
	interface BpTypeItem extends vscode.QuickPickItem {
		type: BreakpointType;
	}

	const typeItems: BpTypeItem[] = [
		{
			label: `$(debug-breakpoint) ${vscode.l10n.t("Line Breakpoint")}`,
			description: vscode.l10n.t("Pause execution when hit"),
			type: "line",
		},
		{
			label: `$(debug-breakpoint-conditional) ${vscode.l10n.t("Conditional Breakpoint")}`,
			description: vscode.l10n.t("Pause when expression evaluates to true"),
			type: "condition",
		},
		{
			label: `$(debug-breakpoint-data) ${vscode.l10n.t("Hit Count Breakpoint")}`,
			description: vscode.l10n.t("Pause when hit count condition is satisfied"),
			type: "hitCount",
		},
		{
			label: `$(debug-breakpoint-log) ${vscode.l10n.t("Logpoint")}`,
			description: vscode.l10n.t("Print log message to debug console without pausing"),
			type: "logpoint",
		},
		{
			label: `$(debug-breakpoint-function) ${vscode.l10n.t("Function Breakpoint")}`,
			description: vscode.l10n.t("Pause when a named function is invoked"),
			type: "function",
		},
	];

	const selectedTypeItem = await vscode.window.showQuickPick(typeItems, {
		placeHolder: vscode.l10n.t("Select breakpoint type"),
	});

	if (!selectedTypeItem) return;
	const bpType = selectedTypeItem.type;

	// 3. 收集特定类型的参数
	let condition: string | undefined;
	let hitCondition: string | undefined;
	let logMessage: string | undefined;
	let functionName: string | undefined;

	if (bpType === "condition") {
		condition = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter condition expression (e.g. user.isAdmin === true)"),
			placeHolder: "user.isAdmin === true",
		});
		if (condition === undefined) return; // 用户按了 ESC
	} else if (bpType === "hitCount") {
		hitCondition = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter hit count condition (e.g. > 5 or % 10 === 0)"),
			placeHolder: "> 5",
		});
		if (hitCondition === undefined) return;
	} else if (bpType === "logpoint") {
		logMessage = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter log message to print (supports {var} interpolation)"),
			placeHolder: "User state: {user.name}, retries: {retryCount}",
		});
		if (logMessage === undefined) return;
	} else if (bpType === "function") {
		functionName = await vscode.window.showInputBox({
			prompt: vscode.l10n.t("Enter function name to break on"),
			placeHolder: "handleUserAuthentication",
			validateInput: (v) => (!v || !v.trim() ? vscode.l10n.t("Function name cannot be empty") : null),
		});
		if (!functionName) return;
	}

	// 4. 输入业务描述 (可选)
	const description = await vscode.window.showInputBox({
		prompt: vscode.l10n.t("Enter breakpoint description (optional, current line: {0}:{1})", fileNameOnly, currentLine),
		placeHolder: vscode.l10n.t("e.g. Check steering message injection in decision loop"),
	});

	// 5. 构造新条目并持久化
	let newEntry: SceneBreakpoint;
	if (bpType === "function") {
		newEntry = {
			type: "function",
			functionName: functionName!.trim(),
			condition: condition?.trim() || undefined,
			hitCondition: hitCondition?.trim() || undefined,
			desc: description?.trim() || undefined,
		} as FunctionSceneBreakpoint;
	} else {
		const contextSnippet = extractContextSnippet(editor.document, editor.selection.active.line);
		newEntry = {
			type: bpType,
			file: relativeFilePath.includes("/") ? relativeFilePath : fileNameOnly,
			line: currentLine,
			condition: condition?.trim() || undefined,
			hitCondition: hitCondition?.trim() || undefined,
			logMessage: logMessage?.trim() || undefined,
			desc: description?.trim() || undefined,
			contextSnippet,
		} as SourceSceneBreakpoint;
	}

	upsertBreakpointToScene(config, targetScene, newEntry);
	saveScenesConfig(workspaceRoot, config);

	// 若当前添加的目标场景正是处于激活状态的场景，立即向编辑器注入该断点并点亮红点
	if (sceneStateManager.isSceneActive(targetScene)) {
		await applySingleBreakpointToEditor(workspaceRoot, newEntry);
		sceneStateManager.setActiveScene(targetScene, config.scenes[targetScene]?.length || 0);
	}

	const summaryLabel = bpType === "function" ? functionName : `${fileNameOnly}:${currentLine}`;
	vscode.window.showInformationMessage(
		vscode.l10n.t("Saved breakpoint to scene [{0}]: {1}:{2} {3}", targetScene, summaryLabel, bpType, newEntry.desc ? `("${newEntry.desc}")` : ""),
	);
}
