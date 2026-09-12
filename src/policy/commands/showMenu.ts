import * as fs from "node:fs";
import * as vscode from "vscode";
import { getScenesConfigPath, getWorkspaceRoot, loadScenesConfig, saveScenesConfig } from "../../infra/storage/jsonFileSceneRepository";
import { sceneStateManager } from "../../core/sceneStateManager";
import { applySceneCommand } from "./applyScene";
import { clearAllCommand } from "./clearAll";
import { importSceneFromClipboardCommand } from "./clipboardSync";
import { exportSceneCommand } from "./exportScene";

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

	// 自动将当前激活的场景设为默认高亮聚焦项（激活整行高亮选中背景！）
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
