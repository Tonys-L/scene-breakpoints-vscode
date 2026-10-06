import { Breakpoint } from "#src/domain/models/breakpoint";
import { Scene } from "#src/domain/models/scene";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";
import { sceneStateManager } from "./sceneStateManager";
import { applicationSerialQueue, type SerialQueue } from "./serialQueue";
import { getDependencies } from "./dependencies";
import { appEventBus } from "./eventBus";
import type { SceneItem, ScenesConfig } from "#src/domain/types";
import { mutateCatalog } from "./mutateCatalog";
import {
	type ActivateSceneResult,
	type SceneActivationDeps,
	executeSceneActivation,
} from "./sceneActivationPipeline";

export type { ActivateSceneResult };

/**
 * 基础设施依赖可选覆盖选项 (Options)
 */
export interface SceneOpOptions extends SceneActivationDeps {}

export interface ExportSceneResult {
	success: boolean;
	count: number;
}

export class SceneManager {
	constructor(public readonly queue: SerialQueue = applicationSerialQueue) {}

	private resolveDeps(opts?: SceneOpOptions) {
		const defaultDeps = getDependencies();
		return {
			sceneRepository: opts?.sceneRepository || defaultDeps.sceneRepository,
			breakpointBridge: opts?.breakpointBridge || defaultDeps.breakpointBridge,
			lineReader: opts?.lineReader || defaultDeps.lineReader,
			isExternalPendingEdit: opts?.isExternalPendingEdit || defaultDeps.isExternalPendingEdit,
			resolveFingerprintConflict:
				opts?.resolveFingerprintConflict || defaultDeps.resolveFingerprintConflict,
			conflictDetection: opts?.conflictDetection,
		};
	}

	/**
	 * 获取当前工作区的场景配置纯数据结构 (只读查询门面)
	 */
	public loadScenesConfig(workspaceRoot: string, options?: SceneOpOptions): ScenesConfig {
		const { sceneRepository } = this.resolveDeps(options);
		if (!sceneRepository) {
			throw new Error("SceneService: sceneRepository must be configured");
		}
		return sceneRepository.loadScenesConfig(workspaceRoot);
	}

	/**
	 * 获取当前工作区的场景目录聚合根 (只读查询门面)
	 */
	public loadCatalog(workspaceRoot: string, options?: SceneOpOptions): SceneCatalog {
		return new SceneCatalog(this.loadScenesConfig(workspaceRoot, options));
	}

	/**
	 * 激活目标场景并执行多场景合并与自愈闭环
	 */
	public async activateScene(
		workspaceRoot: string,
		targetScenes: string[],
		options?: SceneOpOptions,
	): Promise<ActivateSceneResult> {
		return this.queue.enqueue(async () => {
			const deps = this.resolveDeps(options);
			return executeSceneActivation({ workspaceRoot, targetScenes, deps });
		});
	}

	/**
	 * 清空全局断点与激活场景
	 */
	public async clearAll(workspaceRoot?: string, options?: SceneOpOptions): Promise<void> {
		return this.queue.enqueue(async () => {
			sceneStateManager.setApplyingState(true);
			try {
				const { sceneRepository, breakpointBridge } = this.resolveDeps(options);
				if (!breakpointBridge) throw new Error("SceneService: breakpointBridge must be configured");

				if (workspaceRoot && sceneRepository) {
					await mutateCatalog(
						workspaceRoot,
						(catalog) => {
							if (catalog.getActiveScenes().length > 0) {
								catalog.clearActive();
								return true;
							}
							return false;
						},
						{ sceneRepository, queue: this.queue, silent: true, syncActive: false },
					);
				}
				await breakpointBridge.clearAllBreakpoints();
				sceneStateManager.clearLastAppliedTopologyHash();
				sceneStateManager.setActiveScene(undefined);
				if (workspaceRoot) {
					appEventBus.emit("scenes:changed", { workspaceRoot, reason: "clearAll" });
				}
			} finally {
				sceneStateManager.setApplyingState(false);
			}
		});
	}

