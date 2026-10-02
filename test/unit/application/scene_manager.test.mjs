import assert from "node:assert";
// 业务逻辑全部走真实源码，仅通过端口注入 Mock 隔离外部依赖
import {
	sceneManager,
	breakpointManager,
	agentSyncService,
	configureDependencies,
} from "#src/application/index.ts";
const activateScene = sceneManager.activateScene.bind(sceneManager);
const addBreakpoint = breakpointManager.addBreakpoint.bind(breakpointManager);
const clearAll = sceneManager.clearAll.bind(sceneManager);
const exportScene = sceneManager.exportScene.bind(sceneManager);
const handleExternalChange = agentSyncService.handleExternalChange.bind(agentSyncService);
import { sceneStateManager } from "#src/application/sceneStateManager.ts";

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
		const ghostResult = await activateScene(
			workspaceRoot,
			["non-existent"],
			{
				sceneRepository: repo,
				breakpointBridge: bridge,
				loopGuard,
			}
		);
		assert.strictEqual(ghostResult.success, false, "幽灵场景激活必须失败");
		assert.deepStrictEqual(ghostResult.missingScenes, ["non-existent"]);
		assert.strictEqual(repo.saveCount, 0, "幽灵场景激活严禁写盘");

		// 合法激活与 SSOT 落盘
		const validResult = await activateScene(
			workspaceRoot,
			["auth"],
			{
				sceneRepository: repo,
				breakpointBridge: bridge,
				loopGuard,
			}
		);
		assert.strictEqual(validResult.success, true, "合法场景激活成功");
		assert.strictEqual(validResult.loadedCount, 1);
		assert.strictEqual(repo.config.activeScenes[0], "auth", "必须已持久化写入 activeScenes 权威 SSOT");
		assert.strictEqual(sceneStateManager.getActiveScene(), "auth", "状态机内存投影必须同步更新");
		assert.strictEqual(loopGuard.marked, true, "必须标记 internalSaving 防回环");

		// 大小写容错校准：目标场景名自动校准为字典中声明的原始名称 (INV-009)
		const caseResult = await activateScene(
			workspaceRoot,
			["AUTH"],
			{
				sceneRepository: repo,
				breakpointBridge: bridge,
				loopGuard,
			}
		);
		assert.strictEqual(caseResult.success, true, "大小写容错匹配必须激活成功");
		assert.deepStrictEqual(caseResult.validTargetScenes, ["auth"], "必须校准为 scenes 字典声明的原始场景名");

		// 幂等激活：activeScenes 未变时不得重复写盘 (INV-010)
		const saveCountBefore = repo.saveCount;
		await activateScene(
			workspaceRoot,
			["auth"],
			{
				sceneRepository: repo,
				breakpointBridge: bridge,
				loopGuard,
			}
		);
		assert.strictEqual(repo.saveCount, saveCountBefore, "重复激活相同场景时 activeScenes 未变，严禁冗余写盘");
	}

	// ----------------------------------------------------
	// 2. 测试 addBreakpoint、即刻点亮与唯一性查重覆盖 (INV-001)
	// ----------------------------------------------------
	console.log("DEBUG: Test step 2");
	{
		resetStateManager();
		sceneStateManager.setActiveScenes(["auth"], 1);
		const repo = new MockSceneRepository({
			scenes: {
				auth: [{ file: "auth.ts", line: 10, type: "line" }],
			},
		});
		const bridge = new MockBreakpointBridge();

		const addResult = await addBreakpoint(
			workspaceRoot,
			"auth",
			{ file: "auth.ts", line: 15, type: "line" },
			{
				sceneRepository: repo,
				breakpointBridge: bridge,
			}
		);

		assert.strictEqual(addResult.success, true);
		assert.strictEqual(addResult.isImmediatelyApplied, true, "激活场景添加断点必须即刻点亮");
		assert.strictEqual(bridge.singleApplied.length, 1);
		assert.strictEqual(repo.config.scenes.auth.length, 2, "断点必须持久化保存至磁盘配置");

		// 同文件同行重复添加必须原地覆盖，不得产生重复项 (INV-001)
		const overwriteResult = await addBreakpoint(
			workspaceRoot,
			"auth",
			{ file: "auth.ts", line: 15, type: "line", condition: "orderId > 100" },
			{
				sceneRepository: repo,
				breakpointBridge: bridge,
			}
		);
		assert.strictEqual(overwriteResult.success, true);
		assert.strictEqual(repo.config.scenes.auth.length, 2, "同文件同行断点必须查重覆盖而非追加");
		assert.strictEqual(repo.config.scenes.auth[1].condition, "orderId > 100", "覆盖后必须保留最新断点定义");
	}

	// ----------------------------------------------------
	// 3. 测试 clearAll
	// ----------------------------------------------------
	console.log("DEBUG: Test step 3");
	{
		resetStateManager();
		sceneStateManager.setActiveScenes(["auth"]);
		const repo = new MockSceneRepository({
			scenes: { auth: [] },
			activeScenes: ["auth"],
		});
		const bridge = new MockBreakpointBridge();

		await clearAll(workspaceRoot, {
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
	console.log("DEBUG: Test step 4");
	{
		resetStateManager();

		// 覆盖模式
		const overwriteRepo = new MockSceneRepository({ scenes: {} });
		const bridge = new MockBreakpointBridge();
		bridge.currentBreakpoints = [
			{ file: "main.ts", line: 5, type: "line" },
			{ file: "main.ts", line: 8, type: "line" },
		];

		const exportResult = await exportScene(
			workspaceRoot,
			"new-scene",
			"overwrite",
			{
				sceneRepository: overwriteRepo,
				breakpointBridge: bridge,
			}
		);

		assert.strictEqual(exportResult.success, true);
		assert.strictEqual(exportResult.count, 2);
		assert.strictEqual(overwriteRepo.config.scenes["new-scene"].length, 2);

		// 追加模式：与既有断点重复的项必须查重合并 (INV-001)
		const appendRepo = new MockSceneRepository({
			scenes: { existing: [{ file: "main.ts", line: 5, type: "line" }] },
		});
		const appendResult = await exportScene(
			workspaceRoot,
			"existing",
			"append",
			{
				sceneRepository: appendRepo,
				breakpointBridge: bridge,
			}
		);

		assert.strictEqual(appendResult.success, true);
		assert.strictEqual(appendResult.count, 2);
		assert.strictEqual(appendRepo.config.scenes.existing.length, 2, "追加导出时同文件同行断点必须去重合并");
	}

	// 5
	console.log("DEBUG: Test step 5");


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

		const changeResult = await handleExternalChange(workspaceRoot, {
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
		const deniedResult = await handleExternalChange(workspaceRoot, {
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
	console.log("DEBUG: Test step 6");
	{
		resetStateManager();
		const repo = new MockSceneRepository({
			scenes: { s1: [], s2: [] },
		});
		const executionOrder = [];

		const p1 = activateScene(
			workspaceRoot,
			["s1"],
			{
				sceneRepository: repo,
				breakpointBridge: {
					applySceneBreakpoints: async () => {
						await new Promise((r) => setTimeout(r, 30));
						executionOrder.push("s1-finished");
						return { loadedCount: 0, healedCount: 0, healedBreakpoints: [] };
					},
				},
			}
		);

		const p2 = activateScene(
			workspaceRoot,
			["s2"],
			{
				sceneRepository: repo,
				breakpointBridge: {
					applySceneBreakpoints: async () => {
						executionOrder.push("s2-finished");
						return { loadedCount: 0, healedCount: 0, healedBreakpoints: [] };
					},
				},
			}
		);

		await Promise.all([p1, p2]);
		assert.deepStrictEqual(
			executionOrder,
			["s1-finished", "s2-finished"],
			"单写者私有队列必须保障业务编排严格串行依次完成，杜绝交错竞态",
		);
	}

	// ----------------------------------------------------
	// 7. 测试缺失指纹断点在激活时的持久化回写闭环 (INV-004 & INV-010)
	// ----------------------------------------------------
	console.log("DEBUG: Test step 7");

	{
		resetStateManager();
		const repo = new MockSceneRepository({
			activeScenes: ["demo-flow"],
			scenes: {
				"demo-flow": [
					{ file: "demo.ts", line: 15, type: "line", desc: "未带指纹的初始断点" },
				],
			},
		});

		const bridge = {
			appliedScenes: [],
			applySceneBreakpoints: async (_ws, _label, bps) => {
				const enriched = bps.map((b) => ({
					...b,
					contextSnippet: {
						prev: "const a = 1;",
						current: "const b = 2;",
						next: "const c = 3;",
						indent: 2,
					},
				}));
				return {
					loadedCount: enriched.length,
					healedCount: 0,
					enrichedCount: 1,
					healedBreakpoints: enriched,
					unmatchedBreakpoints: [],
				};
			},
			collectCurrentBreakpoints: async () => [],
			clearAllBreakpoints: async () => {},
			applySingleBreakpointToEditor: async () => true,
			syncBreakpointEnabledToEditor: async () => true,
		};

		const loopGuard = { marked: false, markInternalSaving: () => { loopGuard.marked = true; } };

		const res = await activateScene(
			workspaceRoot,
			["demo-flow"],
			{
				sceneRepository: repo,
				breakpointBridge: bridge,
				loopGuard,
			}
		);

		assert.strictEqual(res.success, true);
		assert.strictEqual(res.enrichedCount, 1, "激活结果必须包含 enrichedCount");
		assert.strictEqual(loopGuard.marked, true, "持久化必须标记内部保存守卫");
		assert.strictEqual(repo.saveCount, 1, "必须触发权威 SSOT 磁盘保存");
		assert.ok(
			repo.config.scenes["demo-flow"][0].contextSnippet,
			"demo-flow 断点必须持久化补齐后的 contextSnippet",
		);
		assert.strictEqual(
			repo.config.scenes["demo-flow"][0].contextSnippet.current,
			"const b = 2;",
		);
	}

	// 8. 多场景叠加激活指纹补齐与持久化闭环回归测试 (INV-001, INV-011)
	console.log("DEBUG: Test step 8");
	{
		const workspaceRoot = "/mock/workspace";
		const initialConfig = {
			scenes: {
				"scene-a": [
					{
						type: "line",
						file: "src/a.ts",
						line: 10,
					},
				],
				"scene-b": [
					{
						type: "line",
						file: "src/b.ts",
						line: 20,
					},
				],
			},
		};

		const repo = new MockSceneRepository(initialConfig);
		const bridge = {
			applySceneBreakpoints: async (_ws, _label, bps) => {
				const enriched = bps.map((b) => ({
					...b,
					contextSnippet: {
						prev: "// prev line",
						current: `code for ${b.file}`,
						next: "// next line",
						indent: 2,
					},
				}));
				return {
					loadedCount: enriched.length,
					healedCount: 0,
					enrichedCount: 2,
					healedBreakpoints: enriched,
					unmatchedBreakpoints: [],
				};
			},
			collectCurrentBreakpoints: async () => [],
			clearAllBreakpoints: async () => {},
			applySingleBreakpointToEditor: async () => true,
			syncBreakpointEnabledToEditor: async () => true,
		};

		const loopGuard = { marked: false, markInternalSaving: () => { loopGuard.marked = true; } };

		const res = await activateScene(
			workspaceRoot,
			["scene-a", "scene-b"],
			{
				sceneRepository: repo,
				breakpointBridge: bridge,
				loopGuard,
			}
		);

		assert.strictEqual(res.success, true);
		assert.strictEqual(res.enrichedCount, 2, "多场景激活必须统计所有补齐的指纹数");
		assert.strictEqual(loopGuard.marked, true, "多场景持久化必须标记内部写盘守卫");
		assert.ok(repo.saveCount >= 1, "多场景激活必须成功触发磁盘存盘");

		assert.ok(
			repo.config.scenes["scene-a"][0].contextSnippet,
			"scene-a 的断点必须成功持久化 contextSnippet",
		);
		assert.strictEqual(
			repo.config.scenes["scene-a"][0].contextSnippet.current,
			"code for src/a.ts",
		);

		assert.ok(
			repo.config.scenes["scene-b"][0].contextSnippet,
			"scene-b 的断点也必须成功持久化 contextSnippet",
		);
		assert.strictEqual(
			repo.config.scenes["scene-b"][0].contextSnippet.current,
			"code for src/b.ts",
		);
	}

	// 9. 全场景未激活静默指纹预加固测试 (enrichAllSceneFingerprints)
	console.log("DEBUG: Test step 9");
	{
		const workspaceRoot = "/mock/workspace";
		const initialConfig = {
			scenes: {
				"unactivated-scene-1": [
					{
						type: "line",
						file: "src/calc.ts",
						line: 2,
					},
				],
				"unactivated-scene-2": [
					{
						type: "line",
						file: "src/utils.ts",
						line: 1,
					},
				],
			},
		};

		const repo = new MockSceneRepository(initialConfig);
		const loopGuard = { marked: false, markInternalSaving: () => { loopGuard.marked = true; } };

		const mockFiles = {
			"/mock/workspace/src/calc.ts": [
				"// calc file",
				"export function add(a, b) {",
				"  return a + b;",
				"}",
			],
			"/mock/workspace/src/utils.ts": [
				"export const PI = 3.14159;",
			],
		};

		const { agentSyncService: syncSvc } = await import("#src/application/index.ts");
		const res = await syncSvc.enrichAllSceneFingerprints(workspaceRoot, {
			sceneRepository: repo,
			loopGuard,
			fileLinesReader: async (fPath) => mockFiles[fPath.replace(/\\/g, "/")],
		});

		assert.strictEqual(res.enrichedCount, 2, "必须成功为 2 个未激活场景的断点预补齐指纹");
		assert.strictEqual(res.persisted, true, "预补齐后必须触发存盘");
		assert.strictEqual(loopGuard.marked, true, "必须标记内部写盘守卫防止回环");

		assert.strictEqual(
			repo.config.scenes["unactivated-scene-1"][0].contextSnippet?.current,
			"export function add(a, b) {",
		);
		assert.strictEqual(
			repo.config.scenes["unactivated-scene-2"][0].contextSnippet?.current,
			"export const PI = 3.14159;",
		);

		// 再次调用，全量已有指纹，应 0 毫秒跳过且不触发写盘
		const res2 = await syncSvc.enrichAllSceneFingerprints(workspaceRoot, {
			sceneRepository: repo,
			loopGuard,
			fileLinesReader: async (fPath) => mockFiles[fPath.replace(/\\/g, "/")],
		});
		assert.strictEqual(res2.enrichedCount, 0, "再次巡检无需补齐");
		assert.strictEqual(res2.persisted, false, "无需二次写盘");
	}

	// ----------------------------------------------------
	// 10. 依赖倒置与未配置依赖时的防御拦截测试 (DIP)
	// ----------------------------------------------------
	console.log("DEBUG: Test step 10");

	{
		resetStateManager();
		const { sceneManager: scnMgr, configureDependencies: cfgDeps } = await import(
			"#src/application/index.ts"
		);

		// 未配置依赖且未显式传入时必须抛出清晰的架构防御性错误
		await assert.rejects(
			async () => {
				await scnMgr.activateScene(workspaceRoot, ["some-scene"]);
			},
			/SceneService: sceneRepository and breakpointBridge must be configured/,
			"未配置任何端口依赖直接调用必须触发防御性拦截"
		);

		// 通过 configureDependencies 注入全局默认依赖后，无需参数传参即可成功运行
		const repo = new MockSceneRepository({
			scenes: {
				"demo-scene": [{ file: "demo.ts", line: 15, type: "line" }],
			},
		});
		const bridge = new MockBreakpointBridge();
		cfgDeps({
			sceneRepository: repo,
			breakpointBridge: bridge,
		});

		const configuredResult = await scnMgr.activateScene(workspaceRoot, ["demo-scene"]);
		assert.strictEqual(configuredResult.success, true, "装配依赖后必须顺利激活");
		assert.strictEqual(bridge.appliedBreakpoints.length, 1);
	}

	// ----------------------------------------------------
	// 11. handleExternalChange 核心拓扑变更、挂起与清空分支测试
	// ----------------------------------------------------
	console.log("DEBUG: Test step 11");
	{
		resetStateManager();
		const { agentSyncService: syncSvc } = await import("#src/application/index.ts");

		// A. 外部清空 activeScenes 声明式清空分支 (diff.action === 'clear')
		sceneStateManager.setActiveScenes(["login"]);
		const clearRepo = new MockSceneRepository({
			scenes: { login: [{ file: "login.ts", line: 1 }] },
			activeScenes: [],
		});
		const clearBridge = new MockBreakpointBridge();
		const clearRes = await syncSvc.handleExternalChange(workspaceRoot, {
			allowAiActivation: true,
			sceneRepository: clearRepo,
			breakpointBridge: clearBridge,
		});
		assert.strictEqual(clearRes.action, "cleared");
		assert.strictEqual(clearBridge.cleared, true);

		// B. 处于激活状态但外部变更断点，调试进行中挂起策略 (isDebuggingActive: true)
		resetStateManager();
		sceneStateManager.setActiveScenes(["login"]);
		sceneStateManager.setLastAppliedTopologyHash("old_hash_123");
		const pendingRepo = new MockSceneRepository({
			scenes: { login: [{ file: "login.ts", line: 20 }] },
			activeScenes: ["login"],
		});
		const pendingBridge = new MockBreakpointBridge();
		let pendingMessageCalled = false;
		const pendingRes = await handleExternalChange(workspaceRoot, {
			allowAiActivation: false,
			isDebuggingActive: true,
			sceneRepository: pendingRepo,
			breakpointBridge: pendingBridge,
			onPendingMessage: () => {
				pendingMessageCalled = true;
			},
		});
		assert.strictEqual(pendingRes.action, "pending");
		assert.strictEqual(pendingMessageCalled, true, "必须触发挂起状态栏提示回调");
		assert.strictEqual(sceneStateManager.isPendingTopologyUpdate(), true);

		// C. 处于激活状态且外部变更断点，非调试状态立即应用 (isDebuggingActive: false)
		const appliedRes = await handleExternalChange(workspaceRoot, {
			allowAiActivation: false,
			isDebuggingActive: false,
			sceneRepository: pendingRepo,
			breakpointBridge: pendingBridge,
		});
		assert.strictEqual(appliedRes.action, "applied");
		assert.ok(pendingBridge.appliedBreakpoints.length > 0);

		// D. 拓扑未变，返回 noop
		const noopRes = await handleExternalChange(workspaceRoot, {
			allowAiActivation: false,
			isDebuggingActive: false,
			sceneRepository: pendingRepo,
			breakpointBridge: pendingBridge,
		});
		assert.strictEqual(noopRes.action, "noop");
	}

	// ----------------------------------------------------
	// 12. activateScene 应用层前置自愈与指纹富化闭环测试 (Clean Architecture DIP)
	// ----------------------------------------------------
	console.log("DEBUG: Test step 12");
	{
		resetStateManager();
		const repo = new MockSceneRepository({
			activeScenes: [],
			scenes: {
				"heal-flow": [
					{
						file: "user.ts",
						line: 10,
						type: "line",
						contextSnippet: {
							prev: "function getUser() {",
							current: "  const id = request.params.id;",
							next: "  return db.find(id);",
							indent: 2,
						},
					},
					{
						file: "user.ts",
						line: 16,
						type: "line",
					},
				],
			},
		});

		const mockFileLines = [
			"// Line 1",
			"// Line 2",
			"// Line 3",
			"// Line 4",
			"// Line 5",
			"// Line 6",
			"// Line 7",
			"// Line 8",
			"// Line 9",
			"function other() {}",
			"function getUser() {",
			"  const id = request.params.id;", // 第 12 行 (原第 10 行自愈到此处)
			"  return db.find(id);",
			"}",
			"// Line 15",
			"export const version = '1.0';", // 第 16 行 (待富化指纹)
		];

		let bridgeReceivedBreakpoints = [];
		const bridge = {
			applySceneBreakpoints: async (_ws, _label, bps) => {
				bridgeReceivedBreakpoints = bps;
				return {
					loadedCount: bps.length,
					healedCount: 0,
				};
			},
			collectCurrentBreakpoints: async () => [],
			clearAllBreakpoints: async () => {},
			applySingleBreakpointToEditor: async () => true,
			syncBreakpointEnabledToEditor: async () => true,
		};

		const loopGuard = { marked: false, markInternalSaving: () => { loopGuard.marked = true; } };

		const res = await activateScene(
			workspaceRoot,
			["heal-flow"],
			{
				sceneRepository: repo,
				breakpointBridge: bridge,
				loopGuard,
				fileLinesReader: async (_path) => mockFileLines,
			},
		);

		assert.strictEqual(res.success, true);
		assert.strictEqual(res.healedCount, 1, "应用层必须检测到 1 处自愈");
		assert.strictEqual(res.enrichedCount, 1, "应用层必须检测到 1 处指纹补齐");
		assert.strictEqual(bridgeReceivedBreakpoints.length, 2);
		assert.strictEqual(bridgeReceivedBreakpoints[0].line, 12, "下发给底层桥接的断点行号必须已完成自愈校准为 12");
		assert.ok(bridgeReceivedBreakpoints[1].contextSnippet, "下发给底层桥接的断点必须已补齐指纹");
		assert.strictEqual(repo.config.scenes["heal-flow"][0].line, 12, "自愈后的行号必须成功回写持久化到仓库");
		assert.ok(repo.config.scenes["heal-flow"][1].contextSnippet, "补齐后的指纹必须成功回写持久化到仓库");
	}

	console.log("  ✅ [Application] 场景应用服务与串行排队测试套件（12 大核心维度·真实源码）全部通过！");
}

