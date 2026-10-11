import * as vscode from "vscode";
import * as path from "node:path";
import { appEventBus } from "#src/application/eventBus";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { debugTraceBuffer } from "#src/application/debugTraceBuffer";
import {
	createNodeIdResolver,
	findNodeById,
	findNodeByLocation,
	type GraphSnapshot,
} from "#src/application/sceneGraphProjection";
import {
	buildGraphWebviewDocument,
	type GraphWebviewLabels,
} from "./graphWebviewDocument";
import {
	isGraphViewTab,
	isWebviewToHostMessage,
	type GraphViewTab,
	type HostToWebviewMessage,
} from "./graphMessageProtocol";
import {
	setSourceNavigationLock,
	isInternalOrVirtualFramePath,
} from "#src/application/debugPauseContext";

/**
 * 画布 Webview 生命周期与协议路由控制器 (Graph Canvas Controller, v1.3.0)
 * 职责：WebviewPanel 创建/销毁、postMessage 双向路由、应用事件订阅（随面板 dispose 成对退订）。
 * 快照与轨迹均不构成业务主状态 (INV-028)：面板隐藏销毁重建，重显时全量重发。
 */

const HIGHLIGHT_DURATION_MS = 800;

export interface GraphCanvasControllerOptions {
	readonly extensionUri: vscode.Uri;
	readonly labels: GraphWebviewLabels;
	/** 快照装配注入点（ui 装配层组装 sceneManager/sceneStateManager 分层合并视图；visibleScenes 为 Scope Selector 用户选择，缺省跟随激活集） */
	readonly loadSnapshot: (workspaceRoot: string, visibleScenes?: readonly string[]) => GraphSnapshot;
}

function createNonce(): string {
	let nonce = "";
	for (let i = 0; i < 16; i++) {
		nonce += Math.floor(Math.random() * 16).toString(16);
	}
	return nonce;
}

/**
 * 决定画布面板创建时的目标 ViewColumn（伴随模式 Companion Mode）：
 * 若当前有活动的文本编辑器，优先在 Beside（右侧分屏）打开，形成左侧代码 + 右侧架构拓扑的并排伴随视图；
 * 否则在当前活动的 ViewColumn.Active 打开。
 */
export function resolveCanvasColumn(activeEditorColumn?: vscode.ViewColumn): vscode.ViewColumn {
	if (activeEditorColumn !== undefined) {
		return vscode.ViewColumn.Beside;
	}
	return vscode.ViewColumn.Active;
}

/**
 * 决定节点跳转源码时的目标 ViewColumn（跨分屏防遮挡策略）：
 * 若画布面板当前处于右侧分屏（>= ViewColumn.Two），源码始终在 ViewColumn.One（左侧编辑区）打开并高亮；
 * 若画布面板处于 ViewColumn.One（主屏），源码在 ViewColumn.Beside（右侧分屏）打开；
 * 确保代码文件与画布永不共占同一编辑器组，彻底根除“点击跳转后画布被代码挤掉/覆盖”的割裂感。
 */
export function resolveTargetSourceColumn(panelColumn?: vscode.ViewColumn): vscode.ViewColumn {
	if (panelColumn === vscode.ViewColumn.One) {
		return vscode.ViewColumn.Beside;
	}
	return vscode.ViewColumn.One;
}

