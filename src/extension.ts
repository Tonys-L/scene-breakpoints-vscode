import * as vscode from "vscode";
import {
	configureDependencies,
	sceneStateManager,
	sceneManager,
	debugTraceBuffer,
	buildGraphSnapshot,
	type GraphSnapshot,
} from "./application";
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
import { GraphCanvasController } from "./ui/views/graphCanvas/graphCanvasController";
import type { GraphWebviewLabels } from "./ui/views/graphCanvas/graphWebviewDocument";
import { setGraphCommandDeps } from "./ui/commands/graphCommands";

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

function buildGraphCanvasLabels(): GraphWebviewLabels {
	return {
		panelTitle: vscode.l10n.t("Scene Graph"),
		tabFlow: vscode.l10n.t("Flow"),
		tabTrace: vscode.l10n.t("Hit Trace"),
		exportButton: vscode.l10n.t("Export Mermaid"),
		flowEmpty: vscode.l10n.t(
			"Canvas is empty. Select scenes in the scope bar above, or activate a scene.",
		),
		traceEmpty: vscode.l10n.t("No hit records in this debug session yet."),
		scopeLabel: vscode.l10n.t("Scene Scope"),
		sceneInactive: vscode.l10n.t("Not Active"),
		laneCircular: vscode.l10n.t("Circular scene reference"),
		localLayerBadge: vscode.l10n.t("Local"),
		localLayerTitle: vscode.l10n.t("Local private scene (.vscode/debug-scenes.local.json)"),
		zoomIn: vscode.l10n.t("Zoom In"),
		zoomOut: vscode.l10n.t("Zoom Out"),
		zoomFit: vscode.l10n.t("Fit View"),
		zoomReset: vscode.l10n.t("Reset Zoom (1:1)"),
		unmatchedBadge: vscode.l10n.t("Code Drifter Unmatched"),
		conditionLabel: vscode.l10n.t("Condition:"),
		hitConditionLabel: vscode.l10n.t("Hit Count:"),
		logMessageLabel: vscode.l10n.t("Log Message:"),
		bpTypeLabels: {
			line: { name: vscode.l10n.t("Line"), title: vscode.l10n.t("Line Breakpoint") },
			condition: { name: vscode.l10n.t("Cond"), title: vscode.l10n.t("Conditional Breakpoint") },
			logpoint: { name: vscode.l10n.t("Log"), title: vscode.l10n.t("Logpoint") },
			hitCount: { name: vscode.l10n.t("Hit"), title: vscode.l10n.t("Hit Count Breakpoint") },
			function: { name: vscode.l10n.t("Func"), title: vscode.l10n.t("Function Breakpoint") },
			ref: { name: vscode.l10n.t("Scene"), title: vscode.l10n.t("Scene Reference") },
		},
		sceneSelectTooltip: vscode.l10n.t("Click to switch active debug scene"),
		scenePrefix: vscode.l10n.t("Scene:"),
		selectScenePrompt: vscode.l10n.t("Select Scene"),
		statusActive: vscode.l10n.t("● Active"),
		statusPreview: vscode.l10n.t("○ Preview"),
		searchScenePlaceholder: vscode.l10n.t("Search scene name..."),
		activeScenesGroup: vscode.l10n.t("Active Scenes"),
		inactiveScenesGroup: vscode.l10n.t("Pending / Preview Scenes"),
		switchToSceneTooltip: vscode.l10n.t("Switch to scene: {0}"),
		noScenesFound: vscode.l10n.t("No matching scenes found"),
		openInEditorTooltip: vscode.l10n.t("Open in editor (or double-click card)"),
		refPrefix: vscode.l10n.t("Ref: {0}"),
		refScenePrefix: vscode.l10n.t("Referenced Scene: {0}"),
		conditionExprTooltip: vscode.l10n.t("Condition Expression: {0}"),
		hitCountTooltip: vscode.l10n.t("Hit Count Condition: {0}"),
		logMessageTooltip: vscode.l10n.t("Log Message: {0}"),
		codeDriftWarning: vscode.l10n.t("Code drift exceeds safety threshold"),
		notActiveTooltip: vscode.l10n.t("Current scene is not active in debugger"),
		expand: vscode.l10n.t("Expand"),
		collapse: vscode.l10n.t("Collapse"),
		breakpointFallback: vscode.l10n.t("Breakpoint"),
		activateScene: vscode.l10n.t("Activate Scene"),
		activateSceneTooltip: vscode.l10n.t("Activate [{0}] and register breakpoints immediately"),
		exportMermaidTooltip: vscode.l10n.t("Export Mermaid Flowchart"),
		flowEmptyHint: vscode.l10n.t("Multiple scenes can be checked in the menu above for cross-flow comparison"),
		pendingActiveScene: vscode.l10n.t("Pending Active Scene"),
		traceFilterPlaceholder: vscode.l10n.t("Filter description, file path, or step..."),
		clearSearch: vscode.l10n.t("Clear Search"),
		traceTotalSteps: vscode.l10n.t("Total {0} steps"),
		traceTotalStepsTooltip: vscode.l10n.t("{0} execution hits recorded"),
		traceLoopCollapsed: vscode.l10n.t("Collapsed {0} loop groups"),
		traceLoopCollapsedTooltip: vscode.l10n.t("Automatically collapsed {0} hits into {1} loops"),
		statusDebugPaused: vscode.l10n.t("Debugger Paused"),
		statusSessionTerminated: vscode.l10n.t("Session Terminated"),
		statusRunning: vscode.l10n.t("Running"),
		clearTraceTooltip: vscode.l10n.t("Clear Current Hit Trace"),
		traceLoopUnit: vscode.l10n.t("Loop {0} times ({1} steps)"),
		tracePausedInLoop: vscode.l10n.t("Currently paused inside loop"),
		scrollToLatest: vscode.l10n.t("Jump to latest step ↓"),
		jumpToSourceTooltip: vscode.l10n.t("Click to jump and locate source line"),
		pausedHere: vscode.l10n.t("Paused here"),
		exitPoint: vscode.l10n.t("Exit point"),
		locateSource: vscode.l10n.t("Locate Source"),
		expandMinimap: vscode.l10n.t("Expand Minimap"),
		collapseMinimap: vscode.l10n.t("Collapse Minimap"),
		minimap: vscode.l10n.t("Minimap"),
		minimapNav: vscode.l10n.t("Minimap Navigation"),
	};
}

