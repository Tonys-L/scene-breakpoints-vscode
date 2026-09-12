import * as fs from "node:fs";
import * as vscode from "vscode";
import { handleExternalChange } from "../../../application/sceneService";
import { getWorkspaceRoot, isContentMatchingLastSaved } from "../../storage/jsonFileSceneRepository";
import { saveLoopGuard } from "../../storage/saveLoopGuard";
import { SceneTreeDataProvider } from "../sceneTreeProvider";

const syncCoordinator = saveLoopGuard;

/**
 * 响应外部 debug-scenes.json 变更与 AI 声明式场景激活
 * 职责：读取配置开关、感知调试会话状态并展示状态栏提示，将业务调度委托给 handleExternalChange
 */
export async function handleExternalScenesFileChange(workspaceRoot: string): Promise<void> {
	const allowAiActivation = vscode.workspace
		.getConfiguration("sceneBreakpoints")
		.get<boolean>("allowAiFileActivation", false);

	await handleExternalChange({
		workspaceRoot,
		allowAiActivation,
		isDebuggingActive: !!vscode.debug.activeDebugSession,
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
 * 职责：监听 debug-scenes.json 磁盘文件变化，施加防抖与内部写盘指纹拦截，调度外部变更并刷新树视图
 */
export function registerConfigFileWatcherService(
	treeDataProvider: SceneTreeDataProvider,
): vscode.Disposable {
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

			if (syncCoordinator.isInternalSaving()) {
				return;
			}

			// 调度处理外部文件变更
			const workspaceRoot = getWorkspaceRoot(false);
			if (workspaceRoot) {
				await handleExternalScenesFileChange(workspaceRoot);
			}
			treeDataProvider.refresh();
		}, 100);
	});

	fileWatcher.onDidCreate(() => treeDataProvider.refresh());
	fileWatcher.onDidDelete(() => treeDataProvider.refresh());

	return fileWatcher;
}

export const registerConfigFileWatcher = registerConfigFileWatcherService;
