import assert from "node:assert/strict";
import {
	syncDiskActiveScenesIfNeeded,
	persistHealedBackfill,
	enrichAndHealBreakpoints,
	executeSceneActivation,
} from "#src/application/sceneActivationPipeline.ts";
import { SceneCatalog } from "#src/domain/models/sceneCatalog.ts";
import { Breakpoint } from "#src/domain/models/breakpoint.ts";
import { CircularReferenceError } from "#src/domain/services/sceneResolver.ts";
import { sceneStateManager } from "#src/application/sceneStateManager.ts";
import { appEventBus } from "#src/application/eventBus.ts";

class MockSceneRepo {
	constructor(initialConfig = { scenes: {} }) {
		this.config = JSON.parse(JSON.stringify(initialConfig));
		this.saveCount = 0;
	}
	loadScenesConfig(_ws) {
		return JSON.parse(JSON.stringify(this.config));
	}
	saveScenesConfig(_ws, newConfig) {
		this.config = JSON.parse(JSON.stringify(newConfig));
		this.saveCount++;
	}
}

class MockBridge {
	constructor() {
		this.appliedScenes = [];
		this.appliedBreakpoints = [];
	}
	async applySceneBreakpoints(_ws, label, bps) {
		this.appliedScenes.push(label);
		this.appliedBreakpoints = bps;
		return { loadedCount: bps.length, healedCount: 0 };
	}
	async collectCurrentBreakpoints() {
		return [];
	}
	async clearAllBreakpoints() {}
	async applySingleBreakpointToEditor() {
		return true;
	}
	async syncBreakpointEnabledToEditor() {
		return true;
	}
}

async function testSyncDiskActiveScenes() {
	const repo = new MockSceneRepo({ scenes: { auth: [] }, activeScenes: ["auth"] });
	const catalog = new SceneCatalog(repo.config);

	// 1. activeScenes 一致时：静默不落盘
	syncDiskActiveScenesIfNeeded("/workspace", catalog, ["auth"], ["auth"], repo);
	assert.strictEqual(repo.saveCount, 0, "activeScenes 相同不得多余写盘");

	// 2. activeScenes 不一致时：优先落盘
	syncDiskActiveScenesIfNeeded("/workspace", catalog, ["old"], ["auth"], repo);
	assert.strictEqual(repo.saveCount, 1, "activeScenes 变化时必须单向优先写盘");
}

async function testPersistHealedBackfill() {
	const repo = new MockSceneRepo({
		scenes: {
			auth: [{ file: "src/auth.ts", line: 10, type: "line", contextSnippet: { current: "checkAuth();" } }],
		},
	});
	const catalog = new SceneCatalog(repo.config);
	const healedBp = new Breakpoint({
		file: "src/auth.ts",
		line: 12,
		type: "line",
		contextSnippet: { current: "checkAuth();" },
	});

	persistHealedBackfill(
		"/workspace",
		catalog,
		["auth"],
		{ loadedCount: 1, healedCount: 1, healedBreakpoints: [healedBp] },
		// 批次 3 溯源路由：输入为带 ownerScene 的展开流
		[{ breakpoint: healedBp, ownerScene: "auth", refPath: ["auth"] }],
		repo,
	);

	assert.strictEqual(repo.saveCount, 1);
	const savedBps = repo.config.scenes.auth;
	assert.strictEqual(savedBps[0].line, 12, "自愈后的行号必须写回磁盘 SSOT");
}

async function testEnrichAndHealBreakpoints() {
	// 1. 无 lineReader 时安全跳过
	const bp1 = new Breakpoint({ file: "src/calc.ts", line: 5, type: "line" });
	const res1 = await enrichAndHealBreakpoints("/workspace", [bp1]);
	assert.deepStrictEqual(res1, { healedCount: 0, enrichedCount: 0, unmatched: [] });

	// 2. 函数断点直接放行
	const fnBp = new Breakpoint({ functionName: "login", type: "function" });
	const resFn = await enrichAndHealBreakpoints("/workspace", [fnBp], { readLines: async () => ["line 1"] });
	assert.strictEqual(resFn.healedCount, 0);

	// 3. 有源码行时富化并自愈
	const lines = ["const a = 1;", "const b = 2;", "function login() {", "  return true;", "}"];
	const bpToHeal = new Breakpoint({
		file: "src/login.ts",
		line: 3,
		type: "line",
		contextSnippet: {
			current: "function login() {",
			prev: "const b = 2;",
			next: "  return true;",
		},
	});
	// 源码中该行被下移至第 4 行
	const driftedLines = ["// header", "const a = 1;", "const b = 2;", "function login() {", "  return true;", "}"];
	const resHealed = await enrichAndHealBreakpoints(
		"/workspace",
		[bpToHeal],
		{ readLines: async () => driftedLines },
	);
	assert.strictEqual(resHealed.healedCount, 1, "应成功计算出自愈偏移");
	assert.strictEqual(bpToHeal.line, 4, "断点实体行号应被自愈为 4");
}

