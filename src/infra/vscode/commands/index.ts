import * as vscode from "vscode";
import {
	addBreakpointCommand,
	applySceneCommand,
	clearAllCommand,
	exportSceneCommand,
	showMenuCommand,
} from "./sceneCommands";
import {
	copySceneToClipboardCommand,
	importSceneFromClipboardCommand,
} from "./clipboardCommands";
import {
	checkAndPromptSkillUpdates,
	diagnoseAiIntegrationCommand,
	installSkillCommand,
} from "./skillCommands";
import { registerTreeCommands } from "./treeCommands";
import { SceneTreeDataProvider } from "../sceneTreeProvider";

export interface CommandDependencies {
	treeDataProvider?: SceneTreeDataProvider;
}

/**
 * 命令注册中枢：以声明式表驱动方式集中注册扩展的所有命令，并绑定生命周期
 */
export function registerAllCommands(
	context: vscode.ExtensionContext,
	deps?: CommandDependencies,
): void {
	const commands: Array<[string, (...args: any[]) => any]> = [
		// 核心场景断点命令
		["sceneBreakpoints.addBreakpoint", addBreakpointCommand],
		["sceneBreakpoints.applyScene", applySceneCommand],
		["sceneBreakpoints.clearAll", clearAllCommand],
		["sceneBreakpoints.exportScene", exportSceneCommand],
		["sceneBreakpoints.showMenu", showMenuCommand],
		// 剪贴板快速流转与团队共享
		["sceneBreakpoints.copySceneToClipboard", copySceneToClipboardCommand],
		["sceneBreakpoints.importSceneFromClipboard", importSceneFromClipboardCommand],
		// AI Agent 技能集成与状态诊断
		["sceneBreakpoints.installSkill", () => installSkillCommand(context)],
		["sceneBreakpoints.diagnoseAiIntegration", () => diagnoseAiIntegrationCommand(context)],
	];

	for (const [commandId, handler] of commands) {
		context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
	}

	if (deps?.treeDataProvider) {
		registerTreeCommands(context, deps.treeDataProvider);
	}
}

export * from "./sceneCommands";
export * from "./clipboardCommands";
export * from "./treeCommands";
export * from "./skillCommands";
