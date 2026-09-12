export type BreakpointType = "line" | "condition" | "hitCount" | "logpoint" | "function";

export interface BaseBreakpoint {
	type: BreakpointType;
	enabled?: boolean; // 是否启用断点，缺省默认为 true
	desc?: string;
}

export interface ContextSnippet {
	prev?: string; // 上一行特征代码文本（保留缩进）
	current: string; // 当前行特征代码文本（保留缩进）
	next?: string; // 下一行特征代码文本（保留缩进）
	scopeAnchor?: string; // 最近的外层函数/方法名称锚点
	indent?: number; // 前导缩进空格深度
}

export interface SourceSceneBreakpoint extends BaseBreakpoint {
	type: "line" | "condition" | "hitCount" | "logpoint";
	file: string;
	line: number;
	condition?: string; // 表达式为 true 时暂停 (用于 condition)
	hitCondition?: string; // 命中次数条件，如 >5, %10==0 (用于 hitCount)
	logMessage?: string; // 控制台打印日志消息，支持 {var} 插值 (用于 logpoint)
	contextSnippet?: ContextSnippet; // 用于代码行号漂移自愈的上下文指纹
}

export interface FunctionSceneBreakpoint extends BaseBreakpoint {
	type: "function";
	functionName: string;
	condition?: string;
	hitCondition?: string;
}

export type SceneBreakpoint = SourceSceneBreakpoint | FunctionSceneBreakpoint;

export interface ScenesConfig {
	$schema?: string;
	activeScenes?: string[]; // 当前激活的一个或多个场景名称（支持多场景叠加）
	bindings?: Record<string, string | string[]>; // launch.json 配置名称与场景的映射关系
	scenes: Record<string, SceneBreakpoint[]>;
}

