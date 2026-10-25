import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { echoLoopGuard } from "./echoLoopGuard";
import { AtomicFileJsonStore, type ISelfHealingStore } from "./atomicFileJsonStore";
import { stripComments, hasGitConflictMarkers } from "#src/shared/utils/textUtils";
import type { ScenesConfig } from "#src/domain/types";
import type {
	ISceneRepository,
	MergedScenesLoad,
	SceneLayerOrigin,
} from "#src/domain/ports/sceneRepository";
import { sanitizeScenesConfig } from "#src/domain/services/scenePayloadCodec";

/**
 * 存储层用户通知抽象 (消除基础设施直接对 VS Code 弹窗硬绑定)
 */
export interface StorageNotifier {
	error(message: string): void;
	info(message: string): void;
	warn(message: string): void;
}

const defaultNotifier: StorageNotifier = {
	error: (msg) => {
		void vscode.window.showErrorMessage(msg);
	},
	info: (msg) => {
		void vscode.window.showInformationMessage(msg);
	},
	warn: (msg) => {
		void vscode.window.showWarningMessage(msg);
	},
};

let activeNotifier: StorageNotifier = defaultNotifier;

export function setStorageNotifier(notifier: StorageNotifier): void {
	activeNotifier = notifier;
}

export function resetStorageNotifier(): void {
	activeNotifier = defaultNotifier;
}

export function getScenesConfigPath(workspaceRoot: string): string {
	return path.join(workspaceRoot, ".vscode", "debug-scenes.json");
}

/**
 * 个人私有层配置路径 (v1.2.0 INV-032)：`debug-scenes.local.json`，
 * 插件激活时自动确保该文件名加入 `.gitignore`，杜绝个人临时场景污染 Git 仓库
 */
export function getLocalScenesConfigPath(workspaceRoot: string): string {
	return path.join(workspaceRoot, ".vscode", "debug-scenes.local.json");
}

export { hasGitConflictMarkers, sanitizeScenesConfig };
export const stripJsonComments = stripComments;

const atomicStore: ISelfHealingStore<ScenesConfig, string> = new AtomicFileJsonStore<ScenesConfig>();

// 最近一次分层合并的场景级来源溯源表（按工作区主文件路径隔离，防多工作区/测试串扰）
const lastMergedOriginByWorkspace = new Map<string, Record<string, SceneLayerOrigin>>();

/**
 * 单层配置读取（原子自愈加载 + Git 冲突标记拦截）
 * v1.2.0：由单文件 loadScenesConfig 参数化抽取，供 team/local 双层复用
 */
function readLayerConfig(configPath: string): ScenesConfig {
	if (!fs.existsSync(configPath)) {
		return { scenes: {} };
	}

	try {
		const raw = fs.readFileSync(configPath, "utf-8");
		if (hasGitConflictMarkers(raw)) {
			activeNotifier.error(
				vscode.l10n.t("Scene configuration has Git merge conflicts. Please resolve them first."),
			);
			return { scenes: {} };
		}
	} catch {
		// 忽略读取错误，交由 atomicStore 完整性自愈管道处理
	}

	try {
		const report = atomicStore.load(configPath, {
			fallback: () => ({ scenes: {} }),
			parse: (text) => JSON.parse(stripJsonComments(text)),
			validate: (data): data is ScenesConfig => Boolean(data && typeof data === "object"),
			onHealed: (msg) => {
				activeNotifier.info(
					vscode.l10n.t("Scene configuration self-healed: {0}", msg),
				);
			},
		});

		if (report.status === "healed") {
			echoLoopGuard.markInternalSaving();
		}

		return sanitizeScenesConfig(report.data);
	} catch (e: any) {
		activeNotifier.error(vscode.l10n.t("Failed to read debug-scenes.json: {0}", e?.message || String(e)));
		return { scenes: {} };
	}
}

