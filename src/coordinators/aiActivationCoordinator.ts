import * as vscode from "vscode";
import { sceneStateManager } from "../sceneStateManager";
import { applySceneCommand } from "../commands/applyScene";
import { clearAllCommand } from "../commands/clearAll";
import { loadScenesConfig } from "../config/configStorage";
import { mergeScenesBreakpoints } from "../config/sceneOperations";
import {
	computeBreakpointsTopologyHash,
	resolveActiveScenesDiff,
} from "../config/aiActivationResolver";
import { applySceneBreakpoints } from "../breakpointAdapter";

/**
 * AI 激活协同调度器 (AI Activation Coordinator)
 * 职责：专职负责监听与响应外部 debug-scenes.json 变动的副作用调度，驱动命令层与适配器层
 * 消除 config 领域层对 commands 策略层的反向依赖，彻底根除循环依赖
 */
export async function handleExternalScenesFileChange(workspaceRoot: string): Promise<void> {
	const allowAiActivation = vscode.workspace
		.getConfiguration("sceneBreakpoints")
		.get<boolean>("allowAiFileActivation", false);

	const config = loadScenesConfig(workspaceRoot);
	const currentActives = sceneStateManager.getActiveScenes();

	const diff = resolveActiveScenesDiff({
		allowAiActivation,
		currentActiveScenes: currentActives,
		rawActiveScenes: config.activeScenes,
		scenesDict: config.scenes,
	});

	if (diff.shouldApply) {
		if (diff.action === "apply") {
			await applySceneCommand(diff.targetScenes);
		} else if (diff.action === "clear") {
			await clearAllCommand();
		}
	} else if (currentActives.length > 0 && !sceneStateManager.isApplyingScene()) {
		// 关键防线 2：核心断点拓扑 Diff
		// 若断点核心拓扑未发生实质变动 (例如仅改了 desc, bindings, 或未激活场景)，绝对不重刷 DAP
		const merged = mergeScenesBreakpoints(config, currentActives);
		const newTopologyHash = computeBreakpointsTopologyHash(merged);

		if (newTopologyHash === sceneStateManager.getLastAppliedTopologyHash()) {
			return;
		}

		// 关键防线 1：调试会话保护 (策略 A: 挂起策略，绝不打断开发者调试心流)
		if (vscode.debug.activeDebugSession) {
			sceneStateManager.setPendingTopologyUpdate(true);
			vscode.window.setStatusBarMessage(
				vscode.l10n.t("$(alert) Breakpoint changes pending. Will apply on next debug session."),
				5000,
			);
			return;
		}

		// 拓扑发生实质变更且非调试运行中，平滑重刷装配
		await applySceneBreakpoints(workspaceRoot, currentActives.join("+"), merged);
		sceneStateManager.setLastAppliedTopologyHash(newTopologyHash);
	}
}
