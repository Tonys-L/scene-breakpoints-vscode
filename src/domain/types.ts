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

/** 引用项 DTO —— 磁盘 JSON 形状（场景内联引用其他场景的断点集合） */
export interface SceneRefItem {
	type: "scene";
	name: string; // 被引用场景名（同文件内解析）
	desc?: string; // 引用意图说明（树视图展示）
	enabled?: boolean; // 缺省 true；false 时整棵子树跳过
}

/** 场景条目 DTO —— scenes 字典数组元素的判别联合（具象断点 + 引用节点） */
export type SceneItem = SceneBreakpoint | SceneRefItem;

export interface ScenesConfig {
	$schema?: string;
	activeScenes?: string[]; // 当前激活的一个或多个场景名称（支持多场景叠加）
	bindings?: Record<string, string | string[]>; // launch.json 配置名称与场景的映射关系
	scenes: Record<string, SceneItem[]>;
}
