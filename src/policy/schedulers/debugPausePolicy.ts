import * as vscode from "vscode";
import { SceneTreeDataProvider, SceneTreeItem } from "../../infra/vscode/sceneTreeProvider";

/**
 * 调试暂停协同服务 (Debug Pause Service)
 * 职责：专职负责在调试运行时捕获断点命中与单步暂停事件，向树视图下发高亮位置与驱动跟随
 */
export function registerDebugPauseService(
	treeView: vscode.TreeView<SceneTreeItem>,
	treeDataProvider: SceneTreeDataProvider,
): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	// 核心协同方法：将命中断点位置下发给树视图提供者处理
	const revealPausedBreakpoint = async (file: string, line: number): Promise<void> => {
		await treeDataProvider.revealPausedLocation(treeView, file, line);
	};

	// 1. DAP 底层协议跟踪工厂：拦截 stackTrace 响应（最精准、最通用的暂停栈帧提取），并感知 continued/terminated
	const trackerFactory = vscode.debug.registerDebugAdapterTrackerFactory("*", {
		createDebugAdapterTracker() {
			return {
				onDidSendMessage(msg: any) {
					if (
						msg?.type === "response" &&
						msg.command === "stackTrace" &&
						msg.body?.stackFrames &&
						msg.body.stackFrames.length > 0
					) {
						const topFrame = msg.body.stackFrames[0];
						if (topFrame.source?.path && typeof topFrame.line === "number") {
							revealPausedBreakpoint(topFrame.source.path, topFrame.line);
						}
					} else if (msg?.type === "event") {
						if (msg.event === "continued" || msg.event === "terminated") {
							treeDataProvider.clearPausedLocation();
						}
					}
				},
			};
		},
	});
	disposables.push(trackerFactory);

	// 2. 编辑器焦点与光标联动守护：调试暂停时 VS Code 宿主会自动激活命中断点的源码文件与代码行
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

	// 3. 活动堆栈帧变动事件（作为补充感知渠道）
	const stackItemListener = (vscode.debug as any).onDidChangeActiveStackItem?.(async (item: any) => {
		if (item && item.source?.path && typeof item.line === "number") {
			await revealPausedBreakpoint(item.source.path, item.line);
		} else if (!item) {
			treeDataProvider.clearPausedLocation();
		}
	});
	if (stackItemListener) {
		disposables.push(stackItemListener);
	}

	// 4. 调试会话终止时可靠复位树视图暂停指示高亮
	disposables.push(
		vscode.debug.onDidTerminateDebugSession(() => {
			treeDataProvider.clearPausedLocation();
		}),
	);

	return vscode.Disposable.from(...disposables);
}

export const registerDebugPauseCoordinator = registerDebugPauseService;

