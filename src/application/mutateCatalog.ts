import type { IBreakpointBridge, ISceneRepository } from "#src/domain/ports";
import { Scene } from "#src/domain/models/scene";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";
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
	const validScenes = activeScenes.map((name) => catalog.getScene(name)).filter((s): s is Scene => !!s);
	if (validScenes.length === 0) return [];
	return Scene.merge(validScenes).getBreakpoints().map((b) => b.toJSON());
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

		const config = sceneRepository.loadScenesConfig(workspaceRoot);
		const catalog = new SceneCatalog(config);

		const shouldSyncActive = options?.syncActive !== false;
		const activeScenes = shouldSyncActive ? sceneStateManager.getActiveScenes() : [];

		const result = await action(catalog);
		if (result) {
			sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());

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