/**
 * 分层加载核心 (v1.2.0 INV-032)
 * - team 层：主文件完整配置（含 activeScenes，激活态仅存主文件）
 * - local 层：私有文件仅承载 scenes 字典
 * - 合并语义：同名场景 local 覆盖 team（就近覆盖，个人临时调试行号覆写团队场景）
 * - originByScene：场景级来源溯源表，供分层回写路由
 */
function loadLayers(workspaceRoot: string): MergedScenesLoad {
	const teamConfig = readLayerConfig(getScenesConfigPath(workspaceRoot));
	const localConfig = readLayerConfig(getLocalScenesConfigPath(workspaceRoot));

	const originByScene: Record<string, SceneLayerOrigin> = {};
	for (const name of Object.keys(teamConfig.scenes || {})) {
		originByScene[name] = "team";
	}
	for (const name of Object.keys(localConfig.scenes || {})) {
		originByScene[name] = "local";
	}

	const mergedConfig: ScenesConfig = {
		...teamConfig,
		scenes: { ...teamConfig.scenes, ...localConfig.scenes },
	};

	// 记录最近一次合并来源（供旧版 saveScenesConfig 单文件调用方分层路由），按工作区隔离防测试串扰
	lastMergedOriginByWorkspace.set(getScenesConfigPath(workspaceRoot), originByScene);

	return { config: mergedConfig, originByScene };
}

export function loadMergedScenesConfig(workspaceRoot: string): MergedScenesLoad {
	return loadLayers(workspaceRoot);
}

export function loadScenesConfig(workspaceRoot: string): ScenesConfig {
	return loadLayers(workspaceRoot).config;
}

/**
 * 单层原子落盘 + 键控回环基线记录 (v1.2.0)
 * 每个物理文件独立维护 echoLoopGuard 基线（per-file 键控），team/local 互不串扰
 */
function writeLayerConfig(configPath: string, config: ScenesConfig, isTeamLayer: boolean): void {
	echoLoopGuard.markInternalSaving();
	const content = JSON.stringify(config, null, 2);
	echoLoopGuard.setLastSavedContentForKey(configPath, content);
	// 主文件（team 层）写盘时同步维护默认键基线：watcher 回环守卫 (isContentMatchingLastSaved) 沿用默认键
	if (isTeamLayer) {
		echoLoopGuard.setLastSavedContent(content);
	}
	atomicStore.save(configPath, config);
}

/**
 * 分层回写 (v1.2.0 INV-032)
 * - origin team（或溯源表缺失的历史场景）→ 主文件
 * - origin local / 新增场景（溯源表缺失）→ 私有文件
 * - activeScenes 仅随 team 层落主文件；local 文件仅承载 scenes 字典
 * - local 层为空时不创建/改写私有文件，避免无谓文件噪音
 */
export function saveScenesLayers(
	workspaceRoot: string,
	config: ScenesConfig,
	originByScene: Record<string, SceneLayerOrigin>,
): void {
	const teamScenes: Record<string, ScenesConfig["scenes"][string]> = {};
	const localScenes: Record<string, ScenesConfig["scenes"][string]> = {};
	for (const [name, items] of Object.entries(config.scenes || {})) {
		if (originByScene[name] === "local") {
			localScenes[name] = items;
		} else {
			teamScenes[name] = items;
		}
	}

	try {
		writeLayerConfig(getScenesConfigPath(workspaceRoot), { ...config, scenes: teamScenes }, true);

		if (Object.keys(localScenes).length > 0) {
			writeLayerConfig(getLocalScenesConfigPath(workspaceRoot), { scenes: localScenes }, false);
		}
	} catch (e: any) {
		activeNotifier.error(vscode.l10n.t("Failed to save debug-scenes.json: {0}", e?.message || String(e)));
	}
}

