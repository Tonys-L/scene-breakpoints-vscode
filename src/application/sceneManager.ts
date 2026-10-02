import type { ApplySceneResult, IBreakpointBridge, ISceneRepository } from "#src/domain/ports";
import { Breakpoint } from "#src/domain/models/breakpoint";
import { Scene } from "#src/domain/models/scene";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";
import { HealingEngine } from "#src/domain/services/healingEngine";
import { sceneStateManager } from "./sceneStateManager";
import { SerialQueue } from "./serialQueue";
import { getDependencies } from "./dependencies";
import { appEventBus } from "./eventBus";
import type { SceneBreakpoint, ScenesConfig, SourceSceneBreakpoint } from "#src/domain/types";

/**
 * 基础设施依赖可选覆盖选项 (Options)
 */
export interface SceneOpOptions {
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
	fileLinesReader?: (filePath: string) => Promise<string[] | undefined>;
}

export interface ActivateSceneResult {
	success: boolean;
	validTargetScenes: string[];
	missingScenes: string[];
	loadedCount: number;
	healedCount: number;
	enrichedCount?: number;
	unmatchedCount: number;
	unmatchedBreakpoints?: SourceSceneBreakpoint[];
}

export interface ExportSceneResult {
	success: boolean;
	count: number;
}

export class SceneManager {
	constructor(private readonly queue: SerialQueue = new SerialQueue()) {}

