import * as vscode from "vscode";
import { breakpointManager } from "#src/application";
import { getWorkspaceRoot } from "#src/infra/vscode/workspaceRoot";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { dapEchoGuard } from "#src/infra/vscode/dapEchoGuard";
import { appEventBus } from "#src/application/eventBus";

/**
 * 断点全双工同步与脏状态服务 (Breakpoint Sync Listener)
 * 职责：专职负责监听 VS Code 编辑器原生断点变动事件，受原子锁与内部写盘防回环保护，调度 syncBreakpointChanges 同步至激活场景并检查脏状态
 */
export function registerBreakpointSyncService(): vscode.Disposable {
	return vscode.debug.onDidChangeBreakpoints(async (event) => {
		if (dapEchoGuard.isApplyingBreakpoints() || sceneStateManager.isApplyingScene()) {
			return;
		}

		const currentCount = vscode.debug.breakpoints.length;
		if (currentCount === 0) {
			sceneStateManager.setActiveScene(undefined, 0);
			return;
		}

		if (event.changed && event.changed.length > 0) {
			const activeScenes = sceneStateManager.getActiveScenes();
			if (activeScenes.length > 0) {
				const workspaceRoot = getWorkspaceRoot();
				if (workspaceRoot) {
					const syncItems = event.changed
						.map((bp: any) => {
							if (bp.functionName) {
								return {
									functionName: bp.functionName,
									enabled: bp.enabled ?? true,
								};
							}
							if (bp.location?.uri?.fsPath && typeof bp.location?.range?.start?.line === "number") {
								return {
									file: bp.location.uri.fsPath,
									line: bp.location.range.start.line + 1,
									enabled: bp.enabled ?? true,
								};
							}
							return null;
						})
						.filter(Boolean) as { file?: string; line?: number; functionName?: string; enabled: boolean }[];

					const hasUpdated = await breakpointManager.syncBreakpointChanges(
						workspaceRoot,
						syncItems,
						activeScenes,
					);

					if (hasUpdated) {
						appEventBus.emit("breakpoints:changed", { workspaceRoot });
					}
				}
			}
		}

		sceneStateManager.checkDirtyWithCount(currentCount);
	});
}
