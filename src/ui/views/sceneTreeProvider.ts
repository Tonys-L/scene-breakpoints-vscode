import * as path from "node:path";
import * as vscode from "vscode";
import { getWorkspaceRoot } from "#src/ui/utils/workspaceRoot";
import { sceneManager, breakpointManager, appEventBus } from "#src/application";

import { sceneStateManager } from "#src/application/sceneStateManager";
import type { SourceSceneBreakpoint } from "#src/domain/types";
import { BreakpointNode, PlaceholderNode, SceneNode, type SceneTreeItem } from "./treeNodes";

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
	private readonly _busDisposables: { dispose(): void }[] = [];

	constructor(private readonly extensionPath: string = "") {
		this._busDisposables.push(
			appEventBus.on("scenes:changed", () => this.refresh()),
			appEventBus.on("scene:activated", () => this.refresh()),
			appEventBus.on("breakpoints:changed", () => this.refresh()),
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
				const node = new SceneNode(name, bps.length, isActive, isDirty && isActive);
				this._sceneNodesMap.set(name, node);
				return node;
			});
		}

		// 子节点：返回指定场景内的断点列表
		if (element instanceof SceneNode) {
			const config = sceneManager.loadScenesConfig(workspaceRoot);
			const list = (config.scenes && Array.isArray(config.scenes[element.sceneName]))
				? config.scenes[element.sceneName]
				: [];
			if (list.length === 0) {
				return [new PlaceholderNode(vscode.l10n.t("No breakpoints in this scene"))];
			}
			const nodes = list.map((bp, idx) =>
				new BreakpointNode(element.sceneName, idx, bp, workspaceRoot, this.extensionPath, this._pausedLocation),
			);
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
		treeView: vscode.TreeView<SceneTreeItem>,
		file: string,
		line: number,
	): Promise<void> {
		const workspaceRoot = getWorkspaceRoot(false);
		if (!workspaceRoot) {
			this.setPausedLocation(file, line);
			return;
		}

		const config = sceneManager.loadScenesConfig(workspaceRoot);
		const activeScenes = sceneStateManager.getActiveScenes();
		if (activeScenes.length === 0) return;

		const fullTarget = path.normalize(file).toLowerCase();
		let isHit = false;
		let hitSceneName: string | undefined;

		for (const sceneName of activeScenes) {
			const bps = config.scenes[sceneName] || [];
			const hit = bps.some((b) => {
				if (b.type === "function") return false;
				const src = b as SourceSceneBreakpoint;
				if (Number(src.line) !== line) return false;
				const fp = path.normalize(
					path.isAbsolute(src.file) ? src.file : path.join(workspaceRoot, src.file),
				).toLowerCase();
				const rawSrc = path.normalize(src.file).toLowerCase().replace(/\\/g, "/");
				const targetNorm = fullTarget.replace(/\\/g, "/");
				return fp === fullTarget || targetNorm.endsWith("/" + rawSrc) || targetNorm.endsWith(rawSrc);
			});

			if (hit) {
				isHit = true;
				hitSceneName = sceneName;
				break;
			}
		}

		// 核心守卫：若当前位置不属于任何已激活的场景断点，绝不冲刷既有断点高亮
		if (!isHit) {
			return;
		}

		this.setPausedLocation(file, line);

		let pausedNode = this.findPausedBreakpointNode();
		if (!pausedNode && hitSceneName) {
			// 若当前所属场景尚未展开，主动触发展开
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

		if (pausedNode) {
			try {
				await treeView.reveal(pausedNode, { select: true, focus: false });
			} catch {
				// 树项未完全载入时安全降级
			}
		}
	}
}
