import assert from "node:assert";
// 业务逻辑全部走真实源码，仅通过端口注入 Mock 隔离外部依赖
import {
	activateScene,
	addBreakpoint,
	clearAll,
	exportScene,
	handleExternalChange,
} from "../../../src/application/sceneService.ts";
import { sceneStateManager } from "../../../src/domain/sceneStateManager.ts";

/**
 * 端口 Mock：内存版 ISceneRepository
 */
class MockSceneRepository {
	constructor(initialConfig = { scenes: {} }) {
		this.config = JSON.parse(JSON.stringify(initialConfig));
		this.saveCount = 0;
	}

	loadScenesConfig(_workspaceRoot) {
		return JSON.parse(JSON.stringify(this.config));
	}

	saveScenesConfig(_workspaceRoot, newConfig) {
		this.config = JSON.parse(JSON.stringify(newConfig));
		this.saveCount++;
	}
}

/**
 * 端口 Mock：内存版 IBreakpointBridge
 */
class MockBreakpointBridge {
	constructor() {
		this.appliedScenes = [];
		this.appliedBreakpoints = [];
		this.singleApplied = [];
		this.cleared = false;
		this.currentBreakpoints = [];
	}

	async applySceneBreakpoints(_workspaceRoot, sceneName, breakpoints) {
		this.appliedScenes.push(sceneName);
		this.appliedBreakpoints = [...breakpoints];
		return {
			loadedCount: breakpoints.length,
			healedCount: 0,
			healedBreakpoints: [],
			unmatchedBreakpoints: [],
		};
	}

	async applySingleBreakpointToEditor(_workspaceRoot, breakpoint) {
		this.singleApplied.push(breakpoint);
	}

	async clearAllBreakpoints() {
		this.cleared = true;
		this.appliedBreakpoints = [];
	}

	async collectCurrentBreakpoints(_workspaceRoot) {
		return [...this.currentBreakpoints];
	}
}

/**
 * 重置真实单例 sceneStateManager 的可测状态，避免测试块间相互污染
 */
function resetStateManager() {
	sceneStateManager.setActiveScene(undefined);
	sceneStateManager.setLastAppliedTopologyHash("");
	sceneStateManager.setPendingTopologyUpdate(false);
	sceneStateManager.setApplyingState(false);
}

