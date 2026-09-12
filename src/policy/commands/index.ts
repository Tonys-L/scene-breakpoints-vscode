import * as vscode from "vscode";
import { addBreakpointCommand } from "./addBreakpoint";
import { applySceneCommand } from "./applyScene";
import { clearAllCommand } from "./clearAll";
import { exportSceneCommand } from "./exportScene";
import { showMenuCommand } from "./showMenu";
import { copySceneToClipboardCommand, importSceneFromClipboardCommand } from "./clipboardSync";
import { installSkillCommand, diagnoseAiIntegrationCommand, checkAndPromptSkillUpdates } from "./skillCommands";
import { registerTreeCommands } from "./treeCommands";
import { SceneTreeDataProvider } from "../../infra/vscode/sceneTreeProvider";

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
	// 声明式命令路由映射表：统一管理，杜绝临时变量堆积与销毁遗漏
	const commands: Array<[string, (...args: any[]) => any]> = [
		// 核心断点场景交互
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

	// 表驱动批量注册并推入 subscriptions 统一管理生命周期
	for (const [commandId, handler] of commands) {
		context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
	}

	// 树视图专用交互与上下文菜单命令注册
	if (deps?.treeDataProvider) {
		registerTreeCommands(context, deps.treeDataProvider);
	}
}

export {
	addBreakpointCommand,
	applySceneCommand,
	clearAllCommand,
	exportSceneCommand,
	showMenuCommand,
	copySceneCommand,
	importSceneCommand,
	installSkillCommand,
	diagnoseAiIntegrationCommand,
	checkAndPromptSkillUpdates,
	registerTreeCommands,
};
