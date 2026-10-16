import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
	GraphCanvasController,
	resolveCanvasColumn,
	resolveTargetSourceColumn,
} from "#src/ui/views/graphCanvas/graphCanvasController";
import { appEventBus } from "#src/application/eventBus";
import { debugTraceBuffer } from "#src/application/debugTraceBuffer";

export async function runGraphCanvasControllerTests() {
	console.log("  ▶ [GraphCanvasController] 运行画布控制器单元测试套件...");

	const LABELS = {
		panelTitle: "Scene Graph",
		tabFlow: "Flow",
		tabTrace: "Trace",
		exportButton: "Export Mermaid",
		flowEmpty: "No active scenes.",
		traceEmpty: "No trace records.",
		scopeLabel: "Scene Scope",
		sceneInactive: "Not Active",
		laneCircular: "Circular scene reference",
	};

	function createSnapshotFixture() {
		return {
			workspaceRoot: "/ws",
			activeScenes: ["auth-flow"],
			lanes: [
				{
					id: "scene:auth-flow",
					sceneName: "auth-flow",
					layer: "team",
					nodes: [
						{
							id: "auth-flow#0",
							kind: "breakpoint",
							ownerScene: "auth-flow",
							refPath: ["auth-flow"],
							file: "src/auth/login.ts",
							line: 10,
							bpType: "line",
							enabled: true,
							status: "idle",
						},
					],
				},
			],
			warnings: [],
		};
	}

	function createController(loadSnapshot = () => createSnapshotFixture()) {
		return new GraphCanvasController({
			extensionUri: vscode.Uri.file("/ext"),
			labels: LABELS,
			loadSnapshot,
		});
	}

	function postedMessages() {
		const panel = vscode.window._lastWebviewPanel;
		return panel ? panel.webview._postedMessages : [];
	}

	async function settle() {
		await new Promise((resolve) => setImmediate(resolve));
	}

	function resetPanelState() {
		vscode.window._webviewPanels.length = 0;
		vscode.window._lastWebviewPanel = undefined;
		vscode.window._lastTextEditor = undefined;
	}

	// 1. showInEditor 创建面板：viewType/标题/localResourceRoots 锁定 media/graph，HTML 含本地脚本与 payload
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();
		controller.showInEditor("/ws");

		const panel = vscode.window._lastWebviewPanel;
		assert.ok(panel, "showInEditor 必须创建 WebviewPanel");
		assert.strictEqual(panel.viewType, "sceneBreakpointsGraphCanvas");
		assert.strictEqual(panel.title, "Scene Graph");
		assert.strictEqual(panel.options.localResourceRoots.length, 1);
		assert.match(panel.options.localResourceRoots[0].fsPath, /media[\\/]graph$/);
		assert.match(panel.webview.html, /Content-Security-Policy/);
		assert.match(panel.webview.html, /id="sb-payload"/);
		assert.match(panel.webview.html, /graphWebview\.js/);

		controller.dispose();
		appEventBus.clear();
	}

	// 2. ready 后全量重发：render → view → trace-clear（+轨迹回放）
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		debugTraceBuffer.append("/ws/src/auth/login.ts", 10);
		const controller = createController();
		controller.showInEditor("/ws");
		assert.strictEqual(postedMessages().length, 0, "ready 前不得提前 postMessage");

		panelFireReady();
		const messages = postedMessages();
		assert.strictEqual(messages[0].type, "render");
		assert.strictEqual(messages[0].snapshot.lanes[0].sceneName, "auth-flow");
		assert.strictEqual(messages[1].type, "view");
		assert.strictEqual(messages[1].tab, "flow");
		assert.strictEqual(messages[2].type, "trace-clear");
		const append = messages.find((m) => m.type === "trace-append");
		assert.ok(append, "存量轨迹必须全量回放");
		assert.strictEqual(append.record.file, "/ws/src/auth/login.ts");

		controller.dispose();
		debugTraceBuffer.clear();
		appEventBus.clear();
	}

	function panelFireReady() {
		vscode.window._lastWebviewPanel._fireMessage({ type: "ready" });
	}

	// 3. debug:paused 双消费：live-pulse（快照位置匹配）+ trace-append（buffer 末条）
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();
		controller.showInEditor("/ws");
		panelFireReady();

		debugTraceBuffer.append("/ws/src/auth/login.ts", 10);
		appEventBus.emit("debug:paused", { file: "/ws/src/auth/login.ts", line: 10 });

		const messages = postedMessages();
		const pulse = messages.find((m) => m.type === "live-pulse");
		const traceAppend = messages.filter((m) => m.type === "trace-append");
		assert.ok(pulse, "命中快照节点必须发 live-pulse");
		assert.strictEqual(pulse.nodeId, "auth-flow#0", "nodeId 由快照解析器派生");
		assert.strictEqual(traceAppend.length, 1, "暂停只增量追加末条轨迹");
		assert.strictEqual(traceAppend[0].record.nodeId, "auth-flow#0");

		// 面板未开时暂停静默
		controller.dispose();
		const before = postedMessages().length;
		appEventBus.emit("debug:paused", { file: "/ws/src/auth/login.ts", line: 10 });
		assert.strictEqual(postedMessages().length, before, "dispose 后暂停不得再发消息");

		debugTraceBuffer.clear();
		appEventBus.clear();
	}

	// 4. debug:resumed → live-clear；debug:terminated → debug-status: terminated (保留轨迹供复盘)
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();
		controller.showInEditor("/ws");
		panelFireReady();

		appEventBus.emit("debug:resumed", undefined);
		assert.ok(postedMessages().some((m) => m.type === "live-clear"));

		appEventBus.emit("debug:terminated", undefined);
		assert.ok(
			postedMessages().some((m) => m.type === "debug-status" && m.status === "terminated"),
			"会话终止下发 terminated 状态且不清除轨迹",
		);

		controller.dispose();
		appEventBus.clear();
	}

	// 5. switch-tab：合法 tab 记忆并在重发时生效；非法 tab 忽略
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();
		controller.showInEditor("/ws");
		const panel = vscode.window._lastWebviewPanel;

		panel._fireMessage({ type: "switch-tab", tab: "trace" });
		panel._fireMessage({ type: "ready" });
		assert.ok(postedMessages().some((m) => m.type === "view" && m.tab === "trace"));

		panel._fireMessage({ type: "switch-tab", tab: "bogus" });
		panel._fireMessage({ type: "ready" });
		assert.ok(
			postedMessages().some((m) => m.type === "view" && m.tab === "trace"),
			"非法 tab 不得污染当前视图状态",
		);

		controller.dispose();
		appEventBus.clear();
	}

	// 6. open-source：直达源码 + 视口居中 + 装饰高亮；未知节点零动作
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();
		controller.showInEditor("/ws");
		const panel = vscode.window._lastWebviewPanel;

		panel._fireMessage({ type: "open-source", nodeId: "auth-flow#0" });
		await settle();

		const editor = vscode.window._lastTextEditor;
		assert.ok(editor, "必须打开源码编辑器");
		assert.match(editor.document.uri.fsPath, /src[\\/]auth[\\/]login\.ts$/);
		assert.strictEqual(editor._revealCalls.length, 1);
		assert.strictEqual(editor._revealCalls[0].revealType, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		assert.strictEqual(editor._decorationCalls.length, 1, "命中行一次性高亮");

		const editorBefore = vscode.window._lastTextEditor;
		panel._fireMessage({ type: "open-source", nodeId: "nonexistent#99" });
		await settle();
		assert.strictEqual(
			vscode.window._lastTextEditor,
			editorBefore,
			"未知节点不得打开编辑器",
		);

		controller.dispose();
		appEventBus.clear();
	}

	// 7. export-mermaid：画布导出按钮转发至导出命令
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();
		controller.showInEditor("/ws");
		const panel = vscode.window._lastWebviewPanel;

		let exportCommandInvoked = false;
		const registered = vscode.commands.registerCommand(
			"sceneBreakpoints.exportGraphMermaid",
			() => {
				exportCommandInvoked = true;
			},
		);
		panel._fireMessage({ type: "export-mermaid" });
		await settle();
		assert.ok(exportCommandInvoked, "export-mermaid 必须转发导出命令");
		registered.dispose();

		controller.dispose();
		appEventBus.clear();
	}

	// 8. 幂等 show 与场景事件重发：已开面板 reveal + 全量重发，场景变更触发 render
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();
		controller.showInEditor("/ws");
		panelFireReady();
		const countAfterReady = postedMessages().length;

		controller.showInEditor("/ws");
		assert.strictEqual(vscode.window._webviewPanels.length, 1, "幂等 show 不得重复建面板");
		assert.ok(postedMessages().length > countAfterReady, "重显必须全量重发");

		appEventBus.emit("breakpoints:changed", { workspaceRoot: "/ws" });
		const lastRender = [...postedMessages()].reverse().find((m) => m.type === "render");
		assert.ok(lastRender, "断点变更必须触发快照重发");

		controller.dispose();
		appEventBus.clear();
	}

	// 9. 面板 dispose（用户关闭）：总线订阅成对退订，重开重建
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();
		controller.showInEditor("/ws");
		panelFireReady();
		const panel = vscode.window._lastWebviewPanel;

		panel.dispose(); // 模拟用户关闭面板
		const before = postedMessages().length;
		appEventBus.emit("debug:paused", { file: "/ws/src/auth/login.ts", line: 10 });
		appEventBus.emit("breakpoints:changed", { workspaceRoot: "/ws" });
		assert.strictEqual(postedMessages().length, before, "面板关闭后订阅必须成对退订");

		controller.showInEditor("/ws");
		assert.strictEqual(vscode.window._webviewPanels.length, 2, "重开必须重建面板");
		const newPanel = vscode.window._lastWebviewPanel;
		assert.notStrictEqual(newPanel, panel);
		newPanel._fireMessage({ type: "ready" });
		assert.ok(postedMessages().some((m) => m.type === "render"), "新面板 ready 后正常重发");

		controller.dispose();
		appEventBus.clear();
	}

	// 10. 面板隐藏后重显（onDidChangeViewState visible）：隐藏切回前台必须全量重发，纯焦点切换 (true -> true) 绝不重发
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();
		controller.showInEditor("/ws");
		panelFireReady();
		const countAfterReady = postedMessages().length;

		const panel = vscode.window._lastWebviewPanel;
		// A. 纯焦点切换或失焦（visible 仍为 true）-> 绝不可触发全量重发，防止销毁 DOM 导致滚动条跳动
		panel._fireViewState(true);
		assert.strictEqual(postedMessages().length, countAfterReady, "纯焦点切换不得触发重发");

		// B. 从隐藏 (false) 切回可见 (true) -> 必须全量重发同步
		panel._fireViewState(false);
		panel._fireViewState(true);
		assert.ok(postedMessages().length > countAfterReady, "隐藏后重显必须全量重发");

		controller.dispose();
		appEventBus.clear();
	}

	// 11. set-scope：用户选择注入 loadSnapshot 并全量重发；选择跨重发保持
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const loadCalls = [];
		const controller = createController((root, scenes) => {
			loadCalls.push({ root, scenes });
			return createSnapshotFixture();
		});
		controller.showInEditor("/ws");
		const panel = vscode.window._lastWebviewPanel;
		panel._fireMessage({ type: "set-scope", scenes: ["s-a", "s-b"] });
		await settle();

		const scopeCall = loadCalls[loadCalls.length - 1];
		assert.deepStrictEqual(scopeCall.scenes, ["s-a", "s-b"], "用户 scope 选择必须透传 loadSnapshot");
		assert.ok(
			postedMessages().some((m) => m.type === "render"),
			"set-scope 必须触发快照全量重发",
		);
		assert.deepStrictEqual(
			controller.getVisibleScenes(),
			["s-a", "s-b"],
			"getVisibleScenes 必须暴露当前 scope（导出对齐所见即所得）",
		);

		// 场景变更重发时 scope 保持（panel 生命周期内不丢）
		const countBefore = loadCalls.length;
		appEventBus.emit("breakpoints:changed", { workspaceRoot: "/ws" });
		assert.strictEqual(loadCalls.length, countBefore + 1);
		assert.deepStrictEqual(loadCalls[loadCalls.length - 1].scenes, ["s-a", "s-b"], "重发必须沿用用户 scope");

		controller.dispose();
		appEventBus.clear();
	}

	// 12. set-scope 非法消息：守卫拦截，loadSnapshot 零调用
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		let loadCount = 0;
		const controller = createController(() => {
			loadCount++;
			return createSnapshotFixture();
		});
		controller.showInEditor("/ws");
		panelFireReady();
		const baseline = loadCount;
		const panel = vscode.window._lastWebviewPanel;

		panel._fireMessage({ type: "set-scope" });
		panel._fireMessage({ type: "set-scope", scenes: "bogus" });
		panel._fireMessage({ type: "set-scope", scenes: ["a", 42] });
		await settle();
		assert.strictEqual(loadCount, baseline, "非法 set-scope 不得触发快照重建");
		assert.strictEqual(controller.getVisibleScenes(), undefined, "非法 set-scope 不得污染视图状态");

		controller.dispose();
		appEventBus.clear();
	}

	// 13. 面板关闭重开：scope 视图状态随面板销毁重置（回归跟随激活集）
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const loadCalls = [];
		const controller = createController((root, scenes) => {
			loadCalls.push({ root, scenes });
			return createSnapshotFixture();
		});
		controller.showInEditor("/ws");
		const panel = vscode.window._lastWebviewPanel;
		panel._fireMessage({ type: "set-scope", scenes: ["s-x"] });
		panel.dispose();

		controller.showInEditor("/ws");
		const newPanel = vscode.window._lastWebviewPanel;
		newPanel._fireMessage({ type: "ready" });
		const lastCall = loadCalls[loadCalls.length - 1];
		assert.strictEqual(
			lastCall.scenes,
			undefined,
			"面板关闭重开后 scope 必须重置为跟随激活集",
		);

		controller.dispose();
		appEventBus.clear();
	}

	// 14. 伴随分屏策略：resolveCanvasColumn 与 resolveTargetSourceColumn 智能调度
	{
		// 画布打开位置判定
		assert.strictEqual(
			resolveCanvasColumn(vscode.ViewColumn.One),
			vscode.ViewColumn.Beside,
			"主屏有代码编辑器时，画布优先在右侧分屏 Beside 打开",
		);
		assert.strictEqual(
			resolveCanvasColumn(undefined),
			vscode.ViewColumn.Active,
			"无活动编辑器时，画布在 Active 打开",
		);

		// 跳转代码位置判定（防遮挡）
		assert.strictEqual(
			resolveTargetSourceColumn(vscode.ViewColumn.One),
			vscode.ViewColumn.Beside,
			"画布处于主屏时，源码跳转至 Beside 打开以防覆盖画布",
		);
		assert.strictEqual(
			resolveTargetSourceColumn(vscode.ViewColumn.Two),
			vscode.ViewColumn.One,
			"画布处于右侧分屏时，源码跳转至主屏 ViewColumn.One 打开",
		);
		assert.strictEqual(
			resolveTargetSourceColumn(vscode.ViewColumn.Three),
			vscode.ViewColumn.One,
			"画布处于第三方分屏时，源码依然优先跳转至左侧主屏打开",
		);
	}

	// 14. WebviewViewProvider 副侧边栏伴随模式测试 (v1.4.0)
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();
		const mockView = vscode.window.createMockWebviewView();

		controller.resolveWebviewView(mockView, {}, {});
		assert.strictEqual(controller.getWebviewView(), mockView, "resolveWebviewView 必须挂载当前 webviewView");
		assert.match(mockView.webview.html, /id="sb-payload"/, "WebviewView 必须渲染 payload HTML");

		// 测试 show 优先聚焦副侧边栏，0 Tab 挤占
		let showCalled = false;
		mockView.show = (preserveFocus) => {
			showCalled = true;
		};
		await controller.show("/ws");
		assert.strictEqual(showCalled, true, "show 必须优先展示已挂载的 WebviewView");
		assert.strictEqual(controller.getPanel(), undefined, "show 在 WebviewView 存在时绝不创建 WebviewPanel");

		// 测试事件总线分发至 WebviewView
		appEventBus.emit("debug:paused", { file: "src/auth/login.ts", line: 10 });
		await settle();
		const pulseMsg = mockView.webview._postedMessages.find((m) => m.type === "live-pulse");
		assert.ok(pulseMsg, "WebviewView 必须收到 live-pulse 消息");
		assert.strictEqual(pulseMsg.nodeId, "auth-flow#0");

		// 测试可见性重显触发全量数据重发
		mockView.webview._postedMessages.length = 0;
		mockView._fireVisibility(true);
		assert.ok(mockView.webview._postedMessages.some((m) => m.type === "render"), "WebviewView 变为可见必须触发 render 重发");

		// 测试 WebviewView 模式下点击跳转源码定向至 ViewColumn.One
		vscode.window._lastTextEditor = undefined;
		mockView._fireMessage({ type: "open-source", nodeId: "auth-flow#0", file: "src/auth/login.ts", line: 10 });
		await settle();
		assert.ok(vscode.window._lastTextEditor, "点击节点必须打开文本编辑器");
		assert.strictEqual(vscode.window._lastTextEditor.viewColumn, vscode.ViewColumn.One, "副侧边栏模式跳转源码必须在 ViewColumn.One 主屏打开，绝不遮挡副侧边栏");

		// 测试全屏打开逃生门 (showInEditor)
		controller.showInEditor("/ws");
		const panel = controller.getPanel();
		assert.ok(panel, "showInEditor 必须成功创建全屏 WebviewPanel");

		// 测试双宿主同时接收 debug-status
		appEventBus.emit("debug:resumed");
		await settle();
		assert.ok(mockView.webview._postedMessages.some((m) => m.type === "debug-status" && m.status === "running"));
		assert.ok(panel.webview._postedMessages.some((m) => m.type === "debug-status" && m.status === "running"));

		// 测试清理
		panel.dispose();
		mockView.dispose();
		controller.dispose();
		appEventBus.clear();
	}

	// 15. 当 WebviewView 尚未挂载时，show 仅触发 focus 视图命令，坚决不降级弹出 WebviewPanel
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		const controller = createController();

		let executedCommand = null;
		const registered = vscode.commands.registerCommand("sceneBreakpointsGraphView.focus", () => {
			executedCommand = "sceneBreakpointsGraphView.focus";
		});

		await controller.show("/ws");
		assert.strictEqual(executedCommand, "sceneBreakpointsGraphView.focus", "show 必须触发 sceneBreakpointsGraphView.focus 唤醒副侧边栏");
		assert.strictEqual(vscode.window._lastWebviewPanel, undefined, "show 绝对不可创建 WebviewPanel 弹 Tab");
		assert.strictEqual(controller.getPanel(), undefined, "show 绝对不可挂载 panel");

		registered.dispose();
		controller.dispose();
		appEventBus.clear();
	}

	// 16. resolveWebviewView 自动兜底当前打开的 workspaceFolders，确保初次挂载即刻带工作区根加载场景快照
	{
		appEventBus.clear();
		debugTraceBuffer.clear();
		resetPanelState();
		let loadedRoot = null;
		const controller = createController((root) => {
			loadedRoot = root;
			return createSnapshotFixture();
		});

		// 模拟 VS Code 已打开项目工作区
		vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file("/my/project") }];
		const mockView = vscode.window.createMockWebviewView();
		controller.resolveWebviewView(mockView, {}, {});

		assert.strictEqual(loadedRoot, "/my/project", "resolveWebviewView 必须自动从 workspaceFolders 提取默认根目录并传给 loadSnapshot");

		// 测试 resendAll 外部刷新广播
		loadedRoot = null;
		controller.resendAll();
		assert.strictEqual(loadedRoot, "/my/project", "resendAll 刷新必须沿用已解析的工作区根");

		mockView.dispose();
		controller.dispose();
		vscode.workspace.workspaceFolders.length = 0;
		appEventBus.clear();
	}

	// 收尾：清理单例解析器残留，避免污染后续套件
	debugTraceBuffer.setNodeIdResolver(null);
	debugTraceBuffer.clear();

	console.log("  ✅ [GraphCanvasController] 画布控制器测试全部通过！");
}
