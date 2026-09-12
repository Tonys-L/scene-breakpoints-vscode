import type { IBreakpointBridge, ISceneRepository } from "../core/ports";
import { computeBreakpointsTopologyHash, resolveActiveScenesDiff } from "../core/activationResolver";
import { mergeScenesBreakpoints } from "../core/sceneOperations";
import { sceneStateManager } from "../core/sceneStateManager";
import { jsonFileSceneRepository } from "../infra/storage/jsonFileSceneRepository";
import { vscodeBreakpointBridge } from "../infra/vscode/vscodeBreakpointBridge";
import { activateScenePolicy } from "./activateScenePolicy";
import { clearAllPolicy } from "./clearAllPolicy";

export interface ExternalChangePolicyParams {
	workspaceRoot: string;
	allowAiActivation: boolean;
	isDebuggingActive: boolean;
	sceneRepository?: ISceneRepository;
	breakpointBridge?: IBreakpointBridge;
	onPendingMessage?: () => void;
}

export interface ExternalChangePolicyResult {
	action: "applied" | "cleared" | "pending" | "noop";
	targetScenes?: string[];
}

/**
 * 外部文件变更调度核心用例 (External Change Policy)
 * 职责：纯策略编排，比对差异 -> 调度激活/清空 -> 会话保护与核心拓扑 Diff
 */
export async function externalChangePolicy(
	params: ExternalChangePolicyParams,
): Promise<ExternalChangePolicyResult> {
	const {
		workspaceRoot,
		allowAiActivation,
		isDebuggingActive,
		sceneRepository = jsonFileSceneRepository,
		breakpointBridge = vscodeBreakpointBridge,
		onPendingMessage,
	} = params;

	const config = sceneRepository.loadScenesConfig(workspaceRoot);
	const currentActives = sceneStateManager.getActiveScenes();

	const diff = resolveActiveScenesDiff({
		allowAiActivation,
		currentActiveScenes: currentActives,
		rawActiveScenes: config.activeScenes,
		scenesDict: config.scenes,
	});

	if (diff.shouldApply) {
		if (diff.action === "apply") {
			await activateScenePolicy({
				workspaceRoot,
				targetScenes: diff.targetScenes,
				sceneRepository,
				breakpointBridge,
			});
			return { action: "applied", targetScenes: diff.targetScenes };
		} else if (diff.action === "clear") {
			await clearAllPolicy({
				workspaceRoot,
				sceneRepository,
				breakpointBridge,
			});
			return { action: "cleared" };
		}
	} else if (currentActives.length > 0 && !sceneStateManager.isApplyingScene()) {
		// 关键防线 2：核心断点拓扑 Diff
		const merged = mergeScenesBreakpoints(config, currentActives);
		const newTopologyHash = computeBreakpointsTopologyHash(merged);

		if (newTopologyHash === sceneStateManager.getLastAppliedTopologyHash()) {
			return { action: "noop" };
		}

		// 关键防线 1：调试会话保护 (策略 A: 挂起策略，绝不打断开发者调试心流)
		if (isDebuggingActive) {
			sceneStateManager.setPendingTopologyUpdate(true);
			if (onPendingMessage) {
				onPendingMessage();
			}
			return { action: "pending" };
		}

		// 拓扑发生实质变更且非调试运行中，平滑重刷装配
		await breakpointBridge.applySceneBreakpoints(
			workspaceRoot,
			currentActives.join("+"),
			merged,
		);
		sceneStateManager.setLastAppliedTopologyHash(newTopologyHash);
		return { action: "applied", targetScenes: currentActives };
	}

	return { action: "noop" };
}
