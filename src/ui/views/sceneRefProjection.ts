import { sceneManager } from "#src/application";
import type { SceneItem, ScenesConfig } from "#src/domain/types";
import { BreakpointNode, SceneRefTreeItem, buildNodeId } from "./treeNodes";

/** 树视图声明态投影的步骤节点联合（引用节点 + 断点节点） */
export type SceneStepNode = BreakpointNode | SceneRefTreeItem;

interface ProjectionContext {
	workspaceRoot: string;
	extensionPath: string;
	pausedLocation: { file: string; line: number } | null;
	/** 声明路径段（含 scene:/ref: 前缀段），多层引用逐段累积 */
	path: string[];
	/** 引用子树内的断点为只读投影 */
	readonly: boolean;
}

/**
 * 声明态步骤投影（§6.1 树渲染规则）：将场景声明步骤逐项映射为树节点，声明序保真。
 * 树展示引用结构本身，不走 resolver（展示与激活关注点分离）。
 */
function projectSteps(
	sceneName: string,
	steps: readonly SceneItem[],
	scenes: ScenesConfig["scenes"],
	ctx: ProjectionContext,
): SceneStepNode[] {
	// 预扫描同层引用重名，自第二次出现起以 @index 消歧，保证 TreeItem.id 全树唯一
	const refCounts = new Map<string, number>();
	for (const item of steps) {
		if (item && item.type === "scene") {
			refCounts.set(item.name, (refCounts.get(item.name) ?? 0) + 1);
		}
	}
	const emittedRefs = new Map<string, number>();

	return steps.map((item, idx) => {
		if (item && item.type === "scene") {
			const sourceSteps = scenes[item.name];
			const occurrence = (emittedRefs.get(item.name) ?? 0) + 1;
			emittedRefs.set(item.name, occurrence);
			const idSuffix = occurrence >= 2 ? `@${idx}` : "";
			return new SceneRefTreeItem(
				{
					sceneName,
					refName: item.name,
					path: [...ctx.path, `ref:${item.name}${idSuffix}`],
					index: idx,
				},
				{
					desc: item.desc,
					enabled: item.enabled !== false,
					childCount: Array.isArray(sourceSteps) ? sourceSteps.length : 0,
					isDangling: !Array.isArray(sourceSteps),
				},
			);
		}

		const bpNode = new BreakpointNode(
			sceneName,
			idx,
			item,
			ctx.workspaceRoot,
			ctx.extensionPath,
			ctx.pausedLocation,
			{ readonly: ctx.readonly },
		);
		if (ctx.readonly) {
			// 只读断点 id 走声明路径 scheme，防止同一源场景被多处引用时跨场景重复 id
			bpNode.id = buildNodeId([...ctx.path, `bp:${idx}`]);
		}
		return bpNode;
	});
}

/**
 * 场景顶层声明态投影（深接口 getBreakpointNodes 的实现内核）
 */
export function projectSceneStepNodes(
	sceneName: string,
	workspaceRoot: string,
	extensionPath: string,
	pausedLocation: { file: string; line: number } | null,
): SceneStepNode[] {
	const config = sceneManager.loadScenesConfig(workspaceRoot);
	const steps = config.scenes[sceneName] ?? [];
	return projectSteps(sceneName, steps, config.scenes, {
		workspaceRoot,
		extensionPath,
		pausedLocation,
		path: [`scene:${sceneName}`],
		readonly: false,
	});
}

/**
 * 引用节点子层投影：被引用源场景的声明步骤逐项映射，只读语义沿声明路径传播
 */
export function projectRefChildNodes(
	refNode: SceneRefTreeItem,
	workspaceRoot: string,
	extensionPath: string,
	pausedLocation: { file: string; line: number } | null,
): SceneStepNode[] {
	const config = sceneManager.loadScenesConfig(workspaceRoot);
	const sourceSteps = config.scenes[refNode.ctx.refName];
	if (!Array.isArray(sourceSteps)) return [];
	// 声明路径取自 ctx（权威来源），子层路径逐段累积其上
	return projectSteps(
		refNode.ctx.refName,
		sourceSteps,
		config.scenes,
		{
			workspaceRoot,
			extensionPath,
			pausedLocation,
			path: [...refNode.ctx.path],
			readonly: true,
		},
	);
}
