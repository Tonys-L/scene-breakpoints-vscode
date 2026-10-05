import assert from "node:assert";
import { ActiveBreakpointIndex, activeBreakpointIndex } from "#src/application/activeBreakpointIndex";
import { appEventBus } from "#src/application/eventBus";
import { sceneStateManager } from "#src/application/sceneStateManager";

export async function runActiveBreakpointIndexTests() {
	console.log("  ▶ [ActiveBreakpointIndex] 运行活动断点内存索引投影单元测试套件...");

	const workspaceRoot = "/workspace/demo-app";

	const mockScenes = {
		"auth-flow": [
			{ type: "line", file: "src/auth/login.ts", line: 10, desc: "校验凭证" },
			{ type: "condition", file: "src/auth/login.ts", line: 20, condition: "user == null" },
			{ type: "function", functionName: "handleAuthError" },
			{ type: "line", file: "/workspace/demo-app/src/auth/token.ts", line: 15, desc: "生成令牌" },
		],
		"order-flow": [
			{ type: "line", file: "src/order/create.ts", line: 30, desc: "创建订单" },
			{ type: "line", file: "src/order/create.ts", line: 0, desc: "无效行号" },
			{ type: "line", file: "", line: 5, desc: "无效文件路径" },
		],
		"inactive-flow": [
			{ type: "line", file: "src/inactive.ts", line: 99 },
		],
	};

	// 1. 同步与索引建立
	{
		const index = new ActiveBreakpointIndex();
		index.sync(workspaceRoot, mockScenes, ["auth-flow", "order-flow"]);

		assert.deepStrictEqual(index.getActiveScenes(), ["auth-flow", "order-flow"]);
		const all = index.getAllIndexedBreakpoints();
		// auth-flow: 3 valid line bps (function skipped); order-flow: 1 valid line bp (line 0 and empty file skipped)
		assert.strictEqual(all.length, 4, "有效断点必须全部被正确索引（过滤函数断点与非法行）");
		assert.strictEqual(all[0].stepIndex, 1);
		assert.strictEqual(all[1].stepIndex, 2);
		assert.strictEqual(all[2].stepIndex, 3);
		assert.strictEqual(all[3].stepIndex, 1);
	}

	// 2. getBreakpointsForDocument 文档断点检索与缓存
	{
		const index = new ActiveBreakpointIndex();
		index.sync(workspaceRoot, mockScenes, ["auth-flow", "order-flow"]);

		// A. 绝对路径命中相对声明
		const docA = index.getBreakpointsForDocument("/workspace/demo-app/src/auth/login.ts");
		assert.strictEqual(docA.length, 2);
		assert.strictEqual(docA[0].breakpoint.line, 10);
		assert.strictEqual(docA[1].breakpoint.line, 20);

		// B. 相对路径命中
		const docB = index.getBreakpointsForDocument("src/auth/login.ts");
		assert.strictEqual(docB.length, 2);

		// C. 绝对声明命中
		const docC = index.getBreakpointsForDocument("/workspace/demo-app/src/auth/token.ts");
		assert.strictEqual(docC.length, 1);
		assert.strictEqual(docC[0].breakpoint.line, 15);

		// D. 未激活场景中的断点不命中
		const docInactive = index.getBreakpointsForDocument("/workspace/demo-app/src/inactive.ts");
		assert.strictEqual(docInactive.length, 0);

		// E. 无关文件不命中
		const docNone = index.getBreakpointsForDocument("/workspace/demo-app/src/other.ts");
		assert.strictEqual(docNone.length, 0);
	}

	// 3. findActiveBreakpoint 与 isHitInActiveScenes
	{
		const index = new ActiveBreakpointIndex();
		index.sync(workspaceRoot, mockScenes, ["auth-flow"]);

		// 精确命中
		const found = index.findActiveBreakpoint("/workspace/demo-app/src/auth/login.ts", 10);
		assert.ok(found);
		assert.strictEqual(found.sceneName, "auth-flow");
		assert.strictEqual(found.stepIndex, 1);
		assert.strictEqual(found.breakpoint.desc, "校验凭证");

		assert.strictEqual(
			index.isHitInActiveScenes("/workspace/demo-app/src/auth/login.ts", 10),
			true,
		);

		// 行号不匹配
		assert.strictEqual(
			index.findActiveBreakpoint("/workspace/demo-app/src/auth/login.ts", 11),
			undefined,
		);
		assert.strictEqual(
			index.isHitInActiveScenes("/workspace/demo-app/src/auth/login.ts", 11),
			false,
		);

		// 文件不匹配
		assert.strictEqual(
			index.findActiveBreakpoint("/workspace/demo-app/src/auth/unknown.ts", 10),
			undefined,
		);
		assert.strictEqual(
			index.isHitInActiveScenes("/workspace/demo-app/src/auth/unknown.ts", 10),
			false,
		);
	}

	// 4. syncFromConfig 与 clear
	{
		const index = new ActiveBreakpointIndex();
		const config = {
			activeScenes: ["order-flow"],
			scenes: mockScenes,
		};
		index.syncFromConfig(workspaceRoot, config);
		assert.deepStrictEqual(index.getActiveScenes(), ["order-flow"]);
		assert.strictEqual(index.getAllIndexedBreakpoints().length, 1);

		index.clear();
		assert.deepStrictEqual(index.getActiveScenes(), []);
		assert.strictEqual(index.getAllIndexedBreakpoints().length, 0);
		assert.strictEqual(
			index.isHitInActiveScenes("/workspace/demo-app/src/order/create.ts", 30),
			false,
		);
		index.dispose();
	}

	// 5. 事件总线自闭环标记失效 (Reactive Event-Driven Invalidation)
	{
		const index = new ActiveBreakpointIndex();
		index.sync(workspaceRoot, mockScenes, ["auth-flow"]);
		assert.strictEqual(index.getNeedsSync(), false);
		assert.strictEqual(index.isUpToDate(workspaceRoot, ["auth-flow"]), true);

		// 广播断点变动事件
		appEventBus.emit("breakpoints:changed", { workspaceRoot });
		assert.strictEqual(index.getNeedsSync(), true, "收到 breakpoints:changed 必须自动标记为脏");
		assert.strictEqual(index.isUpToDate(workspaceRoot, ["auth-flow"]), false, "脏状态下 isUpToDate 必须为 false");

		// 广播场景变动事件
		index.sync(workspaceRoot, mockScenes, ["auth-flow"]);
		assert.strictEqual(index.getNeedsSync(), false);
		appEventBus.emit("scenes:changed", { workspaceRoot });
		assert.strictEqual(index.getNeedsSync(), true, "收到 scenes:changed 必须自动标记为脏");
		index.dispose();
	}

	// 6. activeBreakpointIndex 单例与 sceneStateManager 状态协同
	{
		sceneStateManager.setActiveScenes(["auth-flow"]);
		activeBreakpointIndex.sync(workspaceRoot, mockScenes, ["auth-flow"]);

		const bps = activeBreakpointIndex.getBreakpointsForDocument("/workspace/demo-app/src/auth/login.ts");
		assert.strictEqual(bps.length, 2);
		assert.strictEqual(
			activeBreakpointIndex.isHitInActiveScenes("/workspace/demo-app/src/auth/login.ts", 10),
			true,
		);
		assert.strictEqual(
			activeBreakpointIndex.isHitInActiveScenes("/workspace/demo-app/src/auth/login.ts", 99),
			false,
		);

		// 清空场景时联动清空活动断点索引
		sceneStateManager.setActiveScenes([]);
		assert.strictEqual(
			activeBreakpointIndex.getBreakpointsForDocument("/workspace/demo-app/src/auth/login.ts").length,
			0,
		);
	}

	console.log("  ✅ [ActiveBreakpointIndex] 内存索引投影单元测试全部通过！");
}
