import type { IBreakpointBridge, ISceneRepository } from "../domain/ports";
import { mergeScenesBreakpoints } from "../domain/sceneOperations";
import { sceneStateManager } from "../domain/sceneStateManager";
import type { SourceSceneBreakpoint } from "../domain/types";
import { jsonFileSceneRepository } from "../infra/storage/jsonFileSceneRepository";
import { saveLoopGuard as defaultLoopGuard } from "../infra/storage/saveLoopGuard";
import { vscodeBreakpointBridge } from "../infra/vscode/vscodeBreakpointBridge";
import { useCaseQueue } from "./useCaseQueue";

export interface ActivateSceneParams {
	workspaceRoot: string;
	targetScenes: string[];
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	loopGuard?: { markInternalSaving: () => void };
}

export interface ActivateSceneResult {
	success: boolean;
	validTargetScenes: string[];
	missingScenes: string[];
	loadedCount: number;
	healedCount: number;
	unmatchedCount: number;
}

/**
 * 场景激活核心用例 (Activate Scene)
 * 职责：纯业务流程编排，受串行互斥队列保护，杜绝任何 VS Code 弹窗或 UI 交互耦合
 * 流程：校验存在性 -> 合并断点 -> 写入权威持久化 SSOT (debug-scenes.json) -> 装配 DAP -> 投影更新至内存状态机 -> 闭环持久化自愈
 */
export async function activateScene(
	params: ActivateSceneParams,
): Promise<ActivateSceneResult> {
	return useCaseQueue.run(async () => {
		const {
			workspaceRoot,
			targetScenes: rawTargetScenes,
			sceneRepository = jsonFileSceneRepository,
			breakpointBridge = vscodeBreakpointBridge,
			loopGuard = defaultLoopGuard,
		} = params;

		const config = sceneRepository.loadScenesConfig(workspaceRoot);
		const sceneNames = Object.keys(config.scenes || {});

		// 1. 过滤幽灵场景与有效性校验 (INV-009)
		const validTargetScenes: string[] = [];
		const missingScenes: string[] = [];

		for (const target of rawTargetScenes) {
			const matched = sceneNames.find((s) => s.toLowerCase() === target.toLowerCase());
			if (matched) {
				validTargetScenes.push(matched);
			} else {
				missingScenes.push(target);
			}
		}

		if (validTargetScenes.length === 0) {
			return {
				success: false,
				validTargetScenes: [],
				missingScenes,
				loadedCount: 0,
				healedCount: 0,
				unmatchedCount: 0,
			};
		}

		// 2. 聚合多场景断点并去重 (INV-001, INV-011)
		const bpsToLoad = mergeScenesBreakpoints(config, validTargetScenes);
		const primarySceneLabel = validTargetScenes.length === 1 ? validTargetScenes[0] : validTargetScenes.join(" + ");

		// 3. 权威持久化 SSOT 写入约束：先落盘 activeScenes，确保磁盘始终是权威 SSOT (INV-010)
		const currentDiskActives = config.activeScenes;
		const isSameActive =
			Array.isArray(currentDiskActives) &&
			currentDiskActives.length === validTargetScenes.length &&
			currentDiskActives.every((s, i) => s === validTargetScenes[i]);

		if (!isSameActive) {
			config.activeScenes = validTargetScenes;
			loopGuard.markInternalSaving();
			sceneRepository.saveScenesConfig(workspaceRoot, config);
		}

		// 4. 装配断点至宿主调试器 (INV-002, INV-005)
		const applyResult = await breakpointBridge.applySceneBreakpoints(
			workspaceRoot,
			primarySceneLabel,
			bpsToLoad,
		);

		const { loadedCount, healedCount } = applyResult;
		const healedBreakpoints = applyResult.healedBreakpoints;
		const unmatchedCount = (applyResult as any).unmatchedBreakpoints?.length || 0;

		// 5. 将持久化结果投影更新至内存状态机，驱动 UI 渲染 (INV-004)
		sceneStateManager.setActiveScenes(validTargetScenes, loadedCount);

		// 6. 自愈持久化闭环 (Self-Healing Persistence Loopback)
		if (healedCount > 0 && healedBreakpoints) {
			let hasPersisted = false;
			if (validTargetScenes.length === 1) {
				config.scenes[validTargetScenes[0]] = healedBreakpoints;
				hasPersisted = true;
			} else {
				for (const sceneName of validTargetScenes) {
					const sceneList = config.scenes[sceneName];
					if (!Array.isArray(sceneList)) continue;
					for (const item of sceneList) {
						if (item.type === "function") continue;
						const srcItem = item as SourceSceneBreakpoint;
						const matched = healedBreakpoints.find(
							(h): h is SourceSceneBreakpoint =>
								h.type !== "function" &&
								(h as SourceSceneBreakpoint).file === srcItem.file &&
								(h as SourceSceneBreakpoint).contextSnippet?.current === srcItem.contextSnippet?.current,
						);
						if (matched && srcItem.line !== matched.line) {
							srcItem.line = matched.line;
							hasPersisted = true;
						}
					}
				}
			}
			if (hasPersisted) {
				loopGuard.markInternalSaving();
				sceneRepository.saveScenesConfig(workspaceRoot, config);
			}
		}

		return {
			success: true,
			validTargetScenes,
			missingScenes,
			loadedCount,
			healedCount,
			unmatchedCount,
		};
	});
}

export const activateSceneUseCase = activateScene;
export type ActivateSceneUseCaseParams = ActivateSceneParams;
export type ActivateSceneUseCaseResult = ActivateSceneResult;

export const activateScenePolicy = activateScene;
export type ActivateScenePolicyParams = ActivateSceneParams;
export type ActivateScenePolicyResult = ActivateSceneResult;
