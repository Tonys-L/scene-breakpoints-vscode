import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
	activeBreakpointIndex,
	appEventBus,
	debugTraceBuffer,
	sceneStateManager,
	type TraceRecord,
} from "#src/application";
import type { WatchEvaluationResult } from "#src/domain/types";
import { getWorkspaceRoot } from "#src/infra/vscode/workspaceRoot";

export interface PersistedTraceWatchItem {
	expression: string;
	value: string;
	expected?: unknown;
	status: "matched" | "mismatch" | "observed" | "error";
	error?: string;
}

export interface PersistedTraceStep {
	seq: number;
	scene?: string;
	stepIndex?: number;
	file: string;
	line: number;
	desc?: string;
	ts: number;
	watches: PersistedTraceWatchItem[];
}

export interface PersistedDebugTraceSnapshot {
	status: "running" | "paused" | "terminated";
	updatedAt: string;
	activeScenes: string[];
	hasMismatchOrError: boolean;
	currentPause: { file: string; line: number } | null;
	steps: PersistedTraceStep[];
}

export function getDebugTraceFilePath(workspaceRoot: string): string {
	return path.join(workspaceRoot, ".vscode", "debug-trace.local.json");
}

export function resolveWatchStatus(w: WatchEvaluationResult): "matched" | "mismatch" | "observed" | "error" {
	if (w.error) return "error";
	if (w.isMatched === true) return "matched";
	if (w.isMatched === false) return "mismatch";
	return "observed";
}

export function mapWatchToPersistedItem(w: WatchEvaluationResult): PersistedTraceWatchItem {
	const item: PersistedTraceWatchItem = {
		expression: w.expression,
		value: w.value,
		status: resolveWatchStatus(w),
	};
	if (w.expected !== undefined) item.expected = w.expected;
	if (w.error) item.error = w.error;
	return item;
}

export function buildPersistedTraceStep(rec: TraceRecord, workspaceRoot: string): PersistedTraceStep {
	const activeBp = activeBreakpointIndex.findActiveBreakpoint(rec.file, rec.line, workspaceRoot);
	const watches = (rec.watches ?? []).map(mapWatchToPersistedItem);
	const step: PersistedTraceStep = {
		seq: rec.seq,
		file: activeBp?.breakpoint.file || rec.file,
		line: rec.line,
		ts: rec.ts,
		watches,
	};
	if (activeBp) {
		step.scene = activeBp.sceneName;
		step.stepIndex = activeBp.stepIndex;
		if (activeBp.breakpoint.desc) {
			step.desc = activeBp.breakpoint.desc;
		}
	}
	return step;
}

export function writeDebugTraceSnapshotToDisk(
	workspaceRoot: string,
	status: "running" | "paused" | "terminated",
	currentPause: { file: string; line: number } | null,
): PersistedDebugTraceSnapshot | undefined {
	try {
		const steps = debugTraceBuffer.getRecords().map((r) => buildPersistedTraceStep(r, workspaceRoot));
		const hasMismatchOrError = steps.some((s) =>
			s.watches.some((w) => w.status === "mismatch" || w.status === "error"),
		);
		const snapshot: PersistedDebugTraceSnapshot = {
			status,
			updatedAt: new Date().toISOString(),
			activeScenes: sceneStateManager.getActiveScenes(),
			hasMismatchOrError,
			currentPause,
			steps,
		};
		const tracePath = getDebugTraceFilePath(workspaceRoot);
		fs.mkdirSync(path.dirname(tracePath), { recursive: true });
		fs.writeFileSync(tracePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
		return snapshot;
	} catch {
		return undefined;
	}
}

/**
 * 调试运行时命中轨迹与 Watch 求值结果自动落盘服务
 * 职责：将 debugTraceBuffer 中的实时轨迹与 Watch 断言结果同步写入 `.vscode/debug-trace.local.json`，
 * 供 AI Agent 自动监听读取并实现零提示词闭环诊断。
 */
export function registerDebugTracePersistenceService(): vscode.Disposable {
	debugTraceBuffer.init();
	let currentStatus: "running" | "paused" | "terminated" = "running";
	let currentPause: { file: string; line: number } | null = null;

	const flush = (): void => {
		const wsRoot = getWorkspaceRoot();
		if (!wsRoot) return;
		writeDebugTraceSnapshotToDisk(wsRoot, currentStatus, currentPause);
	};

	const disposables = [
		appEventBus.on("debug:started", () => {
			currentStatus = "running";
			currentPause = null;
			flush();
		}),
		appEventBus.on("debug:paused", ({ file, line }) => {
			currentStatus = "paused";
			currentPause = { file, line };
			flush();
		}),
		appEventBus.on("debug:watch-evaluated", () => {
			flush();
		}),
		appEventBus.on("debug:resumed", () => {
			currentStatus = "running";
			currentPause = null;
			flush();
		}),
		appEventBus.on("debug:terminated", () => {
			currentStatus = "terminated";
			currentPause = null;
			flush();
		}),
	];

	return new vscode.Disposable(() => {
		for (const d of disposables) {
			d.dispose();
		}
	});
}
