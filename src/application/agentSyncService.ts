import type { IBreakpointBridge, ILineReader, ISceneRepository } from "#src/domain/ports";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";
import { expandScenes } from "#src/domain/services/sceneResolver";
import { computeTopologyHash, resolveActiveScenesDiff } from "#src/domain/services/activeScenesDiffResolver";
import { sceneStateManager } from "./sceneStateManager";
import { sceneManager } from "./sceneManager";
import { applicationSerialQueue, type SerialQueue } from "./serialQueue";
import { getDependencies } from "./dependencies";

export interface EnrichAllSceneFingerprintsOptions {
	sceneRepository?: ISceneRepository;
	lineReader?: ILineReader;
}

export interface EnrichAllSceneFingerprintsResult {
	enrichedCount: number;
	persisted: boolean;
}

export interface HandleExternalChangeOptions {
	allowAiActivation?: boolean;
	isDebuggingActive?: boolean;
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	lineReader?: ILineReader;
	onPendingMessage?: () => void;
	/**
	 * 冲突检测显式启用标记 (INV-031 watcher 路径门控)
	 * 外部文件变更事件路径必须显式下发：autoEnrichEmptyFingerprints 先行落盘会刷新
	 * lastSavedContent 基线"洗白"外部编辑信号，仅凭磁盘漂移判定会失真
	 */
	conflictDetection?: "enabled";
}

export interface HandleExternalChangeResult {
	action: "applied" | "cleared" | "pending" | "noop";
	targetScenes?: string[];
}

/**
 * AI 与外部协同服务 (Agent Sync Service)
 * 职责：负责外部文件变更感知、AI 自动激活协同、核心拓扑比对 Diff 与全场景代码指纹静默预加固流程，受单写者串行队列保护 (INV-010)
 */
export class AgentSyncService {
	constructor(private readonly queue: SerialQueue = applicationSerialQueue) {}

	/**
	 * 全场景伴随指纹静默预加固
	 */
	public async enrichAllSceneFingerprints(
		workspaceRoot: string,
		options?: EnrichAllSceneFingerprintsOptions,
	): Promise<EnrichAllSceneFingerprintsResult> {
		return this.queue.enqueue(async () => {
			const defaultDeps = getDependencies();
			const sceneRepository = options?.sceneRepository || defaultDeps.sceneRepository;
			const activeLineReader: ILineReader | undefined =
				options?.lineReader || defaultDeps.lineReader;

			if (!sceneRepository) {
				return { enrichedCount: 0, persisted: false };
			}

			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			if (!config || !config.scenes) {
				return { enrichedCount: 0, persisted: false };
			}

			const catalog = new SceneCatalog(config);
			const unfingerprintedBps = catalog.getAllScenes().flatMap((s) => s.getUnfingerprintedBreakpoints());
			if (unfingerprintedBps.length === 0) {
				return { enrichedCount: 0, persisted: false };
			}

			let enrichedCount = 0;
			for (const bp of unfingerprintedBps) {
				if (bp.type === "function") continue;
				const fullPath = bp.resolveFullPath(workspaceRoot);
				const lines = activeLineReader ? await activeLineReader.readLines(fullPath) : undefined;
				if (!lines || lines.length === 0) continue;

				if (bp.enrich(lines)) {
					enrichedCount++;
				}
			}

			if (enrichedCount > 0) {
				sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
				return { enrichedCount, persisted: true };
			}

			return { enrichedCount: 0, persisted: false };
		});
	}

	/**
	 * 静默预补齐场景中可能缺失的代码上下文指纹
	 */
	private async autoEnrichEmptyFingerprints(
		workspaceRoot: string,
		sceneRepository: ISceneRepository,
		lineReader?: ILineReader,
	): Promise<void> {
		if (!lineReader) return;
		lineReader.clearCache?.();
		try {
			const configForEnrich = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalogForEnrich = new SceneCatalog(configForEnrich);
			const unfingerprintedBps = catalogForEnrich.getAllScenes().flatMap((s) => s.getUnfingerprintedBreakpoints());

			if (unfingerprintedBps.length === 0) return;

			let enriched = false;
			for (const bp of unfingerprintedBps) {
				if (bp.type === "function") continue;
				const fullPath = bp.resolveFullPath(workspaceRoot);
				const lines = await lineReader.readLines(fullPath);
				if (lines && lines.length > 0 && bp.enrich(lines)) {
					enriched = true;
				}
			}
			if (enriched) {
				sceneRepository.saveScenesConfig(workspaceRoot, catalogForEnrich.toJSON());
			}
		} catch (err) {
			console.warn("[AgentSyncService] Failed to auto-enrich empty fingerprints:", err);
		}
	}

