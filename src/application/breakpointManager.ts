import type { IBreakpointBridge, ISceneRepository } from "#src/domain/ports";
import { Breakpoint } from "#src/domain/models/breakpoint";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";
import { sceneStateManager } from "./sceneStateManager";
import { SerialQueue } from "./serialQueue";
import { getDependencies } from "./dependencies";
import { appEventBus } from "./eventBus";
import type { SceneBreakpoint } from "#src/domain/types";

/**
 * 基础设施依赖可选覆盖选项 (Options)
 * 允许在调用时显式传入测试替身或特定实例，缺省时自动使用全局默认依赖
 */
export interface BreakpointOpOptions {
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
}

export interface AddBreakpointResult {
	success: boolean;
	totalBreakpoints: number;
	isImmediatelyApplied?: boolean;
}

export interface ToggleBreakpointResult {
	success: boolean;
	newEnabled?: boolean;
}

/**
 * 断点状态管理器 (Breakpoint Manager)
 * 职责：负责场景内断点的生命周期、启闭切换、即刻点亮、重排与编辑器变更同步，受单写者串行队列保护 (INV-010)
 */
export class BreakpointManager {
	constructor(private readonly queue: SerialQueue = new SerialQueue()) {}

	private resolveDeps(opts?: BreakpointOpOptions) {
		const defaultDeps = getDependencies();
		const sceneRepository = opts?.sceneRepository || defaultDeps.sceneRepository;
		if (!sceneRepository) {
			throw new Error("BreakpointManager: sceneRepository must be configured");
		}
		return {
			sceneRepository,
			breakpointBridge: opts?.breakpointBridge || defaultDeps.breakpointBridge,
			loopGuard: opts?.loopGuard || defaultDeps.loopGuard,
		};
	}

	private saveAndNotify(
		sceneRepository: ISceneRepository,
		workspaceRoot: string,
		catalog: SceneCatalog,
		loopGuard?: { markInternalSaving: () => void },
		sceneName?: string,
	): void {
		loopGuard?.markInternalSaving();
		sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
		appEventBus.emit("scenes:changed", { workspaceRoot });
		if (sceneName) {
			appEventBus.emit("breakpoints:changed", { workspaceRoot, sceneName });
		}
	}

