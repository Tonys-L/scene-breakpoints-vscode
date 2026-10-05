import assert from "node:assert";
import { mutateCatalog } from "#src/application/mutateCatalog";
import { SerialQueue } from "#src/application/serialQueue";
import { appEventBus } from "#src/application/eventBus";
import { resetDependencies } from "#src/application/dependencies";
import { sceneStateManager } from "#src/application/sceneStateManager";

export async function runMutateCatalogTests() {
	console.log("\n  ▶ [Mutation Pipeline] 运行统一原子写事务管道 (mutateCatalog) 单元测试套件...");

	const createMockRepo = (initialConfig = { scenes: {} }) => {
		let config = JSON.parse(JSON.stringify(initialConfig));
		let saveCalls = 0;
		return {
			loadScenesConfig: (_root) => JSON.parse(JSON.stringify(config)),
			saveScenesConfig: (_root, newConfig) => {
				saveCalls++;
				config = JSON.parse(JSON.stringify(newConfig));
			},
			getConfig: () => config,
			getSaveCalls: () => saveCalls,
		};
	};

	// 1. 测试未配置 sceneRepository 时抛出异常
	{
		const { getDependencies, configureDependencies } = await import("#src/application/dependencies");
		const prevDeps = getDependencies();
		try {
			resetDependencies();
			let errorThrown = false;
			try {
				await mutateCatalog("/mock/workspace", (cat) => cat.hasScene("test"));
			} catch (err) {
				errorThrown = true;
				assert.match(err.message, /sceneRepository must be configured/);
			}
			assert.strictEqual(errorThrown, true, "缺失仓储依赖时必须拦截并抛错");
		} finally {
			configureDependencies(prevDeps);
		}
	}

	// 2. 测试正常执行写事务并保存
	{
		const repo = createMockRepo({ scenes: { sceneA: [] } });
		let sceneEvents = [];
		const sub = appEventBus.on("scenes:changed", (event) => sceneEvents.push(event));

		const result = await mutateCatalog(
			"/mock/workspace",
			(catalog) => {
				catalog.getOrCreateScene("sceneB");
				return true;
			},
			{ sceneRepository: repo, reason: "addScene" },
		);

		sub.dispose();
		assert.strictEqual(result, true);
		assert.strictEqual(repo.getSaveCalls(), 1);
		assert.ok(repo.getConfig().scenes.sceneB, "必须成功写入新场景");
		assert.strictEqual(sceneEvents.length, 1);
		assert.strictEqual(sceneEvents[0].workspaceRoot, "/mock/workspace");
		assert.strictEqual(sceneEvents[0].reason, "addScene");
	}

	// 3. 测试 action 返回 false 时不触发保存与事件广播
	{
		const repo = createMockRepo({ scenes: { sceneA: [] } });
		let sceneEvents = [];
		const sub = appEventBus.on("scenes:changed", (event) => sceneEvents.push(event));

		const result = await mutateCatalog(
			"/mock/workspace",
			(_catalog) => false,
			{ sceneRepository: repo },
		);

		sub.dispose();
		assert.strictEqual(result, false);
		assert.strictEqual(repo.getSaveCalls(), 0, "action 返回 false 时禁止保存");
		assert.strictEqual(sceneEvents.length, 0, "action 返回 false 时禁止广播事件");
	}

	// 4. 测试 notify.sceneName 联动广播 breakpoints:changed 事件
	{
		const repo = createMockRepo({ scenes: { sceneA: [] } });
		let bpEvents = [];
		const sub = appEventBus.on("breakpoints:changed", (event) => bpEvents.push(event));

		await mutateCatalog(
			"/mock/workspace",
			(catalog) => {
				const sc = catalog.getScene("sceneA");
				sc.upsertBreakpoint({ file: "app.ts", line: 42, enabled: true });
				return true;
			},
			{ sceneRepository: repo, notify: { sceneName: "sceneA" } },
		);

		sub.dispose();
		assert.strictEqual(bpEvents.length, 1);
		assert.strictEqual(bpEvents[0].workspaceRoot, "/mock/workspace");
		assert.strictEqual(bpEvents[0].sceneName, "sceneA");
	}

	// 5. 测试 silent: true 静默落盘（不向 scenes:changed 广播）
	{
		const repo = createMockRepo({ scenes: { sceneA: [] } });
		let sceneEvents = [];
		const sub = appEventBus.on("scenes:changed", (event) => sceneEvents.push(event));

		const result = await mutateCatalog(
			"/mock/workspace",
			(catalog) => {
				catalog.clearActive();
				return true;
			},
			{ sceneRepository: repo, silent: true },
		);

		sub.dispose();
		assert.strictEqual(result, true);
		assert.strictEqual(repo.getSaveCalls(), 1, "silent 模式依然正常写盘");
		assert.strictEqual(sceneEvents.length, 0, "silent: true 必须抑制 scenes:changed 广播");
	}

	// 6. 测试自定义队列与串行互斥保护
	{
		const repo = createMockRepo({ scenes: { counter: [] } });
		const customQueue = new SerialQueue();
		const order = [];

		await Promise.all([
			mutateCatalog(
				"/mock/workspace",
				async () => {
					await new Promise((r) => setTimeout(r, 20));
					order.push(1);
					return true;
				},
				{ sceneRepository: repo, queue: customQueue },
			),
			mutateCatalog(
				"/mock/workspace",
				async () => {
					order.push(2);
					return true;
				},
				{ sceneRepository: repo, queue: customQueue },
			),
		]);

		assert.deepStrictEqual(order, [1, 2], "自定义队列必须保障串行执行顺序");
	}

	// 7. 测试向后兼容历史位置参数 (legacyNotify, legacyQueue)
	{
		const repo = createMockRepo({ scenes: { sceneA: [] } });
		let bpEvents = [];
		const sub = appEventBus.on("breakpoints:changed", (event) => bpEvents.push(event));
		const legacyQueue = new SerialQueue();

		const result = await mutateCatalog(
			"/mock/workspace",
			(_catalog) => true,
			{ sceneRepository: repo },
			{ sceneName: "legacyScene" },
			legacyQueue,
		);

		sub.dispose();
		assert.strictEqual(result, true);
		assert.strictEqual(bpEvents.length, 1);
		assert.strictEqual(bpEvents[0].sceneName, "legacyScene");
	}

	// 8. 测试活跃场景断点变异时自动联动 DAP 桥接器同步并更新状态机
	{
		const repo = createMockRepo({
			scenes: {
				activeScene: [
					{ file: "src/main.ts", line: 10, enabled: true },
					{ file: "src/main.ts", line: 20, enabled: true },
				],
			},
			activeScenes: ["activeScene"],
		});

		sceneStateManager.setActiveScenes(["activeScene"], 2);
		sceneStateManager.setLastAppliedTopologyHash("initial-hash");

		let bridgeCalls = [];
		const mockBridge = {
			applySceneBreakpoints: async (root, label, bps) => {
				bridgeCalls.push({ root, label, bps });
				return { loadedCount: bps.length, healedCount: 0 };
			},
			clearAllBreakpoints: async () => {},
		};

		// 从 activeScene 中移除第 1 个断点
		const result = await mutateCatalog(
			"/mock/workspace",
			(catalog) => {
				const sc = catalog.getScene("activeScene");
				return sc.removeBreakpoint(0);
			},
			{ sceneRepository: repo, breakpointBridge: mockBridge },
		);

		assert.strictEqual(result, true);
		assert.strictEqual(bridgeCalls.length, 1, "必须自动联动 breakpointBridge.applySceneBreakpoints");
		assert.strictEqual(bridgeCalls[0].label, "activeScene");
		assert.strictEqual(bridgeCalls[0].bps.length, 1, "残余断点必须只剩 1 个");
		assert.strictEqual(bridgeCalls[0].bps[0].line, 20);
		assert.strictEqual(sceneStateManager.getBaselineBreakpointCount(), 1, "状态机激活断点数必须同步更新");

		// 复位全局状态机
		sceneStateManager.setActiveScenes([]);
		sceneStateManager.clearLastAppliedTopologyHash();
	}

	console.log("    ✔ mutateCatalog 统一原子写事务管道测试全量通过！");
}
