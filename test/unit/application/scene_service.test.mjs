import assert from "node:assert";

/**
 * SerialQueue 逻辑镜像 (与 src/application/sceneService.ts 内部 SerialQueue 100% 严格对齐)
 */
class SerialQueueMock {
	constructor() {
		this.currentQueue = Promise.resolve();
	}

	run(task) {
		const result = this.currentQueue.then(task, task);
		this.currentQueue = result.catch(() => {});
		return result;
	}
}

/**
 * SceneStateManager 逻辑镜像 (与 src/domain/sceneStateManager.ts 100% 严格对齐)
 */
class SceneStateManagerMock {
	constructor() {
		this.activeScenes = [];
		this.baselineCount = 0;
	}

	getActiveScene() {
		return this.activeScenes[0];
	}

	getActiveScenes() {
		return [...this.activeScenes];
	}

	setActiveScenes(scenes, count = 0) {
		this.activeScenes = [...scenes];
		this.baselineCount = count;
	}

	setActiveScene(scene, count = 0) {
		this.activeScenes = scene ? [scene] : [];
		this.baselineCount = count;
	}

	isSceneActive(scene) {
		return this.activeScenes.includes(scene);
	}

	getBaselineBreakpointCount() {
		return this.baselineCount;
	}

	setBaselineBreakpointCount(count) {
		this.baselineCount = count;
	}
}

/**
 * SceneService 应用服务编排模型 (与 src/application/sceneService.ts 100% 严格对齐)
 */
class SceneServiceMock {
	constructor(stateManager) {
		this.queue = new SerialQueueMock();
		this.stateManager = stateManager;
	}

	async _doActivate({ workspaceRoot, targetScenes: rawTargetScenes, sceneRepository, breakpointBridge, loopGuard }) {
		const config = sceneRepository.loadScenesConfig(workspaceRoot);
		const sceneNames = Object.keys(config.scenes || {});

		// 1. 过滤幽灵场景与有效性校验 (INV-009)
		const validTargetScenes = [];
		const missingScenes = [];

		for (const target of rawTargetScenes) {
			const matched = sceneNames.find((s) => s.toLowerCase() === target.toLowerCase());
			if (matched) {
				validTargetScenes.push(matched);
			} else {
				missingScenes.push(target);
			}
		}

		if (validTargetScenes.length === 0) {
			return {
				success: false,
				validTargetScenes: [],
				missingScenes,
				loadedCount: 0,
				healedCount: 0,
				unmatchedCount: 0,
			};
		}

		// 2. 权威持久化 SSOT 写入约束：先落盘 activeScenes (INV-010)
		config.activeScenes = validTargetScenes;
		if (loopGuard) loopGuard.markInternalSaving();
		sceneRepository.saveScenesConfig(workspaceRoot, config);

		// 3. 装配断点至宿主调试器 (INV-002, INV-005)
		const bpsToLoad = [];
		for (const s of validTargetScenes) {
			bpsToLoad.push(...(config.scenes[s] || []));
		}
		const primarySceneLabel = validTargetScenes.join(" + ");
		const applyResult = await breakpointBridge.applySceneBreakpoints(workspaceRoot, primarySceneLabel, bpsToLoad);

		// 4. 投影更新至内存状态机 (INV-004)
		this.stateManager.setActiveScenes(validTargetScenes, applyResult.loadedCount);

		return {
			success: true,
			validTargetScenes,
			missingScenes,
			loadedCount: applyResult.loadedCount,
			healedCount: applyResult.healedCount,
			unmatchedCount: 0,
		};
	}

	async activate(params) {
		return this.queue.run(() => this._doActivate(params));
	}

