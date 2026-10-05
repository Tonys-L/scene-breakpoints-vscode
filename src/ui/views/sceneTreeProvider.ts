import * as vscode from "vscode";
import { getWorkspaceRoot } from "#src/ui/utils/commandRunner";
import { sceneManager, breakpointManager, appEventBus, activeBreakpointIndex } from "#src/application";

import { sceneStateManager } from "#src/application/sceneStateManager";
import { BreakpointNode, PlaceholderNode, SceneNode, treeViewState, type SceneTreeItem } from "./treeNodes";

// 重新导出节点类型，保证下游与现有单测 100% 零破坏兼容
export * from "./treeNodes";

/**
 * 侧边栏场景断点树视图数据提供者与拖拽控制器 (SceneTreeDataProvider)
 * 职责：负责树视图数据的装载检索、拖拽排序 (D&D) 与调试命中自动展开高亮
 */
export class SceneTreeDataProvider
	implements vscode.TreeDataProvider<SceneTreeItem>, vscode.TreeDragAndDropController<SceneTreeItem>, vscode.Disposable {
	public readonly dropMimeTypes = ["application/vnd.code.tree.sceneBreakpointsView"];
	public readonly dragMimeTypes = ["application/vnd.code.tree.sceneBreakpointsView"];

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<SceneTreeItem | undefined | void>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private _pausedLocation: { file: string; line: number } | null = null;
	private _sceneNodesMap = new Map<string, SceneNode>();
	private _activeBreakpointNodes: BreakpointNode[] = [];
	private _boundTreeView?: vscode.TreeView<SceneTreeItem>;
	private readonly _expandedSceneNames = new Set<string>();
	private readonly _busDisposables: { dispose(): void }[] = [];

	public markSceneExpanded(sceneName: string): void {
		this._expandedSceneNames.add(sceneName);
	}

	public markSceneCollapsed(sceneName: string): void {
		this._expandedSceneNames.delete(sceneName);
	}

	public isSceneExpanded(sceneName: string): boolean {
		return this._expandedSceneNames.has(sceneName);
	}

	constructor(private readonly extensionPath: string = "") {
		this._busDisposables.push(
			appEventBus.on("scenes:changed", () => this.refresh()),
			appEventBus.on("scene:activated", () => this.refresh()),
			appEventBus.on("breakpoints:changed", () => this.refresh()),
			appEventBus.on("debug:paused", async ({ file, line }) => {
				await this.revealPausedLocation(file, line);
			}),
			appEventBus.on("debug:resumed", () => {
				this.clearPausedLocation();
			}),
		);
	}

	public dispose(): void {
		for (const d of this._busDisposables) {
			d.dispose();
		}
		this._busDisposables.length = 0;
		this._onDidChangeTreeData.dispose();
	}

	public handleDrag(
		source: readonly SceneTreeItem[],
		treeDataTransfer: vscode.DataTransfer,
		_token: vscode.CancellationToken,
	): void {
		const bpNodes = source.filter((item): item is BreakpointNode => item instanceof BreakpointNode);
		if (bpNodes.length > 0) {
			treeDataTransfer.set(
				"application/vnd.code.tree.sceneBreakpointsView",
				new vscode.DataTransferItem(bpNodes),
			);
		}
	}

	public async handleDrop(
		target: SceneTreeItem | undefined,
		sources: vscode.DataTransfer,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const transferItem = sources.get("application/vnd.code.tree.sceneBreakpointsView");
		if (!transferItem || !transferItem.value) return;

		const draggedNodes: BreakpointNode[] = transferItem.value;
		if (!Array.isArray(draggedNodes) || draggedNodes.length === 0) return;

		const sourceNode = draggedNodes[0];
		if (!sourceNode || !(sourceNode instanceof BreakpointNode) || typeof sourceNode.index !== "number") return;

		let targetSceneName: string | undefined;
		let targetIndex: number | undefined;

		if (target instanceof BreakpointNode) {
			targetSceneName = target.sceneName;
			targetIndex = target.index;
		} else if (target instanceof SceneNode) {
			targetSceneName = target.sceneName;
			targetIndex = 0;
		}

		if (!targetSceneName || targetSceneName !== sourceNode.sceneName || typeof targetIndex !== "number") {
			return;
		}

		const workspaceRoot = getWorkspaceRoot(true);
		if (!workspaceRoot) return;

		const reordered = await breakpointManager.reorderBreakpoint(
			workspaceRoot,
			targetSceneName,
			sourceNode.index,
			targetIndex,
		);
		if (reordered) {
			this.refresh();
		}
	}

	public setPausedLocation(file: string, line: number): void {
		this._pausedLocation = { file, line };
		for (const node of this._activeBreakpointNodes) {
			node.setPausedLocation(this._pausedLocation);
		}
		this.refresh();
	}

	public clearPausedLocation(): void {
		if (this._pausedLocation) {
			this._pausedLocation = null;
			for (const node of this._activeBreakpointNodes) {
				node.setPausedLocation(null);
			}
			this.refresh();
		}
	}

	public getPausedLocation(): { file: string; line: number } | null {
		return this._pausedLocation;
	}

	public findPausedBreakpointNode(): BreakpointNode | undefined {
		if (!this._pausedLocation) return undefined;
		return this._activeBreakpointNodes.find((n) => n.isPausedAtBreakpoint());
	}

	public getParent(element: SceneTreeItem): vscode.ProviderResult<SceneTreeItem> {
		if (element instanceof BreakpointNode) {
			const parent = this._sceneNodesMap.get(element.sceneName);
			if (parent) return parent;
			return new SceneNode(element.sceneName, 0, sceneStateManager.isSceneActive(element.sceneName), false);
		}
		return undefined;
	}

	public refresh(element?: SceneTreeItem): void {
		this._onDidChangeTreeData.fire(element);
	}

	public getTreeItem(element: SceneTreeItem): vscode.TreeItem {
		if (element instanceof BreakpointNode) {
			element.updateAppearance();
		}
		return element;
	}

	/**
	 * 获取指定场景内的所有断点树节点（深接口）
	 * 供 getChildren 与命令层查询使用，避免外部伪造 SceneNode 实例
	 */
	public async getBreakpointNodes(sceneName: string): Promise<BreakpointNode[]> {
		const workspaceRoot = getWorkspaceRoot(false);
		if (!workspaceRoot) return [];
		const config = sceneManager.loadScenesConfig(workspaceRoot);
		const list = (config.scenes && Array.isArray(config.scenes[sceneName]))
			? config.scenes[sceneName]
			: [];
		const isActive = sceneStateManager.isSceneActive(sceneName);
		return list.map((bp, idx) => {
			const isUnmatched = bp.type !== "function" && isActive && sceneStateManager.isBreakpointUnmatched(bp.file, bp.line);
			return new BreakpointNode(
				sceneName,
				idx,
				bp,
				workspaceRoot,
				this.extensionPath,
				this._pausedLocation,
				{ isUnmatched },
			);
		});
	}

	public async getChildren(element?: SceneTreeItem): Promise<SceneTreeItem[]> {
		const workspaceRoot = getWorkspaceRoot(false);
		if (!workspaceRoot) {
			return [new PlaceholderNode(vscode.l10n.t("Open a workspace folder to view scenes"))];
		}

		// 根节点：返回场景列表
		if (!element) {
			const config = sceneManager.loadScenesConfig(workspaceRoot);
			const sceneNames = Object.keys(config.scenes || {});
			if (sceneNames.length === 0) {
				return [
					new PlaceholderNode(
						vscode.l10n.t("No scenes yet. Click + to create or export breakpoints"),
						"add",
					),
				];
			}

			const activeScenes = sceneStateManager.getActiveScenes();
			const isDirty = sceneStateManager.getIsDirty();

			this._sceneNodesMap.clear();
			return sceneNames.map((name) => {
				const bps = (config.scenes && Array.isArray(config.scenes[name])) ? config.scenes[name] : [];
				const isActive = activeScenes.includes(name);
				const isExpanded = this.isSceneExpanded(name) || isActive;
				const node = new SceneNode(name, bps.length, isActive, isDirty && isActive, isExpanded);
				this._sceneNodesMap.set(name, node);
				return node;
			});
		}

		// 子节点：返回指定场景内的断点列表
		if (element instanceof SceneNode) {
			const nodes = await this.getBreakpointNodes(element.sceneName);
			if (nodes.length === 0) {
				return [new PlaceholderNode(vscode.l10n.t("No breakpoints in this scene"))];
			}
			// 记录缓存以备 reveal 定位
			this._activeBreakpointNodes = this._activeBreakpointNodes
				.filter((n) => n.sceneName !== element.sceneName)
				.concat(nodes);
			return nodes;
		}

		return [];
	}

	/**
	 * 统一高亮与自动展开调试运行时命中的断点节点 (UI 呈现深接口)
	 */
	public async revealPausedLocation(
		treeViewOrFile: vscode.TreeView<SceneTreeItem> | string,
		fileOrLine?: string | number,
		lineOrNothing?: number,
	): Promise<void> {
		let treeView: vscode.TreeView<SceneTreeItem> | undefined;
		let file: string;
		let line: number;

		if (typeof treeViewOrFile === "string") {
			file = treeViewOrFile;
			line = typeof fileOrLine === "number" ? fileOrLine : 0;
			treeView = this._boundTreeView;
		} else {
			treeView = treeViewOrFile;
			file = typeof fileOrLine === "string" ? fileOrLine : "";
			line = typeof lineOrNothing === "number" ? lineOrNothing : 0;
		}

		const workspaceRoot = getWorkspaceRoot(false);
		if (!workspaceRoot) {
			this.setPausedLocation(file, line);
			return;
		}

		const activeScenes = sceneStateManager.getActiveScenes();
		if (activeScenes.length === 0) return;

		if (!activeBreakpointIndex.isUpToDate(workspaceRoot, activeScenes)) {
			const config = sceneManager.loadScenesConfig(workspaceRoot);
			activeBreakpointIndex.syncFromConfig(workspaceRoot, config, activeScenes);
		}

		const activeBp = activeBreakpointIndex.findActiveBreakpoint(file, line, workspaceRoot);

		// 核心守卫：若当前位置不属于任何已激活的场景断点，绝不冲刷既有断点高亮
		if (!activeBp) {
			return;
		}

		const hitSceneName = activeBp.sceneName;
		this.setPausedLocation(file, line);

		let pausedNode = this.findPausedBreakpointNode();
		if (!pausedNode && hitSceneName && treeView) {
			// 若当前所属场景尚未展开，主动触发展开
			const config = sceneManager.loadScenesConfig(workspaceRoot);
			const bps = config.scenes[hitSceneName] || [];
			const parentNode = new SceneNode(hitSceneName, bps.length, true, false);
			try {
				await treeView.reveal(parentNode, { expand: true });
				await this.getChildren(parentNode);
				pausedNode = this.findPausedBreakpointNode();
			} catch {
				// 容错忽略展开异常
			}
		}

		if (pausedNode && treeView) {
			try {
				await treeView.reveal(pausedNode, { select: true, focus: false });
			} catch {
				// 树项未完全载入时安全降级
			}
		}
	}

	/**
	 * 绑定 VS Code TreeView 原生视图实例
	 * 统一接管展开/折叠状态持久化记忆、复选框点击局部静默刷新与领域状态变更监听
	 */
	public bindView(treeView: vscode.TreeView<SceneTreeItem>): vscode.Disposable {
		this._boundTreeView = treeView;
		const disposables: vscode.Disposable[] = [];

		// 1. 记录用户手动展开/折叠的场景状态，防止任何刷新导致折叠状态被重置
		disposables.push(
			treeView.onDidExpandElement((e) => {
				if (e.element instanceof SceneNode) {
					this.markSceneExpanded(e.element.sceneName);
					treeViewState.markExpanded(e.element.sceneName);
				}
			}),
			treeView.onDidCollapseElement((e) => {
				if (e.element instanceof SceneNode) {
					this.markSceneCollapsed(e.element.sceneName);
					treeViewState.markCollapsed(e.element.sceneName);
				}
			}),
		);

		// 2. 状态机全局变更时响应式重绘树视图
		disposables.push(
			sceneStateManager.onDidChangeState(() => {
				this.refresh();
			}),
		);

		// 3. 监听用户点击树节点原生复选框事件 (对齐 VS Code 原生 Breakpoints 面板)
		disposables.push(
			treeView.onDidChangeCheckboxState(async (e) => {
				const workspaceRoot = getWorkspaceRoot(true);
				if (!workspaceRoot) return;

				for (const [item, state] of e.items) {
					if (item instanceof BreakpointNode && item.sceneName && typeof item.index === "number") {
						const newEnabled = state === vscode.TreeItemCheckboxState.Checked;
						const result = await breakpointManager.toggleBreakpoint(
							workspaceRoot,
							item.sceneName,
							item.index,
							newEnabled,
						);

						if (result.success) {
							item.breakpoint.enabled = result.newEnabled;
							item.updateAppearance();
							this.refresh(item);
						}
					}
				}
			}),
		);

		return vscode.Disposable.from(...disposables);
	}
}

/**
 * 树视图交互与复选框协同控制器快捷装配函数 (向后兼容)
 */
export function registerTreeInteractionService(
	treeView: vscode.TreeView<SceneTreeItem>,
	treeDataProvider: SceneTreeDataProvider,
): vscode.Disposable {
	return treeDataProvider.bindView(treeView);
}

export const registerTreeInteractionCoordinator = registerTreeInteractionService;

