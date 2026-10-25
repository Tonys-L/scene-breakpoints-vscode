import * as vscode from "vscode";
import type { WatchEvaluationResult } from "#src/domain/types";

export interface DapWatchEvaluatorOptions {
	timeoutMs?: number;
}

/**
 * 变量监视求值器 (DAP Watch Evaluator)
 * 职责：在断点命中且暂停于特定堆栈帧时，安全、只读地求值当前断点配置的 watch 表达式列表，
 * 并与期望值进行对比，严格施加超时截断熔断保护 (INV-033)
 */
export async function evaluateBreakpointWatches(
	session: vscode.DebugSession,
	frameId: number | undefined,
	watches: string[] | undefined,
	expectedMap?: Record<string, any>,
	options?: DapWatchEvaluatorOptions,
): Promise<WatchEvaluationResult[]> {
	if (!watches || watches.length === 0) {
		return [];
	}

	const timeoutMs = options?.timeoutMs ?? 1200; // 默认 1200ms 熔断保护（避免初次命中排队引发假超时）

	const tasks = watches.map(async (expr): Promise<WatchEvaluationResult> => {
		const expected = expectedMap ? expectedMap[expr] : undefined;

		// 声明超时 Promise
		let timer: NodeJS.Timeout;
		const timeoutPromise = new Promise<{ result: string; type?: string }>((_, reject) => {
			timer = setTimeout(() => {
				reject(new Error(`Timeout (${timeoutMs}ms)`));
			}, timeoutMs);
		});

		try {
			// DAP 'evaluate' 请求（context 为 'watch'，表达只读无副作用意图）
			const evalPromise = session.customRequest("evaluate", {
				expression: expr,
				frameId,
				context: "watch",
			}) as Promise<{ result: string; type?: string }>;

			const res = await Promise.race([evalPromise, timeoutPromise]);
			clearTimeout(timer!);

			const actualValue = res.result;
			let isMatched: boolean | undefined = undefined;

			if (expected !== undefined) {
				isMatched = compareActualWithExpected(actualValue, expected);
			}

			return {
				expression: expr,
				value: actualValue,
				type: res.type,
				expected,
				isMatched,
			};
		} catch (err: any) {
			clearTimeout(timer!);
			const errorMsg = err?.message || String(err);
			return {
				expression: expr,
				value: "<error>",
				expected,
				isMatched: expected !== undefined ? false : undefined,
				error: errorMsg,
			};
		}
	});

	return Promise.all(tasks);
}

function stripMatchingOuterQuotes(str: string): string {
	if (str.length < 2) return str;
	const first = str[0];
	const last = str[str.length - 1];
	if (first === last && (first === '"' || first === "'" || first === "`")) {
		return str.slice(1, -1);
	}
	return str;
}

/**
 * 比较求值结果与期望值
 * 支持字符串完全匹配、数字比对与布尔比对
 */
export function compareActualWithExpected(actualStr: string, expected: any): boolean {
	if (expected === null && (actualStr === "null" || actualStr === "None")) {
		return true;
	}
	if (expected === undefined && (actualStr === "undefined" || actualStr === "None")) {
		return true;
	}

	if (typeof expected === "boolean") {
		return actualStr.toLowerCase() === String(expected);
	}

	if (typeof expected === "number") {
		const parsed = Number(actualStr);
		if (!isNaN(parsed)) {
			return parsed === expected;
		}
	}

	const expStr = typeof expected === "object" ? JSON.stringify(expected) : String(expected);
	return actualStr === expStr || stripMatchingOuterQuotes(actualStr) === expStr;
}

/**
 * 判断 DAP stopped 事件原因是否属于可自动放行的断点命中
 * 严格排除 step (F10/F11 单步)、pause (手动暂停)、exception (异常中断) 等用户交互暂停
 */
export function isAutoContinuableStopReason(reason?: string): boolean {
	if (!reason) return true;
	return reason === "breakpoint" || reason === "function breakpoint";
}

/**
 * 根据 autoContinueMode 配置与当前断点 Watch 求值结果决定是否自动继续执行
 * - "onPass": 仅当不存在 mismatch 或求值 error 时自动放行；一旦断言失败立即定格现场
 * - "always": 采集完成后无条件自动放行
 * - "off": 保持暂停
 */
export function shouldAutoContinueAfterWatch(
	mode: string | undefined,
	stopReason: string | undefined,
	results: readonly WatchEvaluationResult[],
): boolean {
	if (!mode || mode === "off") return false;
	if (!isAutoContinuableStopReason(stopReason)) return false;
	if (mode === "always") return true;
	if (mode === "onPass") {
		return !results.some((r) => r.isMatched === false || Boolean(r.error));
	}
	return false;
}

/**
 * 调度调试会话自动继续执行（含同代次 pauseSeq 校验与 180ms 兜底重试）
 */
export function scheduleSessionContinue(
	session: vscode.DebugSession,
	threadId: number,
	isSamePause: () => boolean,
	onReset: () => void,
): void {
	const sendContinue = (useWorkbenchFallback: boolean): void => {
		if (!isSamePause()) return;
		if (useWorkbenchFallback) {
			void Promise.resolve(vscode.commands.executeCommand("workbench.action.debug.continue")).catch(() => {});
		}
		if (typeof session.customRequest === "function") {
			void Promise.resolve(session.customRequest("continue", { threadId }))
				.then(() => {
					if (isSamePause()) onReset();
				})
				.catch(() => {});
		}
	};
	const t1 = setTimeout(() => sendContinue(false), 25);
	const t2 = setTimeout(() => sendContinue(true), 180);
	t1.unref?.();
	t2.unref?.();
}

export interface DapStackRequestMessage {
	type?: string;
	seq?: number;
	request_seq?: number;
	command?: string;
	arguments?: {
		startFrame?: number;
	};
}

/**
 * 追踪发往调试适配器的 stackTrace 请求，区分栈顶请求 (startFrame === 0) 与分页 Caller 请求 (startFrame > 0)
 */
export function trackStackTraceRequest(
	msg: DapStackRequestMessage,
	isPaused: boolean,
	topReqSeqs: Set<number>,
	ignoredReqSeqs: Set<number>,
): boolean {
	if (msg?.type === "request" && msg.command === "stackTrace" && typeof msg.seq === "number") {
		const startFrame = msg.arguments?.startFrame ?? 0;
		if (startFrame > 0 || !isPaused) {
			ignoredReqSeqs.add(msg.seq);
		} else {
			topReqSeqs.add(msg.seq);
		}
		return true;
	}
	return false;
}

/**
 * 校验 stackTrace 响应是否对应当前暂停周期的栈顶请求，过滤分页 Caller 帧与跨暂停周期的陈旧响应
 */
export function isAcceptedStackTraceResponse(
	msg: DapStackRequestMessage,
	hasSeenReqs: boolean,
	topReqSeqs: Set<number>,
	ignoredReqSeqs: Set<number>,
): boolean {
	if (typeof msg.request_seq !== "number") return true;
	if (ignoredReqSeqs.delete(msg.request_seq)) return false;
	if (hasSeenReqs && !topReqSeqs.delete(msg.request_seq)) return false;
	return true;
}
