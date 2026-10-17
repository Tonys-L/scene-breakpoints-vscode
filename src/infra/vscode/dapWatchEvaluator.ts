import type * as vscode from "vscode";
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

	const timeoutMs = options?.timeoutMs ?? 300; // 默认 300ms 熔断保护

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

	// 若 actualStr 自带外层双引号（如 "\"abc\""），剥离后与期望比对
	if (actualStr.startsWith('"') && actualStr.endsWith('"') && actualStr.length >= 2) {
		const unquoted = actualStr.slice(1, -1);
		if (unquoted === expStr) return true;
	}

	return actualStr === expStr;
}
