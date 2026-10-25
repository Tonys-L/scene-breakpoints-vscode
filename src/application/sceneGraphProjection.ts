import {
	CircularReferenceError,
	expandScene,
	type ResolveWarning,
	type ResolvedStep,
} from "#src/domain/services/sceneResolver";
import type { SceneCatalog } from "#src/domain/models/sceneCatalog";
import type { SceneLayerOrigin } from "#src/domain/ports/sceneRepository";
import type { BreakpointType, SourceSceneBreakpoint } from "#src/domain/types";
import { isFilePathMatch } from "#src/shared/utils/pathUtils";

/**
 * 场景断点图形化只读投影 (Scene Graph Projection, v1.3.0)
 * 职责：将可见场景集（Scope Selector，缺省 = 激活集）的展开态断点流 (expandScenes)
 * 投影为纯数据画布快照 GraphSnapshot。
 * 设计裁决："看什么"（visibleScenes）与"什么在生效"（activeScenes）正交解耦，
 * registered 为纯推导标注（ownerScene ∈ activeScenes），不参与任何业务状态。
 * 硬约束：纯只读字段拷贝，对领域实体零回写、零业务副作用 (INV-028 弱耦合，不构成业务主状态)。
 */

export type GraphNodeKind = "breakpoint" | "scene-ref";
export type GraphNodeStatus = "idle" | "unmatched";
export type GraphLaneLayer = SceneLayerOrigin;

/** 画布节点：断点实体字段的安全只读拷贝（id 稳定：{ownerScene}#{声明序}） */
export interface GraphNode {
	readonly id: string;
	readonly kind: GraphNodeKind;
	readonly ownerScene: string;
	/** 引用链（含根场景），驱动 webview 引用分组嵌套 */
	readonly refPath: readonly string[];
	readonly file?: string;
	readonly line?: number;
	readonly functionName?: string;
	readonly bpType?: BreakpointType;
	readonly condition?: string;
	readonly hitCondition?: string;
	readonly logMessage?: string;
	/** 场景引用占位节点的被引用场景名（kind === "scene-ref" 时存在） */
	readonly refName?: string;
	readonly desc?: string;
	readonly contextSnippet?: string;
	readonly enabled: boolean;
	readonly status: GraphNodeStatus;
	/** 所属场景是否已登记激活（ownerScene ∈ activeScenes，纯推导标注，webview 据此渲染未激活态） */
	readonly registered: boolean;
	/** 变量追踪监视表达式列表 (v1.5.0) */
	readonly watch?: readonly string[];
	/** 变量预期值字典 (v1.5.0) */
	readonly expected?: Record<string, any>;
}

/** 执行流泳道：一个可见根场景的展开态节点流 */
export interface GraphLane {
	readonly id: string;
	readonly sceneName: string;
	readonly layer: GraphLaneLayer;
	/** 根场景是否已登记激活（sceneName ∈ activeScenes，纯推导标注） */
	readonly registered: boolean;
	readonly nodes: readonly GraphNode[];
	/** 展开失败原因（成环），非空时该泳道为警告泳道（仅列原因，不静默空白） */
	readonly expandError?: GraphLaneError;
}

/** 泳道展开失败的结构化原因 */
export interface GraphLaneError {
	readonly code: "circular-ref";
	readonly cyclePath: readonly string[];
}

/** Scope Selector 场景选项：目录全量场景的只读标注 */
export interface GraphSceneOption {
	readonly name: string;
	readonly layer: GraphLaneLayer;
	/** 该场景是否在当前激活集中（纯推导标注） */
	readonly registered: boolean;
}

/** 引用解析降级警告透传（悬空引用 / 禁用引用） */
export interface GraphWarning {
	readonly code: "dangling-ref" | "disabled-ref";
	readonly refName: string;
	readonly refPath: readonly string[];
}

