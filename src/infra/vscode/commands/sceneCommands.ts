import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { activateScene, addBreakpoint, clearAll, exportScene } from "../../../application/sceneService";
import { extractContextSnippet } from "../../../domain/healingEngine";
import { sceneStateManager } from "../../../domain/sceneStateManager";
import type { BreakpointType, FunctionSceneBreakpoint, SceneBreakpoint, SourceSceneBreakpoint } from "../../../domain/types";
import {
	getScenesConfigPath,
	getWorkspaceRoot,
	loadScenesConfig,
	saveScenesConfig,
} from "../../storage/jsonFileSceneRepository";
import { vscodeBreakpointBridge } from "../vscodeBreakpointBridge";
import { importSceneFromClipboardCommand } from "./clipboardCommands";

// ==============================
// 1. 清空所有断点命令 (Clear All)
// ==============================

export async function clearAllCommand(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(false);
	await clearAll({ workspaceRoot });
}

// ==============================
// 2. 激活场景断点命令 (Apply Scene)
// ==============================

export async function applySceneCommand(sceneParam?: unknown): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(true);
	if (!workspaceRoot) return;

	const config = loadScenesConfig(workspaceRoot);
	const sceneNames = Object.keys(config.scenes || {});
	if (sceneNames.length === 0) {
		vscode.window.showWarningMessage(vscode.l10n.t("No scenes configured in debug-scenes.json yet"));
		return;
	}

	let targetScenes: string[] | undefined;

	if (Array.isArray(sceneParam)) {
		targetScenes = sceneParam.map((s) => String(s).trim()).filter(Boolean);
	} else if (typeof sceneParam === "string" && sceneParam.trim()) {
		if (sceneParam.includes(",")) {
			targetScenes = sceneParam.split(",").map((s) => s.trim()).filter(Boolean);
		} else {
			targetScenes = [sceneParam.trim()];
		}
	}

	// 智能感知：若当前打开的是 debug-scenes.json 且未显式指定场景，优先识别光标所在区域的场景名
	if (!targetScenes) {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor && activeEditor.document.fileName.endsWith("debug-scenes.json")) {
			const currentLine = activeEditor.selection.active.line;
			for (let i = currentLine; i >= 0; i--) {
				const lineText = activeEditor.document.lineAt(i).text;
				for (const sName of sceneNames) {
					if (lineText.includes(`"${sName}"`) && lineText.includes(":")) {
						targetScenes = [sName];
						break;
					}
				}
				if (targetScenes) break;
			}
		}
	}

	// 若仍未确定场景，弹出可多选面板 (canPickMany: true)
	if (!targetScenes) {
		const currentActiveScenes = sceneStateManager.getActiveScenes();
		const items = sceneNames.map((name) => ({
			label: name,
			description: vscode.l10n.t("{0} breakpoint(s)", config.scenes[name]?.length || 0),
			picked: currentActiveScenes.includes(name),
		}));

		const picked = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: vscode.l10n.t("Select one or more debug scenes to activate (check to layer breakpoints)"),
		});

		if (picked === undefined) return; // 用户按 ESC 或取消
		targetScenes = picked.map((it) => it.label);
	}

	// 若所有勾选均被取消，执行清空并返回
	if (targetScenes.length === 0) {
		await clearAllCommand();
		return;
	}

	// 保护机制：若当前工作区正处于未保存临时断点的 Dirty 状态，弹窗提示用户决策
	const currentActive = sceneStateManager.getActiveScene();
	const isDirty = sceneStateManager.getIsDirty();
	if (currentActive && isDirty) {
		const actionAppend = vscode.l10n.t("Save & Append to [{0}]", currentActive);
		const actionDiscard = vscode.l10n.t("Discard Temporary Breakpoints");

		const chosen = await vscode.window.showWarningMessage(
			vscode.l10n.t(
				"Workspace has unsaved temporary breakpoints in scene [{0}]. What would you like to do before switching/reloading?",
				currentActive,
			),
			{ modal: true },
			actionAppend,
			actionDiscard,
		);

		if (!chosen) return;

		if (chosen === actionAppend) {
			const currentBps = vscodeBreakpointBridge.collectCurrentBreakpoints(workspaceRoot);
			config.scenes[currentActive] = currentBps;
			saveScenesConfig(workspaceRoot, config);
		}
	}

	// 调用纯业务用例执行核心调度流
	const result = await activateScene({
		workspaceRoot,
		targetScenes,
	});

	if (!result.success) {
		vscode.window.showErrorMessage(
			vscode.l10n.t("Scene(s) [{0}] not found in debug-scenes.json", result.missingScenes.join(", ")),
		);
		return;
	}

	if (result.missingScenes.length > 0) {
		vscode.window.showWarningMessage(
			vscode.l10n.t("Scene(s) [{0}] not found and skipped", result.missingScenes.join(", ")),
		);
	}

	const primarySceneLabel = result.validTargetScenes.length === 1
		? result.validTargetScenes[0]
		: result.validTargetScenes.join(" + ");

	// UI 结果反馈
	if (result.unmatchedCount > 0) {
		const count = result.unmatchedCount;
		const unmatches = result.unmatchedBreakpoints || [];
		const firstItem = unmatches[0];
		const summary = unmatches
			.slice(0, 3)
			.map((bp) => `${path.basename(bp.file)}:${bp.line}`)
			.join(", ");
		const more = count > 3 ? ` 等 ${count} 处` : "";
		const viewAction = vscode.l10n.t("Locate Code");
		vscode.window
			.showWarningMessage(
				vscode.l10n.t(
					"Scene [{0}] activated, but {1} breakpoint(s) could not match code (fell back to original lines): {2}{3}",
					primarySceneLabel,
					count,
					summary,
					more,
				),
				viewAction,
			)
			.then(async (selected) => {
				if (selected === viewAction && firstItem) {
					const fullPath = path.isAbsolute(firstItem.file)
						? firstItem.file
						: path.join(workspaceRoot, firstItem.file);
					try {
						const doc = await vscode.workspace.openTextDocument(fullPath);
						const editor = await vscode.window.showTextDocument(doc);
						const pos = new vscode.Position(Math.max(0, firstItem.line - 1), 0);
						editor.selection = new vscode.Selection(pos, pos);
						editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
					} catch {
						// 忽略打开失败
					}
				}
			});
	} else if (result.healedCount > 0) {
		vscode.window.showInformationMessage(
			vscode.l10n.t(
				"Scene(s) [{0}] activated! Loaded {1} breakpoint(s) (Auto-healed {2} drifted line(s)).",
				primarySceneLabel,
				result.loadedCount,
				result.healedCount,
			),
		);
	} else {
		vscode.window.showInformationMessage(
			vscode.l10n.t(
				"Scene(s) [{0}] activated! Set {1} target breakpoint(s) and cleaned others.",
				primarySceneLabel,
				result.loadedCount,
			),
		);
	}
}

