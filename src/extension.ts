import * as fs from "node:fs";
import * as vscode from "vscode";
import { SceneCodeLensProvider } from "./codeLensProvider";
import { applySceneCommand, registerAllCommands } from "./commands";
import { getStatusBarItem, initStatusBarItem } from "./statusBar";
import { sceneStateManager } from "./sceneStateManager";
import { syncCoordinator } from "./syncCoordinator";

import { applySceneBreakpoints, syncBreakpointEnabledToEditor } from "./breakpointAdapter";
import {
	getWorkspaceRoot,
	isContentMatchingLastSaved,
	loadScenesConfig,
	mergeScenesBreakpoints,
	resolveLaunchBoundScenes,
	saveScenesConfig,
	syncEditorBreakpointChangesToConfig,
} from "./configManager";
import { handleExternalScenesFileChange } from "./coordinators/aiActivationCoordinator";
import { BreakpointNode, SceneNode, SceneTreeDataProvider } from "./sceneTreeProvider";

export function activate(context: vscode.ExtensionContext) {
	// 1. 初始化底部常驻状态栏
	initStatusBarItem(context);

	// 2. 注册左侧调试面板专属场景管理树视图 (Run & Debug View)
	const treeDataProvider = new SceneTreeDataProvider(context.extensionPath);
	const treeView = vscode.window.createTreeView("sceneBreakpointsView", {
		treeDataProvider,
		showCollapseAll: true,
	});

	// 3. 注册扩展全部用户命令 (通过表驱动命令注册中枢统一管理)
	registerAllCommands(context, { treeDataProvider });

	// 4. 注册调试配置提供者：在调试启动前根据优先级联动激活目标场景 (带幂等防护)
	const debugConfigProvider = vscode.debug.registerDebugConfigurationProvider("*", {
		async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration) {
			const autoActivate = vscode.workspace
				.getConfiguration("sceneBreakpoints")
				.get<boolean>("autoActivateOnLaunch", true);

			if (autoActivate && config) {
				const workspaceRoot = getWorkspaceRoot(false);
				if (workspaceRoot) {
					const scenesConfig = loadScenesConfig(workspaceRoot);
					const targetScenes = resolveLaunchBoundScenes(
						scenesConfig,
						config.name,
						config.env?.DEBUG_SCENE,
					);

					if (targetScenes.length > 0) {
						// 幂等守卫 (Idempotency Guard): 若当前已激活的场景集合与目标完全一致，跳过切换
						const currentActives = sceneStateManager.getActiveScenes();
						const isIdentical =
							currentActives.length === targetScenes.length &&
							currentActives.every((s, idx) => s === targetScenes[idx]);

						if (!isIdentical) {
							await applySceneCommand(targetScenes);
						}
					}
				}
			}
			return config;
		},
	});


	// 4. 注册 CodeLens 提供者：在 debug-scenes.json 中为每个场景渲染一键激活透镜按钮
	const codeLensProvider = vscode.languages.registerCodeLensProvider(
		{ pattern: "**/debug-scenes.json" },
		new SceneCodeLensProvider(),
	);

	// 5. 监听断点变更事件：
	// a. 若处于批量装配或原子替换中，直接放行保护；
	// b. 若所有断点被清除，复位状态为 None；
	// c. 捕获 event.changed，反向同步编辑器中被切换启用/禁用的断点到当前激活场景 JSON；
	// d. 脏状态安全检测。
	const bpChangeListener = vscode.debug.onDidChangeBreakpoints(async (event) => {
		if (sceneStateManager.isApplyingScene()) {
			return;
		}

		const currentCount = vscode.debug.breakpoints.length;
		if (currentCount === 0) {
			sceneStateManager.setActiveScene(undefined, 0);
			return;
		}

		if (event.changed && event.changed.length > 0) {
			const activeScenes = sceneStateManager.getActiveScenes();
			if (activeScenes.length > 0) {
				const workspaceRoot = getWorkspaceRoot(false);
				if (workspaceRoot) {
					const config = loadScenesConfig(workspaceRoot);
					const hasUpdated = syncEditorBreakpointChangesToConfig(
						config,
						activeScenes,
						event.changed,
						workspaceRoot,
					);
					if (hasUpdated) {
						syncCoordinator.markInternalSaving();
						saveScenesConfig(workspaceRoot, config);
						treeDataProvider.refresh();
					}
				}
			}
		}

		sceneStateManager.checkDirtyWithCount(currentCount);
	});

	// 记录用户手动展开/折叠的场景状态，防止任何刷新导致折叠状态被粗暴重置
	treeView.onDidExpandElement((e) => {
		if (e.element instanceof SceneNode) {
			SceneNode.expandedScenes.add(e.element.sceneName);
		}
	});
	treeView.onDidCollapseElement((e) => {
		if (e.element instanceof SceneNode) {
			SceneNode.expandedScenes.delete(e.element.sceneName);
		}
	});

	// 状态机变更与外部文件变动时响应式重绘树视图
	const stateChangeListener = sceneStateManager.onDidChangeState(() => {
		treeDataProvider.refresh();
	});

	// 监听用户点击树节点原生复选框事件 (对齐 VS Code 原生 Breakpoints 面板)
	const checkboxChangeListener = treeView.onDidChangeCheckboxState(async (e) => {
		const workspaceRoot = getWorkspaceRoot(true);
		if (!workspaceRoot) return;

		const config = loadScenesConfig(workspaceRoot);
		let hasChanges = false;
		const affectedBreakpoints: { node: BreakpointNode; sceneName: string; bp: import("./types").SceneBreakpoint }[] = [];

		for (const [item, state] of e.items) {
			if (item instanceof BreakpointNode && item.sceneName && typeof item.index === "number") {
				const list = config.scenes[item.sceneName];
				if (list && list[item.index]) {
					const targetBp = list[item.index];
					const newEnabled = state === vscode.TreeItemCheckboxState.Checked;
					if (targetBp.enabled !== newEnabled) {
						targetBp.enabled = newEnabled;
						item.breakpoint.enabled = newEnabled; // 关键修复：同步更新内存中 TreeItem 持有的断点实体属性
						hasChanges = true;
						affectedBreakpoints.push({ node: item, sceneName: item.sceneName, bp: targetBp });
					}
				}
			}
		}

		if (hasChanges) {
			syncCoordinator.markInternalSaving();
			saveScenesConfig(workspaceRoot, config);

			// 极关键优化：仅局部精准刷新受影响的断点节点属性，绝不刷新整树！
			// VS Code 将仅就地更新该节点的图标与状态，其它所有兄弟节点与场景根节点纹丝不动，0 闪烁！
			for (const { node } of affectedBreakpoints) {
				node.updateAppearance();
				treeDataProvider.refresh(node);
			}

			// 若对应场景处于激活状态，实时就地同步编辑器原生断点
			for (const { sceneName, bp } of affectedBreakpoints) {
				if (sceneStateManager.isSceneActive(sceneName)) {
					await syncBreakpointEnabledToEditor(workspaceRoot, bp, bp.enabled ?? true);
				}
			}
		}
	});

	let fileChangeDebounceTimer: NodeJS.Timeout | undefined;
	const fileWatcher = vscode.workspace.createFileSystemWatcher("**/debug-scenes.json");
	fileWatcher.onDidChange((uri) => {
		if (fileChangeDebounceTimer) {
			clearTimeout(fileChangeDebounceTimer);
		}
		fileChangeDebounceTimer = setTimeout(async () => {
			fileChangeDebounceTimer = undefined;
			// 严密指纹守卫：比对磁盘内容，若与扩展最近一次内部写盘内容一致，100% 确定为自身持久化行为
			// 坚决直接返回，彻底阻断文件系统异步延迟推送导致的二次重复整树重绘与断点重复重装
			try {
				if (fs.existsSync(uri.fsPath)) {
					const currentDiskContent = fs.readFileSync(uri.fsPath, "utf-8");
					if (isContentMatchingLastSaved(currentDiskContent)) {
						return;
					}
				}
			} catch {
				// 文件正在占用写入中时忽略异常
			}

			if (syncCoordinator.isInternalSaving()) {
				return;
			}

			// 调度领域层处理外部文件变更（支持 AI activeScenes 声明式自动激活与热重载）
			const workspaceRoot = getWorkspaceRoot(false);
			if (workspaceRoot) {
				await handleExternalScenesFileChange(workspaceRoot);
			}
			treeDataProvider.refresh();
		}, 100);
	});
	fileWatcher.onDidCreate(() => treeDataProvider.refresh());
	fileWatcher.onDidDelete(() => treeDataProvider.refresh());

	const terminateSessionListener = vscode.debug.onDidTerminateDebugSession(async () => {
		// 调试会话结束后，核心断点拓扑快照失效清空
		sceneStateManager.clearLastAppliedTopologyHash();
		// 调试会话结束后，若存在挂起的断点拓扑更新，平滑自动执行重刷
		if (sceneStateManager.isPendingTopologyUpdate()) {
			sceneStateManager.setPendingTopologyUpdate(false);
			const workspaceRoot = getWorkspaceRoot(false);
			if (workspaceRoot) {
				await handleExternalScenesFileChange(workspaceRoot);
			}
		}
	});

	// 若宿主环境支持实验性 Chat Skill Provider API，执行动态注入
	if (typeof (vscode as any).chat?.registerSkillProvider === "function") {
		const skillProvider = {
			onDidChangeSkills: new vscode.EventEmitter<void>().event,
			provideSkills(): any[] {
				return [
					{
						uri: vscode.Uri.joinPath(
							context.extensionUri,
							"skills",
							"scene-breakpoints",
							"SKILL.md",
						),
					},
				];
			},
		};
		try {
			context.subscriptions.push(
				(vscode as any).chat.registerSkillProvider(skillProvider),
			);
		} catch {
			// 忽略实验性 API 不兼容异常
		}
	}

	context.subscriptions.push(
		debugConfigProvider,
		codeLensProvider,
		bpChangeListener,
		treeView,
		checkboxChangeListener,
		stateChangeListener,
		fileWatcher,
		terminateSessionListener,
		{ dispose: () => sceneStateManager.dispose() },
	);

	return {
		treeDataProvider,
		treeView,
		getStatusBarItem,
	};
}

export function deactivate() {}

