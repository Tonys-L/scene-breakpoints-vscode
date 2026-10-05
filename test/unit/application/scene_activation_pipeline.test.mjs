import assert from "node:assert/strict";
import {
	syncDiskActiveScenesIfNeeded,
	persistHealedBackfill,
	enrichAndHealBreakpoints,
	executeSceneActivation,
} from "#src/application/sceneActivationPipeline.ts";
import { SceneCatalog } from "#src/domain/models/sceneCatalog.ts";
import { Breakpoint } from "#src/domain/models/breakpoint.ts";

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
		[healedBp],
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

export async function runSceneActivationPipelineTests() {
	console.log("  ▶ [SceneActivationPipeline] 运行场景激活自愈管道独立单元测试...");
	await testSyncDiskActiveScenes();
	await testPersistHealedBackfill();
	await testEnrichAndHealBreakpoints();
	await testExecuteSceneActivation();
	console.log("  ✅ [SceneActivationPipeline] 场景激活自愈管道单元测试全部通过！");
}

if (process.argv[1]?.endsWith("scene_activation_pipeline.test.mjs")) {
	runSceneActivationPipelineTests();
}