// ==============================
// 3. 添加断点命令 (Add Breakpoint)
// ==============================

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
		if (condition === undefined) return;
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

	await addBreakpoint({
		workspaceRoot,
		targetScene,
		breakpoint: newEntry,
	});

	const summaryLabel = bpType === "function" ? functionName : `${fileNameOnly}:${currentLine}`;
	vscode.window.showInformationMessage(
		vscode.l10n.t("Saved breakpoint to scene [{0}]: {1}:{2} {3}", targetScene, summaryLabel, bpType, newEntry.desc ? `("${newEntry.desc}")` : ""),
	);
}

// ==============================
// 4. 导出场景命令 (Export Scene)
// ==============================

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

// ==============================
// 5. 显示场景菜单命令 (Show Menu)
// ==============================

interface MenuQuickPickItem extends vscode.QuickPickItem {
	action?: "switch" | "clear" | "export" | "importClipboard" | "multiSelect" | "openConfig";
	sceneName?: string;
}

export async function showMenuCommand(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(true);
	if (!workspaceRoot) return;

	const config = loadScenesConfig(workspaceRoot);
	const sceneNames = Object.keys(config.scenes || {});
	const activeScenes = sceneStateManager.getActiveScenes();
	const isDirty = sceneStateManager.getIsDirty();

	const items: MenuQuickPickItem[] = [];

	if (sceneNames.length > 0) {
		for (const name of sceneNames) {
			const bps = config.scenes[name] || [];
			const isActive = activeScenes.includes(name);
			let label = isActive ? `🟢 ${name}` : `⚪ ${name}`;
			if (isActive && isDirty) {
				label = `🟢 ${name}*`;
			}
			let description: string | undefined;
			if (isActive) {
				description = isDirty ? vscode.l10n.t("(Active - Unsaved)") : vscode.l10n.t("(Active)");
			}
			items.push({
				label,
				description,
				detail: vscode.l10n.t("{0} breakpoint(s)", bps.length),
				action: "switch",
				sceneName: name,
			});
		}
	} else {
		items.push({
			label: `$(info) ${vscode.l10n.t("No scenes configured yet")}`,
			description: vscode.l10n.t("Add breakpoints or export active ones to create a scene"),
		});
	}

	// 分隔线
	items.push({
		label: vscode.l10n.t("Quick Actions"),
		kind: vscode.QuickPickItemKind.Separator,
	});

	// 快捷动作
	items.push(
		{
			label: `$(checklist) ${vscode.l10n.t("Multi-Select Scenes to Activate...")}`,
			description: vscode.l10n.t("Check multiple scenes to layer breakpoints together"),
			action: "multiSelect",
		},
		{
			label: `$(cloud-upload) ${vscode.l10n.t("Export Active Breakpoints as Scene...")}`,
			description: vscode.l10n.t("Save current editor breakpoints into debug-scenes.json"),
			action: "export",
		},
		{
			label: `$(cloud-download) ${vscode.l10n.t("Import Scene from Clipboard...")}`,
			description: vscode.l10n.t("Parse and import scene breakpoints from clipboard"),
			action: "importClipboard",
		},
		{
			label: `$(clear-all) ${vscode.l10n.t("Clear All Breakpoints")}`,
			description: vscode.l10n.t("Clear all breakpoints from current workspace"),
			action: "clear",
		},
		{
			label: `$(file-code) ${vscode.l10n.t("Open debug-scenes.json")}`,
			description: vscode.l10n.t("Edit configuration file directly"),
			action: "openConfig",
		},
	);

	const quickPick = vscode.window.createQuickPick<MenuQuickPickItem>();
	quickPick.items = items;
	quickPick.placeholder = vscode.l10n.t("Select a scene to activate, or choose a management action");
	quickPick.matchOnDescription = true;
	quickPick.matchOnDetail = true;

	// 自动将当前激活的场景设为默认高亮聚焦项
	const firstActive = activeScenes[0];
	if (firstActive) {
		const activeItem = items.find((it) => it.action === "switch" && it.sceneName === firstActive);
		if (activeItem) {
			quickPick.activeItems = [activeItem];
		}
	}

	quickPick.onDidAccept(async () => {
		const selected = quickPick.selectedItems[0];
		quickPick.hide();
		if (!selected || !selected.action) return;

		switch (selected.action) {
			case "multiSelect":
				await applySceneCommand();
				break;
			case "switch":
				if (selected.sceneName) {
					await applySceneCommand(selected.sceneName);
				}
				break;
			case "export":
				await exportSceneCommand();
				break;
			case "importClipboard":
				await importSceneFromClipboardCommand();
				break;
			case "clear":
				await clearAllCommand();
				break;
			case "openConfig": {
				const configPath = getScenesConfigPath(workspaceRoot);
				if (!fs.existsSync(configPath)) {
					saveScenesConfig(workspaceRoot, { scenes: {} });
				}
				const doc = await vscode.workspace.openTextDocument(configPath);
				await vscode.window.showTextDocument(doc);
				break;
			}
		}
	});

	quickPick.onDidHide(() => quickPick.dispose());
	quickPick.show();
}
