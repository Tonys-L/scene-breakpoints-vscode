import type { IBreakpointBridge, ISceneRepository } from "#src/domain/ports";
import { Scene } from "#src/domain/models/scene";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";
import { ActiveScenesDiffResolver } from "#src/domain/services/activeScenesDiffResolver";
import { sceneStateManager } from "./sceneStateManager";
import { sceneManager } from "./sceneManager";
import { SerialQueue } from "./serialQueue";
import { getDependencies } from "./dependencies";

export interface EnrichAllSceneFingerprintsOptions {
	sceneRepository?: ISceneRepository;
	loopGuard?: { markInternalSaving: () => void };
	fileLinesReader?: (filePath: string) => Promise<string[] | undefined>;
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
	loopGuard?: { markInternalSaving: () => void };
	fileLinesReader?: (filePath: string) => Promise<string[] | undefined>;
	onPendingMessage?: () => void;
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
	constructor(private readonly queue: SerialQueue = new SerialQueue()) {}

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
			const loopGuard = options?.loopGuard || defaultDeps.loopGuard;
			const fileLinesReader = options?.fileLinesReader;

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

			const fileCache = new Map<string, string[] | undefined>();
			const readLines = async (filePath: string): Promise<string[] | undefined> => {
				if (fileCache.has(filePath)) {
					return fileCache.get(filePath);
				}
				const lines = fileLinesReader ? await fileLinesReader(filePath) : undefined;
				fileCache.set(filePath, lines);
				return lines;
			};

			let enrichedCount = 0;
			for (const bp of unfingerprintedBps) {
				if (bp.type === "function") continue;
				const fullPath = bp.resolveFullPath(workspaceRoot);
				const lines = await readLines(fullPath);
				if (!lines || lines.length === 0) continue;

				if (bp.enrich(lines)) {
					enrichedCount++;
				}
			}

			if (enrichedCount > 0) {
				loopGuard?.markInternalSaving();
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
		fileLinesReader: (filePath: string) => Promise<string[] | undefined>,
		loopGuard?: { markInternalSaving: () => void },
	): Promise<void> {
		try {
			const configForEnrich = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalogForEnrich = new SceneCatalog(configForEnrich);
			const unfingerprintedBps = catalogForEnrich.getAllScenes().flatMap((s) => s.getUnfingerprintedBreakpoints());

			if (unfingerprintedBps.length === 0) return;

			let enriched = false;
			for (const bp of unfingerprintedBps) {
				if (bp.type === "function") continue;
				const fullPath = bp.resolveFullPath(workspaceRoot);
				const lines = await fileLinesReader(fullPath);
				if (lines && lines.length > 0 && bp.enrich(lines)) {
					enriched = true;
				}
			}
			if (enriched) {
				loopGuard?.markInternalSaving();
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
		const activeScenes = currentActives
			.map((name) => catalog.getScene(name))
			.filter((s): s is Scene => !!s);
		const merged = Scene.merge(activeScenes).getBreakpoints().map((bp) => bp.toJSON());
		const newTopologyHash = ActiveScenesDiffResolver.computeTopologyHash(merged);

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
			const loopGuard = options?.loopGuard || defaultDeps.loopGuard;
			const allowAiActivation = options?.allowAiActivation ?? false;
			const isDebuggingActive = options?.isDebuggingActive ?? false;
			const fileLinesReader = options?.fileLinesReader;
			const onPendingMessage = options?.onPendingMessage;

			if (!sceneRepository || !breakpointBridge) {
				return { action: "noop" };
			}

			// 1. 静默预补齐指纹
			if (fileLinesReader) {
				await this.autoEnrichEmptyFingerprints(workspaceRoot, sceneRepository, fileLinesReader, loopGuard);
			}

			// 2. 外部变更差异比对 (Diff Engine)
			const config = sceneRepository.loadScenesConfig(workspaceRoot);
			const catalog = new SceneCatalog(config);
			const currentActives = sceneStateManager.getActiveScenes();

			const diff = ActiveScenesDiffResolver.resolveActiveScenesDiff({
				currentActiveScenes: currentActives,
				rawActiveScenes: config.activeScenes,
				allowAiActivation,
				scenesDict: config.scenes,
			});

			if (diff.shouldApply) {
				if (diff.action === "apply" && diff.targetScenes && diff.targetScenes.length > 0) {
					await sceneManager.activateScene(
						workspaceRoot,
						diff.targetScenes,
						{ sceneRepository, breakpointBridge, loopGuard },
					);
					return { action: "applied", targetScenes: diff.targetScenes };
				} else if (diff.action === "clear") {
					await sceneManager.clearAll(
						workspaceRoot,
						{ sceneRepository, breakpointBridge, loopGuard },
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
