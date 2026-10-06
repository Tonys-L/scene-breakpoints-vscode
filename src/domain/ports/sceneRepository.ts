import type { ScenesConfig } from "#src/domain/types";

/**
 * 场景配置分层来源 (v1.2.0 INV-032)
 * - team: 团队公共层 `.vscode/debug-scenes.json`（纳入 Git 版本管理）
 * - local: 个人私有层 `.vscode/debug-scenes.local.json`（个人临时调试场景，不入 Git）
 */
export type SceneLayerOrigin = "team" | "local";

/**
 * 分层合并加载结果：合并视图配置 + 场景级来源溯源表
 * originByScene 表达每个场景名当前生效的声明层（同名场景 local 覆盖 team）
 */
export interface MergedScenesLoad {
	config: ScenesConfig;
	originByScene: Record<string, SceneLayerOrigin>;
}

/**
 * 核心层能力契约：场景配置持久化仓储端口 (ISceneRepository)
 * 职责：定义场景配置的读取、原子写盘与路径推导纯契约，技术层实现此接口
 *
 * v1.2.0 分层扩展（可选方法）：未实现分层方法的仓储替身（测试内存实现）自动回退单文件语义，
 * 生产实现 `jsonFileSceneRepository` 必须完整实现分层三方法
 */
export interface ISceneRepository {
	/** 读取指定工作区的场景配置文件（生产实现返回 team+local 合并视图） */
	loadScenesConfig(workspaceRoot: string): ScenesConfig;

	/** 同步保存场景配置文件至磁盘（生产实现按来源溯源表分层路由） */
	saveScenesConfig(workspaceRoot: string, config: ScenesConfig): void;

	/** 获取场景配置文件物理路径 */
	getScenesConfigPath(workspaceRoot: string): string;

	/** 获取个人私有层配置文件物理路径（v1.2.0 分层） */
	getLocalScenesConfigPath?(workspaceRoot: string): string;

	/** 分层合并加载：返回合并视图与场景级来源溯源表（v1.2.0 分层） */
	loadMergedScenesConfig?(workspaceRoot: string): MergedScenesLoad;

	/** 分层回写：按来源溯源表将场景分流写回 team/local 两层（v1.2.0 分层） */
	saveScenesLayers?(workspaceRoot: string, config: ScenesConfig, originByScene: Record<string, SceneLayerOrigin>): void;
}