	public async exportScene(
		workspaceRoot: string,
		targetScene: string,
		mode: "overwrite" | "append",
		options?: SceneOpOptions,
	): Promise<ExportSceneResult> {
		return this.queue.enqueue(async () => {
			const { sceneRepository, breakpointBridge } = this.resolveDeps(options);
			if (!sceneRepository || !breakpointBridge) {
				throw new Error("SceneService: sceneRepository and breakpointBridge must be configured");
			}
			const exportedBps = await breakpointBridge.collectCurrentBreakpoints(workspaceRoot);
			if (exportedBps.length === 0) return { success: false, count: 0 };

			await mutateCatalog(
				workspaceRoot,
				(catalog) => {
					const scene = catalog.getOrCreateScene(targetScene);
					if (mode === "append") {
						for (const bp of exportedBps) scene.upsertStep(new Breakpoint(bp));
					} else {
						scene.setSteps(exportedBps.map((b) => new Breakpoint(b)));
					}
					return true;
				},
				{ sceneRepository, queue: this.queue, reason: "exportScene" },
			);
			return { success: true, count: exportedBps.length };
		});
	}

	/**
	 * 创建新空白场景
	 */
	public async createScene(
		workspaceRoot: string,
		sceneName: string,
		options?: SceneOpOptions,
	): Promise<boolean> {
		const target = (sceneName || "").trim();
		if (!target) return false;
		return mutateCatalog(
			workspaceRoot,
			(cat) => {
				if (cat.hasScene(target)) return false;
				cat.getOrCreateScene(target);
				return true;
			},
			{ ...options, queue: this.queue },
		);
	}

	/**
	 * 重命名现有场景
	 */
	public async renameScene(
		workspaceRoot: string,
		oldName: string,
		newName: string,
		options?: SceneOpOptions,
	): Promise<boolean> {
		return mutateCatalog(
			workspaceRoot,
			(cat) => cat.renameScene(oldName, newName),
			{ ...options, queue: this.queue },
		);
	}

	/**
	 * 删除指定场景
	 */
	public async deleteScene(
		workspaceRoot: string,
		sceneName: string,
		options?: SceneOpOptions,
	): Promise<boolean> {
		return mutateCatalog(
			workspaceRoot,
			(cat) => cat.deleteScene(sceneName),
			{ ...options, queue: this.queue },
		);
	}

	/**
	 * 克隆场景副本
	 */
	public async duplicateScene(
		workspaceRoot: string,
		sourceName: string,
		targetName: string,
		options?: SceneOpOptions,
	): Promise<boolean> {
		return mutateCatalog(
			workspaceRoot,
			(cat) => cat.duplicateScene(sourceName, targetName),
			{ ...options, queue: this.queue },
		);
	}

	/**
	 * 从外部步骤列表导入场景（支持覆盖与追加合并；断点与引用条目均按声明态适配）
	 */
	public async importScene(
		workspaceRoot: string,
		sceneName: string,
		items: SceneItem[],
		mode: "overwrite" | "append" = "overwrite",
		options?: SceneOpOptions,
	): Promise<boolean> {
		const target = (sceneName || "").trim();
		if (!target) return false;
		return mutateCatalog(
			workspaceRoot,
			(catalog) => {
				const scene = catalog.getOrCreateScene(target);
				if (mode === "append") {
					const incoming = new Scene(target, items);
					for (const step of incoming.getSteps()) scene.upsertStep(step);
				} else {
					scene.setSteps(items);
				}
				return true;
			},
			{ ...options, queue: this.queue },
		);
	}

	/**
	 * 获取场景配置文件物理路径
	 */
	public getScenesConfigPath(workspaceRoot: string, options?: SceneOpOptions): string {
		const { sceneRepository } = this.resolveDeps(options);
		if (!sceneRepository) {
			throw new Error("SceneService: sceneRepository must be configured");
		}
		return sceneRepository.getScenesConfigPath(workspaceRoot);
	}

	/**
	 * 确保场景配置文件存在并返回其物理路径
	 */
	public ensureScenesConfigFile(workspaceRoot: string, options?: SceneOpOptions): string {
		const { sceneRepository } = this.resolveDeps(options);
		if (!sceneRepository) {
			throw new Error("SceneService: sceneRepository must be configured");
		}
		const configPath = sceneRepository.getScenesConfigPath(workspaceRoot);
		const config = sceneRepository.loadScenesConfig(workspaceRoot);
		if (!config.scenes) {
			sceneRepository.saveScenesConfig(workspaceRoot, { scenes: {} });
		}
		return configPath;
	}
}

// 导出统一单例对象实例 (Singleton Instance)
export const sceneManager = new SceneManager();
