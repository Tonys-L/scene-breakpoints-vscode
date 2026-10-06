import * as vscode from "vscode";
import { addBreakpointCommand } from "./addBreakpointCommand";
import {
	applySceneCommand,
	clearAllCommand,
	exportSceneCommand,
	setExtensionGlobalState,
	registerResolveWarningsNotifier,
} from "./sceneCommands";
import { showMenuCommand } from "./menuCommands";
import { captureCallStackCommand } from "./captureCallStackCommand";
import {
	copySceneToClipboardCommand,
	importSceneFromClipboardCommand,
} from "./clipboardCommands";
import {
	installSkillCommand,
} from "./skillCommands";
import { diagnoseAiIntegrationCommand } from "./skillDiagnostic";
import { registerTreeCommands } from "./treeCommands";
import type { SceneTreeDataProvider } from "#src/ui/views/sceneTreeProvider";

export interface CommandDependencies {
	treeDataProvider?: SceneTreeDataProvider;
	treeView?: vscode.TreeView<any>;
}

/**
 * 命令注册中枢：以声明式表驱动方式集中注册扩展的所有命令，并绑定生命周期
 */
export function registerAllCommands(
	context: vscode.ExtensionContext,
	deps?: CommandDependencies,
): void {
	setExtensionGlobalState(context.globalState);

	const commands: Array<[string, (...args: any[]) => any]> = [
		// 核心场景断点命令
		["sceneBreakpoints.addBreakpoint", addBreakpointCommand],
		["sceneBreakpoints.applyScene", applySceneCommand],
		["sceneBreakpoints.clearAll", clearAllCommand],
		["sceneBreakpoints.exportScene", exportSceneCommand],
		["sceneBreakpoints.showMenu", showMenuCommand],
		// 事故现场逆向固化：调用栈一键生成场景 (v1.2.0)
		["sceneBreakpoints.captureCallStack", captureCallStackCommand],
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

	// 解析警告通知（引用悬空/禁用等激活告警）
	context.subscriptions.push(registerResolveWarningsNotifier());

	if (deps?.treeDataProvider) {
		registerTreeCommands(context, deps.treeDataProvider, deps.treeView);
	}
}

export * from "./addBreakpointCommand";
export * from "./sceneCommands";
export * from "./menuCommands";
export * from "./captureCallStackCommand";
export * from "./clipboardCommands";
export * from "./treeCommands";
export * from "./skillCommands";
export * from "./skillDiagnostic";
