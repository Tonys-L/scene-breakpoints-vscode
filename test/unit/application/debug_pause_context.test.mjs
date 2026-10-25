import assert from "node:assert/strict";
import {
	setLatestWatchResults,
	getLatestWatchResults,
	clearLatestWatchResults,
	setCapturablePauseContext,
	getCapturablePauseContext,
	isInternalOrVirtualFramePath,
	setSourceNavigationLock,
	isSourceNavigationLocked,
	setActivePauseAuthority,
	getActivePauseAuthority,
	clearActivePauseAuthority,
} from "#src/application/debugPauseContext.ts";

export async function runDebugPauseContextTests() {
	console.log("  ▶ [Debug Pause Context] 运行调试暂停上下文与监视缓存匹配单元测试...");

	// 1. 基础单参数写入与读取
	{
		clearLatestWatchResults();
		const results = [
			{ expression: "foo", value: "1", isMatched: true },
		];
		setLatestWatchResults("test.ts:10", results);
		const found = getLatestWatchResults("test.ts:10");
		assert.deepStrictEqual(found, results, "通过直接 key 应当能命中结果");
	}

	// 2. 绝对路径写入，相对路径+行号查询命中 (Windows 反斜杠与大小写容错)
	{
		clearLatestWatchResults();
		const absPath = "D:\\project\\my\\repo\\packages\\agent\\src\\loop.ts";
		const results = [
			{ expression: "status", value: '"REJECTED"', expected: "APPROVED", isMatched: false },
		];
		setLatestWatchResults(absPath, 164, results);

		// 相对路径查找
		const relQuery = "packages/agent/src/loop.ts";
		const foundRel = getLatestWatchResults(relQuery, 164, "D:/project/my/repo");
		assert.deepStrictEqual(foundRel, results, "相对路径应当通过 isFilePathMatch 成功命中");

		// 大小写不同与斜杠差异查找
		const foundCase = getLatestWatchResults("packages\\Agent\\Src\\loop.ts", 164, "d:\\project\\my\\repo");
		assert.deepStrictEqual(foundCase, results, "大小写不同与反斜杠应当能正常容错命中");

		// 异行不命中
		const notFoundLine = getLatestWatchResults(relQuery, 999, "D:/project/my/repo");
		assert.strictEqual(notFoundLine, undefined, "行号不一致应当返回 undefined");
	}

	// 3. 绝对路径以 key 形式写入，以参数形式查询命中
	{
		clearLatestWatchResults();
		const absKey = "C:/Users/workspace/src/app.ts:42";
		const results = [{ expression: "count", value: "10" }];
		setLatestWatchResults(absKey, results);

		const found = getLatestWatchResults("src/app.ts", 42, "C:/Users/workspace");
		assert.deepStrictEqual(found, results, "通过 key 存入的绝对路径，也能被相对路径+行号查出");
	}

	// 4. 清空缓存验证
	{
		clearLatestWatchResults();
		const found = getLatestWatchResults("test.ts", 10);
		assert.strictEqual(found, undefined, "clearLatestWatchResults 后应当无缓存");
	}

	// 5. 虚拟栈帧过滤验证
	{
		assert.strictEqual(isInternalOrVirtualFramePath(undefined), true);
		assert.strictEqual(isInternalOrVirtualFramePath("<node_internals>/internal/modules/cjs/loader.js"), true);
		assert.strictEqual(isInternalOrVirtualFramePath("node:internal/process/task_queues"), true);
		assert.strictEqual(isInternalOrVirtualFramePath("d:/repo/src/index.ts"), false);
	}

	// 6. 导航抑制锁验证
	{
		setSourceNavigationLock(true, 50);
		assert.strictEqual(isSourceNavigationLocked(), true);
		await new Promise((resolve) => setTimeout(resolve, 80));
		assert.strictEqual(isSourceNavigationLocked(), false);
	}

	// 7. 权威暂停主权与可捕获上下文验证
	{
		setCapturablePauseContext({ session: { id: "s1" }, threadId: 3 });
		assert.deepStrictEqual(getCapturablePauseContext(), { session: { id: "s1" }, threadId: 3 });
		setCapturablePauseContext(undefined);
		assert.strictEqual(getCapturablePauseContext(), undefined);

		setActivePauseAuthority({ sessionId: "s1", threadId: 3, filePath: "src/a.ts", line: 12 });
		assert.deepStrictEqual(getActivePauseAuthority(), { sessionId: "s1", threadId: 3, filePath: "src/a.ts", line: 12 });
		clearActivePauseAuthority();
		assert.strictEqual(getActivePauseAuthority(), undefined);
	}

	console.log("  ✅ [Debug Pause Context] 调试暂停上下文单元测试全部通过！");
}

if (process.argv[1]?.endsWith("debug_pause_context.test.mjs")) {
	runDebugPauseContextTests();
}

