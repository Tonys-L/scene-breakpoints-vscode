import * as fs from "node:fs";
import * as vscode from "vscode";
import { getWorkspaceRoot, isContentMatchingLastSaved } from "../../infra/storage/jsonFileSceneRepository";
import { SceneTreeDataProvider } from "../../infra/vscode/sceneTreeProvider";
import { saveLoopGuard } from "../saveLoopGuard";
const syncCoordinator = saveLoopGuard;
import { handleExternalScenesFileChange } from "./aiActivationPolicy";

/**
 * 配置文件文件系统监听服务 (Config File Watcher Service)
 * 职责：专职负责监听 debug-scenes.json 磁盘文件变化，施加防抖与内部写盘指纹拦截，调度外部变更并刷新树视图
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
			// 严密指纹守卫：比对磁盘内容，若与扩展最近一次内部写盘内容一致，100% 确定为自身持久化行为
			// 坚决直接返回，彻底阻断文件系统异步延迟推送导致的二次重复整树重绘与断点重复重装
			try {
				if (fs.existsSync(uri.fsPath)) {
					const currentDiskContent = fs.readFileSync(uri.fsPath, "utf-8");
					if (isContentMatchingLastSaved(currentDiskContent)) {
						return;
					}
				}
			} catch {
				// 文件正在占用写入中时忽略异常
			}

			if (syncCoordinator.isInternalSaving()) {
				return;
			}

			// 调度领域层处理外部文件变更（支持 AI activeScenes 声明式自动激活与热重载）
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