/** 画布全量快照：面板打开 / 场景变更时全量重发 */
export interface GraphSnapshot {
	readonly workspaceRoot: string;
	readonly activeScenes: readonly string[];
	/** 目录全量场景选项（Scope Selector 数据源，catalog 声明序） */
	readonly availableScenes: readonly GraphSceneOption[];
	readonly lanes: readonly GraphLane[];
	readonly warnings: readonly GraphWarning[];
}

export interface GraphProjectionInput {
	workspaceRoot: string;
	catalog: SceneCatalog;
	activeScenes: readonly string[];
	/** 用户选择的可见场景（Scope Selector），缺省 = activeScenes */
	visibleScenes?: readonly string[];
	/** 场景级分层来源溯源表（INV-032），缺省 team */
	originByScene?: Record<string, SceneLayerOrigin>;
	/** 未匹配断点判定（来自 SceneStateManager），缺省恒 false */
	isUnmatched?: (file?: string, line?: number) => boolean;
}

/** 断点步骤 → 画布节点（字段安全拷贝，实体引用零回写） */
function buildBreakpointNode(
	step: ResolvedStep,
	index: number,
	registered: boolean,
	isUnmatched?: (file?: string, line?: number) => boolean,
): GraphNode {
	const bp = step.breakpoint;
	const isFunction = bp.type === "function";
	const file = isFunction ? undefined : bp.file;
	const line = isFunction ? undefined : bp.line;
	const inferredType = bp.type === "line" && bp.condition ? "condition"
		: bp.type === "line" && bp.hitCondition ? "hitCount"
		: bp.type === "line" && bp.logMessage ? "logpoint"
		: bp.type;
	return {
		id: `${step.ownerScene}#${index}`,
		kind: "breakpoint",
		ownerScene: step.ownerScene,
		refPath: [...step.refPath],
		file,
		line,
		functionName: isFunction ? bp.functionName : undefined,
		bpType: inferredType,
		desc: bp.desc,
		contextSnippet: bp.contextSnippet ? [
			bp.contextSnippet.prev ? `  ${bp.contextSnippet.prev}` : null,
			`> ${bp.contextSnippet.current}`,
			bp.contextSnippet.next ? `  ${bp.contextSnippet.next}` : null,
		].filter(Boolean).join("\n") : undefined,
		condition: bp.condition,
		hitCondition: bp.hitCondition,
		logMessage: bp.logMessage,
		watch: !isFunction && Array.isArray((bp as SourceSceneBreakpoint).watch) ? [...(bp as SourceSceneBreakpoint).watch!] : undefined,
		expected: !isFunction && (bp as SourceSceneBreakpoint).expected ? { ...(bp as SourceSceneBreakpoint).expected } : undefined,
		enabled: bp.enabled,
		status: isUnmatched?.(file, line) ? "unmatched" : "idle",
		registered,
	};
}

/** 悬空/禁用引用 → 灰色占位节点（挂在所属引用链根泳道） */
function buildRefPlaceholderNode(w: ResolveWarning, occurrence: number, registered: boolean): GraphNode {
	const ownerScene = w.refPath[w.refPath.length - 1] ?? w.refName;
	const suffix = occurrence >= 2 ? `@${occurrence - 1}` : "";
	return {
		id: `${w.refPath.join(">")}#ref-${w.refName}${suffix}`,
		kind: "scene-ref",
		ownerScene,
		refPath: [...w.refPath],
		refName: w.refName,
		enabled: w.code !== "disabled-ref",
		status: "idle",
		registered,
	};
}

/** 可见场景集展开结果：步骤流 + 警告 + 展开失败场景（成环路径） */

/**
 * 构建画布全量快照：可见场景集 → expandScenes 展开流 → 泳道节点投影。
 * 缺省可见集 = 激活集；成环场景降级为警告泳道（expandError），保证画布打开零异常。
 */
