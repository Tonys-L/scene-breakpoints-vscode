import * as vscode from "vscode";
import { LaunchBindingResolver } from "#src/domain/services/launchBindingResolver";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { activeBreakpointIndex } from "#src/application/activeBreakpointIndex";
import { appEventBus } from "#src/application/eventBus";
import { loadScenesConfig } from "#src/infra/storage/jsonFileSceneRepository";
import {
	setCapturablePauseContext,
	getCapturablePauseContext,
	isInternalOrVirtualFramePath,
	isSourceNavigationLocked,
	setLatestWatchResults,
	getLatestWatchResults,
	clearLatestWatchResults,
	setActivePauseAuthority,
	getActivePauseAuthority,
	clearActivePauseAuthority,
} from "#src/application/debugPauseContext";
import {
	evaluateBreakpointWatches,
	isAcceptedStackTraceResponse,
	scheduleSessionContinue,
	shouldAutoContinueAfterWatch,
	trackStackTraceRequest,
} from "#src/infra/vscode/dapWatchEvaluator";
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
	seq?: number;
	request_seq?: number;
	command?: string;
	event?: string;
	arguments?: {
		startFrame?: number;
	};
	body?: {
		reason?: string;
		threadId?: number;
		allThreadsContinued?: boolean;
		stackFrames?: Array<{
			id?: number;
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

interface DapStackFrame {
	id?: number;
	line?: number;
	source?: { path?: string };
}

/** 模块级状态：当前调试暂停是否已由 DAP 权威栈帧捕获（防止 VS Code 编辑器切入跟随重复上报） */
let isCurrentPauseCapturedByDap = false;

/**
 * 从 DAP stackFrames 中提取首选场景断点栈帧（栈顶唯一物理准绳）：
 * 1. 过滤所有非源码内部虚拟模块 (<node_internals>, node:*, internal/modules/ 等)；
 * 2. 严格以过滤后的首个真实物理用户源码帧 (Top-most User Frame, 即 userFrames[0]) 作为物理暂停点；
 * 3. 坚决杜绝在整条调用栈中向下搜索 Caller 场景断点，物理阻断断点倒挂回弹；
 * 4. 若整栈全为内部虚拟模块，严格返回 undefined 并静默忽略。
 */
export function selectBestUserSourceFrame(
	frames: readonly DapStackFrame[],
	_workspaceRoot?: string,
): DapStackFrame | undefined {
	if (!frames || frames.length === 0) return undefined;

	const userFrames = frames.filter((f) => !isInternalOrVirtualFramePath(f.source?.path));
	if (userFrames.length === 0) {
		return undefined;
	}

	return userFrames[0];
}

function handleWatchEvaluationOnFrameHit(
	session: vscode.DebugSession,
	targetFrame: DapStackFrame,
	wsRoot: string,
	stopReason?: string,
	onAutoContinue?: () => void,
): void {
	const getMode = () => vscode.workspace.getConfiguration("sceneBreakpoints").get<string>("autoContinueMode", "onPass");
	const matchedBp = activeBreakpointIndex.findActiveBreakpoint(targetFrame.source!.path!, targetFrame.line!, wsRoot);
	if (!matchedBp) {
		if (onAutoContinue && getMode() === "always" && shouldAutoContinueAfterWatch("always", stopReason, [])) {
			onAutoContinue();
		}
		return;
	}
	if (!matchedBp.breakpoint?.watch || matchedBp.breakpoint.watch.length === 0) {
		if (onAutoContinue && shouldAutoContinueAfterWatch(getMode(), stopReason, [])) {
			onAutoContinue();
		}
		return;
	}
	const frameId = typeof targetFrame.id === "number" ? targetFrame.id : undefined;
	const bpPath = targetFrame.source!.path!;
	const bpLine = targetFrame.line!;

	void evaluateBreakpointWatches(
		session,
		frameId,
		matchedBp.breakpoint.watch,
		matchedBp.breakpoint.expected,
	).then((results) => {
		const key = `${bpPath}:${bpLine}`;
		setLatestWatchResults(key, results);
		appEventBus.emit("debug:watch-evaluated", {
			file: bpPath,
			line: bpLine,
			results,
		});
		if (onAutoContinue && shouldAutoContinueAfterWatch(getMode(), stopReason, results)) {
			onAutoContinue();
		}
	}).catch(() => {
		// 静默容灾 (INV-033)
	});
}

function ensureIndexSyncedIfNeeded(wsRoot: string | undefined): void {
	if (wsRoot && (activeBreakpointIndex.getNeedsSync() || activeBreakpointIndex.getAllIndexedBreakpoints().length === 0)) {
		try {
			activeBreakpointIndex.syncFromConfig(wsRoot, loadScenesConfig(wsRoot));
		} catch {
			// ignore
		}
	}
}

function createDapTrackerFactory(
	revealPausedBreakpoint: (file: string, line: number) => Promise<void>,
	clearPausedBreakpoint: () => void,
): vscode.Disposable {
	return vscode.debug.registerDebugAdapterTrackerFactory("*", {
		createDebugAdapterTracker(session: vscode.DebugSession) {
			let sessionPausedThreadId: number | undefined;
			let sessionStopReason: string | undefined;
			let hasCapturedThisPause = false;
			let hasSeenStackReqs = false;
			let pauseSeq = 0;
			const topReqSeqs = new Set<number>();
			const ignoredReqSeqs = new Set<number>();
			const sessionId = (session as { id?: string })?.id || "default";

			const resetPauseState = (): void => {
				pauseSeq++;
				topReqSeqs.clear();
				sessionPausedThreadId = undefined;
				sessionStopReason = undefined;
				hasCapturedThisPause = false;
				isCurrentPauseCapturedByDap = false;
				setCapturablePauseContext(undefined);
				clearActivePauseAuthority();
				clearLatestWatchResults();
				clearPausedBreakpoint();
			};

			return {
				onWillReceiveMessage(msg: DapMessagePayload) {
					if (trackStackTraceRequest(msg, sessionPausedThreadId !== undefined, topReqSeqs, ignoredReqSeqs)) {
						hasSeenStackReqs = true;
					}
				},
				onDidSendMessage(msg: DapMessagePayload) {
					if (msg?.type === "response" && msg.command === "stackTrace" && msg.body?.stackFrames?.length) {
						if (!isAcceptedStackTraceResponse(msg, hasSeenStackReqs, topReqSeqs, ignoredReqSeqs)) return;
						const currentAuth = getActivePauseAuthority();
						if ((currentAuth && currentAuth.sessionId !== sessionId) || hasCapturedThisPause || sessionPausedThreadId === undefined) return;

						const wsRoot = getWorkspaceRoot();
						ensureIndexSyncedIfNeeded(wsRoot);
						const targetFrame = selectBestUserSourceFrame(msg.body.stackFrames, wsRoot);
						if (targetFrame?.source?.path && typeof targetFrame.line === "number") {
							const [capturedThreadId, capturedReason, capturedSeq] = [sessionPausedThreadId, sessionStopReason, pauseSeq];
							hasCapturedThisPause = true;
							isCurrentPauseCapturedByDap = true;
							setActivePauseAuthority({ sessionId, threadId: capturedThreadId, filePath: targetFrame.source.path, line: targetFrame.line });
							void revealPausedBreakpoint(targetFrame.source.path, targetFrame.line);
							if (wsRoot) {
								const isSame = () => pauseSeq === capturedSeq && sessionPausedThreadId === capturedThreadId;
								handleWatchEvaluationOnFrameHit(session, targetFrame, wsRoot, capturedReason, () => {
									scheduleSessionContinue(session, capturedThreadId, isSame, resetPauseState);
								});
							}
						}
					} else if (msg?.type === "event") {
						if (msg.event === "stopped") {
							pauseSeq++;
							topReqSeqs.clear();
							hasCapturedThisPause = false;
							isCurrentPauseCapturedByDap = false;
							sessionStopReason = msg.body?.reason;
							if (typeof msg.body?.threadId === "number") {
								sessionPausedThreadId = msg.body.threadId;
								setCapturablePauseContext({ session, threadId: msg.body.threadId });
								setActivePauseAuthority({ sessionId, threadId: msg.body.threadId });
							}
						} else if (msg.event === "continued" || msg.event === "terminated") {
							const currentAuth = getActivePauseAuthority();
							const contId = msg.body?.threadId;
							const isMatch = (!currentAuth || currentAuth.sessionId === sessionId) &&
								(msg.event === "terminated" || msg.body?.allThreadsContinued === true || contId === undefined || contId === sessionPausedThreadId);
							if (isMatch) resetPauseState();
						}
					}
				},
			};
		},
	});
}

function tryEvaluateMissingWatchResults(
	currentFile: string,
	currentLine: number,
	workspaceRoot: string,
): void {
	const pauseCtx = getCapturablePauseContext();
	if (!pauseCtx || getLatestWatchResults(currentFile, currentLine, workspaceRoot)) return;

	const frame: DapStackFrame = {
		id: undefined,
		line: currentLine,
		source: { path: currentFile },
	};
	handleWatchEvaluationOnFrameHit(pauseCtx.session as unknown as vscode.DebugSession, frame, workspaceRoot);
}

function createEditorCheckListener(
	revealPausedBreakpoint: (file: string, line: number) => Promise<void>,
): vscode.Disposable[] {
	const checkEditor = (editor?: vscode.TextEditor): void => {
		if (isSourceNavigationLocked()) return;
		if (isCurrentPauseCapturedByDap || getActivePauseAuthority()) return;
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
			tryEvaluateMissingWatchResults(currentFile, currentLine, workspaceRoot);
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

	disposables.push(
		vscode.debug.onDidStartDebugSession(() => {
			appEventBus.emit("debug:started", undefined);
		}),
		vscode.debug.onDidTerminateDebugSession(() => {
			setCapturablePauseContext(undefined);
			clearActivePauseAuthority();
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
