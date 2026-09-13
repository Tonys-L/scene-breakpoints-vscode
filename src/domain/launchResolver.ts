import type { ScenesConfig } from "./types";

/**
 * 根据调试配置名称或环境变量安全推导绑定的有效场景列表 (杜绝幽灵激活)
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

	// 1. 最高优先级：环境变量 DEBUG_SCENE
	if (envScene && typeof envScene === "string" && envScene.trim()) {
		const rawScenes = envScene.split(",").map((s) => s.trim()).filter(Boolean);
		const matchedScenes = rawScenes
			.map(matchSceneName)
			.filter((s): s is string => typeof s === "string");
		return matchedScenes;
	}

	// 2. 查找 bindings 映射
	const normalizedLaunchName = (launchName || "").trim();
	if (!normalizedLaunchName) return [];

	if (config.bindings && typeof config.bindings === "object") {
		const bindingKeys = Object.keys(config.bindings);
		const matchedKey = bindingKeys.find(
			(k) => k.trim().toLowerCase() === normalizedLaunchName.toLowerCase(),
		);

		if (matchedKey) {
			const target = config.bindings[matchedKey];
			if (typeof target === "string" && target.trim()) {
				const rawScenes = target.split(",").map((s) => s.trim()).filter(Boolean);
				const matchedScenes = rawScenes
					.map(matchSceneName)
					.filter((s): s is string => typeof s === "string");
				return matchedScenes;
			}
			if (Array.isArray(target)) {
				const matchedScenes = target
					.map((item) => (typeof item === "string" ? matchSceneName(item) : undefined))
					.filter((s): s is string => typeof s === "string");
				return matchedScenes;
			}
		}
	}

	// 3. 兜底同名匹配
	const exactSameScene = matchSceneName(normalizedLaunchName);
	return exactSameScene ? [exactSameScene] : [];
}