/**
 * 场景断点可视化画布装配 (v1.3.0)：轨迹缓存先行订阅，控制器经命令依赖注入点接线
 */
function setupGraphCanvas(context: vscode.ExtensionContext): GraphCanvasController {
	debugTraceBuffer.init();
	const loadGraphSnapshot = (
		workspaceRoot: string,
		visibleScenes?: readonly string[],
	): GraphSnapshot => {
		const { catalog, originByScene } = sceneManager.loadMergedCatalog(workspaceRoot);
		return buildGraphSnapshot({
			workspaceRoot,
			catalog,
			activeScenes: sceneStateManager.getActiveScenes(),
			visibleScenes,
			originByScene,
			isUnmatched: (file, line) => sceneStateManager.isBreakpointUnmatched(file, line),
		});
	};
	const graphCanvasController = new GraphCanvasController({
		extensionUri: context.extensionUri,
		labels: buildGraphCanvasLabels(),
		loadSnapshot: loadGraphSnapshot,
	});
	setGraphCommandDeps({ controller: graphCanvasController, loadSnapshot: loadGraphSnapshot });
	return graphCanvasController;
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

	// 3.1 场景断点可视化画布 (v1.3.0 & v1.4.0)：挂载副侧边栏 WebviewView Provider 与命令接线
	const graphCanvasController = setupGraphCanvas(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			GraphCanvasController.viewType,
			graphCanvasController,
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
	);

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
		// 场景断点画布控制器：总线订阅与面板生命周期成对释放
		graphCanvasController,
		// 调试命中轨迹缓存订阅（随扩展卸载退订）
		{ dispose: () => debugTraceBuffer.dispose() },
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
		graphCanvasController,
	};
}

export function deactivate() {}