export async function runSceneServiceTests() {
	console.log("  ▶ [Application] 运行场景应用服务 (sceneService·真实源码) 核心流程与串行互斥测试套件...");

	const workspaceRoot = "/mock/workspace";

	// ----------------------------------------------------
	// 1. 测试 activate 与 SSOT 落盘时序 (INV-009, INV-010)
	// ----------------------------------------------------
	{
		resetStateManager();
		const repo = new MockSceneRepository({
			scenes: {
				auth: [{ file: "auth.ts", line: 10, type: "line" }],
				order: [{ file: "order.ts", line: 20, type: "line" }],
			},
		});
		const bridge = new MockBreakpointBridge();
		const loopGuard = { marked: false, markInternalSaving: () => { loopGuard.marked = true; } };

		// 幽灵场景过滤 (INV-009)
		const ghostResult = await activateScene({
			workspaceRoot,
			targetScenes: ["non-existent"],
			sceneRepository: repo,
			breakpointBridge: bridge,
			loopGuard,
		});
		assert.strictEqual(ghostResult.success, false, "幽灵场景激活必须失败");
		assert.deepStrictEqual(ghostResult.missingScenes, ["non-existent"]);
		assert.strictEqual(repo.saveCount, 0, "幽灵场景激活严禁写盘");

		// 合法激活与 SSOT 落盘
		const validResult = await activateScene({
			workspaceRoot,
			targetScenes: ["auth"],
			sceneRepository: repo,
			breakpointBridge: bridge,
			loopGuard,
		});
		assert.strictEqual(validResult.success, true, "合法场景激活成功");
		assert.strictEqual(validResult.loadedCount, 1);
		assert.strictEqual(repo.config.activeScenes[0], "auth", "必须已持久化写入 activeScenes 权威 SSOT");
		assert.strictEqual(sceneStateManager.getActiveScene(), "auth", "状态机内存投影必须同步更新");
		assert.strictEqual(loopGuard.marked, true, "必须标记 internalSaving 防回环");

		// 大小写容错校准：目标场景名自动校准为字典中声明的原始名称 (INV-009)
		const caseResult = await activateScene({
			workspaceRoot,
			targetScenes: ["AUTH"],
			sceneRepository: repo,
			breakpointBridge: bridge,
			loopGuard,
		});
		assert.strictEqual(caseResult.success, true, "大小写容错匹配必须激活成功");
		assert.deepStrictEqual(caseResult.validTargetScenes, ["auth"], "必须校准为 scenes 字典声明的原始场景名");

		// 幂等激活：activeScenes 未变时不得重复写盘 (INV-010)
		const saveCountBefore = repo.saveCount;
		await activateScene({
			workspaceRoot,
			targetScenes: ["auth"],
			sceneRepository: repo,
			breakpointBridge: bridge,
			loopGuard,
		});
		assert.strictEqual(repo.saveCount, saveCountBefore, "重复激活相同场景时 activeScenes 未变，严禁冗余写盘");
	}

	// ----------------------------------------------------
	// 2. 测试 addBreakpoint、即刻点亮与唯一性查重覆盖 (INV-001)
	// ----------------------------------------------------
	{
		resetStateManager();
		sceneStateManager.setActiveScenes(["auth"], 1);
		const repo = new MockSceneRepository({
			scenes: {
				auth: [{ file: "auth.ts", line: 10, type: "line" }],
			},
		});
		const bridge = new MockBreakpointBridge();

		const addResult = await addBreakpoint({
			workspaceRoot,
			targetScene: "auth",
			breakpoint: { file: "auth.ts", line: 15, type: "line" },
			sceneRepository: repo,
			breakpointBridge: bridge,
		});

		assert.strictEqual(addResult.success, true);
		assert.strictEqual(addResult.isImmediatelyApplied, true, "激活场景添加断点必须即刻点亮");
		assert.strictEqual(bridge.singleApplied.length, 1);
		assert.strictEqual(repo.config.scenes.auth.length, 2, "断点必须持久化保存至磁盘配置");

		// 同文件同行重复添加必须原地覆盖，不得产生重复项 (INV-001)
		const overwriteResult = await addBreakpoint({
			workspaceRoot,
			targetScene: "auth",
			breakpoint: { file: "auth.ts", line: 15, type: "line", condition: "orderId > 100" },
			sceneRepository: repo,
			breakpointBridge: bridge,
		});
		assert.strictEqual(overwriteResult.success, true);
		assert.strictEqual(repo.config.scenes.auth.length, 2, "同文件同行断点必须查重覆盖而非追加");
		assert.strictEqual(repo.config.scenes.auth[1].condition, "orderId > 100", "覆盖后必须保留最新断点定义");
	}

	// ----------------------------------------------------
	// 3. 测试 clearAll
	// ----------------------------------------------------
	{
		resetStateManager();
		sceneStateManager.setActiveScenes(["auth"]);
		const repo = new MockSceneRepository({
			scenes: { auth: [] },
			activeScenes: ["auth"],
		});
		const bridge = new MockBreakpointBridge();

		await clearAll({
			workspaceRoot,
			sceneRepository: repo,
			breakpointBridge: bridge,
		});

		assert.deepStrictEqual(repo.config.activeScenes, [], "磁盘 activeScenes 必须清空");
		assert.strictEqual(bridge.cleared, true, "宿主断点必须清空");
		assert.strictEqual(sceneStateManager.getActiveScene(), undefined, "状态机必须复位为空");
	}

	// ----------------------------------------------------
	// 4. 测试 exportScene (覆盖模式与追加去重模式)
	// ----------------------------------------------------
	{
		resetStateManager();

		// 覆盖模式
		const overwriteRepo = new MockSceneRepository({ scenes: {} });
		const bridge = new MockBreakpointBridge();
		bridge.currentBreakpoints = [
			{ file: "main.ts", line: 5, type: "line" },
			{ file: "main.ts", line: 8, type: "line" },
		];

		const exportResult = await exportScene({
			workspaceRoot,
			targetScene: "new-scene",
			mode: "overwrite",
			sceneRepository: overwriteRepo,
			breakpointBridge: bridge,
		});

		assert.strictEqual(exportResult.success, true);
		assert.strictEqual(exportResult.count, 2);
		assert.strictEqual(overwriteRepo.config.scenes["new-scene"].length, 2);

		// 追加模式：与既有断点重复的项必须查重合并 (INV-001)
		const appendRepo = new MockSceneRepository({
			scenes: { existing: [{ file: "main.ts", line: 5, type: "line" }] },
		});
		const appendResult = await exportScene({
			workspaceRoot,
			targetScene: "existing",
			mode: "append",
			sceneRepository: appendRepo,
			breakpointBridge: bridge,
		});

		assert.strictEqual(appendResult.success, true);
		assert.strictEqual(appendResult.count, 2);
		assert.strictEqual(appendRepo.config.scenes.existing.length, 2, "追加导出时同文件同行断点必须去重合并");
	}

	// ----------------------------------------------------
	// 5. 测试 handleExternalChange (授权调度与未授权拦截)
	// ----------------------------------------------------
	{
		resetStateManager();
		const repo = new MockSceneRepository({
			scenes: {
				feature: [{ file: "f.ts", line: 1, type: "line" }],
			},
			activeScenes: ["feature"],
		});
		const bridge = new MockBreakpointBridge();

		const changeResult = await handleExternalChange({
			workspaceRoot,
			allowAiActivation: true,
			isDebuggingActive: false,
			sceneRepository: repo,
			breakpointBridge: bridge,
		});

		assert.strictEqual(changeResult.action, "applied");
		assert.deepStrictEqual(changeResult.targetScenes, ["feature"]);
		assert.strictEqual(sceneStateManager.getActiveScene(), "feature", "外部激活调度后内存投影必须同步");

		// 未开启授权时严禁自动调度
		resetStateManager();
		const deniedResult = await handleExternalChange({
			workspaceRoot,
			allowAiActivation: false,
			isDebuggingActive: false,
			sceneRepository: repo,
			breakpointBridge: bridge,
		});
		assert.strictEqual(deniedResult.action, "noop", "allowAiActivation 未授权时必须拒绝外部自动调度");
		assert.strictEqual(bridge.appliedScenes.length, 1, "未授权调度严禁触发断点装配");
	}

	// ----------------------------------------------------
	// 6. 测试 SerialQueue 单写者私有串行队列互斥防交错
	// ----------------------------------------------------
	{
		resetStateManager();
		const repo = new MockSceneRepository({
			scenes: { s1: [], s2: [] },
		});
		const executionOrder = [];

		const p1 = activateScene({
			workspaceRoot,
			targetScenes: ["s1"],
			sceneRepository: repo,
			breakpointBridge: {
				applySceneBreakpoints: async () => {
					await new Promise((r) => setTimeout(r, 30));
					executionOrder.push("s1-finished");
					return { loadedCount: 0, healedCount: 0, healedBreakpoints: [] };
				},
			},
		});

		const p2 = activateScene({
			workspaceRoot,
			targetScenes: ["s2"],
			sceneRepository: repo,
			breakpointBridge: {
				applySceneBreakpoints: async () => {
					executionOrder.push("s2-finished");
					return { loadedCount: 0, healedCount: 0, healedBreakpoints: [] };
				},
			},
		});

		await Promise.all([p1, p2]);
		assert.deepStrictEqual(
			executionOrder,
			["s1-finished", "s2-finished"],
			"单写者私有队列必须保障业务编排严格串行依次完成，杜绝交错竞态",
		);
	}

	console.log("  ✅ [Application] 场景应用服务与串行排队测试套件（6 大核心维度·真实源码）全部通过！");
}