async function testExecuteSceneActivation() {
	const repo = new MockSceneRepo({
		scenes: {
			sceneA: [{ file: "src/a.ts", line: 10, type: "line" }],
			sceneB: [{ file: "src/b.ts", line: 20, type: "line" }],
		},
	});
	const bridge = new MockBridge();

	// 1. 幽灵场景拦截 (INV-009)
	const ghostRes = await executeSceneActivation({
		workspaceRoot: "/workspace",
		targetScenes: ["ghostScene"],
		deps: { sceneRepository: repo, breakpointBridge: bridge },
	});
	assert.strictEqual(ghostRes.success, false);
	assert.deepStrictEqual(ghostRes.missingScenes, ["ghostScene"]);

	// 2. 正常场景激活与合并下发 (INV-001, INV-002)
	const okRes = await executeSceneActivation({
		workspaceRoot: "/workspace",
		targetScenes: ["sceneA", "sceneB"],
		deps: { sceneRepository: repo, breakpointBridge: bridge },
	});
	assert.strictEqual(okRes.success, true);
	assert.deepStrictEqual(okRes.validTargetScenes, ["sceneA", "sceneB"]);
	assert.strictEqual(okRes.loadedCount, 2);
	assert.strictEqual(bridge.appliedScenes[0], "sceneA + sceneB");

	// 3. 伴随 ILineReader 的自愈激活测试 (修复生产自愈短路缺陷回归保障)
	const driftedRepo = new MockSceneRepo({
		scenes: {
			driftScene: [
				{
					file: "src/code.ts",
					line: 2,
					type: "line",
					contextSnippet: { current: "targetLine();" },
				},
			],
		},
	});
	const mockLineReader = {
		readLines: async () => ["// header", "// blank", "targetLine();"], // 偏移至第 3 行
	};
	const healedActRes = await executeSceneActivation({
		workspaceRoot: "/workspace",
		targetScenes: ["driftScene"],
		deps: { sceneRepository: driftedRepo, breakpointBridge: bridge, lineReader: mockLineReader },
	});
	assert.strictEqual(healedActRes.success, true);
	assert.strictEqual(healedActRes.healedCount, 1, "激活管道必须成功自愈行号");
	assert.strictEqual(bridge.appliedBreakpoints[0].line, 3, "下发给调试器的断点行号必须为自愈后的第 3 行");
}

// ==============================
// 批次 3：场景组合引擎接入用例（§9.1 断言表）
// ==============================

/** 构造带缓存的行读取器：仅命中指定文件，其余返回 undefined */
function makeLineReader(files) {
	return {
		readLines: async (filePath) => {
			const norm = String(filePath).replace(/\\/g, "/");
			const hit = Object.keys(files).find((k) => norm.endsWith(k));
			return hit ? files[hit] : undefined;
		},
		clearCache: () => {},
	};
}

// T1. 成环中止：状态机 None 态零污染 + 锁释放 + 磁盘零写入 + 零 DAP 下发 (§5.3, §9.1)
async function testCircularRefAbort() {
	sceneStateManager.resetState();
	const repo = new MockSceneRepo({
		scenes: {
			A: [{ file: "src/a.ts", line: 1, type: "line" }, { type: "scene", name: "B" }],
			B: [{ file: "src/b.ts", line: 2, type: "line" }, { type: "scene", name: "A" }],
		},
	});
	const bridge = new MockBridge();
	const configBefore = JSON.parse(JSON.stringify(repo.config));

	await assert.rejects(
		executeSceneActivation({
			workspaceRoot: "/workspace",
			targetScenes: ["A"],
			deps: { sceneRepository: repo, breakpointBridge: bridge },
		}),
		(err) => {
			assert.ok(err instanceof CircularReferenceError, "必须抛出 CircularReferenceError");
			assert.deepStrictEqual(err.cyclePath, ["A", "B", "A"], "环路径必须从入口截取且闭合");
			return true;
		},
	);

	assert.strictEqual(repo.saveCount, 0, "成环失败路径磁盘零写入（含 INV-010 同步落盘）");
	assert.strictEqual(bridge.appliedScenes.length, 0, "成环失败路径零 DAP 下发");
	assert.strictEqual(sceneStateManager.isApplyingScene(), false, "异常路径无锁遗留");
	assert.deepStrictEqual(sceneStateManager.getActiveScenes(), [], "状态机 None 态零污染");
	assert.deepStrictEqual(JSON.parse(JSON.stringify(repo.config)), configBefore, "配置文件未被改写");
}

