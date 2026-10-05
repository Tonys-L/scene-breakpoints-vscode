import type { ScenesConfig } from "#src/domain/types";
import { uniqueStrings } from "#src/shared/utils/arrayUtils";

/**
 * 依据 VS Code 调试启动配置或环境变量推导绑定的有效场景列表 (杜绝幽灵激活)
 * 仲裁规则：严格执行三级优先级 (DEBUG_SCENE 环境变量 > bindings 映射 > 智能同名匹配) 与幽灵场景防御。
 */
export function resolveLaunchBoundScenes(
	config: ScenesConfig,
	launchName?: string,
	envScene?: string,
): string[] {
	const sceneNames = Object.keys(config.scenes || {});
	const matchSceneName = (candidate: string) => {
		const trimmed = candidate.trim();
		if (!trimmed) return undefined;
		const lower = trimmed.toLowerCase();
		return sceneNames.find((name) => name.toLowerCase() === lower);
	};

	// 1. 最高优先级：显式指定的环境变量 (支持逗号分隔多场景)
	if (envScene && envScene.trim()) {
		const candidates = uniqueStrings(envScene);
		const matched: string[] = [];
		for (const cand of candidates) {
			const found = matchSceneName(cand);
			if (found && !matched.includes(found)) {
				matched.push(found);
			}
		}
		return matched;
	}

	// 2. 次高优先级：launch.json 声明式 bindings 映射 (支持字符串逗号分隔或数组形式)
	if (launchName && config.bindings) {
		const mapped = config.bindings[launchName];
		if (mapped) {
			const rawCandidates = uniqueStrings(mapped);
			const matched: string[] = [];
			for (const cand of rawCandidates) {
				const found = matchSceneName(cand);
				if (found && !matched.includes(found)) {
					matched.push(found);
				}
			}
			if (matched.length > 0) return matched;
		}
	}

	// 3. 第三优先级：智能同名匹配
	if (launchName) {
		const found = matchSceneName(launchName);
		if (found) return [found];
	}

	return [];
}

/**
 * 调试启动绑定解析器领域服务 (LaunchBindingResolver)
 */
export class LaunchBindingResolver {
	public static resolveScenes = resolveLaunchBoundScenes;
}
