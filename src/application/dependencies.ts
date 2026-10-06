import type { SceneActivationDeps } from "./sceneActivationPipeline";

export interface ApplicationDependencies extends SceneActivationDeps {}

let defaultDependencies: ApplicationDependencies = {};

/**
 * 装配应用层全局默认依赖 (Composition Root 依赖注入，遵循 Clean Architecture DIP)
 */
export function configureDependencies(deps: ApplicationDependencies): void {
	defaultDependencies = { ...defaultDependencies, ...deps };
}

export function getDependencies(): ApplicationDependencies {
	return defaultDependencies;
}

export function resetDependencies(): void {
	defaultDependencies = {};
}

