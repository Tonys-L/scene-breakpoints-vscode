import type { IBreakpointBridge, ISceneRepository, SceneLayerOrigin } from "#src/domain/ports";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";
import { expandScenes } from "#src/domain/services/sceneResolver";
import { computeTopologyHash } from "#src/domain/services/activeScenesDiffResolver";
import type { SceneBreakpoint } from "#src/domain/types";
import { sceneStateManager } from "./sceneStateManager";
import { activeBreakpointIndex } from "./activeBreakpointIndex";
import { applicationSerialQueue, type SerialQueue } from "./serialQueue";
import { getDependencies } from "./dependencies";
import { appEventBus } from "./eventBus";

export interface MutateCatalogOptions {
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	syncActive?: boolean;
	notify?: { sceneName?: string };
	queue?: SerialQueue;
	reason?: string;
	silent?: boolean;
}

export type CatalogMutationOptions = MutateCatalogOptions;

function getMergedActiveBreakpoints(catalog: SceneCatalog, activeScenes: string[]): SceneBreakpoint[] {
	// 引用展开流接入（§2.7/§5.4）：与激活管道同源 expandScenes，保证拓扑哈希一致性
	return expandScenes(catalog, activeScenes).steps.map((s) => s.breakpoint.raw);
}

async function syncActiveBreakpointsIfNeeded(
	workspaceRoot: string,
	catalog: SceneCatalog,
	activeScenes: string[],
	breakpointBridge?: IBreakpointBridge,
): Promise<void> {
	if (activeScenes.length === 0) return;

	const survivingActiveScenes = catalog.getHasExplicitActiveScenes() && catalog.getActiveScenes().length === 0
		? []
		: (catalog.getActiveScenes().length > 0
			? catalog.getActiveScenes().filter((s) => catalog.hasScene(s))
			: activeScenes.filter((s) => catalog.hasScene(s)));

	const newActiveBps = getMergedActiveBreakpoints(catalog, survivingActiveScenes);
	const newHash = computeTopologyHash(newActiveBps);
	const currentHash = sceneStateManager.getLastAppliedTopologyHash();

	if (newHash !== currentHash || survivingActiveScenes.length !== activeScenes.length) {
		if (breakpointBridge) {
			if (survivingActiveScenes.length === 0) {
				await breakpointBridge.clearAllBreakpoints();
			} else {
				const primaryLabel = survivingActiveScenes.length === 1
					? survivingActiveScenes[0]
					: survivingActiveScenes.join(" + ");
				await breakpointBridge.applySceneBreakpoints(workspaceRoot, primaryLabel, newActiveBps);
			}
		}
		sceneStateManager.setLastAppliedTopologyHash(newHash);
		sceneStateManager.setActiveScenes(survivingActiveScenes, newActiveBps.length);
		activeBreakpointIndex.sync(workspaceRoot, catalog.toJSON().scenes, survivingActiveScenes);
	}
}

/**
 * 统一原子写事务管道 (Single-Writer Mutation Pipeline - INV-010 / ADR-003)
 * 职责：统一承接对 SceneCatalog 的写事务执行、落盘持久化、活跃场景断点增量同步与事件广播
 */
export async function mutateCatalog<T = boolean>(
	workspaceRoot: string,
	action: (catalog: SceneCatalog) => Promise<T> | T,
	options?: MutateCatalogOptions,
	legacyNotify?: { sceneName?: string },
	legacyQueue?: SerialQueue,
): Promise<T> {
	const queue = options?.queue ?? legacyQueue ?? applicationSerialQueue;
	const notify = options?.notify ?? legacyNotify;

	return queue.enqueue(async () => {
		const defaultDeps = getDependencies();
		const sceneRepository = options?.sceneRepository || defaultDeps.sceneRepository;
		const breakpointBridge = options?.breakpointBridge || defaultDeps.breakpointBridge;
		if (!sceneRepository) {
			throw new Error("mutateCatalog: sceneRepository must be configured");
		}

		// v1.2.0 分层加载 (INV-032)：优先走分层端口获取来源溯源表；仓储替身（未实现分层）回退单文件语义
		const merged = sceneRepository.loadMergedScenesConfig?.(workspaceRoot);
		const config = merged ? merged.config : sceneRepository.loadScenesConfig(workspaceRoot);
		const catalog = new SceneCatalog(config);

		const shouldSyncActive = options?.syncActive !== false;
		const activeScenes = shouldSyncActive ? sceneStateManager.getActiveScenes() : [];

		const result = await action(catalog);
		if (result) {
			if (merged && sceneRepository.saveScenesLayers) {
				// 分层回写路由 (INV-032)：新增场景（合并视图中不存在）缺省落 local 私有层，杜绝临时场景污染 Git
				const originByScene: Record<string, SceneLayerOrigin> = { ...merged.originByScene };
				for (const name of Object.keys(catalog.toJSON().scenes || {})) {
					if (!(name in originByScene)) originByScene[name] = "local";
				}
				sceneRepository.saveScenesLayers(workspaceRoot, catalog.toJSON(), originByScene);
			} else {
				sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
			}

			if (shouldSyncActive) {
				await syncActiveBreakpointsIfNeeded(workspaceRoot, catalog, activeScenes, breakpointBridge);
			}

			if (!options?.silent) {
				appEventBus.emit("scenes:changed", { workspaceRoot, reason: options?.reason });
			}
			if (notify?.sceneName) {
				appEventBus.emit("breakpoints:changed", { workspaceRoot, sceneName: notify.sceneName });
			}
		}
		return result;
	});
}
