import * as vscode from "vscode";
import { sceneStateManager } from "./domain";
import {
	registerAllCommands,
	checkAndPromptSkillUpdates,
	registerBreakpointSyncService,
	registerChatSkillService,
	registerConfigFileWatcherService,
	registerDebugLaunchService,
	registerDebugPauseService,
	registerSessionLifecycleService,
	registerTreeInteractionService,
	SceneCodeLensProvider,
	SceneTreeDataProvider,
	TemplateContentProvider,
	templateContentProvider,
	getStatusBarItem,
	initStatusBarItem,
	getWorkspaceRoot,
} from "./infra";

/**
 * 插件主激活入口 (Composition Root)
 * 职责：专职负责核心服务连线、命令注册与各领域协同服务 (Services) 挂载，0 业务实现细节残留
 */
export function activate(context: vscode.ExtensionContext) {
	// 1. 初始化底部常驻状态栏
	initStatusBarItem(context);

	// 2. 注册左侧调试面板专属场景管理树视图 (Run & Debug View)
	const treeDataProvider = new SceneTreeDataProvider(context.extensionPath);
	const treeView = vscode.window.createTreeView("sceneBreakpointsView", {
		treeDataProvider,
		showCollapseAll: true,
		dragAndDropController: treeDataProvider,
	});

	// 3. 表驱动集中注册所有用户命令与树交互动作
	registerAllCommands(context, { treeDataProvider, treeView });

	// 4. 挂载各领域协同业务服务 (Services) 与技术层提供者
	context.subscriptions.push(
		// 启动项三级匹配与调试配置联动服务
		registerDebugLaunchService(),
		// 编辑器断点全双工反向同步与脏状态检测服务
		registerBreakpointSyncService(treeDataProvider),
		// 树视图展开折叠记忆与复选框就地更新服务
		registerTreeInteractionService(treeView, treeDataProvider),
		// 外部 debug-scenes.json 文件变更监听与防抖守卫服务
		registerConfigFileWatcherService(treeDataProvider),
		// 调试运行时命中断点高亮、调用栈追踪与自动展开跟随服务
		registerDebugPauseService(treeView, treeDataProvider),
		// 调试会话终止生命周期与拓扑补发服务
		registerSessionLifecycleService(),
		// AI Agent Chat Skill 动态注入服务
		registerChatSkillService(context),
		// 场景一键激活 CodeLens 透镜按钮
		vscode.languages.registerCodeLensProvider(
			{ pattern: "**/debug-scenes.json" },
			new SceneCodeLensProvider(),
		),
		// Skill 官方模版虚拟文档比对提供者
		vscode.workspace.registerTextDocumentContentProvider(
			TemplateContentProvider.scheme,
			templateContentProvider,
		),
		treeView,
		{ dispose: () => sceneStateManager.dispose() },
	);

	// 5. 工作区 AI Skill 规则版本静默诊断与升级探测
	const wsRoot = getWorkspaceRoot(false);
	if (wsRoot) {
		checkAndPromptSkillUpdates(context, wsRoot).catch(() => {});
	}

	return {
		treeDataProvider,
		treeView,
		getStatusBarItem,
		checkAndPromptSkillUpdates,
	};
}

export function deactivate() {}
