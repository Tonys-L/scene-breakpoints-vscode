import assert from "node:assert";
import {
	evaluateBreakpointWatches,
	compareActualWithExpected,
	isAutoContinuableStopReason,
	shouldAutoContinueAfterWatch,
	scheduleSessionContinue,
	trackStackTraceRequest,
	isAcceptedStackTraceResponse,
} from "#src/infra/vscode/dapWatchEvaluator.ts";

export async function runDapWatchEvaluatorTests() {
	console.log("\n  ▶ [DAP Watch Evaluator] 运行变量监视求值器单元测试套件...");

	// 1. 测试 compareActualWithExpected 比较算法
	assert.strictEqual(compareActualWithExpected("true", true), true);
	assert.strictEqual(compareActualWithExpected("false", false), true);
	assert.strictEqual(compareActualWithExpected("false", true), false);
	assert.strictEqual(compareActualWithExpected("100", 100), true);
	assert.strictEqual(compareActualWithExpected("100.5", 100.5), true);
	assert.strictEqual(compareActualWithExpected('"success"', "success"), true);
	assert.strictEqual(compareActualWithExpected("'stop'", "stop"), true, "js-debug 单引号包裹字符串必须与期望值匹配");
	assert.strictEqual(compareActualWithExpected("'你好'", "你好"), true, "中文单引号包裹字符串必须与期望值匹配");
	assert.strictEqual(compareActualWithExpected("`template`", "template"), true);
	assert.strictEqual(compareActualWithExpected("success", "success"), true);
	assert.strictEqual(compareActualWithExpected("null", null), true);
	assert.strictEqual(compareActualWithExpected("undefined", undefined), true);
	assert.strictEqual(compareActualWithExpected('{"a":1}', { a: 1 }), true);
	console.log("    ✔ compareActualWithExpected 基础比对与对象比对全部正确通过");

	// 2. 空 watches 返回空数组
	const mockSession = {
		customRequest: async () => ({ result: "ok" }),
	};
	const emptyRes = await evaluateBreakpointWatches(mockSession, 1, []);
	assert.deepStrictEqual(emptyRes, []);

	// 3. 正常求值与 expected 匹配
	const sessionSuccess = {
		customRequest: async (_cmd, args) => {
			if (args.expression === "user.name") return { result: '"Alice"', type: "string" };
			if (args.expression === "order.amount") return { result: "250", type: "number" };
			if (args.expression === "status") return { result: '"PENDING"', type: "string" };
			return { result: "unknown" };
		},
	};

	const results = await evaluateBreakpointWatches(
		sessionSuccess,
		10,
		["user.name", "order.amount", "status"],
		{
			"user.name": "Alice",
			"order.amount": 200, // 期望 200，实际 250 -> mismatch
			"status": "PENDING",
		},
	);

	assert.strictEqual(results.length, 3);
	assert.strictEqual(results[0].expression, "user.name");
	assert.strictEqual(results[0].value, '"Alice"');
	assert.strictEqual(results[0].isMatched, true);

	assert.strictEqual(results[1].expression, "order.amount");
	assert.strictEqual(results[1].value, "250");
	assert.strictEqual(results[1].isMatched, false); // Mismatch

	assert.strictEqual(results[2].expression, "status");
	assert.strictEqual(results[2].isMatched, true);
	console.log("    ✔ evaluateBreakpointWatches 正常求值与对比验证通过");

	// 4. 超时截断与静默容灾保护 (INV-033)
	const hangingSession = {
		customRequest: async () => new Promise((resolve) => setTimeout(resolve, 500)),
	};

	const timeoutRes = await evaluateBreakpointWatches(
		hangingSession,
		1,
		["hanging.property"],
		undefined,
		{ timeoutMs: 50 },
	);

	assert.strictEqual(timeoutRes.length, 1);
	assert.strictEqual(timeoutRes[0].value, "<error>");
	assert.ok(timeoutRes[0].error?.includes("Timeout"));
	console.log("    ✔ evaluateBreakpointWatches 超时截断熔断保护 (INV-033) 验证通过");

	// 5. DAP 异常报错静默捕获
	const errorSession = {
		customRequest: async () => {
			throw new Error("ReferenceError: foo is not defined");
		},
	};
	const errRes = await evaluateBreakpointWatches(
		errorSession,
		1,
		["foo"],
	);
	assert.strictEqual(errRes.length, 1);
	assert.strictEqual(errRes[0].value, "<error>");
	assert.ok(errRes[0].error?.includes("ReferenceError"));
	console.log("    ✔ evaluateBreakpointWatches DAP 异常优雅捕获降级验证通过");

	// 6. isAutoContinuableStopReason 与 shouldAutoContinueAfterWatch 策略验证
	assert.strictEqual(isAutoContinuableStopReason("breakpoint"), true);
	assert.strictEqual(isAutoContinuableStopReason("function breakpoint"), true);
	assert.strictEqual(isAutoContinuableStopReason(undefined), true);
	assert.strictEqual(isAutoContinuableStopReason("step"), false, "F10/F11 单步绝不可自动放行");
	assert.strictEqual(isAutoContinuableStopReason("pause"), false, "手动暂停绝不可自动放行");
	assert.strictEqual(isAutoContinuableStopReason("exception"), false, "异常中断绝不可自动放行");

	const passResults = [
		{ expression: "a", value: "1", expected: 1, isMatched: true },
		{ expression: "b", value: "2" },
	];
	const mismatchResults = [
		{ expression: "a", value: "1", expected: 2, isMatched: false },
	];
	const errorResults = [
		{ expression: "a", value: "<error>", error: "ReferenceError" },
	];

	assert.strictEqual(shouldAutoContinueAfterWatch("onPass", "breakpoint", passResults), true);
	assert.strictEqual(shouldAutoContinueAfterWatch("onPass", "breakpoint", mismatchResults), false, "onPass 遇 Mismatch 必须定格现场");
	assert.strictEqual(shouldAutoContinueAfterWatch("onPass", "breakpoint", errorResults), false, "onPass 遇求值 Error 必须定格现场");
	assert.strictEqual(shouldAutoContinueAfterWatch("always", "breakpoint", mismatchResults), true, "always 模式无条件自动放行");
	assert.strictEqual(shouldAutoContinueAfterWatch("off", "breakpoint", passResults), false, "off 模式保持暂停");
	assert.strictEqual(shouldAutoContinueAfterWatch("onPass", "step", passResults), false, "单步暂停时绝不自动放行");
	console.log("    ✔ shouldAutoContinueAfterWatch 自动放行与异常定格策略验证通过");

	// 7. trackStackTraceRequest 与 isAcceptedStackTraceResponse 分页请求过滤验证
	const topSeqs = new Set();
	const ignoredSeqs = new Set();
	assert.strictEqual(trackStackTraceRequest({ type: "request", seq: 10, command: "threads" }, true, topSeqs, ignoredSeqs), false);
	// 未暂停时发出的 stackTrace 请求归入 ignoredSeqs
	assert.strictEqual(trackStackTraceRequest({ type: "request", seq: 11, command: "stackTrace", arguments: { startFrame: 0 } }, false, topSeqs, ignoredSeqs), true);
	// 暂停时发出的 startFrame: 1 分页请求归入 ignoredSeqs
	assert.strictEqual(trackStackTraceRequest({ type: "request", seq: 12, command: "stackTrace", arguments: { startFrame: 1 } }, true, topSeqs, ignoredSeqs), true);
	// 暂停时发出的 startFrame: 0 栈顶请求归入 topSeqs
	assert.strictEqual(trackStackTraceRequest({ type: "request", seq: 13, command: "stackTrace", arguments: { startFrame: 0 } }, true, topSeqs, ignoredSeqs), true);

	assert.strictEqual(isAcceptedStackTraceResponse({ type: "response", request_seq: 11, command: "stackTrace" }, true, topSeqs, ignoredSeqs), false, "未暂停时的陈旧请求响应必须被过滤");
	assert.strictEqual(isAcceptedStackTraceResponse({ type: "response", request_seq: 12, command: "stackTrace" }, true, topSeqs, ignoredSeqs), false, "startFrame: 1 分页请求响应必须被过滤");
	assert.strictEqual(isAcceptedStackTraceResponse({ type: "response", request_seq: 13, command: "stackTrace" }, true, topSeqs, ignoredSeqs), true, "startFrame: 0 栈顶请求响应必须放行");
	assert.strictEqual(isAcceptedStackTraceResponse({ type: "response", request_seq: 13, command: "stackTrace" }, true, topSeqs, ignoredSeqs), false, "同一个栈顶请求响应消费一次后不得重复放行");
	assert.strictEqual(isAcceptedStackTraceResponse({ type: "response", command: "stackTrace" }, false, topSeqs, ignoredSeqs), true, "无 request_seq 的测试桩消息兼容放行");
	console.log("    ✔ trackStackTraceRequest & isAcceptedStackTraceResponse 栈顶请求过滤验证通过");

	// 8. scheduleSessionContinue 调度与同代次校验验证
	let resetCount = 0;
	let samePause = true;
	const contCalls = [];
	scheduleSessionContinue(
		{
			customRequest: async (cmd, args) => {
				contCalls.push({ cmd, args });
				return {};
			},
		},
		9,
		() => samePause,
		() => {
			resetCount++;
		},
	);
	await new Promise((r) => setTimeout(r, 50));
	assert.strictEqual(contCalls.length, 1);
	assert.strictEqual(contCalls[0].cmd, "continue");
	assert.strictEqual(contCalls[0].args.threadId, 9);
	assert.strictEqual(resetCount, 1);
	samePause = false; // 后续 180ms 兜底触发时因 isSamePause 为 false 不应再次请求
	await new Promise((r) => setTimeout(r, 160));
	assert.strictEqual(contCalls.length, 1);
	console.log("    ✔ scheduleSessionContinue 异步放行与代次守卫验证通过");

	console.log("  ✅ [DAP Watch Evaluator] 测试套件全部通过！\n");
}
