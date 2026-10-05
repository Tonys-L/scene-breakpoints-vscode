import type { IBreakpointBridge, ISceneRepository } from "#src/domain/ports";
import { Breakpoint } from "#src/domain/models/breakpoint";
import { sceneStateManager } from "./sceneStateManager";
import { applicationSerialQueue, type SerialQueue } from "./serialQueue";
import { getDependencies } from "./dependencies";
import { mutateCatalog } from "./mutateCatalog";
import { appEventBus } from "./eventBus";
import type { SceneBreakpoint } from "#src/domain/types";

/**
 * 基础设施依赖可选覆盖选项 (Options)
 * 允许在调用时显式传入测试替身或特定实例，缺省时自动使用全局默认依赖
 */
export interface BreakpointOpOptions {
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	syncActive?: boolean;
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
	constructor(private readonly queue: SerialQueue = applicationSerialQueue) {}

	private resolveDeps(opts?: BreakpointOpOptions) {
		const defaultDeps = getDependencies();
		return {
			breakpointBridge: opts?.breakpointBridge || defaultDeps.breakpointBridge,
		};
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
			let totalBreakpoints = 0;
			const success = await mutateCatalog(
				workspaceRoot,
				(catalog) => {
					const scene = catalog.getOrCreateScene(targetScene);
					scene.upsertBreakpoint(new Breakpoint(breakpoint));
					totalBreakpoints = scene.getBreakpoints().length;
					return true;
				},
				{
					...options,
					syncActive: false, // 由下方单点即刻点亮接管
					notify: { sceneName: targetScene },
					queue: this.queue,
				},
			);

			if (!success) {
				return { success: false, totalBreakpoints: 0 };
			}

			// 即刻点亮 (Immediate Highlight)：若当前场景已激活，立即注入宿主调试器运行时并更新基准计数
			let isImmediatelyApplied = false;
			const activeScenes = sceneStateManager.getActiveScenes();
			if (activeScenes.includes(targetScene)) {
				const { breakpointBridge } = this.resolveDeps(options);
				const isSuccess = breakpointBridge ? await breakpointBridge.applySingleBreakpointToEditor(workspaceRoot, breakpoint) : false;
				if (isSuccess !== false) {
					sceneStateManager.incrementActiveBaseline();
					isImmediatelyApplied = true;
					appEventBus.emit("breakpoints:changed", { workspaceRoot, sceneName: targetScene });
				}
			}

			return {
				success: true,
				totalBreakpoints,
				isImmediatelyApplied,
			};
		});
	}

	/**
	 * 移除场景内指定索引断点，若属于激活场景自动联动 DAP 桥接器同步移除 (修复失步缺陷)
	 */
	public async removeBreakpoint(
		workspaceRoot: string,
		sceneName: string,
		index: number,
		options?: BreakpointOpOptions,
	): Promise<boolean> {
		return mutateCatalog(
			workspaceRoot,
			(catalog) => {
				const scene = catalog.getScene(sceneName);
				if (!scene) return false;
				return scene.removeBreakpoint(index);
			},
			{
				...options,
				notify: { sceneName },
				queue: this.queue,
			},
		);
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
		let newEnabled: boolean | undefined;

		const success = await mutateCatalog(
			workspaceRoot,
			(catalog) => {
				const scene = catalog.getScene(sceneName);
				if (!scene) return false;
				const bp = scene.getBreakpoint(index);
				if (!bp) return false;
				newEnabled = targetEnabled !== undefined ? targetEnabled : !bp.enabled;
				bp.enabled = newEnabled;
				return true;
			},
			{
				...options,
				notify: { sceneName },
				queue: this.queue,
			},
		);

		if (!success || newEnabled === undefined) {
			return { success: false };
		}

		return {
			success: true,
			newEnabled,
		};
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
		return mutateCatalog(
			workspaceRoot,
			(catalog) => {
				const scene = catalog.getScene(sceneName);
				if (!scene) return false;
				scene.setAllEnabled(enabled);
				return true;
			},
			{
				...options,
				notify: { sceneName },
				queue: this.queue,
			},
		);
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
		return mutateCatalog(
			workspaceRoot,
			(catalog) => {
				const scene = catalog.getScene(sceneName);
				if (!scene) return false;
				return scene.moveBreakpoint(index, direction);
			},
			{
				...options,
				notify: { sceneName },
				queue: this.queue,
			},
		);
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
		return mutateCatalog(
			workspaceRoot,
			(catalog) => {
				const scene = catalog.getScene(sceneName);
				if (!scene) return false;
				return scene.reorderBreakpoint(sourceIndex, targetIndex);
			},
			{
				...options,
				notify: { sceneName },
				queue: this.queue,
			},
		);
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
		if (!changes || changes.length === 0) return false;

		return mutateCatalog(
			workspaceRoot,
			(catalog) => {
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
				return hasChanged;
			},
			{
				...options,
				syncActive: false, // 外部编辑器驱动的同步，禁止反向回环再次刷 DAP (INV-008)
				queue: this.queue,
			},
		);
	}
}

// 导出统一单例对象实例 (Singleton Instance)
export const breakpointManager = new BreakpointManager();
