import type { WatchEvaluationResult } from "#src/domain/types";
import { isFilePathMatch } from "#src/shared/utils/pathUtils";

/**
 * 调试暂停态捕获上下文 (v1.2.0 Capture Call Stack)
 * 会话在断点命中/单步暂停期间登记活动会话与暂停线程，供调用栈固化命令查询；
 * 继续执行或会话终止即刻清除，杜绝在运行态误取陈旧堆栈。
 * 归属应用层：infra 监听器写入、UI 命令读取，保持依赖方向合规（ui → application ← infra）。
 */

/** DAP 会话最小契约：仅需通过 customRequest 读取堆栈，避免应用层依赖宿主类型 */
export interface CapturablePauseContext {
	session: { id?: string; customRequest: (command: string, args: unknown) => PromiseLike<unknown> };
	threadId: number;
}

let capturablePause: CapturablePauseContext | undefined;

export function setCapturablePauseContext(context: CapturablePauseContext | undefined): void {
	capturablePause = context;
}

export function getCapturablePauseContext(): CapturablePauseContext | undefined {
	return capturablePause;
}

/**
 * 权威暂停会话主权实体 (Active Pause Authority)
 * 记录当前正处于断点暂停态的权威会话与线程信息，防止多会话/Worker 堆栈冲刷栈顶断点
 */
export interface ActivePauseAuthority {
	sessionId: string;
	threadId: number;
	filePath?: string;
	line?: number;
}

let activePauseAuthority: ActivePauseAuthority | undefined;

export function setActivePauseAuthority(authority: ActivePauseAuthority | undefined): void {
	activePauseAuthority = authority;
}

export function getActivePauseAuthority(): ActivePauseAuthority | undefined {
	return activePauseAuthority;
}

export function clearActivePauseAuthority(): void {
	activePauseAuthority = undefined;
}

/** 判断是否为内部虚拟帧（如 Node.js internal 或虚拟模块） */
export function isInternalOrVirtualFramePath(filePath?: string): boolean {
	if (!filePath) return true;
	const norm = filePath.replace(/\\/g, "/");
	if (norm.includes("<node_internals>") || norm.startsWith("node:") || norm.includes("/internal/modules/")) {
		return true;
	}
	return false;
}

let isNavigatingSourceLocked = false;
let navigationLockTimer: NodeJS.Timeout | undefined;

/**
 * 设置主动源码导航抑制锁：
 * 避免用户在画布或 TraceView 中主动点击跳转定位时，因触发编辑器选区变更 (selection change)
 * 被误判为“运行时命中断点”，彻底杜绝自激回流风暴与红框闪烁。
 */
export function setSourceNavigationLock(active: boolean, autoReleaseMs = 350): void {
	if (navigationLockTimer) {
		clearTimeout(navigationLockTimer);
		navigationLockTimer = undefined;
	}
	isNavigatingSourceLocked = active;
	if (active && autoReleaseMs > 0) {
		navigationLockTimer = setTimeout(() => {
			isNavigatingSourceLocked = false;
			navigationLockTimer = undefined;
		}, autoReleaseMs);
		navigationLockTimer.unref?.();
	}
}

export function isSourceNavigationLocked(): boolean {
	return isNavigatingSourceLocked;
}

interface CachedWatchEntry {
	filePath: string;
	line: number;
	results: WatchEvaluationResult[];
}

/** 断点最近一次命中求值结果缓存（以 `${file}:${line}` 或 `function:${functionName}` 为键） */
const latestWatchResultsMap = new Map<string, WatchEvaluationResult[]>();
const latestWatchEntries: CachedWatchEntry[] = [];

export function setLatestWatchResults(
	keyOrFilePath: string,
	lineOrResults: number | WatchEvaluationResult[],
	maybeResults?: WatchEvaluationResult[],
): void {
	if (typeof lineOrResults === "number" && Array.isArray(maybeResults)) {
		const filePath = keyOrFilePath;
		const line = lineOrResults;
		const results = maybeResults;
		latestWatchResultsMap.set(`${filePath}:${line}`, results);
		const existingIdx = latestWatchEntries.findIndex(
			(e) => e.line === line && isFilePathMatch(e.filePath, filePath),
		);
		if (existingIdx >= 0) {
			latestWatchEntries[existingIdx] = { filePath, line, results };
		} else {
			latestWatchEntries.push({ filePath, line, results });
		}
	} else if (Array.isArray(lineOrResults)) {
		const key = keyOrFilePath;
		const results = lineOrResults;
		latestWatchResultsMap.set(key, results);
		const colonIdx = key.lastIndexOf(":");
		if (colonIdx > 0) {
			const filePath = key.substring(0, colonIdx);
			const line = parseInt(key.substring(colonIdx + 1), 10);
			if (!Number.isNaN(line)) {
				const existingIdx = latestWatchEntries.findIndex(
					(e) => e.line === line && isFilePathMatch(e.filePath, filePath),
				);
				if (existingIdx >= 0) {
					latestWatchEntries[existingIdx] = { filePath, line, results };
				} else {
					latestWatchEntries.push({ filePath, line, results });
				}
			}
		}
	}
}

export function getLatestWatchResults(
	keyOrFilePath: string,
	line?: number,
	workspaceRoot?: string,
): WatchEvaluationResult[] | undefined {
	if (typeof line === "number") {
		const found = latestWatchEntries.find(
			(e) => e.line === line && isFilePathMatch(e.filePath, keyOrFilePath, workspaceRoot),
		);
		if (found) return found.results;
		return latestWatchResultsMap.get(`${keyOrFilePath}:${line}`);
	}
	const direct = latestWatchResultsMap.get(keyOrFilePath);
	if (direct) return direct;
	const colonIdx = keyOrFilePath.lastIndexOf(":");
	if (colonIdx > 0) {
		const filePath = keyOrFilePath.substring(0, colonIdx);
		const parsedLine = parseInt(keyOrFilePath.substring(colonIdx + 1), 10);
		if (!Number.isNaN(parsedLine)) {
			const found = latestWatchEntries.find(
				(e) => e.line === parsedLine && isFilePathMatch(e.filePath, filePath, workspaceRoot),
			);
			if (found) return found.results;
		}
	}
	return undefined;
}

export function clearLatestWatchResults(): void {
	latestWatchResultsMap.clear();
	latestWatchEntries.length = 0;
}