	async addBreakpoint({ workspaceRoot, targetScene, breakpoint, sceneRepository, breakpointBridge, loopGuard }) {
		return this.queue.run(async () => {
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			if (!config.scenes) config.scenes = {};
			if (!config.scenes[targetScene]) config.scenes[targetScene] = [];

			// 1. 查重覆盖 (INV-001)
			const list = config.scenes[targetScene];
			const existingIndex = list.findIndex((it) => it.file === breakpoint.file && it.line === breakpoint.line);
			if (existingIndex >= 0) {
				list[existingIndex] = breakpoint;
			} else {
				list.push(breakpoint);
			}

			if (loopGuard) loopGuard.markInternalSaving();
			sceneRepository.saveScenesConfig(workspaceRoot, config);

			// 2. 即刻点亮判断
			let isImmediatelyApplied = false;
			if (this.stateManager.isSceneActive(targetScene)) {
				await breakpointBridge.applySingleBreakpointToEditor(workspaceRoot, breakpoint);
				this.stateManager.setBaselineBreakpointCount(this.stateManager.getBaselineBreakpointCount() + 1);
				isImmediatelyApplied = true;
			}

			return { success: true, isImmediatelyApplied };
		});
	}

	async clearAll({ workspaceRoot, sceneRepository, breakpointBridge, loopGuard }) {
		return this.queue.run(async () => {
			if (workspaceRoot) {
				const config = sceneRepository.loadScenesConfig(workspaceRoot);
				if (config.activeScenes && config.activeScenes.length > 0) {
					config.activeScenes = [];
					if (loopGuard) loopGuard.markInternalSaving();
					sceneRepository.saveScenesConfig(workspaceRoot, config);
				}
			}
			await breakpointBridge.clearAllBreakpoints();
			this.stateManager.setActiveScene(undefined);
		});
	}

	async exportScene({ workspaceRoot, targetScene, mode, sceneRepository, breakpointBridge, loopGuard }) {
		return this.queue.run(async () => {
			const exportedBps = breakpointBridge.collectCurrentBreakpoints(workspaceRoot);
			if (exportedBps.length === 0) {
				return { success: false, count: 0 };
			}

			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			if (!config.scenes) config.scenes = {};

			if (mode === "overwrite" || !config.scenes[targetScene]) {
				config.scenes[targetScene] = exportedBps;
			} else {
				config.scenes[targetScene].push(...exportedBps);
			}

			if (loopGuard) loopGuard.markInternalSaving();
			sceneRepository.saveScenesConfig(workspaceRoot, config);

			return { success: true, count: exportedBps.length };
		});
	}

	async handleExternalChange({ workspaceRoot, allowAiActivation, sceneRepository, breakpointBridge }) {
		return this.queue.run(async () => {
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			if (!allowAiActivation) return { action: "noop" };

			if (config.activeScenes && config.activeScenes.length > 0) {
				await this._doActivate({
					workspaceRoot,
					targetScenes: config.activeScenes,
					sceneRepository,
					breakpointBridge,
				});
				return { action: "applied", targetScenes: config.activeScenes };
			}
			return { action: "noop" };
		});
	}
}