// T2. 悬空不阻断：存活断点正常下发 + resolve-warnings 事件 1 次 (INV-030.4, §9.1)
async function testDanglingRefNonBlocking() {
	sceneStateManager.resetState();
	const repo = new MockSceneRepo({
		scenes: {
			pay: [{ type: "scene", name: "ghost-ref" }, { file: "src/pay.ts", line: 40, type: "line" }],
		},
	});
	const bridge = new MockBridge();
	const warningEvents = [];
	const sub = appEventBus.on("scene:resolve-warnings", (payload) => warningEvents.push(payload));

	try {
		const res = await executeSceneActivation({
			workspaceRoot: "/workspace",
			targetScenes: ["pay"],
			deps: { sceneRepository: repo, breakpointBridge: bridge },
		});

		assert.strictEqual(res.success, true, "悬空引用必须降级为警告，不阻断激活");
		assert.strictEqual(bridge.appliedScenes.length, 1, "applySceneBreakpoints 仅调用 1 次");
		assert.deepStrictEqual(bridge.appliedBreakpoints, [
			{ type: "line", file: "src/pay.ts", line: 40, enabled: true },
		], "下发流仅含存活断点");
		assert.strictEqual(warningEvents.length, 1, "resolve-warnings 事件必须 emit 1 次");
		assert.strictEqual(warningEvents[0].workspaceRoot, "/workspace");
		assert.deepStrictEqual(warningEvents[0].warnings, [
			{ code: "dangling-ref", refName: "ghost-ref", refPath: ["pay"] },
		]);
		assert.deepStrictEqual(repo.config.scenes.pay[0], { type: "scene", name: "ghost-ref" }, "落盘保真：引用条目保留");
	} finally {
		sub.dispose();
	}
}

// T3. ownerScene 溯源路由：未激活被引用场景 healed 回写，引用发起场景不被误写 (§5.2, §9.1)
async function testOwnerSceneBackfillRouting() {
	sceneStateManager.resetState();
	const repo = new MockSceneRepo({
		scenes: {
			"auth-core": [{ file: "src/auth.ts", line: 10, type: "line", contextSnippet: { current: "checkAuth();" } }],
			"payment-debug": [{ type: "scene", name: "auth-core" }, { file: "src/payment.ts", line: 40, type: "line" }],
		},
	});
	const bridge = new MockBridge();
	const drifted = [...Array.from({ length: 11 }, (_, i) => `// fill ${i}`), "checkAuth();"];
	const res = await executeSceneActivation({
		workspaceRoot: "/workspace",
		targetScenes: ["payment-debug"],
		deps: {
			sceneRepository: repo,
			breakpointBridge: bridge,
			lineReader: makeLineReader({ "src/auth.ts": drifted }),
		},
	});

	assert.strictEqual(res.success, true);
	assert.strictEqual(res.healedCount, 1, "被引用场景断点必须参与自愈");
	assert.strictEqual(bridge.appliedBreakpoints.length, 2, "展开流按声明序下发");
	assert.strictEqual(bridge.appliedBreakpoints[0].file, "src/auth.ts");
	assert.strictEqual(bridge.appliedBreakpoints[0].line, 12, "下发流行号为自愈后行号");
	assert.strictEqual(repo.config.scenes["auth-core"][0].line, 12, "未激活被引用场景必须按 ownerScene 回写");
	assert.strictEqual(repo.config.scenes["payment-debug"][1].line, 40, "引用发起场景自有断点行号不得被误写");
	assert.deepStrictEqual(
		repo.config.scenes["payment-debug"][0],
		{ type: "scene", name: "auth-core" },
		"落盘保真：引用条目完整保留",
	);
}

