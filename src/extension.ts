import * as vscode from "vscode";
import { configureDependencies, sceneStateManager } from "./application";
import {
	registerAllCommands,
	checkAndPromptSkillUpdates,
	SceneCodeLensProvider,
	SceneInlayHintsProvider,
	SceneTreeDataProvider,
	TemplateContentProvider,
	templateContentProvider,
	getStatusBarItem,
	initStatusBarItem,
} from "./ui";
import {
	registerBreakpointSyncService,
	registerChatSkillService,
	registerConfigFileWatcherService,
	registerDebugLaunchService,
	registerDebugPauseService,
	registerSessionLifecycleService,
	getWorkspaceRoot,
	jsonFileSceneRepository,
	seedEchoLoopBaselineFromDisk,
	ensureLocalScenesGitignore,
	isDiskContentModifiedSinceLastSaved,
	vscodeBreakpointBridge,
	vscodeLineReader,
} from "./infra";
import { promptFingerprintConflict } from "./ui/utils/promptHelpers";

/**
 * 组装装配根基础设施依赖
 */
function setupCompositionRoot(): void {
	configureDependencies({
		sceneRepository: jsonFileSceneRepository,
		breakpointBridge: vscodeBreakpointBridge,
		lineReader: vscodeLineReader,
		// INV-031：命令路径外部编辑门控信号（磁盘内容 vs 最近内部写盘基线）
		isExternalPendingEdit: () => {
			const wsRoot = getWorkspaceRoot();
			return wsRoot ? isDiskContentModifiedSinceLastSaved(wsRoot) : false;
		},
		// INV-031：指纹冲突裁决弹窗（用户关闭弹窗时缺省磁盘行号优先）
		resolveFingerprintConflict: promptFingerprintConflict,
	});
}

/**
 * 插件启动与生命周期装配总线 (Composition Root)
 * 职责：专职负责核心服务连线、命令注册与各领域协同服务 (Services) 挂载，0 业务实现细节残留
 */
export function activate(context: vscode.ExtensionContext) {
	// 0. 装配应用用例层依赖 (Composition Root 依赖注入，遵循 Clean Architecture DIP)
	setupCompositionRoot();

	// 0.1 冷启动基线播种 (INV-031 前置)：以磁盘现状为 lastSavedContent 基线，保留 Git Pull 漂移静默自愈
	// 0.2 个人私有层引导 (v1.2.0 INV-032)：确保 .gitignore 包含 debug-scenes.local.json（幂等）
	const wsRootSeed = getWorkspaceRoot();
	if (wsRootSeed) {
		seedEchoLoopBaselineFromDisk(wsRootSeed);
		ensureLocalScenesGitignore(wsRootSeed);
	}

	// 1. 初始化底部常驻状态栏
	initStatusBarItem(context);

	// 2. 初始化行末断点注解主动推送服务
	const inlayHintsProvider = new SceneInlayHintsProvider();

	// 3. 注册左侧调试面板专属场景管理树视图 (Run & Debug View)
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
		registerBreakpointSyncService(),
		// 树视图展开折叠记忆与复选框就地更新服务
		treeDataProvider.bindView(treeView),
		// 外部 debug-scenes.json 文件变更监听与防抖守卫服务
		registerConfigFileWatcherService(),
		// 调试运行时命中断点高亮、调用栈追踪与自动展开跟随服务
		registerDebugPauseService(),
		// 调试会话终止生命周期与拓扑补发服务
		registerSessionLifecycleService(),
		// AI Agent Chat Skill 动态注入服务
		registerChatSkillService(context),
		// 场景一键激活 CodeLens 透镜按钮（v1.2.0：覆盖 team 主文件与 local 私有文件）
		vscode.languages.registerCodeLensProvider(
			[{ pattern: "**/debug-scenes.json" }, { pattern: "**/debug-scenes.local.json" }],
			new SceneCodeLensProvider(),
		),
		// 行末场景断点注解与幽灵文本透视提供者 (Inlay Hints)
		vscode.languages.registerInlayHintsProvider(
			[{ scheme: "file" }, { scheme: "untitled" }],
			inlayHintsProvider,
		),
		inlayHintsProvider,
		// Skill 官方模版虚拟文档比对提供者
		vscode.workspace.registerTextDocumentContentProvider(
			TemplateContentProvider.scheme,
			templateContentProvider,
		),
		treeView,
		{ dispose: () => sceneStateManager.dispose() },
	);

	// 5. 工作区 AI Skill 规则版本静默诊断与升级探测
	const wsRoot = getWorkspaceRoot();
	if (wsRoot) {
		checkAndPromptSkillUpdates(context, wsRoot).catch(() => {});
	}

	return {
		treeDataProvider,
		treeView,
		getStatusBarItem,
		checkAndPromptSkillUpdates,
		sceneStateManager,
		inlayHintsProvider,
	};
}

export function deactivate() {}
