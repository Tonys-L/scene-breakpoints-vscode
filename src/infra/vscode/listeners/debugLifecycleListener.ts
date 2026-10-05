import * as vscode from "vscode";
import { LaunchBindingResolver } from "#src/domain/services/launchBindingResolver";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { activeBreakpointIndex } from "#src/application/activeBreakpointIndex";
import { appEventBus } from "#src/application/eventBus";
import { loadScenesConfig } from "#src/infra/storage/jsonFileSceneRepository";
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

function createRevealAndClearCallbacks() {
	const revealPausedBreakpoint = async (file: string, line: number): Promise<void> => {
		appEventBus.emit("debug:paused", { file, line });
	};

	const clearPausedBreakpoint = (): void => {
		appEventBus.emit("debug:resumed", undefined);
	};

	return { revealPausedBreakpoint, clearPausedBreakpoint };
}

function createDapTrackerFactory(
	revealPausedBreakpoint: (file: string, line: number) => Promise<void>,
	clearPausedBreakpoint: () => void,
): vscode.Disposable {
	return vscode.debug.registerDebugAdapterTrackerFactory("*", {
		createDebugAdapterTracker(_session: vscode.DebugSession) {
			let sessionPausedThreadId: number | undefined;

			return {
				onDidSendMessage(msg: DapMessagePayload) {
					if (
						msg?.type === "response" &&
						msg.command === "stackTrace" &&
						msg.body?.stackFrames &&
						msg.body.stackFrames.length > 0
					) {
						if (sessionPausedThreadId !== undefined) {
							const topFrame = msg.body.stackFrames[0];
							if (topFrame.source?.path && typeof topFrame.line === "number") {
								void revealPausedBreakpoint(topFrame.source.path, topFrame.line);
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
							if (allContinued || (sessionPausedThreadId !== undefined && continuedThreadId === sessionPausedThreadId)) {
								sessionPausedThreadId = undefined;
								clearPausedBreakpoint();
							}
						} else if (msg.event === "terminated") {
							sessionPausedThreadId = undefined;
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
		if (item && item.source?.path && typeof item.line === "number") {
			await revealPausedBreakpoint(item.source.path, item.line);
		}
	});
	if (stackItemListener) {
		disposables.push(stackItemListener);
	}

	disposables.push(
		vscode.debug.onDidTerminateDebugSession(() => {
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