export class GraphCanvasController implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private snapshot: GraphSnapshot | undefined;
	private workspaceRoot = "";
	private currentTab: GraphViewTab = "flow";
	/** Scope Selector 用户选择（纯视图状态，不入业务主状态；undefined = 跟随激活集，随面板销毁重置） */
	private visibleScenes: readonly string[] | undefined;
	private readonly busDisposables: { dispose(): void }[] = [];
	private readonly panelDisposables: vscode.Disposable[] = [];
	private readonly highlightDecoration: vscode.TextEditorDecorationType;

	constructor(private readonly options: GraphCanvasControllerOptions) {
		this.highlightDecoration = vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
		});
	}

	/** 打开或聚焦画布（幂等：已开面板 reveal 并全量重发） */
	public show(workspaceRoot: string): void {
		this.workspaceRoot = workspaceRoot;
		if (this.panel) {
			this.panel.reveal();
			this.resendAll();
			return;
		}
		this.createPanel();
	}

	private createPanel(): void {
		const targetColumn = resolveCanvasColumn(vscode.window.activeTextEditor?.viewColumn);
		const panel = vscode.window.createWebviewPanel(
			"sceneBreakpointsGraphCanvas",
			this.options.labels.panelTitle,
			targetColumn,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(this.options.extensionUri, "media", "graph")],
			},
		);
		this.panel = panel;
		const snapshot = this.refreshSnapshot();
		panel.webview.html = this.buildHtml(panel.webview, snapshot);
		this.lastPanelVisible = panel.visible;
		this.panelDisposables.push(
			panel.webview.onDidReceiveMessage((msg) => this.handleWebviewMessage(msg)),
			panel.onDidChangeViewState((e) => {
				const isNowVisible = e.webviewPanel.visible;
				// 仅当面板从“完全隐藏（后台Tab）”重新切换到前台显示时才重发刷新；
				// 焦点在 Webview 与代码编辑器之间切换时（visible 均为 true），绝不重发，防止销毁 DOM 导致滚动条跳动
				if (!this.lastPanelVisible && isNowVisible) {
					this.resendAll();
				}
				this.lastPanelVisible = isNowVisible;
			}),
			panel.onDidDispose(() => this.handlePanelDisposed()),
		);
		this.subscribeBus();
	}

	private handlePanelDisposed(): void {
		// 事件订阅与面板生命周期成对退订（防 registerAllCommands 泄漏教训）
		for (const d of this.busDisposables) {
			d.dispose();
		}
		this.busDisposables.length = 0;
		this.panelDisposables.length = 0;
		this.panel = undefined;
		this.visibleScenes = undefined;
	}

	private debugStatus: "paused" | "running" | "terminated" = "terminated";
	private lastPanelVisible = true;

	private subscribeBus(): void {
		this.busDisposables.push(
			sceneStateManager.onDidChangeState(() => this.resendAll()),
			appEventBus.on("scenes:changed", () => this.resendAll()),
			appEventBus.on("scene:activated", () => this.resendAll()),
			appEventBus.on("breakpoints:changed", () => this.resendAll()),
			appEventBus.on("debug:started", () => {
				this.debugStatus = "running";
				this.post({ type: "trace-clear" });
				this.post({ type: "live-clear" });
				this.post({ type: "debug-status", status: "running" });
			}),
			appEventBus.on("debug:paused", ({ file, line }) => {
				this.debugStatus = "paused";
				this.handlePaused(file, line);
				this.post({ type: "debug-status", status: "paused" });
			}),
			appEventBus.on("debug:resumed", () => {
				this.debugStatus = "running";
				this.post({ type: "live-clear" });
				this.post({ type: "debug-status", status: "running" });
			}),
			appEventBus.on("debug:terminated", () => {
				this.debugStatus = "terminated";
				this.post({ type: "live-clear" });
				this.post({ type: "debug-status", status: "terminated" });
			}),
		);
	}

	/** 重建快照并刷新轨迹 nodeId 解析器（id 语义单点权威）；返回新快照供调用方窄化 */
	private refreshSnapshot(): GraphSnapshot {
		const snapshot = this.options.loadSnapshot(this.workspaceRoot, this.visibleScenes);
		this.snapshot = snapshot;
		debugTraceBuffer.setNodeIdResolver(createNodeIdResolver(snapshot));
		return snapshot;
	}

	/** 全量重发：render + 当前 tab + 轨迹回放（面板打开/重显/场景变更统一入口） */
	private resendAll(): void {
		if (!this.panel) return;
		const snapshot = this.refreshSnapshot();
		this.post({ type: "render", snapshot });
		this.post({ type: "view", tab: this.currentTab });
		this.post({ type: "trace-clear" });
		for (const record of debugTraceBuffer.getRecords()) {
			this.post({ type: "trace-append", record });
		}
		this.post({ type: "debug-status", status: this.debugStatus });
	}

	/** debug:paused 双消费：执行流脉冲 + 轨迹增量（轨迹记录由 debugTraceBuffer 先行累积） */
	private handlePaused(file: string, line: number): void {
		if (!this.panel) return;
		const nodeId = this.snapshot
			? (findNodeByLocation(this.snapshot, file, line)?.id ?? null)
			: null;
		if (nodeId) {
			this.post({ type: "live-pulse", nodeId });
		}
		const records = debugTraceBuffer.getRecords();
		const latest = records[records.length - 1];
		if (latest) {
			this.post({ type: "trace-append", record: latest });
		}
	}

	private handleWebviewMessage(msg: unknown): void {
		if (!isWebviewToHostMessage(msg)) return;
		switch (msg.type) {
			case "ready":
				this.resendAll();
				break;
			case "switch-tab":
				if (isGraphViewTab(msg.tab)) {
					this.currentTab = msg.tab;
				}
				break;
			case "open-source":
				void this.revealSource(msg.nodeId, msg.file, msg.line);
				break;
			case "set-scope":
				// Scope Selector：重建快照并全量重发（轨迹保留，nodeId 稳定）
				this.visibleScenes = msg.scenes;
				this.resendAll();
				break;
			case "export-mermaid":
				void vscode.commands.executeCommand("sceneBreakpoints.exportGraphMermaid");
				break;
			case "clear-trace":
				debugTraceBuffer.clear();
				this.post({ type: "trace-clear" });
				break;
			case "activate-scene":
				void vscode.commands.executeCommand("sceneBreakpoints.applyScene", [msg.sceneName]);
				break;
		}
	}

	/** 当前 Scope 选择（供导出命令对齐画布所见即所得；undefined = 跟随激活集） */
	public getVisibleScenes(): readonly string[] | undefined {
		return this.visibleScenes;
	}

	/** 获取当前激活的 WebviewPanel（供宿主生命周期检测与 E2E 测试断言） */
	public getPanel(): vscode.WebviewPanel | undefined {
		return this.panel;
	}

	/** 转发/处理 Webview 消息（供测试仿真上报与协议消费） */
	public dispatchWebviewMessage(msg: unknown): void {
		this.handleWebviewMessage(msg);
	}

	/** 点击节点直达源码：优先根据文件物理坐标定位，目标行视口居中 + 光标移入 + 整行高亮 */
	private async revealSource(nodeId?: string, file?: string, line?: number): Promise<void> {
		let targetFile = file;
		let targetLine = line;

		if ((!targetFile || !targetLine) && nodeId && this.snapshot) {
			const node = findNodeById(this.snapshot, nodeId);
			if (node && node.file && node.line && node.line > 0) {
				targetFile = node.file;
				targetLine = node.line;
			}
		}

		if (!targetFile || !targetLine || targetLine <= 0) return;
		if (isInternalOrVirtualFramePath(targetFile)) return;

		const absolute = path.isAbsolute(targetFile)
			? targetFile
			: path.join(this.workspaceRoot, targetFile);

		// 开启导航抑制锁，彻底切断编辑器光标移入引发的 checkEditor 误判回流
		setSourceNavigationLock(true, 400);

		try {
			const targetColumn = resolveTargetSourceColumn(this.panel?.viewColumn);
			const editor = await vscode.window.showTextDocument(vscode.Uri.file(absolute), {
				viewColumn: targetColumn,
				preserveFocus: true,
			});
			const targetPos = new vscode.Position(targetLine - 1, 0);
			const range = new vscode.Range(targetPos, targetPos);
			editor.selection = new vscode.Selection(targetPos, targetPos);
			// 视口外居中，若已在视口范围内则绝对静止，防抽搐跳动
			editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			editor.setDecorations(this.highlightDecoration, [range]);
			const timer = setTimeout(() => {
				editor.setDecorations(this.highlightDecoration, []);
			}, HIGHLIGHT_DURATION_MS);
			timer.unref?.();
		} catch {
			// 文件不存在或已被删除时安全兜底
		}
	}

	private buildHtml(webview: vscode.Webview, snapshot: GraphSnapshot): string {
		const base = vscode.Uri.joinPath(this.options.extensionUri, "media", "graph");
		return buildGraphWebviewDocument({
			cspSource: webview.cspSource,
			libUri: webview.asWebviewUri(vscode.Uri.joinPath(base, "g6-bundle.js")).toString(),
			runtimeUri: webview.asWebviewUri(vscode.Uri.joinPath(base, "graphWebview.js")).toString(),
			stylesUri: webview.asWebviewUri(vscode.Uri.joinPath(base, "graphWebview.css")).toString(),
			nonce: createNonce(),
			snapshot,
			records: debugTraceBuffer.getRecords(),
			initialTab: this.currentTab,
			labels: this.options.labels,
		});
	}

	private post(message: HostToWebviewMessage): void {
		if (!this.panel) return;
		void this.panel.webview.postMessage(message);
	}

	public dispose(): void {
		this.handlePanelDisposed();
	}
}
