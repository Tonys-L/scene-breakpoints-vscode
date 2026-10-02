import type { FunctionSceneBreakpoint, SceneBreakpoint, SourceSceneBreakpoint } from "#src/domain/types";
import { arrayEqualsIgnoreOrder, uniqueStrings } from "#src/shared/utils/arrayUtils";

export interface ResolveActiveScenesDiffParams {
	allowAiActivation?: boolean;
	currentActiveScenes: string[];
	rawActiveScenes: unknown;
	scenesDict: Record<string, any>;
}

export interface ActiveScenesDiffResult {
	shouldApply: boolean;
	action: "apply" | "clear" | "noop";
	targetScenes: string[];
}

/**
 * 场景激活差异与拓扑推导领域服务 (ActiveScenesDiffResolver Domain Service)
 * 职责：负责外部声明式配置变更时的差异推导（Diff 计算）、幽灵场景校验拦截与核心断点拓扑指纹比对
 */
export class ActiveScenesDiffResolver {
	/**
	 * 计算断点集合的核心拓扑指纹 Hash (Core Topology Hash)
	 * 仅比对真正影响 DAP 运行时的核心字段，排除 desc 等纯说明元数据
	 */
	public static computeTopologyHash(breakpoints: SceneBreakpoint[]): string {
		if (!Array.isArray(breakpoints)) {
			return "";
		}
		const tokens = breakpoints.map((bp) => {
			const isEnabled = bp.enabled ?? true;
			if (bp.type === "function") {
				const fn = bp as FunctionSceneBreakpoint;
				return `fn:${fn.functionName || ""}:${fn.condition || ""}:${fn.hitCondition || ""}:${isEnabled}`;
			}
			const src = bp as SourceSceneBreakpoint;
			const normFile = (src.file || "").replace(/\\/g, "/").toLowerCase();
			return `src:${normFile}:${src.line}:${src.type}:${src.condition || ""}:${src.hitCondition || ""}:${src.logMessage || ""}:${isEnabled}`;
		});
		return tokens.sort().join("|");
	}

	public computeTopologyHash(breakpoints: SceneBreakpoint[]): string {
		return ActiveScenesDiffResolver.computeTopologyHash(breakpoints);
	}

	/**
	 * 容错清洗并装箱目标激活场景配置
	 */
	public static extractTargetActiveScenes(raw: unknown): string[] {
		return uniqueStrings(raw);
	}

	public static extractTargetScenes(raw: unknown): string[] {
		return uniqueStrings(raw);
	}

	/**
	 * 过滤幽灵场景，确保请求的场景在配置文件中真实存在 (大小写容错)
	 */
	public static filterGhostScenes(targetScenes: string[], scenesDict: Record<string, any>): string[] {
		if (!scenesDict) return [];
		const existingNames = Object.keys(scenesDict);
		const validScenes: string[] = [];

		for (const target of targetScenes) {
			const matched = existingNames.find((name) => name.toLowerCase() === target.toLowerCase());
			if (matched && !validScenes.includes(matched)) {
				validScenes.push(matched);
			}
		}
		return validScenes;
	}

	/**
	 * 计算激活场景变更 Diff 并推导调度决策
	 */
	public static resolveActiveScenesDiff(params: ResolveActiveScenesDiffParams): ActiveScenesDiffResult {
		const { allowAiActivation = true, currentActiveScenes, rawActiveScenes, scenesDict } = params;

		if (!allowAiActivation) {
			return { shouldApply: false, action: "noop", targetScenes: currentActiveScenes };
		}

		const targetScenes = ActiveScenesDiffResolver.filterGhostScenes(
			uniqueStrings(rawActiveScenes),
			scenesDict,
		);

		const isSame = arrayEqualsIgnoreOrder(targetScenes, currentActiveScenes);

		if (isSame) {
			return { shouldApply: false, action: "noop", targetScenes: currentActiveScenes };
		}

		if (targetScenes.length === 0) {
			return { shouldApply: true, action: "clear", targetScenes: [] };
		}

		return { shouldApply: true, action: "apply", targetScenes };
	}
}
