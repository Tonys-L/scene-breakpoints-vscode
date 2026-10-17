import assert from "node:assert";
import { evaluateBreakpointWatches, compareActualWithExpected } from "#src/infra/vscode/dapWatchEvaluator.ts";

export async function runDapWatchEvaluatorTests() {
	console.log("\n  ▶ [DAP Watch Evaluator] 运行变量监视求值器单元测试套件...");

	// 1. 测试 compareActualWithExpected 比较算法
	assert.strictEqual(compareActualWithExpected("true", true), true);
	assert.strictEqual(compareActualWithExpected("false", false), true);
	assert.strictEqual(compareActualWithExpected("false", true), false);
	assert.strictEqual(compareActualWithExpected("100", 100), true);
	assert.strictEqual(compareActualWithExpected("100.5", 100.5), true);
	assert.strictEqual(compareActualWithExpected('"success"', "success"), true);
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

	console.log("  ✅ [DAP Watch Evaluator] 测试套件全部通过！\n");
}
