import * as vscode from "vscode";
import { sceneManager } from "#src/application";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { runWithWorkspace } from "#src/ui/utils/commandRunner";
import {
	applySceneCommand,
	clearAllCommand,
	exportSceneCommand,
} from "./sceneCommands";
import { importSceneFromClipboardCommand } from "./clipboardCommands";
import { isInlayHintsAlwaysOn, toggleInlayHintsMode } from "#src/ui/utils/inlayHintsCoordinator";

export interface MenuQuickPickItem extends vscode.QuickPickItem {
	action?: "switch" | "clear" | "export" | "importClipboard" | "multiSelect" | "openConfig" | "toggleInlayHintsMode";
	sceneName?: string;
}

/**
 * 状态栏/全局快捷聚合菜单命令 (sceneBreakpoints.showMenu)
 */
/**
 * 构造置顶管理指令项
 */
function buildManagementMenuItems(): MenuQuickPickItem[] {
	const isAlwaysOn = isInlayHintsAlwaysOn();

	return [
		{
			label: `$(clear-all) ${vscode.l10n.t("Clear All Breakpoints")}`,
			description: vscode.l10n.t("Clear all breakpoints from current workspace"),
			action: "clear",
		},
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
			label: `$(file-code) ${vscode.l10n.t("Open debug-scenes.json")}`,
			description: vscode.l10n.t("Edit configuration file directly"),
			action: "openConfig",
		},
		{
			label: isAlwaysOn
				? `$(eye-closed) ${vscode.l10n.t("Line Annotations: Switch to Press Mode (Ctrl+Alt)")}`
				: `$(eye) ${vscode.l10n.t("Line Annotations: Switch to Always-On")}`,
			description: isAlwaysOn
				? vscode.l10n.t("Currently always shown. Click to show only on holding Ctrl+Alt")
				: vscode.l10n.t("Currently shown on holding Ctrl+Alt. Click to keep always visible"),
			action: "toggleInlayHintsMode",
		},
	];
}

/**
 * 构造场景列表项
 */
function buildSceneMenuItems(
	scenesDict: Record<string, unknown[]>,
	activeScenes: string[],
	isDirty: boolean,
): MenuQuickPickItem[] {
	const items: MenuQuickPickItem[] = [
		{ label: vscode.l10n.t("Scenes"), kind: vscode.QuickPickItemKind.Separator },
	];
	const sceneNames = Object.keys(scenesDict || {});

	if (sceneNames.length > 0) {
		for (const name of sceneNames) {
			const bps = scenesDict[name] || [];
			const isActive = activeScenes.includes(name);
			const label = isActive ? (isDirty ? `🟢 ${name}*` : `🟢 ${name}`) : `⚪ ${name}`;
			const description = isActive ? (isDirty ? vscode.l10n.t("(Active - Unsaved)") : vscode.l10n.t("(Active)")) : undefined;

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

	return items;
}

/**
 * 分发执行菜单动作
 */
async function executeMenuAction(selected: MenuQuickPickItem, workspaceRoot: string): Promise<void> {
	switch (selected.action) {
		case "multiSelect":
			await applySceneCommand();
			break;
		case "switch":
			if (selected.sceneName) await applySceneCommand(selected.sceneName);
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
			const configPath = sceneManager.ensureScenesConfigFile(workspaceRoot);
			const doc = await vscode.workspace.openTextDocument(configPath);
			await vscode.window.showTextDocument(doc);
			break;
		}
		case "toggleInlayHintsMode": {
			await toggleInlayHintsMode();
			break;
		}
	}
}

export async function showMenuCommand(): Promise<void> {
	await runWithWorkspace(async (workspaceRoot) => {
		const config = sceneManager.loadScenesConfig(workspaceRoot);
		const activeScenes = sceneStateManager.getActiveScenes();
		const isDirty = sceneStateManager.getIsDirty();

		const items: MenuQuickPickItem[] = [
			...buildManagementMenuItems(),
			...buildSceneMenuItems(config.scenes || {}, activeScenes, isDirty),
		];

		const quickPick = vscode.window.createQuickPick<MenuQuickPickItem>();
		quickPick.items = items;
		quickPick.placeholder = vscode.l10n.t("Select a scene to activate, or choose a management action");
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;

		const firstActive = activeScenes[0];
		if (firstActive) {
			const activeItem = items.find((it) => it.action === "switch" && it.sceneName === firstActive);
			if (activeItem) quickPick.activeItems = [activeItem];
		}

		quickPick.onDidAccept(async () => {
			const selected = quickPick.selectedItems[0];
			quickPick.hide();
			if (!selected || !selected.action) return;
			await executeMenuAction(selected, workspaceRoot);
		});

		quickPick.onDidHide(() => quickPick.dispose());
		quickPick.show();
	});
}

