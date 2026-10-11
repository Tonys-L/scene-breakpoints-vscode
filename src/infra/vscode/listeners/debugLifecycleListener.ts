import * as vscode from "vscode";
import { LaunchBindingResolver } from "#src/domain/services/launchBindingResolver";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { activeBreakpointIndex } from "#src/application/activeBreakpointIndex";
import { appEventBus } from "#src/application/eventBus";
import { loadScenesConfig } from "#src/infra/storage/jsonFileSceneRepository";
import {
	setCapturablePauseContext,
	isInternalOrVirtualFramePath,
	isSourceNavigationLocked,
} from "#src/application/debugPauseContext";
import { getWorkspaceRoot } from "#src/infra/vscode/workspaceRoot";
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
				const workspaceRoot = getWorkspaceRoot();
				if (workspaceRoot) {
					const scenesConfig = loadScenesConfig(workspaceRoot);
					const targetScenes = LaunchBindingResolver.resolveScenes(
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
							await vscode.commands.executeCommand("sceneBreakpoints.applyScene", targetScenes);
						}
					}
				}
			}
			return config;
		},
	});
}

interface DapMessagePayload {
	type?: string;
	command?: string;
	event?: string;
	body?: {
		threadId?: number;
		allThreadsContinued?: boolean;
		stackFrames?: Array<{
			line?: number;
			source?: { path?: string };
		}>;
	};
}

/**
 * 调试暂停态捕获上下文 (v1.2.0 Capture Call Stack)
 * 状态实体存于应用层 `debugPauseContext`（ui → application ← infra 依赖方向合规）；
 * 本监听器仅在 stopped/continued/terminated 事件驱动下写入/清除
 */

function createRevealAndClearCallbacks() {
	const revealPausedBreakpoint = async (file: string, line: number): Promise<void> => {
		appEventBus.emit("debug:paused", { file, line });
	};

	const clearPausedBreakpoint = (): void => {
		appEventBus.emit("debug:resumed", undefined);
	};

	return { revealPausedBreakpoint, clearPausedBreakpoint };
}

interface DapStackFrame {
	line?: number;
	source?: { path?: string };
}

/** 模块级状态：当前调试暂停是否已由 DAP 权威栈帧捕获（防止 VS Code 编辑器切入跟随重复上报） */
let isCurrentPauseCapturedByDap = false;

/**
 * 从 DAP stackFrames 中提取首选场景断点栈帧（场景优先 + 真实物理源码兜底）：
 * 1. 过滤所有非源码内部虚拟模块 (<node_internals>, node:*, internal/modules/ 等)；
 * 2. 优先在堆栈中寻找匹配当前激活场景断点的物理帧（精准穿透包装）；
 * 3. 兜底提取调用栈首个真实用户物理源码帧（如 main.ts:1086）；
 * 4. 若整栈全为内部虚拟模块，严格返回 undefined 并静默忽略。
 */
export function selectBestUserSourceFrame(
	frames: readonly DapStackFrame[],
	workspaceRoot?: string,
): DapStackFrame | undefined {
	if (!frames || frames.length === 0) return undefined;

	// 1. 过滤内部虚拟模块
	const userFrames = frames.filter((f) => !isInternalOrVirtualFramePath(f.source?.path));
	if (userFrames.length === 0) {
		return undefined;
	}

	// 2. 优先提取当前激活场景中的断点帧
	if (workspaceRoot) {
		for (const f of userFrames) {
			if (f.source?.path && typeof f.line === "number") {
				if (activeBreakpointIndex.isHitInActiveScenes(f.source.path, f.line, workspaceRoot)) {
					return f;
				}
			}
		}
	}

	// 3. 兜底提取首个物理源码帧
	return userFrames[0];
}

