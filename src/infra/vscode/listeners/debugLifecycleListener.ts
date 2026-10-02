import * as path from "node:path";
import * as vscode from "vscode";
import { LaunchBindingResolver } from "#src/infra/vscode/launchBindingResolver";
import { sceneStateManager } from "#src/application/sceneStateManager";
import type { SourceSceneBreakpoint } from "#src/domain/types";
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
				const workspaceRoot = getWorkspaceRoot(false);
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

export type PausedLocationHandler = (file: string, line: number) => Promise<void> | void;

function createRevealAndClearCallbacks(param1?: any, param2?: any) {
	const revealPausedBreakpoint = async (file: string, line: number): Promise<void> => {
		if (typeof param1 === "function") {
			await param1(file, line);
		} else if (param1 && typeof param1.onPausedLocation === "function") {
			await param1.onPausedLocation(file, line);
		} else if (param2 && typeof param2.revealPausedLocation === "function") {
			await param2.revealPausedLocation(param1, file, line);
		} else if (param1 && typeof param1.revealPausedLocation === "function") {
			await param1.revealPausedLocation(param2, file, line);
		}
	};

	const clearPausedBreakpoint = (): void => {
		if (param2 && typeof param2.clearPausedLocation === "function") {
			param2.clearPausedLocation();
		} else if (param1 && typeof param1.clearPausedLocation === "function") {
			param1.clearPausedLocation();
		}
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
				onDidSendMessage(msg: any) {
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
 * 职责：在调试运行时捕获断点命中与单步暂停事件，向观察者下发高亮位置与驱动跟随
 */
export function registerDebugPauseService(
	param1?: any,
	param2?: any,
): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];
	const { revealPausedBreakpoint, clearPausedBreakpoint } = createRevealAndClearCallbacks(param1, param2);

	disposables.push(createDapTrackerFactory(revealPausedBreakpoint, clearPausedBreakpoint));
	disposables.push(...createEditorCheckListener(revealPausedBreakpoint));

	const stackItemListener = (vscode.debug as any).onDidChangeActiveStackItem?.(async (item: any) => {
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
	treeView?: any,
	treeDataProvider?: any,
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
