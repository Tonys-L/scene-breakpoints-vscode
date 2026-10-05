import * as fs from "node:fs";
import * as vscode from "vscode";
import { agentSyncService } from "#src/application";
import { isContentMatchingLastSaved, jsonFileSceneRepository } from "#src/infra/storage/jsonFileSceneRepository";
import { getWorkspaceRoot } from "#src/infra/vscode/workspaceRoot";


import { echoLoopGuard } from "#src/infra/storage/echoLoopGuard";
import { vscodeBreakpointBridge } from "#src/infra/vscode/vscodeBreakpointBridge";
import { vscodeLineReader } from "#src/infra/vscode/vscodeLineReader";
import { appEventBus } from "#src/application/eventBus";

/**
 * 响应外部 debug-scenes.json 变更与 AI 声明式场景激活
 * 职责：读取配置开关、感知调试会话状态并展示状态栏提示，将业务调度委托给 AgentSyncService
 */
export async function handleExternalScenesFileChange(workspaceRoot: string): Promise<void> {
	const allowAiActivation = vscode.workspace
		.getConfiguration("sceneBreakpoints")
		.get<boolean>("allowAiFileActivation", false);

	await agentSyncService.handleExternalChange(workspaceRoot, {
		allowAiActivation,
		isDebuggingActive: !!vscode.debug.activeDebugSession,
		sceneRepository: jsonFileSceneRepository,
		breakpointBridge: vscodeBreakpointBridge,
		lineReader: vscodeLineReader,
		onPendingMessage: () => {
			vscode.window.setStatusBarMessage(
				vscode.l10n.t("$(alert) Breakpoint changes pending. Will apply on next debug session."),
				5000,
			);
		},
	});

}


/**
 * 配置文件文件系统监听服务 (Config File Watcher Listener)
 * 职责：监听 debug-scenes.json 磁盘文件变化，施加防抖与内部写盘指纹拦截，调度外部变更并通过 appEventBus 广播事件
 */
export function registerConfigFileWatcherService(): vscode.Disposable {
	let fileChangeDebounceTimer: NodeJS.Timeout | undefined;
	const fileWatcher = vscode.workspace.createFileSystemWatcher("**/debug-scenes.json");

	fileWatcher.onDidChange((uri) => {
		if (fileChangeDebounceTimer) {
			clearTimeout(fileChangeDebounceTimer);
		}
		fileChangeDebounceTimer = setTimeout(async () => {
			fileChangeDebounceTimer = undefined;
			// 严密指纹守卫：比对磁盘内容，若与扩展最近一次内部写盘内容一致，确定为自身持久化行为，阻断二次重复刷新
			try {
				if (fs.existsSync(uri.fsPath)) {
					const currentDiskContent = fs.readFileSync(uri.fsPath, "utf-8");
					if (isContentMatchingLastSaved(currentDiskContent)) {
						return;
					}
				}
			} catch {
				// 文件占用写入时忽略
			}

			if (echoLoopGuard.isInternalSaving()) {
				return;
			}

			// 调度处理外部文件变更
			const workspaceRoot = getWorkspaceRoot();
			if (workspaceRoot) {
				await handleExternalScenesFileChange(workspaceRoot);
				appEventBus.emit("scenes:changed", { workspaceRoot, reason: "external_file_change" });
			}
		}, 100);
	});

	fileWatcher.onDidCreate(() => {
		const workspaceRoot = getWorkspaceRoot() || "";
		appEventBus.emit("scenes:changed", { workspaceRoot, reason: "file_created" });
	});
	fileWatcher.onDidDelete(() => {
		const workspaceRoot = getWorkspaceRoot() || "";
		appEventBus.emit("scenes:changed", { workspaceRoot, reason: "file_deleted" });
	});

	return fileWatcher;
}

export const registerConfigFileWatcher = registerConfigFileWatcherService;
