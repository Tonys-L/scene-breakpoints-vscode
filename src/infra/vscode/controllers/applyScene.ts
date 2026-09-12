import * as path from "node:path";
import * as vscode from "vscode";
import { activateSceneUseCase } from "../../../application/activateSceneUseCase";
import { getWorkspaceRoot, loadScenesConfig, saveScenesConfig } from "../../storage/jsonFileSceneRepository";
import { vscodeBreakpointBridge } from "../vscodeBreakpointBridge";
import { sceneStateManager } from "../../../domain/sceneStateManager";
import { clearAllCommand } from "./clearAll";

/**
 * 场景激活控制器 (Apply Scene Controller)
 * 职责：负责 VS Code 宿主交互（光标感知、QuickPick 弹窗、未保存 Dirty 确认与结果弹窗提示），将纯业务调度委托给 activateScenePolicy
 */
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

	// 1. 智能感知：若当前打开的是 debug-scenes.json 且未显式指定场景，优先识别光标所在区域的场景名
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

	// 2. 若仍未确定场景，弹出可多选面板 (canPickMany: true)
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

	// 3. 若所有勾选均被取消，执行清空并返回
	if (targetScenes.length === 0) {
		await clearAllCommand();
		return;
	}

	// 4. 保护机制：若当前工作区正处于未保存临时断点的 Dirty 状态，弹窗提示用户决策
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

	// 5. 调用纯 Policy 用例执行核心调度流
	const result = await activateSceneUseCase({
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

	// 6. UI 结果反馈
	if (result.healedCount > 0) {
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
