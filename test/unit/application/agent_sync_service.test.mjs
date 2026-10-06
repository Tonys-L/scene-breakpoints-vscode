import assert from "node:assert";
import { agentSyncService } from "#src/application/agentSyncService";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { getDependencies, resetDependencies } from "#src/application/dependencies";

/**
 * agentSyncService 1:1 镜像单测
 * 覆盖高危未测函数 autoEnrichEmptyFingerprints：外部变更时的指纹静默预补齐全分支
 * (经公开入口 handleExternalChange 注入端口驱动，遵循 DIP)
 */

/** 端口 Mock：内存版 ISceneRepository，记录写盘调用 */
class MockSceneRepository {
	constructor(initialConfig, { throwOnFirstLoad = false } = {}) {
		this.config = JSON.parse(JSON.stringify(initialConfig));
		this.saved = [];
		this.loadCount = 0;
		this.throwOnFirstLoad = throwOnFirstLoad;
	}
	loadScenesConfig() {
		this.loadCount++;
		if (this.throwOnFirstLoad && this.loadCount === 1) {
			throw new Error("disk i/o burst");
		}
		return JSON.parse(JSON.stringify(this.config));
	}
	saveScenesConfig(_workspaceRoot, config) {
		this.saved.push(JSON.parse(JSON.stringify(config)));
		this.config = JSON.parse(JSON.stringify(config));
	}
}

const bridgeNotCalled = {
	applySceneBreakpoints: () => {
		throw new Error("breakpointBridge must not be called in pending scenarios");
	},
};

const makeLineReader = (files, calls) => ({
	readLines: async (filePath) => {
		calls.push(filePath);
		return files[filePath.replace(/\\/g, "/")];
	},
	clearCache: () => {
		calls.push("__clearCache__");
	},
});

