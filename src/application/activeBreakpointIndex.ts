import type { SceneBreakpoint, ScenesConfig, SourceSceneBreakpoint } from "#src/domain/types";
import { isFilePathMatch, normalizeFsPath } from "#src/shared/utils/pathUtils";
import { appEventBus, type IDisposable } from "./eventBus";

/**
 * 索引断点实体 (IndexedBreakpoint)
 * 包含断点所属场景名、场景内序号以及断点详细定义
 */
export interface IndexedBreakpoint {
	sceneName: string;
	stepIndex: number;
	breakpoint: SourceSceneBreakpoint;
}

/**
 * 活动断点内存索引投影 (Active Breakpoint Index)
 * 职责：作为应用层深模块，维护当前激活场景断点的高效内存快照，
 * 消除 Inlay Hints、单步调试跟踪与树视图高亮等热路径上的重复磁盘 I/O 与嵌套遍历。
 */
export class ActiveBreakpointIndex {
	private workspaceRoot = "";
	private activeScenes: string[] = [];
	private items: IndexedBreakpoint[] = [];
	private docCache = new Map<string, IndexedBreakpoint[]>();
	private hitCache = new Map<string, IndexedBreakpoint | undefined>();
	private needsSync = false;
	private readonly disposables: IDisposable[] = [];

	constructor() {
		this.disposables.push(
			appEventBus.on("breakpoints:changed", () => this.markDirty()),
			appEventBus.on("scenes:changed", () => this.markDirty()),
		);
	}

	/**
	 * 标记当前索引缓存已失效，下次读取前需按需刷新
	 */
	public markDirty(): void {
		this.docCache.clear();
		this.hitCache.clear();
		this.needsSync = true;
	}

	/**
	 * 获取当前索引是否被标记为需要重同步
	 */
	public getNeedsSync(): boolean {
		return this.needsSync;
	}

	/**
	 * 同步/刷新当前激活场景的断点索引
	 */
	public sync(
		workspaceRoot: string,
		scenes: Record<string, SceneBreakpoint[]>,
		activeScenes: string[],
	): void {
		this.workspaceRoot = workspaceRoot;
		this.activeScenes = [...activeScenes];
		this.items = [];
		this.docCache.clear();
		this.hitCache.clear();
		this.needsSync = false;

		for (const sceneName of activeScenes) {
			const sceneBps = scenes[sceneName];
			if (!Array.isArray(sceneBps)) continue;

			let stepIndex = 0;
			for (const bp of sceneBps) {
				if (!bp || typeof bp !== "object" || bp.type === "function") continue;
				stepIndex++;

				const srcBp = bp as SourceSceneBreakpoint;
				if (!srcBp.file || typeof srcBp.line !== "number" || srcBp.line <= 0) continue;

				this.items.push({
					sceneName,
					stepIndex,
					breakpoint: srcBp,
				});
			}
		}
	}

	/**
	 * 根据完整配置对象刷新索引
	 */
	public syncFromConfig(
		workspaceRoot: string,
		config: ScenesConfig,
		activeScenesOverride?: string[],
	): void {
		const activeScenes = activeScenesOverride ?? config.activeScenes ?? [];
		this.sync(workspaceRoot, config.scenes || {}, activeScenes);
	}

	/**
	 * 获取与指定文档关联的所有活动断点
	 */
	public getBreakpointsForDocument(
		docFsPath: string,
		wsRoot?: string,
	): IndexedBreakpoint[] {
		const root = wsRoot || this.workspaceRoot;
		const normDoc = normalizeFsPath(docFsPath);
		if (this.docCache.has(normDoc)) {
			return this.docCache.get(normDoc)!;
		}

		const matched = this.items.filter((item) =>
			isFilePathMatch(docFsPath, item.breakpoint.file, root),
		);
		this.docCache.set(normDoc, matched);
		return matched;
	}

	/**
	 * 精确查找指定文件和行号对应的活动断点
	 */
	public findActiveBreakpoint(
		file: string,
		line: number,
		wsRoot?: string,
	): IndexedBreakpoint | undefined {
		const root = wsRoot || this.workspaceRoot;
		const cacheKey = `${normalizeFsPath(file)}:${line}`;
		if (this.hitCache.has(cacheKey)) {
			return this.hitCache.get(cacheKey);
		}

		const found = this.items.find(
			(item) =>
				Number(item.breakpoint.line) === line &&
				isFilePathMatch(file, item.breakpoint.file, root),
		);
		this.hitCache.set(cacheKey, found);
		return found;
	}

	/**
	 * 判断指定文件与行号是否命中了当前激活场景中的断点
	 */
	public isHitInActiveScenes(
		file: string,
		line: number,
		wsRoot?: string,
	): boolean {
		return this.findActiveBreakpoint(file, line, wsRoot) !== undefined;
	}

	/**
	 * 获取当前所有已索引断点
	 */
	public getAllIndexedBreakpoints(): IndexedBreakpoint[] {
		return [...this.items];
	}

	/**
	 * 获取当前索引所关联的激活场景列表
	 */
	public getActiveScenes(): string[] {
		return [...this.activeScenes];
	}

	/**
	 * 获取当前索引关联的工作区根目录
	 */
	public getWorkspaceRoot(): string {
		return this.workspaceRoot;
	}

	/**
	 * 判断当前内存索引是否与给定工作区根路径及激活场景完全吻合
	 */
	public isUpToDate(workspaceRoot: string, activeScenes: string[]): boolean {
		if (this.needsSync) return false;
		if (normalizeFsPath(this.workspaceRoot) !== normalizeFsPath(workspaceRoot)) return false;
		if (this.activeScenes.length !== activeScenes.length) return false;
		return this.activeScenes.every((s, i) => s === activeScenes[i]);
	}

	/**
	 * 清空索引（测试重置或无场景激活时）
	 */
	public clear(): void {
		this.workspaceRoot = "";
		this.activeScenes = [];
		this.items = [];
		this.docCache.clear();
		this.hitCache.clear();
		this.needsSync = false;
	}

	/**
	 * 释放事件监听订阅与内部资源
	 */
	public dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables.length = 0;
		this.clear();
	}
}

export const activeBreakpointIndex = new ActiveBreakpointIndex();
