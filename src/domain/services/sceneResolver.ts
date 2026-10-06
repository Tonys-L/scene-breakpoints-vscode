import type { Breakpoint } from "#src/domain/models/breakpoint";
import type { SceneRef } from "#src/domain/models/sceneRef";
import type { SceneCatalog } from "#src/domain/models/sceneCatalog";

/** 引用链深度上限（双保险：防超长链与资源耗尽；含根场景在内最多 32 层） */
const MAX_REF_DEPTH = 32;

/** 展开后的步骤：断点 + 溯源信息 */
export interface ResolvedStep {
	/** 源场景中的实体引用（非克隆，与现状 merge 行为一致：enrich/heal 原地变更即变更源实体） */
	breakpoint: Breakpoint;
	/** 该断点的定义所在场景名（回写路由目标） */
	ownerScene: string;
	/** 引用链（含根场景），如 ["payment-debug", "auth-core"] */
	refPath: string[];
}

/** 解析降级警告：悬空引用（目标场景不存在）与禁用引用（信息级） */
export type ResolveWarning =
	| { code: "dangling-ref"; refName: string; refPath: string[] }
	| { code: "disabled-ref"; refName: string; refPath: string[] };

export interface ExpandResult {
	/** 严格声明序的扁平断点流（已按 INV-011 先到先得去重） */
	steps: ResolvedStep[];
	warnings: ResolveWarning[];
}

/** 成环错误：携带完整环路径，如 ["a", "b", "c", "a"] */
export class CircularReferenceError extends Error {
	public readonly name = "CircularReferenceError";
	constructor(public readonly cyclePath: string[]) {
		super(`Circular scene reference: ${cyclePath.join(" → ")}`);
	}
}

/**
 * 断点位置键 —— 与 Breakpoint.matches 等价判据：
 * function 按 functionName；其余按归一化 file + line。
 * 保证与现有 Scene.merge 去重语义逐字节一致（INV-011）。
 */
function breakpointKey(bp: Breakpoint): string {
	if (bp.type === "function") return `fn:${bp.functionName}`;
	const normFile = (bp.file ?? "").replace(/\\/g, "/").toLowerCase();
	return `src:${normFile}:${bp.line}`;
}

/**
 * 单场景 DFS 展开（内部递归）
 * refPath 语义：从根场景到当前场景的引用链（含两端）
 * ownerScene 隐含于 sceneName 参数 —— 断点的定义场景即其所在场景
 */
function dfs(
	catalog: SceneCatalog,
	sceneName: string,
	refPath: string[],
	seen: Set<string>,
	output: ResolvedStep[],
	warnings: ResolveWarning[],
): void {
	const scene = catalog.getScene(sceneName);
	if (!scene) return; // 调用方已 hasScene 守卫，防御性兜底

	for (const step of scene.getSteps()) {
		if (step.kind === "breakpoint") {
			const bp = step as Breakpoint;
			const key = breakpointKey(bp);
			if (seen.has(key)) continue; // INV-011 先到先得
			seen.add(key);
			output.push({ breakpoint: bp, ownerScene: sceneName, refPath });
			continue;
		}

		const ref = step as SceneRef;

		if (!ref.enabled) {
			// 禁用：整棵子树跳过（含其下游悬空，不报告），先于 dangling 判断
			warnings.push({ code: "disabled-ref", refName: ref.name, refPath });
			continue;
		}
		if (!catalog.hasScene(ref.name)) {
			// 悬空：警告 + 跳过该子树，其余断点正常输出
			warnings.push({ code: "dangling-ref", refName: ref.name, refPath });
			continue;
		}
		if (refPath.includes(ref.name)) {
			// 成环：当前链上重复即环，从环入口截取闭合路径
			const start = refPath.indexOf(ref.name);
			throw new CircularReferenceError([...refPath.slice(start), ref.name]);
		}
		if (refPath.length >= MAX_REF_DEPTH) {
			// 深度上限双保险：以成环错误显式失败
			throw new CircularReferenceError([...refPath, ref.name]);
		}
		dfs(catalog, ref.name, [...refPath, ref.name], seen, output, warnings);
	}
}

/** 单场景展开：声明态 Scene 步骤流 → 具象断点流（INV-030 收窄点） */
export function expandScene(catalog: SceneCatalog, sceneName: string): ExpandResult {
	const output: ResolvedStep[] = [];
	const warnings: ResolveWarning[] = [];
	const seen = new Set<string>();

	const root = catalog.getScene(sceneName);
	if (!root) {
		return { steps: output, warnings: [{ code: "dangling-ref", refName: sceneName, refPath: [] }] };
	}

	if (!root.hasSceneRefs()) {
		// 恒等快路径：无引用场景直出，零递归（存量配置绝大多数走此分支）
		for (const step of root.getSteps()) {
			const bp = step as Breakpoint;
			const key = breakpointKey(bp);
			if (seen.has(key)) continue;
			seen.add(key);
			output.push({ breakpoint: bp, ownerScene: sceneName, refPath: [sceneName] });
		}
		return { steps: output, warnings };
	}

	dfs(catalog, sceneName, [sceneName], seen, output, warnings);
	return { steps: output, warnings };
}

/**
 * 多场景展开（激活管道入口）：按 sceneNames 声明序逐场景展开，
 * seen 跨根共享 —— 多场景叠加激活整体先到先得（INV-011，与现 Scene.merge 语义一致）
 */
export function expandScenes(catalog: SceneCatalog, sceneNames: string[]): ExpandResult {
	const output: ResolvedStep[] = [];
	const warnings: ResolveWarning[] = [];
	const seen = new Set<string>();

	for (const name of sceneNames) {
		const root = catalog.getScene(name);
		if (!root) continue; // 幽灵场景已在 catalog.activate 过滤（INV-009），防御性兜底

		if (root.hasSceneRefs()) {
			dfs(catalog, name, [name], seen, output, warnings);
		} else {
			// 恒等快路径
			for (const step of root.getSteps()) {
				const bp = step as Breakpoint;
				const key = breakpointKey(bp);
				if (seen.has(key)) continue;
				seen.add(key);
				output.push({ breakpoint: bp, ownerScene: name, refPath: [name] });
			}
		}
	}
	return { steps: output, warnings };
}
