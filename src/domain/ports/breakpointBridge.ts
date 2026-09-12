import type { SceneBreakpoint, SourceSceneBreakpoint } from "../types";

export interface ApplySceneResult {
	loadedCount: number;
	healedCount: number;
	healedBreakpoints?: SceneBreakpoint[];
	unmatchedBreakpoints?: SourceSceneBreakpoint[];
}

/**
 * 核心层能力契约：宿主断点桥接端口 (IBreakpointBridge)
 * 职责：定义操作宿主调试断点（装配、抓取、清除、单点同步）的纯契约，技术层实现此接口
 */
export interface IBreakpointBridge {
	/** 将指定断点集合全量装配至宿主调试器 */
	applySceneBreakpoints(
		workspaceRoot: string,
		targetScene: string,
		bpsToLoad: SceneBreakpoint[],
	): Promise<ApplySceneResult>;

	/** 采集当前宿主调试器中已存在的所有原生断点 */
	collectCurrentBreakpoints(workspaceRoot: string): Promise<SceneBreakpoint[]>;

	/** 清空宿主调试器中现存的所有断点 */
	clearAllBreakpoints(): Promise<void>;

	/** 单点即刻点亮注入单个断点至宿主调试器 */
	applySingleBreakpointToEditor(
		workspaceRoot: string,
		bp: SceneBreakpoint,
	): Promise<void>;

	/** 同步宿主调试器中单个断点的启用/禁用状态 */
	syncBreakpointEnabledToEditor(
		workspaceRoot: string,
		bp: SceneBreakpoint,
		enabled: boolean,
	): Promise<boolean>;
}
