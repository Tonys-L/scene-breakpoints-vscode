import type { ScenesConfig } from "../types";

/**
 * 核心层能力契约：场景配置持久化仓储端口 (ISceneRepository)
 * 职责：定义场景配置的读取、原子写盘与路径推导纯契约，技术层实现此接口
 */
export interface ISceneRepository {
	/** 读取指定工作区的场景配置文件 */
	loadScenesConfig(workspaceRoot: string): ScenesConfig;

	/** 同步保存场景配置文件至磁盘 */
	saveScenesConfig(workspaceRoot: string, config: ScenesConfig): void;

	/** 异步通过互斥队列原子写入场景配置文件 */
	saveScenesConfigAtomic(workspaceRoot: string, config: ScenesConfig): Promise<void>;

	/** 获取场景配置文件物理路径 */
	getScenesConfigPath(workspaceRoot: string): string;
}