	private resolveDeps(opts?: SceneOpOptions) {
		const defaultDeps = getDependencies();
		return {
			sceneRepository: opts?.sceneRepository || defaultDeps.sceneRepository,
			breakpointBridge: opts?.breakpointBridge || defaultDeps.breakpointBridge,
			loopGuard: opts?.loopGuard || defaultDeps.loopGuard,
			fileLinesReader: opts?.fileLinesReader || defaultDeps.fileLinesReader,
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
	/**
	 * 当磁盘中的 activeScenes 与当前激活不一致时，执行单向优先落盘 (INV-010)
	 */
	private syncDiskActiveScenesIfNeeded(
		workspaceRoot: string,
		catalog: SceneCatalog,
		currentDiskActives: string[] | undefined,
		validTargetScenes: string[],
		sceneRepository: ISceneRepository,
		loopGuard?: { markInternalSaving: () => void },
	): void {
		const isSameActive =
			Array.isArray(currentDiskActives) &&
			currentDiskActives.length === validTargetScenes.length &&
			currentDiskActives.every((s, i) => s === validTargetScenes[i]);

		if (!isSameActive) {
			loopGuard?.markInternalSaving();
			sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
		}
	}

	/**
	 * 将自愈和富化后的最新行号与指纹回写持久化至各个所属场景 (INV-004, INV-010)
	 */
	private persistHealedBackfill(
		workspaceRoot: string,
		catalog: SceneCatalog,
		validTargetScenes: string[],
		applyResult: ApplySceneResult,
		mergedBreakpoints: Breakpoint[],
		sceneRepository: ISceneRepository,
		loopGuard?: { markInternalSaving: () => void },
	): void {
		const candidateInstances = applyResult.healedBreakpoints?.length
			? applyResult.healedBreakpoints.map((b: SceneBreakpoint | Breakpoint) => (b instanceof Breakpoint ? b : new Breakpoint(b)))
			: mergedBreakpoints;
		for (const sName of validTargetScenes) {
			catalog.getScene(sName)?.backfillHealed(candidateInstances);
		}
		loopGuard?.markInternalSaving();
		sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
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
			const { sceneRepository, breakpointBridge, loopGuard, fileLinesReader } = this.resolveDeps(options);
			if (!sceneRepository || !breakpointBridge) {
				throw new Error("SceneService: sceneRepository and breakpointBridge must be configured");
			}

			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);

			// 1. 过滤幽灵场景与有效性校验 (INV-009)
			const actResult = catalog.activate(targetScenes);
			if (!actResult.success) {
				return {
					success: false,
					validTargetScenes: [],
					missingScenes: actResult.missingScenes,
					loadedCount: 0,
					healedCount: 0,
					unmatchedCount: 0,
				};
			}

			const validTargetScenes = actResult.validTargetScenes;
			const missingScenes = actResult.missingScenes;

			// 2. 聚合多场景断点并去重 (先到先得策略 INV-001, INV-011)
			const activeScenes = validTargetScenes.map((name) => catalog.getScene(name)).filter((s): s is Scene => !!s);
			const mergedBreakpoints = Scene.merge(activeScenes).getBreakpoints();

			// 2.1 应用层前置自愈与指纹富化管道 (Healing & Fingerprint Enrich Pipeline)
			const {
				healedCount: appHealedCount,
				enrichedCount: appEnrichedCount,
				unmatched: unmatchedBreakpoints,
			} = await this.enrichAndHealBreakpoints(workspaceRoot, mergedBreakpoints, fileLinesReader);

			// 同步状态机脱靶失联警告 (INV-004)
			sceneStateManager.setUnmatchedBreakpoints(unmatchedBreakpoints.map((bp) => `${bp.file.replace(/\\/g, "/")}:${bp.line}`));

			const bpsToLoad = mergedBreakpoints.map((b) => b.toJSON());
			const primarySceneLabel = validTargetScenes.length === 1 ? validTargetScenes[0] : validTargetScenes.join(" + ");

			// 3. 权威持久化 SSOT 写入约束：若 activeScenes 变化，先落盘 (INV-010)
			this.syncDiskActiveScenesIfNeeded(workspaceRoot, catalog, config.activeScenes, validTargetScenes, sceneRepository, loopGuard);

			// 4. 装配断点至宿主调试器 (INV-002, INV-005)
			const applyResult = await breakpointBridge.applySceneBreakpoints(workspaceRoot, primarySceneLabel, bpsToLoad);

			const loadedCount = applyResult.loadedCount;
			const healedCount = appHealedCount + (applyResult.healedCount || 0);
			const enrichedCount = appEnrichedCount + (applyResult.enrichedCount || 0);
			const finalUnmatched = unmatchedBreakpoints.length > 0 ? unmatchedBreakpoints : applyResult.unmatchedBreakpoints;
			const unmatchedCount = finalUnmatched?.length || 0;

			// 5. 将持久化结果投影更新至内存状态机，驱动 UI 渲染 (INV-004)
			sceneStateManager.setActiveScenes(validTargetScenes, loadedCount);

			// 6. 自愈与指纹补齐持久化闭环
			if (healedCount > 0 || enrichedCount > 0) {
				this.persistHealedBackfill(workspaceRoot, catalog, validTargetScenes, applyResult, mergedBreakpoints, sceneRepository, loopGuard);
			}

			appEventBus.emit("scene:activated", { workspaceRoot, activeScenes: validTargetScenes });

			return {
				success: true,
				validTargetScenes,
				missingScenes,
				loadedCount,
				healedCount,
				enrichedCount,
				unmatchedCount,
				unmatchedBreakpoints: finalUnmatched,
			};
		});
	}

	/**
	 * 清空全局断点与激活场景
	 */
	public async clearAll(workspaceRoot?: string, options?: SceneOpOptions): Promise<void> {
		return this.queue.enqueue(async () => {
			const { sceneRepository, breakpointBridge, loopGuard } = this.resolveDeps(options);
			if (!breakpointBridge) throw new Error("SceneService: breakpointBridge must be configured");

			if (workspaceRoot && sceneRepository) {
				const config = sceneRepository.loadScenesConfig(workspaceRoot);
				const catalog = new SceneCatalog(config);
				if (catalog.getActiveScenes().length > 0) {
					catalog.clearActive();
					loopGuard?.markInternalSaving();
					sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
				}
			}
			await breakpointBridge.clearAllBreakpoints();
			sceneStateManager.setActiveScene(undefined);
			if (workspaceRoot) {
				appEventBus.emit("scenes:changed", { workspaceRoot, reason: "clearAll" });
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
			const { sceneRepository, breakpointBridge, loopGuard } = this.resolveDeps(options);
			if (!sceneRepository || !breakpointBridge) {
				throw new Error("SceneService: sceneRepository and breakpointBridge must be configured");
			}
			const exportedBps = await breakpointBridge.collectCurrentBreakpoints(workspaceRoot);
			if (exportedBps.length === 0) return { success: false, count: 0 };

			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);
			const scene = catalog.getOrCreateScene(targetScene);
			if (mode === "append") {
				for (const bp of exportedBps) scene.upsertBreakpoint(new Breakpoint(bp));
			} else {
				scene.setBreakpoints(exportedBps.map((b) => new Breakpoint(b)));
			}
			loopGuard?.markInternalSaving();
			sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
			appEventBus.emit("scenes:changed", { workspaceRoot, reason: "exportScene" });
			return { success: true, count: exportedBps.length };
		});
	}

	private async mutateCatalog(
		workspaceRoot: string,
		options: SceneOpOptions | undefined,
		action: (catalog: SceneCatalog) => boolean,
	): Promise<boolean> {
		const { sceneRepository, loopGuard } = this.resolveDeps(options);
		if (!sceneRepository) throw new Error("SceneService: sceneRepository must be configured");
		const config = sceneRepository.loadScenesConfig(workspaceRoot);
		const catalog = new SceneCatalog(config);
		const success = action(catalog);
		if (success) {
			loopGuard?.markInternalSaving();
			sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
			appEventBus.emit("scenes:changed", { workspaceRoot });
		}
		return success;
	}

	/**
	 * 创建新空白场景
	 */
	public async createScene(
		workspaceRoot: string,
		sceneName: string,
		options?: SceneOpOptions,
	): Promise<boolean> {
		return this.queue.enqueue(async () => {
			const target = (sceneName || "").trim();
			if (!target) return false;
			return this.mutateCatalog(workspaceRoot, options, (cat) => {
				if (cat.hasScene(target)) return false;
				cat.getOrCreateScene(target);
				return true;
			});
		});
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
		return this.queue.enqueue(async () =>
			this.mutateCatalog(workspaceRoot, options, (cat) => cat.renameScene(oldName, newName)),
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
		return this.queue.enqueue(async () =>
			this.mutateCatalog(workspaceRoot, options, (cat) => cat.deleteScene(sceneName)),
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
		return this.queue.enqueue(async () =>
			this.mutateCatalog(workspaceRoot, options, (cat) => cat.duplicateScene(sourceName, targetName)),
		);
	}

	/**
	 * 从外部断点列表导入场景（支持覆盖与追加合并）
	 */
	public async importScene(
		workspaceRoot: string,
		sceneName: string,
		breakpoints: SceneBreakpoint[],
		mode: "overwrite" | "append" = "overwrite",
		options?: SceneOpOptions,
	): Promise<boolean> {
		return this.queue.enqueue(async () => {
			const target = (sceneName || "").trim();
			if (!target) return false;
			return this.mutateCatalog(workspaceRoot, options, (catalog) => {
				const scene = catalog.getOrCreateScene(target);
				if (mode === "append") {
					for (const bp of breakpoints) scene.upsertBreakpoint(new Breakpoint(bp));
				} else {
					scene.setBreakpoints(breakpoints.map((b) => new Breakpoint(b)));
				}
				return true;
			});
		});
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

	private async enrichAndHealBreakpoints(
		workspaceRoot: string,
		breakpoints: Breakpoint[],
		fileLinesReader?: (path: string) => Promise<string[] | undefined>,
	): Promise<{ healedCount: number; enrichedCount: number; unmatched: SourceSceneBreakpoint[] }> {
		let healedCount = 0;
		let enrichedCount = 0;
		const unmatched: SourceSceneBreakpoint[] = [];
		if (!fileLinesReader) return { healedCount, enrichedCount, unmatched };

		for (const bp of breakpoints) {
			if (bp.type === "function") continue;
			const fullPath = bp.resolveFullPath(workspaceRoot);
			if (!fullPath) continue;
			try {
				const lines = await fileLinesReader(fullPath);
				if (!lines || lines.length === 0) continue;
				if (bp.enrich(lines)) enrichedCount++;
				const healResult = HealingEngine.heal(lines, bp.line!, bp.contextSnippet);
				if (healResult.isHealed) {
					bp.updateLine(healResult.healedLine);
					healedCount++;
				} else if (healResult.status === "unmatched") {
					unmatched.push(bp.toJSON() as SourceSceneBreakpoint);
				}
			} catch {
				// 容错：读取源码异常时不阻断激活主流程
			}
		}
		return { healedCount, enrichedCount, unmatched };
	}
}

// 导出统一单例对象实例 (Singleton Instance)
export const sceneManager = new SceneManager();
