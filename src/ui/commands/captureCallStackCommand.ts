import * as path from "node:path";
import * as vscode from "vscode";
import { sceneManager } from "#src/application";
import { getDependencies } from "#src/application/dependencies";
import { extractContextSnippet } from "#src/domain/services/healingEngine";
import type { SceneItem, SourceSceneBreakpoint } from "#src/domain/types";
import { promptSceneName } from "#src/ui/utils/promptHelpers";
import { getCapturablePauseContext } from "#src/application/debugPauseContext";
import { getWorkspaceRoot } from "#src/ui/utils/commandRunner";

/**
 * 事故现场逆向固化：调用栈一键生成场景 (v1.2.0 Capture Call Stack, roadmap §4)
 * 职责：调试暂停时从 DAP 拉取当前线程堆栈帧，逆向固化为带三行上下文指纹的场景断点，
 * 经既有 importScene 串行管道落盘（新增场景缺省落 local 私有层，INV-032），零新增写盘路径
 */

/** 单次捕获的最大堆栈帧数（防止超深调用栈产生海量断点） */
const CAPTURE_MAX_FRAMES = 20;

interface StackFrameLike {
	name?: string;
	line?: number;
	source?: { path?: string };
}

/**
 * 判定文件是否位于工作区内部（外部依赖/系统文件不参与固化）
 */
function isInsideWorkspace(absolutePath: string, workspaceRoot: string): boolean {
	const rel = path.relative(workspaceRoot, absolutePath);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function captureCallStackCommand(): Promise<void> {
	const pause = getCapturablePauseContext();
	if (!pause) {
		void vscode.window.showInformationMessage(
			vscode.l10n.t("Capture Call Stack is only available while the debugger is paused."),
		);
		return;
	}

	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		void vscode.window.showWarningMessage(vscode.l10n.t("No workspace folder is open."));
		return;
	}

	let frames: StackFrameLike[] = [];
	try {
		const response = (await pause.session.customRequest("stackTrace", {
			threadId: pause.threadId,
			startFrame: 0,
			levels: CAPTURE_MAX_FRAMES,
		})) as { stackFrames?: StackFrameLike[] } | undefined;
		frames = Array.isArray(response?.stackFrames) ? response.stackFrames : [];
	} catch (e: any) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t("Failed to read call stack from debug session: {0}", e?.message || String(e)),
		);
		return;
	}

	// 逐帧固化：工作区内有效源码帧 -> 相对路径 + 三行上下文指纹；同 file+line 去重 (INV-001 前置)
	const { lineReader } = getDependencies();
	const seen = new Set<string>();
	const items: SceneItem[] = [];
	for (const frame of frames) {
		const absPath = frame.source?.path;
		const line = frame.line;
		if (!absPath || typeof line !== "number" || line < 1) continue;
		if (!isInsideWorkspace(absPath, workspaceRoot)) continue;

		const relativeFile = path.relative(workspaceRoot, absPath).replace(/\\/g, "/");
		const dedupeKey = `${relativeFile}:${line}`;
		if (seen.has(dedupeKey)) continue;

		const lines = await lineReader?.readLines(absPath);
		if (!lines || line - 1 >= lines.length) continue;
		seen.add(dedupeKey);

		items.push({
			type: "line",
			file: relativeFile,
			line,
			desc: frame.name?.trim() || undefined,
			contextSnippet: extractContextSnippet(lines, line - 1),
		} as SourceSceneBreakpoint);
	}

	if (items.length === 0) {
		void vscode.window.showWarningMessage(
			vscode.l10n.t("No capturable source frames found in the current call stack."),
		);
		return;
	}

	const sceneName = await promptSceneName({
		prompt: vscode.l10n.t("Enter scene name to save the captured call stack (e.g. order-crash-repro)"),
	});
	if (!sceneName) return;

	await sceneManager.importScene(workspaceRoot, sceneName, items, "append");

	void vscode.window.showInformationMessage(
		vscode.l10n.t("Captured {0} call stack frame(s) into scene [{1}].", items.length, sceneName),
	);
}
