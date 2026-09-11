import * as path from "node:path";
import * as vscode from "vscode";
import { applySceneBreakpoints, collectCurrentBreakpoints } from "../breakpointAdapter";
import { getWorkspaceRoot, loadScenesConfig, mergeScenesBreakpoints, saveScenesConfig } from "../configManager";
import { sceneStateManager } from "../sceneStateManager";
import { clearAllCommand } from "./clearAll";

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

	// 强校验守卫 (Idempotency & Validity Guard): 校验目标场景是否在 debug-scenes.json 中真实存在 (大小写容错)
	const validTargetScenes: string[] = [];
	const missingScenes: string[] = [];

	for (const target of targetScenes) {
		const matched = sceneNames.find((s) => s.toLowerCase() === target.toLowerCase());
		if (matched) {
			validTargetScenes.push(matched);
		} else {
			missingScenes.push(target);
		}
	}

	if (validTargetScenes.length === 0) {
		vscode.window.showErrorMessage(
			vscode.l10n.t("Scene(s) [{0}] not found in debug-scenes.json", missingScenes.join(", ")),
		);
		return;
	}

	if (missingScenes.length > 0) {
		vscode.window.showWarningMessage(
			vscode.l10n.t("Scene(s) [{0}] not found and skipped", missingScenes.join(", ")),
		);
	}

	targetScenes = validTargetScenes;

	const currentActive = sceneStateManager.getActiveScene();
	const isDirty = sceneStateManager.getIsDirty();

	// 保护机制：若当前工作区正处于未保存临时断点的 Dirty 状态，弹窗提示用户决策
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
			const currentBps = await collectCurrentBreakpoints(workspaceRoot);
			config.scenes[currentActive] = currentBps;
			saveScenesConfig(workspaceRoot, config);
		}
	}

	// 聚合多场景断点并去重 (INV-001)
	const bpsToLoad = mergeScenesBreakpoints(config, targetScenes);
	const primarySceneLabel = targetScenes.length === 1 ? targetScenes[0] : targetScenes.join(" + ");

	const { loadedCount, healedCount, healedBreakpoints, unmatchedBreakpoints } = await applySceneBreakpoints(
		workspaceRoot,
		primarySceneLabel,
		bpsToLoad,
	);

	// 统一由状态机驱动全局状态与视图
	sceneStateManager.setActiveScenes(targetScenes, loadedCount);

	// 自愈持久化闭环 (Self-Healing Persistence Loopback):
	// 若探测并修正了代码行号漂移，自动将自愈后的最新断点回写持久化至 debug-scenes.json
	if (healedCount > 0 && healedBreakpoints) {
		let hasPersisted = false;
		if (targetScenes.length === 1) {
			config.scenes[targetScenes[0]] = healedBreakpoints;
			hasPersisted = true;
		} else {
			for (const sceneName of targetScenes) {
				const sceneList = config.scenes[sceneName];
				if (!Array.isArray(sceneList)) continue;
				for (const item of sceneList) {
					if (item.type === "function") continue;
					const srcItem = item as import("../types").SourceSceneBreakpoint;
					const matched = healedBreakpoints.find(
						(h): h is import("../types").SourceSceneBreakpoint =>
							h.type !== "function" &&
							(h as import("../types").SourceSceneBreakpoint).file === srcItem.file &&
							(h as import("../types").SourceSceneBreakpoint).contextSnippet?.current ===
								srcItem.contextSnippet?.current,
					);
					if (matched && srcItem.line !== matched.line) {
						srcItem.line = matched.line;
						hasPersisted = true;
					}
				}
			}
		}
		if (hasPersisted) {
			saveScenesConfig(workspaceRoot, config);
		}
	}

	if (unmatchedBreakpoints && unmatchedBreakpoints.length > 0) {
		const count = unmatchedBreakpoints.length;
		const firstItem = unmatchedBreakpoints[0];
		const summary = unmatchedBreakpoints
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
	} else if (healedCount > 0) {
		vscode.window.showInformationMessage(
			vscode.l10n.t(
				"Scene(s) [{0}] activated! Loaded {1} breakpoint(s) (Auto-healed {2} drifted line(s)).",
				primarySceneLabel,
				loadedCount,
				healedCount,
			),
		);
	} else {
		vscode.window.showInformationMessage(
			vscode.l10n.t(
				"Scene(s) [{0}] activated! Set {1} target breakpoint(s) and cleaned others.",
				primarySceneLabel,
				loadedCount,
			),
		);
	}
}