export function buildGraphSnapshot(input: GraphProjectionInput): GraphSnapshot {
	const { workspaceRoot, catalog, originByScene, isUnmatched } = input;
	const allSceneNames = catalog.getSceneNames();
	const activeScenes = [...new Set(input.activeScenes)];
	const activeSet = new Set(activeScenes);
	const visibleScenes = [...new Set(input.visibleScenes ?? input.activeScenes)];

	const availableScenes = allSceneNames.map((name) => ({
		name,
		layer: originByScene?.[name] ?? "team",
		registered: activeSet.has(name),
	}));

	if (visibleScenes.length === 0) {
		return { workspaceRoot, activeScenes, availableScenes, lanes: [], warnings: [] };
	}

	const lanes: GraphLane[] = [];
	const allWarnings: GraphWarning[] = [];

	for (const sceneName of visibleScenes) {
		let cyclePath: readonly string[] | undefined;
		let steps: ResolvedStep[] = [];
		let warnings: ResolveWarning[] = [];

		try {
			const res = expandScene(catalog, sceneName);
			steps = res.steps;
			warnings = res.warnings;
		} catch (err) {
			if (err instanceof CircularReferenceError) {
				cyclePath = err.cyclePath;
			} else {
				throw err;
			}
		}

		const laneRegistered = activeSet.has(sceneName);
		const laneNodes: GraphNode[] = [];
		const ownerCounters = new Map<string, number>();

		for (const step of steps) {
			const index = ownerCounters.get(step.ownerScene) ?? 0;
			ownerCounters.set(step.ownerScene, index + 1);
			const isRegistered = activeSet.has(sceneName) || activeSet.has(step.ownerScene);
			laneNodes.push(buildBreakpointNode(step, index, isRegistered, isUnmatched));
		}

		const refOccurrence = new Map<string, number>();
		for (const warning of warnings) {
			const key = `${warning.refPath.join(">")}|${warning.refName}|${warning.code}`;
			const occurrence = (refOccurrence.get(key) ?? 0) + 1;
			refOccurrence.set(key, occurrence);
			laneNodes.push(buildRefPlaceholderNode(warning, occurrence, laneRegistered));
			allWarnings.push({
				code: warning.code,
				refName: warning.refName,
				refPath: warning.refPath,
			});
		}

		lanes.push({
			id: `scene:${sceneName}`,
			sceneName,
			layer: originByScene?.[sceneName] ?? "team",
			registered: laneRegistered,
			expandError: cyclePath
				? { code: "circular-ref" as const, cyclePath: [...cyclePath] }
				: undefined,
			nodes: laneNodes,
		});
	}

	return { workspaceRoot, activeScenes, availableScenes, lanes, warnings: allWarnings };
}

/**
 * 按物理位置查找画布节点（跨平台路径容错，对齐 activeBreakpointIndex 匹配语义）。
 * 未命中返回 undefined；场景引用占位节点无物理位置，永不命中。
 */
export function findNodeByLocation(
	snapshot: GraphSnapshot,
	file: string,
	line: number,
): GraphNode | undefined {
	for (const lane of snapshot.lanes) {
		for (const node of lane.nodes) {
			if (node.kind !== "breakpoint") continue;
			if (node.file === undefined || node.line === undefined) continue;
			if (node.line !== line) continue;
			if (isFilePathMatch(file, node.file, snapshot.workspaceRoot || undefined)) {
				return node;
			}
		}
	}
	return undefined;
}

/** 按 id 查找画布节点（webview open-source 回跳的唯一入口，节点身份语义单点权威） */
export function findNodeById(snapshot: GraphSnapshot, nodeId: string): GraphNode | undefined {
	for (const lane of snapshot.lanes) {
		const found = lane.nodes.find((node) => node.id === nodeId);
		if (found) return found;
	}
	return undefined;
}

/** 由快照构建命中轨迹的 nodeId 解析器（未命中记 null，id 语义单点权威） */
export function createNodeIdResolver(
	snapshot: GraphSnapshot,
): (file: string, line: number) => string | null {
	return (file: string, line: number) => findNodeByLocation(snapshot, file, line)?.id ?? null;
}
