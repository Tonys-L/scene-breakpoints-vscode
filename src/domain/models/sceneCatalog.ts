import type { Breakpoint } from "./breakpoint";
import { Scene } from "./scene";
import type { ScenesConfig } from "#src/domain/types";

export interface ActivationResult {
	success: boolean;
	validTargetScenes: string[];
	missingScenes: string[];
}

/**
 * 场景目录聚合根 (SceneCatalog Aggregate Root)
 * 职责：单份 debug-scenes.json 配置文件的权威 SSOT 聚合根。
 * 负责场景清单字典管理、当前激活集合、启动项路由、幽灵防御(INV-009)与多场景先到先得合并(INV-004/011)
 */
export class SceneCatalog {
	public $schema?: string;
	private scenes: Map<string, Scene> = new Map();
	private activeScenes: string[] = [];
	private bindings: Record<string, string | string[]> = {};
	private hasExplicitActiveScenes: boolean = false;

	constructor(config?: Partial<ScenesConfig>) {
		if (config) {
			this.$schema = config.$schema;
			if (Array.isArray(config.activeScenes)) {
				this.activeScenes = [...config.activeScenes];
				this.hasExplicitActiveScenes = true;
			}
			this.bindings = config.bindings ? JSON.parse(JSON.stringify(config.bindings)) : {};

			if (config.scenes && typeof config.scenes === "object") {
				for (const [name, bps] of Object.entries(config.scenes)) {
					if (Array.isArray(bps)) {
						this.scenes.set(name, new Scene(name, bps));
					}
				}
			}
		}
	}

	/**
	 * 从原始配置对象或 DTO 构造聚合根
	 */
	public static fromConfig(config?: Partial<ScenesConfig>): SceneCatalog {
		return new SceneCatalog(config);
	}

	/**
	 * 获取全量场景实体列表
	 */
	public getAllScenes(): Scene[] {
		return Array.from(this.scenes.values());
	}

	/**
	 * 获取全量场景名称列表
	 */
	public getSceneNames(): string[] {
		return Array.from(this.scenes.keys());
	}

	/**
	 * 检查是否存在指定场景（大小写容错匹配，INV-009）
	 */
	public hasScene(name: string): boolean {
		return !!this.findExactSceneName(name);
	}

	/**
	 * 查找并获取与入参大小写容错匹配的真实场景键名
	 */
	public findExactSceneName(name: string): string | undefined {
		if (!name || typeof name !== "string") return undefined;
		const targetLower = name.trim().toLowerCase();
		for (const key of this.scenes.keys()) {
			if (key.toLowerCase() === targetLower) {
				return key;
			}
		}
		return undefined;
	}

	/**
	 * 获取指定名称的场景实体（支持大小写容错）
	 */
	public getScene(name: string): Scene | undefined {
		const exactName = this.findExactSceneName(name);
		return exactName ? this.scenes.get(exactName) : undefined;
	}

	/**
	 * 获取或创建场景实体
	 */
	public getOrCreateScene(name: string): Scene {
		const existing = this.getScene(name);
		if (existing) return existing;

		const trimmedName = name.trim();
		const created = new Scene(trimmedName);
		this.scenes.set(trimmedName, created);
		return created;
	}

	/**
	 * 重命名场景，并联动维护 launch.json 启动项映射 bindings
	 */
	public renameScene(oldName: string, newName: string): boolean {
		const exactOld = this.findExactSceneName(oldName);
		const trimmedNew = typeof newName === "string" ? newName.trim() : "";
		if (!exactOld || !trimmedNew || this.hasScene(trimmedNew)) {
			return false;
		}

		const scene = this.scenes.get(exactOld)!;
		scene.name = trimmedNew;
		this.scenes.delete(exactOld);
		this.scenes.set(trimmedNew, scene);

		// 联动更新 activeScenes
		this.activeScenes = this.activeScenes.map((s) => (s === exactOld ? trimmedNew : s));

		// 联动更新 bindings 启动项映射
		for (const [k, v] of Object.entries(this.bindings)) {
			if (typeof v === "string" && v === exactOld) {
				this.bindings[k] = trimmedNew;
			} else if (Array.isArray(v)) {
				this.bindings[k] = v.map((it) => (it === exactOld ? trimmedNew : it));
			}
		}

		return true;
	}