// T4. 同源多引用单次回写：两场景引用同源，owner 仅回写一次（INV-011 + ownerScenes 去重, §9.1）
async function testSameOwnerSingleBackfill() {
	sceneStateManager.resetState();
	const repo = new MockSceneRepo({
		scenes: {
			s1: [{ type: "scene", name: "core" }],
			s2: [{ type: "scene", name: "core" }],
			core: [{ file: "src/core.ts", line: 3, type: "line", contextSnippet: { current: "const core = 3;" } }],
		},
		activeScenes: ["s1", "s2"], // 磁盘活跃集合已一致 → INV-010 同步落盘跳过
	});
	const bridge = new MockBridge();
	const drifted = ["// a", "// b", "// c", "const core = 3;"];
	const res = await executeSceneActivation({
		workspaceRoot: "/workspace",
		targetScenes: ["s1", "s2"],
		deps: {
			sceneRepository: repo,
			breakpointBridge: bridge,
			lineReader: makeLineReader({ "src/core.ts": drifted }),
		},
	});

	assert.strictEqual(res.success, true);
	assert.strictEqual(res.healedCount, 1);
	assert.strictEqual(bridge.appliedBreakpoints.length, 1, "同源引用先到先得仅下发一次");
	assert.strictEqual(repo.saveCount, 1, "sync 跳过后仅溯源回写单次落盘");
	assert.strictEqual(repo.config.scenes.core[0].line, 4, "owner 场景断点行号回写为自愈值");
	assert.deepStrictEqual(repo.config.scenes.s1, [{ type: "scene", name: "core" }], "引用发起场景配置不被污染");
	assert.deepStrictEqual(repo.config.scenes.s2, [{ type: "scene", name: "core" }], "引用发起场景配置不被污染");
}

// T5. 黄金快照：无引用双场景叠加激活与改造前基线逐字节一致（行为零漂移证明, §9.1）
async function testGoldenSnapshotNoRefScenes() {
	sceneStateManager.resetState();
	const repo = new MockSceneRepo({
		scenes: {
			alpha: [{ file: "src/a.ts", line: 2, type: "line", contextSnippet: { current: "const alpha = 1;" } }],
			beta: [{ file: "src/b.ts", line: 5, type: "line" }, { type: "function", functionName: "main" }],
		},
		activeScenes: [],
	});
	const bridge = new MockBridge();
	const warningEvents = [];
	const sub = appEventBus.on("scene:resolve-warnings", (payload) => warningEvents.push(payload));

	try {
		const res = await executeSceneActivation({
			workspaceRoot: "/workspace",
			targetScenes: ["alpha", "beta"],
			deps: {
				sceneRepository: repo,
				breakpointBridge: bridge,
				lineReader: makeLineReader({ "src/a.ts": ["// header", "// padding", "const alpha = 1;"] }),
			},
		});

		// 基线捕获自改造前（批次 1 状态）管道对同一夹具的真实输出
		assert.deepStrictEqual(res, {
			success: true,
			validTargetScenes: ["alpha", "beta"],
			missingScenes: [],
			loadedCount: 3,
			healedCount: 1,
			enrichedCount: 0,
			unmatchedCount: 0,
			unmatchedBreakpoints: undefined,
		}, "ActivateSceneResult 与改造前基线逐字段一致");
		assert.strictEqual(bridge.appliedScenes.length, 1);
		assert.deepStrictEqual(bridge.appliedBreakpoints, [
			{ type: "line", file: "src/a.ts", line: 3, enabled: true, contextSnippet: { current: "const alpha = 1;" } },
			{ type: "line", file: "src/b.ts", line: 5, enabled: true },
			{ type: "function", functionName: "main", enabled: true },
		], "DAP 下发流与改造前基线一致");
		assert.strictEqual(repo.saveCount, 2, "落盘次数与改造前基线一致（INV-010 同步 + 溯源回写）");
		assert.deepStrictEqual(JSON.parse(JSON.stringify(repo.config)), {
			scenes: {
				alpha: [{ type: "line", file: "src/a.ts", line: 3, enabled: true, contextSnippet: { current: "const alpha = 1;" } }],
				beta: [{ type: "line", file: "src/b.ts", line: 5, enabled: true }, { type: "function", functionName: "main", enabled: true }],
			},
			activeScenes: ["alpha", "beta"],
		}, "最终落盘 JSON 与改造前基线逐字节一致");
		assert.strictEqual(warningEvents.length, 0, "无引用场景不得产生解析警告事件");
	} finally {
		sub.dispose();
	}
}

export async function runSceneActivationPipelineTests() {
	console.log("  ▶ [SceneActivationPipeline] 运行场景激活自愈管道独立单元测试...");
	await testSyncDiskActiveScenes();
	await testPersistHealedBackfill();
	await testEnrichAndHealBreakpoints();
	await testExecuteSceneActivation();
	await testCircularRefAbort();
	await testDanglingRefNonBlocking();
	await testOwnerSceneBackfillRouting();
	await testSameOwnerSingleBackfill();
	await testGoldenSnapshotNoRefScenes();
	console.log("  ✅ [SceneActivationPipeline] 场景激活自愈管道单元测试全部通过！");
}

if (process.argv[1]?.endsWith("scene_activation_pipeline.test.mjs")) {
	runSceneActivationPipelineTests();
}
