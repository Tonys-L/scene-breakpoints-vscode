import type { SceneBreakpoint, SourceSceneBreakpoint, FunctionSceneBreakpoint } from "./types";

/**
 * 计算断点集合的核心拓扑指纹 Hash (Core Topology Hash)
 * 仅比对真正影响 DAP 运行时的核心字段，排除 desc, hint 等纯说明元数据
 */
export function computeBreakpointsTopologyHash(breakpoints: SceneBreakpoint[]): string {
	if (!Array.isArray(breakpoints) || breakpoints.length === 0) {
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

/**
 * 容错清洗并装箱目标激活场景配置
 * 支持 string[] 或单个 string 自动装箱，去除空白、空串并去重
 */
export function extractTargetActiveScenes(rawActive: unknown): string[] {
	if (Array.isArray(rawActive)) {
		const cleaned = rawActive
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
		return Array.from(new Set(cleaned));
	}
	if (typeof rawActive === "string") {
		const trimmed = rawActive.trim();
		return trimmed.length > 0 ? [trimmed] : [];
	}
	return [];
}

/**
 * 幽灵场景防御审计 (Ghost Scene Guard / INV-007)
 * 严格过滤掉未在 scenes 字典中声明的虚假场景名称（支持大小写容错，并自动校准为字典中声明的原始场景名）
 */
export function filterGhostScenes(
	candidates: string[],
	scenesDict: Record<string, any> | undefined | null,
): string[] {
	if (!Array.isArray(candidates) || candidates.length === 0) {
		return [];
	}
	if (!scenesDict || typeof scenesDict !== "object" || Array.isArray(scenesDict)) {
		return [];
	}
	const declaredKeys = Object.keys(scenesDict);
	const result: string[] = [];
	for (const candidate of candidates) {
		const matched = declaredKeys.find((k) => k.toLowerCase() === candidate.toLowerCase());
		if (matched && !result.includes(matched)) {
			result.push(matched);
		}
	}
	return result;
}

export interface ResolveActiveScenesDiffParams {
	allowAiActivation: boolean;
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
 * 比对外部写入的 activeScenes 与当前激活场景，计算调度动作 (纯领域逻辑，无直接副作用)
 */
export function resolveActiveScenesDiff(
	params: ResolveActiveScenesDiffParams,
): ActiveScenesDiffResult {
	const { allowAiActivation, currentActiveScenes, rawActiveScenes, scenesDict } = params;

	// 1. 权限守卫：未开启授权时坚决不调度
	if (!allowAiActivation) {
		return { shouldApply: false, action: "noop", targetScenes: [] };
	}

	// 2. 清洗装箱并过滤幽灵场景
	const extracted = extractTargetActiveScenes(rawActiveScenes);
	const targetScenes = filterGhostScenes(extracted, scenesDict);

	// 3. 幂等拦截检查：比对当前激活集合与目标集合是否完全一致 (不分先后顺序)
	const currentSorted = [...currentActiveScenes].sort();
	const targetSorted = [...targetScenes].sort();

	const isIdentical =
		currentSorted.length === targetSorted.length &&
		currentSorted.every((s, i) => s === targetSorted[i]);

	if (isIdentical) {
		return { shouldApply: false, action: "noop", targetScenes };
	}

	// 4. 判定动作类型：有目标场景则 apply，目标为空且当前有激活场景则 clear
	if (targetScenes.length > 0) {
		return { shouldApply: true, action: "apply", targetScenes };
	}

	if (currentActiveScenes.length > 0) {
		return { shouldApply: true, action: "clear", targetScenes: [] };
	}

	return { shouldApply: false, action: "noop", targetScenes: [] };
}