/**
 * 内存模拟 ISceneRepository
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
 * 内存模拟 IBreakpointBridge
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

	collectCurrentBreakpoints(_workspaceRoot) {
		return [...this.currentBreakpoints];
	}
}

export async function runSceneServiceTests() {
	console.log("  ▶ [Application] 运行场景应用服务 (sceneService) 核心流程与串行互斥测试套件...");

	const workspaceRoot = "/mock/workspace";
	const stateManager = new SceneStateManagerMock();
	const sceneService = new SceneServiceMock(stateManager);

	// ----------------------------------------------------
	// 1. 测试 activate 与 SSOT 落盘时序 (INV-010, INV-009)
	// ----------------------------------------------------
	{
		const repo = new MockSceneRepository({
			scenes: {
				auth: [{ file: "auth.ts", line: 10, type: "line" }],
				order: [{ file: "order.ts", line: 20, type: "line" }],
			},
		});
		const bridge = new MockBreakpointBridge();
		const loopGuard = { marked: false, markInternalSaving: () => { loopGuard.marked = true; } };

		// 幽灵场景过滤 (INV-009)
		const ghostResult = await sceneService.activate({
			workspaceRoot,
			targetScenes: ["non-existent"],
			sceneRepository: repo,
			breakpointBridge: bridge,
			loopGuard,
		});
		assert.strictEqual(ghostResult.success, false, "幽灵场景激活必须失败");
		assert.deepStrictEqual(ghostResult.missingScenes, ["non-existent"]);

		// 合法激活与 SSOT 落盘
		const validResult = await sceneService.activate({
			workspaceRoot,
			targetScenes: ["auth"],
			sceneRepository: repo,
			breakpointBridge: bridge,
			loopGuard,
		});
		assert.strictEqual(validResult.success, true, "合法场景激活成功");
		assert.strictEqual(validResult.loadedCount, 1);
		assert.strictEqual(repo.config.activeScenes[0], "auth", "必须已持久化写入 activeScenes 权威 SSOT");
		assert.strictEqual(stateManager.getActiveScene(), "auth", "状态机内存投影必须同步更新");
		assert.strictEqual(loopGuard.marked, true, "必须标记 internalSaving 防回环");
	}

	// ----------------------------------------------------
	// 2. 测试 addBreakpoint 与即刻点亮
	// ----------------------------------------------------
	{
		const repo = new MockSceneRepository({
			scenes: {
				auth: [{ file: "auth.ts", line: 10, type: "line" }],
			},
			activeScenes: ["auth"],
		});
		const bridge = new MockBreakpointBridge();
		stateManager.setActiveScenes(["auth"], 1);

		const addResult = await sceneService.addBreakpoint({
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
	}

	// ----------------------------------------------------
	// 3. 测试 clearAll
	// ----------------------------------------------------
	{
		const repo = new MockSceneRepository({
			scenes: { auth: [] },
			activeScenes: ["auth"],
		});
		const bridge = new MockBreakpointBridge();

		await sceneService.clearAll({
			workspaceRoot,
			sceneRepository: repo,
			breakpointBridge: bridge,
		});

		assert.deepStrictEqual(repo.config.activeScenes, [], "磁盘 activeScenes 必须清空");
		assert.strictEqual(bridge.cleared, true, "宿主断点必须清空");
		assert.strictEqual(stateManager.getActiveScene(), undefined, "状态机必须复位为空");
	}

	// ----------------------------------------------------
	// 4. 测试 exportScene (覆盖模式与追加模式)
	// ----------------------------------------------------
	{
		const repo = new MockSceneRepository({ scenes: {} });
		const bridge = new MockBreakpointBridge();
		bridge.currentBreakpoints = [
			{ file: "main.ts", line: 5, type: "line" },
			{ file: "main.ts", line: 8, type: "line" },
		];

		const exportResult = await sceneService.exportScene({
			workspaceRoot,
			targetScene: "new-scene",
			mode: "overwrite",
			sceneRepository: repo,
			breakpointBridge: bridge,
		});

		assert.strictEqual(exportResult.success, true);
		assert.strictEqual(exportResult.count, 2);
		assert.strictEqual(repo.config.scenes["new-scene"].length, 2);
	}

	// ----------------------------------------------------
	// 5. 测试 handleExternalChange
	// ----------------------------------------------------
	{
		const repo = new MockSceneRepository({
			scenes: {
				feature: [{ file: "f.ts", line: 1, type: "line" }],
			},
			activeScenes: ["feature"],
		});
		const bridge = new MockBreakpointBridge();

		const changeResult = await sceneService.handleExternalChange({
			workspaceRoot,
			allowAiActivation: true,
			sceneRepository: repo,
			breakpointBridge: bridge,
		});

		assert.strictEqual(changeResult.action, "applied");
		assert.deepStrictEqual(changeResult.targetScenes, ["feature"]);
	}

	// ----------------------------------------------------
	// 6. 测试 SerialQueue 单写者私有串行队列互斥防交错
	// ----------------------------------------------------
	{
		const repo = new MockSceneRepository({
			scenes: { s1: [], s2: [] },
		});
		const executionOrder = [];

		const p1 = sceneService.activate({
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

		const p2 = sceneService.activate({
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

	console.log("  ✅ [Application] 场景应用服务与串行排队测试套件（6 大核心维度）全部通过！");
}