	/**
	 * 删除场景，并联动清理 bindings 与 activeScenes
	 */
	public deleteScene(name: string): boolean {
		const exactName = this.findExactSceneName(name);
		if (!exactName) return false;

		this.scenes.delete(exactName);
		this.activeScenes = this.activeScenes.filter((s) => s !== exactName);

		// 联动清理 bindings
		for (const [k, v] of Object.entries(this.bindings)) {
			if (typeof v === "string" && v === exactName) {
				delete this.bindings[k];
			} else if (Array.isArray(v)) {
				const filtered = v.filter((it) => it !== exactName);
				if (filtered.length === 0) {
					delete this.bindings[k];
				} else {
					this.bindings[k] = filtered;
				}
			}
		}

		return true;
	}

	/**
	 * 克隆/复制场景副本，支持可选的目标文件过滤 (INV-004)
	 */
	public duplicateScene(
		sourceSceneName: string,
		targetSceneName: string,
		targetFile?: string,
	): boolean {
		const trimmedTarget = typeof targetSceneName === "string" ? targetSceneName.trim() : "";
		if (!trimmedTarget) return false;

		const sourceScene = this.getScene(sourceSceneName);
		if (!sourceScene || this.hasScene(trimmedTarget)) {
			return false;
		}

		if (targetFile) {
			const normTargetFile = targetFile.replace(/\\/g, "/").toLowerCase();
			const clonedBreakpoints: Breakpoint[] = [];
			for (const bp of sourceScene.getBreakpoints()) {
				if (bp.type === "function") continue;
				const bpFile = (bp.file || "").replace(/\\/g, "/").toLowerCase();
				if (bpFile === normTargetFile || bpFile.endsWith("/" + normTargetFile)) {
					clonedBreakpoints.push(bp.clone());
				}
			}
			this.scenes.set(trimmedTarget, new Scene(trimmedTarget, clonedBreakpoints));
		} else {
			this.scenes.set(trimmedTarget, sourceScene.clone(trimmedTarget));
		}

		return true;
	}

	/**
	 * 获取当前激活的场景列表
	 */
	public getActiveScenes(): string[] {
		return [...this.activeScenes];
	}

	/**
	 * 判断当前聚合根是否显式声明了激活场景集合 (即使为空数组)
	 */
	public getHasExplicitActiveScenes(): boolean {
		return this.hasExplicitActiveScenes;
	}

	/**
	 * 获取启动项路由表
	 */
	public getBindings(): Record<string, string | string[]> {
		return { ...this.bindings };
	}

	/**
	 * 激活指定场景列表，施加幽灵场景强防御 (INV-009)
	 */
	public activate(targetScenes: string[]): ActivationResult {
		const validTargetScenes: string[] = [];
		const missingScenes: string[] = [];

		for (const target of targetScenes) {
			const matched = this.findExactSceneName(target);
			if (matched) {
				if (!validTargetScenes.includes(matched)) {
					validTargetScenes.push(matched);
				}
			} else {
				missingScenes.push(target);
			}
		}

		if (validTargetScenes.length === 0) {
			return {
				success: false,
				validTargetScenes: [],
				missingScenes,
			};
		}

		// 写入自身激活状态
		this.activeScenes = validTargetScenes;
		this.hasExplicitActiveScenes = true;

		return {
			success: true,
			validTargetScenes,
			missingScenes,
		};
	}

	/**
	 * 清空当前激活场景
	 */
	public clearActive(): void {
		this.activeScenes = [];
		this.hasExplicitActiveScenes = true;
	}

	/**
	 * 序列化为与磁盘 .vscode/debug-scenes.json 100% 格式吻合的纯 JSON DTO
	 */
	public toJSON(): ScenesConfig {
		const scenesDict: Record<string, any> = {};
		for (const [name, scene] of this.scenes.entries()) {
			scenesDict[name] = scene.toJSON();
		}

		const res: ScenesConfig = {
			scenes: scenesDict,
		};

		if (this.$schema) res.$schema = this.$schema;
		if (this.hasExplicitActiveScenes || this.activeScenes.length > 0) {
			res.activeScenes = [...this.activeScenes];
		}
		if (Object.keys(this.bindings).length > 0) res.bindings = { ...this.bindings };

		return res;
	}
}