export function saveScenesConfig(workspaceRoot: string, config: ScenesConfig): void {
	// 旧版单文件调用方（agentSync 回填 / 激活管道回写）：以上一次合并来源路由；
	// 新增场景（合并视图中不存在，溯源缺失）缺省落 local 私有层，杜绝临时场景污染 Git (INV-032)
	const originByScene: Record<string, SceneLayerOrigin> = {
		...(lastMergedOriginByWorkspace.get(getScenesConfigPath(workspaceRoot)) ?? {}),
	};
	for (const name of Object.keys(config.scenes || {})) {
		if (!(name in originByScene)) originByScene[name] = "local";
	}
	saveScenesLayers(workspaceRoot, config, originByScene);
}

export function isContentMatchingLastSaved(content: string): boolean {
	return echoLoopGuard.isContentMatchingLastSaved(content);
}

export function getLastSavedContent(): string {
	return echoLoopGuard.getLastSavedContent();
}

/**
 * 冷启动基线播种 (INV-031 前置)：扩展启动时以磁盘现状播种 team/local 双层键控基线，
 * 保证 Git Pull / 环境漂移在冷启动后仍可静默自愈。播种失败仅告警，不阻断启动
 */
export function seedEchoLoopBaselineFromDisk(workspaceRoot: string): void {
	try {
		for (const configPath of [getScenesConfigPath(workspaceRoot), getLocalScenesConfigPath(workspaceRoot)]) {
			if (fs.existsSync(configPath)) {
				echoLoopGuard.seedBaselineForKey(configPath, fs.readFileSync(configPath, "utf-8"));
			}
		}
	} catch (e) {
		console.warn("[SceneStorage] Failed to seed echo loop baseline from disk:", e);
	}
}

/**
 * 命令路径外部编辑信号 (INV-031 门控)：主文件磁盘内容相对最近一次内部写盘基线是否发生漂移
 * （local 层外部编辑经 watcher 路径显式标记门控，无需命令路径漂移信号）
 */
export function isDiskContentModifiedSinceLastSaved(workspaceRoot: string): boolean {
	try {
		const configPath = getScenesConfigPath(workspaceRoot);
		if (!fs.existsSync(configPath)) return false;
		return echoLoopGuard.isDiskContentModifiedSinceLastSaveForKey(
			configPath,
			fs.readFileSync(configPath, "utf-8"),
		);
	} catch (e) {
		console.warn("[SceneStorage] Failed to detect disk config modification:", e);
		return false;
	}
}

/**
 * 确保 `.gitignore` 包含个人私有层文件名 (v1.2.0 INV-032，幂等)
 * 返回是否发生了追加写入（用于激活反馈与测试断言）
 */
export function ensureLocalScenesGitignore(workspaceRoot: string): boolean {
	const LOCAL_ENTRY = "debug-scenes.local.json";
	const TRACE_ENTRY = "debug-trace.local.json";
	try {
		const gitignorePath = path.join(workspaceRoot, ".gitignore");
		const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : "";
		const lines = existing.split(/\r?\n/).map((l) => l.trim());
		const hasLocal = lines.includes(LOCAL_ENTRY) || lines.includes(`.vscode/${LOCAL_ENTRY}`);
		const hasTrace = lines.includes(TRACE_ENTRY) || lines.includes(`.vscode/${TRACE_ENTRY}`);
		if (hasLocal && hasTrace) return false;

		const additions: string[] = [];
		if (!hasLocal) additions.push(`.vscode/${LOCAL_ENTRY}`);
		if (!hasTrace) additions.push(`.vscode/${TRACE_ENTRY}`);

		const separator = existing && !existing.endsWith("\n") ? "\n" : "";
		const header = !hasLocal ? "# Scene Breakpoints personal scenes\n" : "";
		fs.writeFileSync(gitignorePath, `${existing}${separator}${header}${additions.join("\n")}\n`, "utf-8");
		return true;
	} catch (e) {
		console.warn("[SceneStorage] Failed to update .gitignore for local scenes:", e);
		return false;
	}
}

export const jsonFileSceneRepository: ISceneRepository = {
	loadScenesConfig,
	saveScenesConfig,
	getScenesConfigPath,
	getLocalScenesConfigPath,
	loadMergedScenesConfig,
	saveScenesLayers,
};
