import assert from "node:assert";
import * as vscode from "vscode";
import { __resetMockVscodeState, debug } from "#test/mocks/vscode.mock.mjs";
import {
	registerBreakpointSyncService,
	registerChatSkillService,
	registerConfigFileWatcherService,
	registerDebugLaunchService,
	registerDebugPauseService,
	registerSessionLifecycleService,
	registerTreeInteractionService,
} from "#src/infra/vscode/listeners/index";
import { sceneStateManager } from "#src/domain/sceneStateManager";
import { SceneTreeDataProvider, SceneNode } from "#src/infra/vscode/sceneTreeProvider";

export async function runListenersRegistryTests() {
	console.log("  ▶ [Listeners Registry] 运行 5 大核心事件监听与生命周期协同单元测试（真实源码）...");

	__resetMockVscodeState();
	const mockTreeDataProvider = new SceneTreeDataProvider();

	// 1. registerBreakpointSyncService 生命周期与断点清空分支
	{
		sceneStateManager.setApplyingState(false);
		sceneStateManager.setActiveScenes(["test-scene"]);
		const syncDisposable = registerBreakpointSyncService(mockTreeDataProvider);
		assert.ok(syncDisposable && typeof syncDisposable.dispose === "function", "必须返回合法 Disposable");

		// 模拟编辑器断点数归零 -> 触发状态机激活清空 (使用 length = 0 保持引用一致)
		vscode.debug.breakpoints.length = 0;
		vscode.debug.fireDidChangeBreakpoints({ added: [], removed: [], changed: [] });

		// 等待异步事件回调完成
		await new Promise((resolve) => setTimeout(resolve, 20));

		assert.strictEqual(
			sceneStateManager.getActiveScene(),
			undefined,
			"断点清空时状态机激活态必须安全同步复位",
		);

		syncDisposable.dispose();
	}

	// 2. registerChatSkillService 容错与 Disposable 契约
	{
		const mockContext = {
			extensionUri: vscode.Uri.file("/mock/extension"),
			subscriptions: [],
		};
		const chatDisposable = registerChatSkillService(mockContext);
		assert.ok(chatDisposable && typeof chatDisposable.dispose === "function");
		chatDisposable.dispose();
	}

	// 3. registerConfigFileWatcherService 文件系统监听器创建
	{
		const watcherDisposable = registerConfigFileWatcherService(mockTreeDataProvider);
		assert.ok(watcherDisposable && typeof watcherDisposable.dispose === "function");
		watcherDisposable.dispose();
	}

	// 4. registerDebugLaunchService 启动推导 Provider 注入
	{
		const launchDisposable = registerDebugLaunchService();
		assert.ok(launchDisposable && typeof launchDisposable.dispose === "function");
		launchDisposable.dispose();
	}

	// 5. registerSessionLifecycleService 调试会话终止清空拓扑哈希
	{
		sceneStateManager.setLastAppliedTopologyHash("hash-abc-123");
		assert.strictEqual(sceneStateManager.getLastAppliedTopologyHash(), "hash-abc-123");

		const sessionDisposable = registerSessionLifecycleService();
		assert.ok(sessionDisposable && typeof sessionDisposable.dispose === "function");

		// 触发调试终止事件
		vscode.debug.fireDidTerminateDebugSession({ name: "Run Debug", type: "node" });
		assert.strictEqual(
			sceneStateManager.getLastAppliedTopologyHash(),
			"",
			"调试会话终止必须清空最后装配的拓扑指纹快照",
		);

		sessionDisposable.dispose();
	}

	// 6. registerTreeInteractionService 折叠记忆与状态订阅
	{
		const mockTreeView = {
			onDidExpandElement: (cb) => {
				mockTreeView._expandCb = cb;
				return { dispose: () => {} };
			},
			onDidCollapseElement: (cb) => {
				mockTreeView._collapseCb = cb;
				return { dispose: () => {} };
			},
			onDidChangeCheckboxState: () => ({ dispose: () => {} }),
		};

		const treeInteractionDisposable = registerTreeInteractionService(mockTreeView, mockTreeDataProvider);
		assert.ok(treeInteractionDisposable && typeof treeInteractionDisposable.dispose === "function");

		// 模拟手动展开与折叠场景节点
		const dummyNode = new SceneNode("auth-login", []);
		mockTreeView._expandCb({ element: dummyNode });
		assert.ok(SceneNode.expandedScenes.has("auth-login"), "展开事件必须记录到 expandedScenes 集合");

		treeInteractionDisposable.dispose();
	}

	// 7. registerDebugPauseService 多线程 (WorkerThread) DAP continued 隔离防误杀
	{
		__resetMockVscodeState();
		const customTreeProvider = new SceneTreeDataProvider();
		const mockTreeView = {
			reveal: async () => {},
		};

		const pauseDisposable = registerDebugPauseService(mockTreeView, customTreeProvider);
		assert.ok(debug._trackerFactories.length > 0, "必须注册 DebugAdapterTrackerFactory");
		const factory = debug._trackerFactories[0];
		const tracker = factory.createDebugAdapterTracker({});

		// 步骤 A: 主会话主线程 (Thread 1) 命中断点 (stopped)，随后 stackTrace 响应到达
		tracker.onDidSendMessage({
			type: "event",
			event: "stopped",
			body: { reason: "breakpoint", threadId: 1 },
		});
		tracker.onDidSendMessage({
			type: "response",
			command: "stackTrace",
			body: {
				stackFrames: [{ source: { path: "D:/repo/src/cli.ts" }, line: 20 }],
			},
		});

		assert.deepStrictEqual(
			customTreeProvider.getPausedLocation(),
			{ file: "D:/repo/src/cli.ts", line: 20 },
			"收到 stackTrace 响应后必须立即设置暂停高亮位置",
		);

		// 步骤 B1: 独立的后台 Worker 会话 (未处于 stopped 状态) 收到后台 stackTrace 响应
		const trackerWorker = factory.createDebugAdapterTracker({ id: "worker-session" });
		trackerWorker.onDidSendMessage({
			type: "response",
			command: "stackTrace",
			body: {
				stackFrames: [{ source: { path: "<node_internals>/internal/worker.js" }, line: 50 }],
			},
		});

		assert.deepStrictEqual(
			customTreeProvider.getPausedLocation(),
			{ file: "D:/repo/src/cli.ts", line: 20 },
			"后台运行中的 Worker 会话 stackTrace 响应绝不可冲刷主线程断点高亮！",
		);

		// 步骤 B2: 子工作线程 (Worker Thread 2) 产生 continued 事件 (allThreadsContinued: false)
		tracker.onDidSendMessage({
			type: "event",
			event: "continued",
			body: { threadId: 2, allThreadsContinued: false },
		});

		assert.deepStrictEqual(
			customTreeProvider.getPausedLocation(),
			{ file: "D:/repo/src/cli.ts", line: 20 },
			"后台 Worker 线程的 continued 事件绝不可清除主线程断点高亮！",
		);

		// 步骤 C: 主线程 (Thread 1) 真正继续运行 (continued)
		tracker.onDidSendMessage({
			type: "event",
			event: "continued",
			body: { threadId: 1 },
		});

		assert.strictEqual(
			customTreeProvider.getPausedLocation(),
			null,
			"主线程继续运行时必须精确清空高亮",
		);

		pauseDisposable.dispose();
	}

	console.log("  ✅ [Listeners Registry] 5 大核心事件监听与生命周期单元测试全部通过！");
}