function createDapTrackerFactory(
	revealPausedBreakpoint: (file: string, line: number) => Promise<void>,
	clearPausedBreakpoint: () => void,
): vscode.Disposable {
	return vscode.debug.registerDebugAdapterTrackerFactory("*", {
		createDebugAdapterTracker(session: vscode.DebugSession) {
			let sessionPausedThreadId: number | undefined;
			let hasCapturedThisPause = false;

			return {
				onDidSendMessage(msg: DapMessagePayload) {
					if (
						msg?.type === "response" &&
						msg.command === "stackTrace" &&
						msg.body?.stackFrames &&
						msg.body.stackFrames.length > 0
					) {
						if (hasCapturedThisPause) {
							return;
						}
						if (sessionPausedThreadId !== undefined) {
							const wsRoot = getWorkspaceRoot();
							if (wsRoot && (activeBreakpointIndex.getNeedsSync() || activeBreakpointIndex.getAllIndexedBreakpoints().length === 0)) {
								try {
									const cfg = loadScenesConfig(wsRoot);
									activeBreakpointIndex.syncFromConfig(wsRoot, cfg);
								} catch {
									// ignore
								}
							}
							const targetFrame = selectBestUserSourceFrame(msg.body.stackFrames, wsRoot);
							if (targetFrame?.source?.path && typeof targetFrame.line === "number") {
								hasCapturedThisPause = true;
								isCurrentPauseCapturedByDap = true;
								void revealPausedBreakpoint(targetFrame.source.path, targetFrame.line);
							}
						}
					} else if (msg?.type === "event") {
						if (msg.event === "stopped") {
							hasCapturedThisPause = false;
							isCurrentPauseCapturedByDap = false;
							if (typeof msg.body?.threadId === "number") {
								sessionPausedThreadId = msg.body.threadId;
								// v1.2.0：登记可捕获暂停上下文，供 captureCallStack 命令固化调用栈
								setCapturablePauseContext({ session, threadId: msg.body.threadId });
							}
						} else if (msg.event === "continued") {
							const continuedThreadId = msg.body?.threadId;
							const allContinued = msg.body?.allThreadsContinued === true;
							if (allContinued || (sessionPausedThreadId !== undefined && continuedThreadId === sessionPausedThreadId)) {
								sessionPausedThreadId = undefined;
								hasCapturedThisPause = false;
								isCurrentPauseCapturedByDap = false;
								setCapturablePauseContext(undefined);
								clearPausedBreakpoint();
							}
						} else if (msg.event === "terminated") {
							sessionPausedThreadId = undefined;
							hasCapturedThisPause = false;
							isCurrentPauseCapturedByDap = false;
							setCapturablePauseContext(undefined);
							clearPausedBreakpoint();
						}
					}
				},
			};
		},
	});
}

function createEditorCheckListener(
	revealPausedBreakpoint: (file: string, line: number) => Promise<void>,
): vscode.Disposable[] {
	const checkEditor = (editor?: vscode.TextEditor): void => {
		if (isSourceNavigationLocked()) return;
		if (isCurrentPauseCapturedByDap) return;
		if (!vscode.debug.activeDebugSession || !editor || editor.document.uri.scheme !== "file") return;
		const workspaceRoot = getWorkspaceRoot();
		if (!workspaceRoot) return;

		const activeScenes = sceneStateManager.getActiveScenes();
		if (activeScenes.length === 0) return;

		const currentFile = editor.document.uri.fsPath;
		const currentLine = editor.selection.active.line + 1;

		const isHitInScene = activeBreakpointIndex.isHitInActiveScenes(currentFile, currentLine, workspaceRoot);
		if (isHitInScene) {
			void revealPausedBreakpoint(currentFile, currentLine);
		}
	};

	return [
		vscode.window.onDidChangeActiveTextEditor(checkEditor),
		vscode.window.onDidChangeTextEditorSelection((e) => checkEditor(e.textEditor)),
	];
}

/**
 * 2. 调试运行时单步暂停与断点命中断点协同服务 (Debug Pause Lifecycle)
 * 职责：在调试运行时捕获断点命中与单步暂停事件，通过 appEventBus 广播 debug:paused / debug:resumed 事件
 */
export function registerDebugPauseService(): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];
	const { revealPausedBreakpoint, clearPausedBreakpoint } = createRevealAndClearCallbacks();

	disposables.push(createDapTrackerFactory(revealPausedBreakpoint, clearPausedBreakpoint));
	disposables.push(...createEditorCheckListener(revealPausedBreakpoint));

	const debugExt = vscode.debug as unknown as {
		onDidChangeActiveStackItem?: (cb: (item: { source?: { path?: string }; line?: number }) => Promise<void>) => vscode.Disposable;
	};
	const stackItemListener = debugExt.onDidChangeActiveStackItem?.(async (item) => {
		if (isSourceNavigationLocked() || isCurrentPauseCapturedByDap) return;
		if (item && item.source?.path && typeof item.line === "number") {
			await revealPausedBreakpoint(item.source.path, item.line);
		}
	});
	if (stackItemListener) {
		disposables.push(stackItemListener);
	}

	disposables.push(
		vscode.debug.onDidStartDebugSession(() => {
			appEventBus.emit("debug:started", undefined);
		}),
		vscode.debug.onDidTerminateDebugSession(() => {
			setCapturablePauseContext(undefined);
			clearPausedBreakpoint();
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
		// v1.3.0：会话终止广播（与 debug:resumed 区分），供命中轨迹缓存等会话级消费方清空状态
		appEventBus.emit("debug:terminated", undefined);
		sceneStateManager.clearLastAppliedTopologyHash();
		if (sceneStateManager.isPendingTopologyUpdate()) {
			sceneStateManager.setPendingTopologyUpdate(false);
			const workspaceRoot = getWorkspaceRoot();
			if (workspaceRoot) {
				await handleExternalScenesFileChange(workspaceRoot);
			}
		}
	});
}

/**
 * 调试全生命周期统一注册
 */
export function registerDebugLifecycleServices(): vscode.Disposable {
	return vscode.Disposable.from(
		registerDebugLaunchService(),
		registerDebugPauseService(),
		registerSessionLifecycleService(),
	);
}

export const registerDebugLaunchCoordinator = registerDebugLaunchService;
export const registerDebugPauseCoordinator = registerDebugPauseService;
export const registerSessionLifecycleCoordinator = registerSessionLifecycleService;