	/**
	 * 处理未发生场景增减但断点核心拓扑内容发生变更的情况
	 */
	private async handleTopologyDiff(
		workspaceRoot: string,
		catalog: SceneCatalog,
		currentActives: string[],
		deps: {
			breakpointBridge: IBreakpointBridge;
			isDebuggingActive: boolean;
			onPendingMessage?: () => void;
		},
	): Promise<HandleExternalChangeResult> {
		// 拓扑哈希输入为展开流 DTO（§2.7/§5.4）：与激活管道同源 expandScenes，保证哈希一致性；
		// 成环时抛出 CircularReferenceError 沿 async 栈上抛，由调用方（watcher）显式上报
		const { steps } = expandScenes(catalog, currentActives);
		const merged = steps.map((s) => s.breakpoint.raw);
		const newTopologyHash = computeTopologyHash(merged);

		if (newTopologyHash === sceneStateManager.getLastAppliedTopologyHash()) {
			return { action: "noop" };
		}

		// 调试会话保护 (挂起策略，不打断开发者调试心流)
		if (deps.isDebuggingActive) {
			sceneStateManager.setPendingTopologyUpdate(true);
			deps.onPendingMessage?.();
			return { action: "pending" };
		}

		// 拓扑发生实质变更且非调试中，重刷装配
		await deps.breakpointBridge.applySceneBreakpoints(
			workspaceRoot,
			currentActives.join("+"),
			merged,
		);
		sceneStateManager.setLastAppliedTopologyHash(newTopologyHash);
		return { action: "applied", targetScenes: currentActives };
	}

	/**
	 * 处理外部 debug-scenes.json 磁盘文件变更与 AI 声明式场景激活
	 */
	public async handleExternalChange(
		workspaceRoot: string,
		options?: HandleExternalChangeOptions,
	): Promise<HandleExternalChangeResult> {
		return this.queue.enqueue(async () => {
			const defaultDeps = getDependencies();
			const sceneRepository = options?.sceneRepository || defaultDeps.sceneRepository;
			const breakpointBridge = options?.breakpointBridge || defaultDeps.breakpointBridge;
			const allowAiActivation = options?.allowAiActivation ?? false;
			const isDebuggingActive = options?.isDebuggingActive ?? false;
			const activeLineReader: ILineReader | undefined =
				options?.lineReader || defaultDeps.lineReader;
			const onPendingMessage = options?.onPendingMessage;

			if (!sceneRepository || !breakpointBridge) {
				return { action: "noop" };
			}

			// 1. 静默预补齐指纹
			if (activeLineReader) {
				await this.autoEnrichEmptyFingerprints(workspaceRoot, sceneRepository, activeLineReader);
			}

			// 2. 外部变更差异比对 (Diff Engine)
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);
			const currentActives = sceneStateManager.getActiveScenes();

			const diff = resolveActiveScenesDiff({
				currentActiveScenes: currentActives,
				rawActiveScenes: config.activeScenes,
				allowAiActivation,
				scenesDict: config.scenes,
			});

			if (diff.shouldApply) {
				if (diff.action === "apply" && diff.targetScenes && diff.targetScenes.length > 0) {
					await sceneManager.activateScene(workspaceRoot, diff.targetScenes, {
						sceneRepository,
						breakpointBridge,
						lineReader: activeLineReader,
						conflictDetection: options?.conflictDetection,
					});
					return { action: "applied", targetScenes: diff.targetScenes };
				} else if (diff.action === "clear") {
					await sceneManager.clearAll(
						workspaceRoot,
						{ sceneRepository, breakpointBridge },
					);
					return { action: "cleared" };
				}
			} else if (currentActives.length > 0 && !sceneStateManager.isApplyingScene()) {
				return this.handleTopologyDiff(workspaceRoot, catalog, currentActives, {
					breakpointBridge,
					isDebuggingActive,
					onPendingMessage,
				});
			}

			return { action: "noop" };
		});
	}
}

// 导出统一单例对象实例 (Singleton Instance)
export const agentSyncService = new AgentSyncService();
