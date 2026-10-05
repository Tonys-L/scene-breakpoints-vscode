import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState, debug } from "#test/mocks/vscode.mock.mjs";
import {
	registerBreakpointSyncService,
	registerChatSkillService,
	registerConfigFileWatcherService,
	registerDebugLaunchService,
	registerDebugPauseService,
	registerSessionLifecycleService,
} from "#src/infra/vscode/listeners/index";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { dapEchoGuard } from "#src/infra/vscode/dapEchoGuard";
import { SceneTreeDataProvider, SceneNode, registerTreeInteractionService } from "#src/ui/views/sceneTreeProvider";

export async function runListenersRegistryTests() {
	console.log("  ▶ [Listeners Registry] 运行 5 大核心事件监听与生命周期协同单元测试（真实源码）...");

	__resetMockVscodeState();
	dapEchoGuard.reset();
	const mockTreeDataProvider = new SceneTreeDataProvider();

	// 1. registerBreakpointSyncService 生命周期、断点清空与反向同步分支
	{
		sceneStateManager.setApplyingState(false);
		sceneStateManager.setActiveScenes(["test-scene"]);
		const syncDisposable = registerBreakpointSyncService();
		assert.ok(syncDisposable && typeof syncDisposable.dispose === "function", "必须返回合法 Disposable");

		// A. 模拟编辑器断点数归零 -> 触发状态机激活清空 (使用 length = 0 保持引用一致)
		vscode.debug.breakpoints.length = 0;
		vscode.debug.fireDidChangeBreakpoints({ added: [], removed: [], changed: [] });

		// 等待异步事件回调完成
		await new Promise((resolve) => setTimeout(resolve, 20));

		assert.strictEqual(
			sceneStateManager.getActiveScene(),
			undefined,
			"断点清空时状态机激活态必须安全同步复位",
		);

		// B. 模拟编辑器断点属性变动 (changed) -> 触发反向同步
		const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sync-test-"));
		vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpWs } }];
		const { saveScenesConfig } = await import("#src/infra/storage/jsonFileSceneRepository");
		saveScenesConfig(tmpWs, {
			scenes: {
				"auth-sync": [
					{ file: "src/auth.ts", line: 10, type: "line", enabled: true },
				],
			},
			activeScenes: ["auth-sync"],
		});
		sceneStateManager.setActiveScenes(["auth-sync"], 1);

		const fakeBp = {
			location: {
				uri: { fsPath: path.join(tmpWs, "src/auth.ts") },
				range: { start: { line: 9 } },
			},
			enabled: false,
		};
		vscode.debug.breakpoints.push(fakeBp);
		vscode.debug.fireDidChangeBreakpoints({ added: [], removed: [], changed: [fakeBp] });
		await new Promise((resolve) => setTimeout(resolve, 30));

		syncDisposable.dispose();
		fs.rmSync(tmpWs, { recursive: true, force: true });
	}

	// 2. registerChatSkillService 容错与 Disposable 契约
	{
		const mockContext = {
			extensionUri: vscode.Uri.file("/mock/extension"),
			subscriptions: [],
		};
		// A. 宿主无 chat API
		const chatDisposable = registerChatSkillService(mockContext);
		assert.ok(chatDisposable && typeof chatDisposable.dispose === "function");
		chatDisposable.dispose();

		// B. 宿主支持实验性 chat.registerSkillProvider
		let provided = [];
		vscode.chat.registerSkillProvider = (provider) => {
			provided = provider.provideSkills();
			return { dispose() {} };
		};
		const chatDisposable2 = registerChatSkillService(mockContext);
		assert.strictEqual(provided.length, 1);
		assert.ok(provided[0].uri.fsPath.includes("SKILL.md"));
		chatDisposable2.dispose();
		vscode.chat.registerSkillProvider = undefined;
	}

	// 3. registerConfigFileWatcherService 文件系统监听器与外部变更调度
	{
		const watcherDisposable = registerConfigFileWatcherService();
		assert.ok(watcherDisposable && typeof watcherDisposable.dispose === "function");

		// 触发 watcher 的各类事件回调
		if (vscode.workspace._lastWatcher) {
			for (const cb of vscode.workspace._lastWatcher._createCbs) cb();
			for (const cb of vscode.workspace._lastWatcher._deleteCbs) cb();
			for (const cb of vscode.workspace._lastWatcher._changeCbs) {
				cb(vscode.Uri.file("/fake/debug-scenes.json"));
			}
		}

		// 直接触发外部场景变更调度器
		const { handleExternalScenesFileChange } = await import("#src/infra/vscode/listeners/configFileWatcherListener");
		const tmpWs2 = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ext-test-"));
		vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpWs2 } }];
		await handleExternalScenesFileChange(tmpWs2);
		fs.rmSync(tmpWs2, { recursive: true, force: true });

		watcherDisposable.dispose();
	}

	// 4. registerDebugLaunchService 启动推导 Provider 注入与执行
	{
		const launchDisposable = registerDebugLaunchService();
		assert.ok(launchDisposable && typeof launchDisposable.dispose === "function");

		// 执行 registered provider
		if (vscode.debug._configProviders.length > 0) {
			const provider = vscode.debug._configProviders[0];
			const res = await provider.resolveDebugConfiguration(undefined, {
				name: "Launch Node",
				type: "node",
				request: "launch",
			});
			assert.ok(res, "必须返回 debug configuration");
		}

		launchDisposable.dispose();
	}

	// 5. registerSessionLifecycleService 调试会话终止清空拓扑哈希与补发
	{
		sceneStateManager.setLastAppliedTopologyHash("hash-abc-123");
		sceneStateManager.setPendingTopologyUpdate(true);
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

	// 6. registerTreeInteractionService 折叠记忆、复选框点击与状态订阅
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
			onDidChangeCheckboxState: (cb) => {
				mockTreeView._checkboxCb = cb;
				return { dispose: () => {} };
			},
		};

		const treeInteractionDisposable = registerTreeInteractionService(mockTreeView, mockTreeDataProvider);
		assert.ok(treeInteractionDisposable && typeof treeInteractionDisposable.dispose === "function");

		// 模拟手动展开与折叠场景节点
		const dummyNode = new SceneNode("auth-login", []);
		mockTreeView._expandCb({ element: dummyNode });
		assert.ok(SceneNode.expandedScenes.has("auth-login"), "展开事件必须记录到 expandedScenes 集合");
		mockTreeView._collapseCb({ element: dummyNode });
		assert.ok(!SceneNode.expandedScenes.has("auth-login"), "折叠事件必须移出 expandedScenes 集合");

		// 模拟原生复选框点击
		const tmpWs3 = fs.mkdtempSync(path.join(os.tmpdir(), "sb-checkbox-test-"));
		vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpWs3 } }];
		const { saveScenesConfig } = await import("#src/infra/storage/jsonFileSceneRepository");
		saveScenesConfig(tmpWs3, {
			scenes: {
				"check-flow": [
					{ file: "src/main.ts", line: 15, type: "line", enabled: true },
				],
			},
		});
		const { BreakpointNode } = await import("#src/ui/views/sceneTreeProvider");
		const bpNode = new BreakpointNode("check-flow", 0, { file: "src/main.ts", line: 15, type: "line", enabled: true }, tmpWs3, tmpWs3);
		if (mockTreeView._checkboxCb) {
			await mockTreeView._checkboxCb({
				items: [[bpNode, vscode.TreeItemCheckboxState.Unchecked]],
			});
		}
		fs.rmSync(tmpWs3, { recursive: true, force: true });

		treeInteractionDisposable.dispose();

		// 直接通过 SceneTreeDataProvider.bindView 绑定 TreeView 契约验证
		const directBindViewDisposable = mockTreeDataProvider.bindView(mockTreeView);
		assert.ok(directBindViewDisposable && typeof directBindViewDisposable.dispose === "function", "SceneTreeDataProvider.bindView 必须返回合法 Disposable");
		directBindViewDisposable.dispose();
	}

	// 7. registerDebugPauseService 多线程 (WorkerThread) DAP continued 隔离防误杀
	{
		__resetMockVscodeState();
		const customTreeProvider = new SceneTreeDataProvider();
		const mockTreeView = {
			reveal: async () => {},
		};

		const pauseDisposable = registerDebugPauseService();
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
				stackFrames: [{ source: { path: "X:/mock-workspace/project/src/cli.ts" }, line: 20 }],
			},
		});

		assert.deepStrictEqual(
			customTreeProvider.getPausedLocation(),
			{ file: "X:/mock-workspace/project/src/cli.ts", line: 20 },
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
			{ file: "X:/mock-workspace/project/src/cli.ts", line: 20 },
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
			{ file: "X:/mock-workspace/project/src/cli.ts", line: 20 },
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

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runListenersRegistryTests();
}