	/**
	 * 向目标场景添加断点，并根据激活状态执行即刻点亮
	 */
	public async addBreakpoint(
		workspaceRoot: string,
		targetScene: string,
		breakpoint: SceneBreakpoint,
		options?: BreakpointOpOptions,
	): Promise<AddBreakpointResult> {
		return this.queue.enqueue(async () => {
			const { sceneRepository, breakpointBridge, loopGuard } = this.resolveDeps(options);
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);

			// 1. 唯一性查重覆盖 (INV-001)
			const scene = catalog.getOrCreateScene(targetScene);
			scene.upsertBreakpoint(new Breakpoint(breakpoint));

			// 2. 持久化写盘与事件广播
			this.saveAndNotify(sceneRepository, workspaceRoot, catalog, loopGuard, targetScene);

			// 3. 即刻点亮 (Immediate Highlight)：若当前场景已激活，立即注入宿主调试器运行时并更新基准计数
			let isImmediatelyApplied = false;
			const activeScenes = sceneStateManager.getActiveScenes();
			if (activeScenes.includes(targetScene)) {
				const isSuccess = breakpointBridge ? await breakpointBridge.applySingleBreakpointToEditor(workspaceRoot, breakpoint) : false;
				if (isSuccess !== false) {
					sceneStateManager.incrementActiveBaseline();
					isImmediatelyApplied = true;
				}
			}

			return {
				success: true,
				totalBreakpoints: scene.getBreakpoints().length,
				isImmediatelyApplied,
			};
		});
	}

	/**
	 * 移除场景内指定索引断点
	 */
	public async removeBreakpoint(
		workspaceRoot: string,
		sceneName: string,
		index: number,
		options?: BreakpointOpOptions,
	): Promise<boolean> {
		return this.queue.enqueue(async () => {
			const { sceneRepository, loopGuard } = this.resolveDeps(options);
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);
			const scene = catalog.getScene(sceneName);
			if (!scene) return false;

			const success = scene.removeBreakpoint(index);
			if (success) {
				this.saveAndNotify(sceneRepository, workspaceRoot, catalog, loopGuard, sceneName);
			}
			return success;
		});
	}

	/**
	 * 切换场景内指定断点的启用/禁用状态，并同步刷新编辑器
	 */
	public async toggleBreakpoint(
		workspaceRoot: string,
		sceneName: string,
		index: number,
		targetEnabled?: boolean,
		options?: BreakpointOpOptions,
	): Promise<ToggleBreakpointResult> {
		return this.queue.enqueue(async () => {
			const { sceneRepository, breakpointBridge, loopGuard } = this.resolveDeps(options);
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);
			const scene = catalog.getScene(sceneName);
			if (!scene) {
				return { success: false };
			}

			const bp = scene.getBreakpoint(index);
			if (!bp) {
				return { success: false };
			}

			const newEnabled = targetEnabled !== undefined ? targetEnabled : !bp.enabled;
			bp.enabled = newEnabled;

			this.saveAndNotify(sceneRepository, workspaceRoot, catalog, loopGuard, sceneName);

			// 若属于激活场景，即刻反向同步编辑器断点显隐
			if (breakpointBridge) {
				const activeScenes = sceneStateManager.getActiveScenes();
				if (activeScenes.includes(sceneName)) {
					await breakpointBridge.syncBreakpointEnabledToEditor(
						workspaceRoot,
						bp.toJSON(),
						newEnabled,
					);
				}
			}

			return {
				success: true,
				newEnabled,
			};
		});
	}

	/**
	 * 批量启用或禁用场景内的所有断点
	 */
	public async setAllEnabled(
		workspaceRoot: string,
		sceneName: string,
		enabled: boolean,
		options?: BreakpointOpOptions,
	): Promise<boolean> {
		return this.queue.enqueue(async () => {
			const { sceneRepository, breakpointBridge, loopGuard } = this.resolveDeps(options);
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);
			const scene = catalog.getScene(sceneName);
			if (!scene) return false;

			scene.setAllEnabled(enabled);

			this.saveAndNotify(sceneRepository, workspaceRoot, catalog, loopGuard, sceneName);

			// 若处于激活状态，联动同步宿主编辑器所有断点状态
			if (breakpointBridge) {
				const activeScenes = sceneStateManager.getActiveScenes();
				if (activeScenes.includes(sceneName)) {
					for (const bp of scene.getBreakpoints()) {
						await breakpointBridge.syncBreakpointEnabledToEditor(
							workspaceRoot,
							bp.toJSON(),
							enabled,
						);
					}
				}
			}

			return true;
		});
	}

	/**
	 * 上移/下移单步微调或置顶/置底断点顺序
	 */
	public async moveBreakpoint(
		workspaceRoot: string,
		sceneName: string,
		index: number,
		direction: "up" | "down" | "top" | "bottom",
		options?: BreakpointOpOptions,
	): Promise<boolean> {
		return this.queue.enqueue(async () => {
			const { sceneRepository, loopGuard } = this.resolveDeps(options);
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);
			const scene = catalog.getScene(sceneName);
			if (!scene) return false;

			const success = scene.moveBreakpoint(index, direction);
			if (success) {
				this.saveAndNotify(sceneRepository, workspaceRoot, catalog, loopGuard, sceneName);
			}
			return success;
		});
	}

	/**
	 * 任意索引拖拽或置顶/置底重排断点顺序
	 */
	public async reorderBreakpoint(
		workspaceRoot: string,
		sceneName: string,
		sourceIndex: number,
		targetIndex: number,
		options?: BreakpointOpOptions,
	): Promise<boolean> {
		return this.queue.enqueue(async () => {
			const { sceneRepository, loopGuard } = this.resolveDeps(options);
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);
			const scene = catalog.getScene(sceneName);
			if (!scene) return false;

			const success = scene.reorderBreakpoint(sourceIndex, targetIndex);
			if (success) {
				this.saveAndNotify(sceneRepository, workspaceRoot, catalog, loopGuard, sceneName);
			}
			return success;
		});
	}

	/**
	 * 同步外部编辑器断点启闭状态至当前激活场景并写盘
	 */
	public async syncBreakpointChanges(
		workspaceRoot: string,
		changes: { file?: string; line?: number; functionName?: string; enabled: boolean }[],
		activeScenes?: string[],
		options?: BreakpointOpOptions,
	): Promise<boolean> {
		return this.queue.enqueue(async () => {
			if (!changes || changes.length === 0) return false;

			const { sceneRepository, loopGuard } = this.resolveDeps(options);
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);
			const scenesToSync = activeScenes || catalog.getActiveScenes();
			if (scenesToSync.length === 0) return false;

			let hasChanged = false;
			for (const sName of scenesToSync) {
				const scene = catalog.getScene(sName);
				if (!scene) continue;
				for (const change of changes) {
					if (scene.syncBreakpointEnabled(change)) {
						hasChanged = true;
					}
				}
			}

			if (hasChanged) {
				this.saveAndNotify(sceneRepository, workspaceRoot, catalog, loopGuard);
			}

			return hasChanged;
		});
	}
}

// 导出统一单例对象实例 (Singleton Instance)
export const breakpointManager = new BreakpointManager();
