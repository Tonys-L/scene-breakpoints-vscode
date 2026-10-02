import * as path from "node:path";
import * as vscode from "vscode";
import { sceneManager } from "#src/application";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { promptInlayHintsModeIfFirstTime } from "#src/ui/views/inlayHintsPrompt";
import { runWithWorkspace } from "#src/ui/utils/commandRunner";
export { addBreakpointCommand } from "./addBreakpointCommand";

let extensionGlobalState: vscode.Memento | undefined;

export function setExtensionGlobalState(state?: vscode.Memento): void {
	extensionGlobalState = state;
}

// ==============================
// 1. 清空所有断点命令 (Clear All)
// ==============================

export async function clearAllCommand(): Promise<void> {
	await runWithWorkspace(false, async (workspaceRoot) => {
		await sceneManager.clearAll(workspaceRoot);
	});
}

// ==============================
// 2. 激活场景断点辅助：目标场景推导
// ==============================

async function resolveTargetScenes(
	workspaceRoot: string,
	sceneParam?: unknown,
): Promise<string[] | undefined> {
	const config = sceneManager.loadScenesConfig(workspaceRoot);
	const sceneNames = Object.keys(config.scenes || {});
	if (sceneNames.length === 0) {
		void vscode.window.showWarningMessage(vscode.l10n.t("No scenes configured in debug-scenes.json yet"));
		return undefined;
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

		if (picked === undefined) return undefined; // 用户按 ESC 或取消
		targetScenes = picked.map((it) => it.label);
	}

	return targetScenes;
}

// ==============================
// 3. 激活场景断点命令 (Apply Scene)
// ==============================

/**
 * 保护机制：若当前工作区正处于未保存临时断点的 Dirty 状态，弹窗提示用户决策
 */
async function handleDirtyCheckBeforeSwitch(workspaceRoot: string): Promise<boolean> {
	const currentActive = sceneStateManager.getActiveScene();
	const isDirty = sceneStateManager.getIsDirty();
	if (!currentActive || !isDirty) return true;

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

	if (!chosen) return false;
	if (chosen === actionAppend) {
		await sceneManager.exportScene(workspaceRoot, currentActive, "overwrite");
	}
	return true;
}

/**
 * 场景激活完成后的 UI 消息提示与未匹配脱靶告警定位
 */
function showActivationFeedback(
	workspaceRoot: string,
	primarySceneLabel: string,
	result: {
		loadedCount: number;
		healedCount: number;
		unmatchedCount: number;
		unmatchedBreakpoints?: Array<{ file: string; line: number }>;
	},
): void {
	if (result.unmatchedCount > 0) {
		const count = result.unmatchedCount;
		const unmatches = result.unmatchedBreakpoints || [];
		const firstItem = unmatches[0];
		const summary = unmatches.slice(0, 3).map((bp) => `${path.basename(bp.file)}:${bp.line}`).join(", ");
		const more = count > 3 ? ` 等 ${count} 处` : "";
		const viewAction = vscode.l10n.t("Locate Code");

		void vscode.window
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
					const fullPath = path.isAbsolute(firstItem.file) ? firstItem.file : path.join(workspaceRoot, firstItem.file);
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
		void vscode.window.showInformationMessage(
			vscode.l10n.t(
				"Scene(s) [{0}] activated! Loaded {1} breakpoint(s) (Auto-healed {2} drifted line(s)).",
				primarySceneLabel,
				result.loadedCount,
				result.healedCount,
			),
		);
	} else {
		void vscode.window.showInformationMessage(
			vscode.l10n.t(
				"Scene(s) [{0}] activated! Set {1} target breakpoint(s) and cleaned others.",
				primarySceneLabel,
				result.loadedCount,
			),
		);
	}
}

export async function applySceneCommand(sceneParam?: unknown): Promise<void> {
	await runWithWorkspace(true, async (workspaceRoot) => {
		const targetScenes = await resolveTargetScenes(workspaceRoot, sceneParam);
		if (!targetScenes) return;

		// 若所有勾选均被取消，执行清空并返回
		if (targetScenes.length === 0) {
			await sceneManager.clearAll(workspaceRoot);
			return;
		}

		const proceed = await handleDirtyCheckBeforeSwitch(workspaceRoot);
		if (!proceed) return;

		const result = await sceneManager.activateScene(workspaceRoot, targetScenes);
		if (!result.success) {
			void vscode.window.showErrorMessage(
				vscode.l10n.t("Scene(s) [{0}] not found in debug-scenes.json", result.missingScenes.join(", ")),
			);
			return;
		}

		if (result.missingScenes.length > 0) {
			void vscode.window.showWarningMessage(
				vscode.l10n.t("Scene(s) [{0}] not found and skipped", result.missingScenes.join(", ")),
			);
		}

		const primarySceneLabel = result.validTargetScenes.length === 1
			? result.validTargetScenes[0]
			: result.validTargetScenes.join(" + ");

		showActivationFeedback(workspaceRoot, primarySceneLabel, result);
		promptInlayHintsModeIfFirstTime(extensionGlobalState).catch(() => {});
	});
}

// ==============================
// 4. 导出场景命令 (Export Scene)
// ==============================

export async function exportSceneCommand(): Promise<void> {
	const currentBreakpoints = vscode.debug.breakpoints;
	if (!currentBreakpoints || currentBreakpoints.length === 0) {
		void vscode.window.showWarningMessage(vscode.l10n.t("No active breakpoints found in current workspace. Please set some breakpoints first."));
		return;
	}

	await runWithWorkspace(true, async (workspaceRoot) => {
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
		const config = sceneManager.loadScenesConfig(workspaceRoot);
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
		const result = await sceneManager.exportScene(
			workspaceRoot,
			targetScene,
			mode,
		);

		if (result.success) {
			sceneStateManager.setActiveScene(targetScene, result.count);
			void vscode.window.showInformationMessage(
				vscode.l10n.t("Successfully exported {0} active breakpoint(s) to scene [{1}]!", result.count, targetScene),
			);
		}
	});
}

