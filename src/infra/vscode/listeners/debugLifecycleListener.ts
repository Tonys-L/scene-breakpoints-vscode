import * as path from "node:path";
import * as vscode from "vscode";
import { resolveLaunchBoundScenes } from "../../../domain/launchResolver";
import { sceneStateManager } from "../../../domain/sceneStateManager";
import type { SourceSceneBreakpoint } from "../../../domain/types";
import { getWorkspaceRoot, loadScenesConfig } from "../../storage/jsonFileSceneRepository";
import { applySceneCommand } from "../commands/sceneCommands";
import { SceneTreeDataProvider, type SceneTreeItem } from "../sceneTreeProvider";
import { handleExternalScenesFileChange } from "./configFileWatcherListener";

/**
 * 1. 调试启动联动监听服务 (Debug Launch Lifecycle)
 * 职责：在调试配置启动前，依据三级优先级推导关联场景，并在满足非重复条件时幂等激活目标场景
 */
export function registerDebugLaunchService(): vscode.Disposable {
	return vscode.debug.registerDebugConfigurationProvider("*", {
		async resolveDebugConfiguration(
			_folder: vscode.WorkspaceFolder | undefined,
			config: vscode.DebugConfiguration,
		) {
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
						// 幂等守卫 (Idempotency Guard)：若当前激活的场景与目标一致，跳过重复切换
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
}

/**
 * 2. 调试运行时单步暂停与断点命中断点协同服务 (Debug Pause Lifecycle)
 * 职责：在调试运行时捕获断点命中与单步暂停事件，向树视图下发高亮位置与驱动跟随
 */
export function registerDebugPauseService(
	treeView: vscode.TreeView<SceneTreeItem>,
	treeDataProvider: SceneTreeDataProvider,
): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	const revealPausedBreakpoint = async (file: string, line: number): Promise<void> => {
		await treeDataProvider.revealPausedLocation(treeView, file, line);
	};

	// DAP 底层协议跟踪：拦截 stackTrace 响应感知命中断点，严格隔离多 Session / 多线程干扰
	const trackerFactory = vscode.debug.registerDebugAdapterTrackerFactory("*", {
		createDebugAdapterTracker(_session: vscode.DebugSession) {
			// 每个调试会话独立持有暂停线程状态，隔离多进程与多会话
			let sessionPausedThreadId: number | undefined;

			return {
				onDidSendMessage(msg: any) {
					if (
						msg?.type === "response" &&
						msg.command === "stackTrace" &&
						msg.body?.stackFrames &&
						msg.body.stackFrames.length > 0
					) {
						// 仅当本会话明确处于 stopped 暂停状态时才处理堆栈，
						// 严密阻断运行中（RUNNING）的后台 Worker 线程的 stackTrace 响应冲刷主线程断点高亮！
						if (sessionPausedThreadId !== undefined) {
							const topFrame = msg.body.stackFrames[0];
							if (topFrame.source?.path && typeof topFrame.line === "number") {
								revealPausedBreakpoint(topFrame.source.path, topFrame.line);
							}
						}
					} else if (msg?.type === "event") {
						if (msg.event === "stopped") {
							if (typeof msg.body?.threadId === "number") {
								sessionPausedThreadId = msg.body.threadId;
							}
						} else if (msg.event === "continued") {
							const continuedThreadId = msg.body?.threadId;
							const allContinued = msg.body?.allThreadsContinued === true;
							// 仅当所有线程继续，或者本会话命中断点的具体线程继续时，才清除高亮；
							// 严格防止 WorkerThread 等后台工作线程的 continued 事件误杀主线程断点高亮
							if (allContinued || (sessionPausedThreadId !== undefined && continuedThreadId === sessionPausedThreadId)) {
								sessionPausedThreadId = undefined;
								treeDataProvider.clearPausedLocation();
							}
						} else if (msg.event === "terminated") {
							sessionPausedThreadId = undefined;
							treeDataProvider.clearPausedLocation();
						}
					}
				},
			};
		},
	});
	disposables.push(trackerFactory);

	// 编辑器焦点与光标联动守护
	const checkEditorPausedBreakpoint = (editor?: vscode.TextEditor): void => {
		if (!vscode.debug.activeDebugSession || !editor || editor.document.uri.scheme !== "file") {
			return;
		}
		const workspaceRoot = getWorkspaceRoot(false);
		if (!workspaceRoot) return;

		const activeScenes = sceneStateManager.getActiveScenes();
		if (activeScenes.length === 0) return;

		const config = loadScenesConfig(workspaceRoot);
		const currentFile = editor.document.uri.fsPath;
		const currentLine = editor.selection.active.line + 1;

		const isHitInScene = activeScenes.some((scene) => {
			const list = config.scenes[scene] || [];
			return list.some((bp) => {
				if (bp.type === "function") return false;
				const src = bp as SourceSceneBreakpoint;
				if (Number(src.line) !== currentLine) return false;
				const full = path.isAbsolute(src.file) ? src.file : path.join(workspaceRoot, src.file);
				const n1 = currentFile.replace(/\\/g, "/").toLowerCase();
				const n2 = full.replace(/\\/g, "/").toLowerCase();
				const n3 = src.file.replace(/\\/g, "/").toLowerCase();
				return n1 === n2 || n1.endsWith("/" + n3) || n1.endsWith(n3);
			});
		});

		if (isHitInScene) {
			revealPausedBreakpoint(currentFile, currentLine);
		}
	};

	disposables.push(
		vscode.window.onDidChangeActiveTextEditor((e) => checkEditorPausedBreakpoint(e)),
		vscode.window.onDidChangeTextEditorSelection((e) => checkEditorPausedBreakpoint(e.textEditor)),
	);

	// 活动堆栈项监听：仅在明确捕获到新的有效源码行堆栈时更新，禁止在焦点切换临时派发 !item 时误清空断点高亮
	const stackItemListener = (vscode.debug as any).onDidChangeActiveStackItem?.(async (item: any) => {
		if (item && item.source?.path && typeof item.line === "number") {
			await revealPausedBreakpoint(item.source.path, item.line);
		}
	});
	if (stackItemListener) {
		disposables.push(stackItemListener);
	}

	// 调试会话终止时可靠复位高亮
	disposables.push(
		vscode.debug.onDidTerminateDebugSession(() => {
			treeDataProvider.clearPausedLocation();
		}),
	);

	return vscode.Disposable.from(...disposables);
}

/**
 * 3. 调试会话终止与后置拓扑补发服务 (Session Lifecycle)
 * 职责：监听调试会话终止事件，失效清空核心拓扑快照，并在存在挂起的外部拓扑更新时平滑自动补发装配重刷
 */
export function registerSessionLifecycleService(): vscode.Disposable {
	return vscode.debug.onDidTerminateDebugSession(async () => {
		sceneStateManager.clearLastAppliedTopologyHash();
		if (sceneStateManager.isPendingTopologyUpdate()) {
			sceneStateManager.setPendingTopologyUpdate(false);
			const workspaceRoot = getWorkspaceRoot(false);
			if (workspaceRoot) {
				await handleExternalScenesFileChange(workspaceRoot);
			}
		}
	});
}

/**
 * 调试全生命周期统一注册
 */
export function registerDebugLifecycleServices(
	treeView: vscode.TreeView<SceneTreeItem>,
	treeDataProvider: SceneTreeDataProvider,
): vscode.Disposable {
	return vscode.Disposable.from(
		registerDebugLaunchService(),
		registerDebugPauseService(treeView, treeDataProvider),
		registerSessionLifecycleService(),
	);
}

export const registerDebugLaunchCoordinator = registerDebugLaunchService;
export const registerDebugPauseCoordinator = registerDebugPauseService;
export const registerSessionLifecycleCoordinator = registerSessionLifecycleService;