export async function runAgentSyncServiceTests() {
	console.log("  ▶ [Agent Sync Service] 运行外部变更指纹静默预补齐 (autoEnrichEmptyFingerprints) 单测（真实源码）...");

	const workspaceRoot = "/mock/workspace";

	try {
		// ----------------------------------------------------
		// A. 全部断点已具指纹 -> 无需补齐，不落盘
		// ----------------------------------------------------
		{
			sceneStateManager.resetState();
			sceneStateManager.setActiveScenes(["enriched"], 1);
			const repo = new MockSceneRepository({
				scenes: {
					enriched: [
						{ file: "src/a.ts", line: 1, type: "line", enabled: true, contextSnippet: { current: "const x = 1;" } },
					],
				},
				activeScenes: ["enriched"],
			});
			const calls = [];
			const result = await agentSyncService.handleExternalChange(workspaceRoot, {
				sceneRepository: repo,
				breakpointBridge: bridgeNotCalled,
				lineReader: makeLineReader({}, calls),
				isDebuggingActive: true, // 拓扑挂起分支，聚焦指纹补齐逻辑
			});

			assert.strictEqual(repo.saved.length, 0, "全部断点已具指纹时绝不触发落盘");
			assert.deepStrictEqual(calls, ["__clearCache__"], "仍需清理行读取缓存但不可读任何文件");
			assert.strictEqual(result.action, "pending", "调试中的拓扑变更必须挂起为 pending");
		}

		// ----------------------------------------------------
		// B. 行断点缺指纹 + 源码可读 -> 静默补齐并落盘
		// ----------------------------------------------------
		{
			sceneStateManager.resetState();
			sceneStateManager.setActiveScenes(["partial"], 1);
			const repo = new MockSceneRepository({
				scenes: {
					partial: [{ file: "src/b.ts", line: 1, type: "line", enabled: true }],
				},
				activeScenes: ["partial"],
			});
			const calls = [];
			const lineReader = makeLineReader({ "/mock/workspace/src/b.ts": ["const greeting = 'hello';", "const x = 2;"] }, calls);

			await agentSyncService.handleExternalChange(workspaceRoot, {
				sceneRepository: repo,
				breakpointBridge: bridgeNotCalled,
				lineReader,
				isDebuggingActive: true,
			});

			assert.strictEqual(repo.saved.length, 1, "存在未具指纹断点且补齐成功时必须落盘一次");
			const savedBp = repo.saved[0].scenes.partial[0];
			assert.ok(
				savedBp.contextSnippet && typeof savedBp.contextSnippet.current === "string" && savedBp.contextSnippet.current.length > 0,
				"落盘断点必须携带补齐后的上下文指纹",
			);
			assert.ok(calls.some((c) => String(c).endsWith("src/b.ts")), "必须读取断点所在源文件行");
		}

		// ----------------------------------------------------
		// C. function 类型断点 -> 跳过补齐，不落盘
		// ----------------------------------------------------
		{
			sceneStateManager.resetState();
			sceneStateManager.setActiveScenes(["fn-only"], 1);
			const repo = new MockSceneRepository({
				scenes: {
					"fn-only": [{ type: "function", functionName: "main", enabled: true }],
				},
				activeScenes: ["fn-only"],
			});
			const calls = [];
			await agentSyncService.handleExternalChange(workspaceRoot, {
				sceneRepository: repo,
				breakpointBridge: bridgeNotCalled,
				lineReader: makeLineReader({ "/mock/workspace/src/c.ts": ["function main() {}"] }, calls),
				isDebuggingActive: true,
			});

			assert.strictEqual(repo.saved.length, 0, "function 断点不参与指纹补齐，绝不落盘");
			assert.ok(
				!calls.some((c) => String(c).endsWith("src/c.ts")),
				"function 断点必须直接跳过，不读取源文件",
			);
		}

		// ----------------------------------------------------
		// D. 源文件不可读 (readLines undefined) 与空行数组 -> 跳过该断点
		// ----------------------------------------------------
		{
			sceneStateManager.resetState();
			sceneStateManager.setActiveScenes(["unreadable"], 1);
			const repo = new MockSceneRepository({
				scenes: {
					unreadable: [
						{ file: "src/missing.ts", line: 1, type: "line", enabled: true },
						{ file: "src/empty.ts", line: 1, type: "line", enabled: true },
					],
				},
				activeScenes: ["unreadable"],
			});
			await agentSyncService.handleExternalChange(workspaceRoot, {
				sceneRepository: repo,
				breakpointBridge: bridgeNotCalled,
				lineReader: makeLineReader({ "/mock/workspace/src/empty.ts": [] }, []),
				isDebuggingActive: true,
			});

			assert.strictEqual(repo.saved.length, 0, "源码不可读时必须静默跳过，绝不落盘");
		}

		// ----------------------------------------------------
		// E. 目标行为空白行导致 enrich 失败 -> 不落盘
		// ----------------------------------------------------
		{
			sceneStateManager.resetState();
			sceneStateManager.setActiveScenes(["blank"], 1);
			const repo = new MockSceneRepository({
				scenes: {
					blank: [{ file: "src/blank.ts", line: 1, type: "line", enabled: true }],
				},
				activeScenes: ["blank"],
			});
			await agentSyncService.handleExternalChange(workspaceRoot, {
				sceneRepository: repo,
				breakpointBridge: bridgeNotCalled,
				lineReader: makeLineReader({ "/mock/workspace/src/blank.ts": ["", "const x = 1;"] }, []),
				isDebuggingActive: true,
			});

			assert.strictEqual(repo.saved.length, 0, "指纹提取失败 (空白行) 时绝不落盘");
		}

		// ----------------------------------------------------
		// F. 读配置异常 -> 容灾守卫吞错告警，不中断主流程
		// ----------------------------------------------------
		{
			sceneStateManager.resetState();
			sceneStateManager.setActiveScenes(["faulty"], 1);
			const repo = new MockSceneRepository(
				{
					scenes: {
						faulty: [{ file: "src/f.ts", line: 1, type: "line", enabled: true }],
					},
					activeScenes: ["faulty"],
				},
				{ throwOnFirstLoad: true }, // 首次 load (autoEnrich 内部) 抛错，第二次 (主流程) 正常
			);
			const warnings = [];
			const origWarn = console.warn;
			console.warn = (...args) => warnings.push(args.join(" "));
			try {
				const result = await agentSyncService.handleExternalChange(workspaceRoot, {
					sceneRepository: repo,
					breakpointBridge: bridgeNotCalled,
					lineReader: makeLineReader({}, []),
					isDebuggingActive: true,
				});
				// 主流程未被 autoEnrich 的内部异常中断
				assert.strictEqual(result.action, "pending", "预补齐异常必须被容灾拦截，不得中断外部变更主流程");
				assert.ok(
					warnings.some((w) => w.includes("auto-enrich")),
					"异常必须以显式上下文告警记录 (禁止静默吞错)",
				);
			} finally {
				console.warn = origWarn;
			}
		}
	} finally {
		sceneStateManager.resetState();
		resetDependencies();
		// 恢复真实默认依赖，避免污染后续套件
		const deps = getDependencies();
		assert.ok(typeof deps === "object", "依赖容器必须可访问");
	}

	console.log("  ✅ [Agent Sync Service] 指纹静默预补齐全分支单测全部通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runAgentSyncServiceTests();
}
