import { Breakpoint } from "./breakpoint";
import { SceneRef } from "./sceneRef";
import type { SceneStep } from "./sceneStep";
import type { SceneBreakpoint, SceneItem, SceneRefItem } from "#src/domain/types";

/**
 * 场景局部实体 (Scene Entity)
 * 职责：作为场景步骤（具象断点 + 引用节点）的聚合容器，负责声明世界步骤流的
 * 有序排列、查重覆盖(INV-001)、排序与批量启闭。
 * 物理世界消费者（自愈/指纹/DAP）必须经 sceneResolver 展开收窄为纯断点流（INV-030），
 * kind 收窄仅允许发生在 Scene 聚合根内部实现细节中，禁止向消费者扩散。
 */
export class Scene {
	public name: string;
	private steps: SceneStep[];

	constructor(name: string, initialSteps: (SceneStep | SceneItem)[] = []) {
		this.name = (name || "").trim();
		this.steps = initialSteps.map((s) => Scene.adaptStep(s)).filter((s): s is SceneStep => !!s);
	}

	/** 实体/DTO 统一适配：SceneStep 直存；引用 DTO 走 SceneRef.from（非法丢弃）；其余构造 Breakpoint */
	private static adaptStep(input: SceneStep | SceneItem): SceneStep | undefined {
		if (input instanceof Breakpoint || input instanceof SceneRef) return input;
		if (!input || typeof input !== "object") return undefined;
		if ((input as SceneItem).type === "scene") return SceneRef.from(input as SceneRefItem);
		return new Breakpoint(input as SceneBreakpoint);
	}

	/**
	 * 获取当前场景内的步骤列表（声明世界唯一读取口；只读视图）
	 * 编译器强制消费者经收窄点（resolver）消费断点，杜绝"忘记展开引用"静默缺陷
	 */
	public getSteps(): readonly SceneStep[] {
		return this.steps;
	}

	/**
	 * 获取指定索引位置的步骤
	 */
	public getStep(index: number): SceneStep | undefined {
		if (index < 0 || index >= this.steps.length) {
			return undefined;
		}
		return this.steps[index];
	}

	/**
	 * 全量替换场景内的步骤列表（常用于全量覆盖模式）
	 */
	public setSteps(newSteps: (SceneStep | SceneItem)[] = []): void {
		this.steps = newSteps.map((s) => Scene.adaptStep(s)).filter((s): s is SceneStep => !!s);
	}

	/**
	 * 清空场景内全部步骤
	 */
	public clearSteps(): void {
		this.steps = [];
	}

	/**
	 * 向场景添加步骤，遵循同位置唯一性查重覆盖契约 (INV-001)
	 * matches 命中替换、否则尾部追加；返回值标识是否为新增（true=追加，false=覆盖）
	 */
	public upsertStep(step: SceneStep): boolean {
		const existIdx = this.steps.findIndex((it) => it.matches(step));

		if (existIdx >= 0) {
			this.steps[existIdx] = step;
			return false;
		}
		this.steps.push(step);
		return true;
	}

	/**
	 * 从场景中移除指定索引位置的步骤
	 */
	public removeStep(index: number): boolean {
		if (index < 0 || index >= this.steps.length) {
			return false;
		}
		this.steps.splice(index, 1);
		return true;
	}

	/**
	 * 调整步骤在场景内的排列次序（上移/下移/置顶/置底）
	 */
	public moveStep(index: number, direction: "up" | "down" | "top" | "bottom"): boolean {
		if (index < 0 || index >= this.steps.length) {
			return false;
		}

		if (direction === "top") {
			if (index === 0) return false;
			const [item] = this.steps.splice(index, 1);
			this.steps.unshift(item);
			return true;
		}

		if (direction === "bottom") {
			if (index === this.steps.length - 1) return false;
			const [item] = this.steps.splice(index, 1);
			this.steps.push(item);
			return true;
		}

		const targetIndex = direction === "up" ? index - 1 : index + 1;
		if (targetIndex < 0 || targetIndex >= this.steps.length) {
			return false;
		}

		const temp = this.steps[index];
		this.steps[index] = this.steps[targetIndex];
		this.steps[targetIndex] = temp;
		return true;
	}

	/**
	 * 拖拽重排步骤至目标索引位置 (reorder)
	 */
	public reorderStep(sourceIndex: number, targetIndex: number): boolean {
		if (
			sourceIndex < 0 ||
			sourceIndex >= this.steps.length ||
			targetIndex < 0 ||
			targetIndex >= this.steps.length ||
			sourceIndex === targetIndex
		) {
			return false;
		}

		const [item] = this.steps.splice(sourceIndex, 1);
		this.steps.splice(targetIndex, 0, item);
		return true;
	}

	/**
	 * 切换场景中指定索引步骤的启用/禁用状态（多态分发：断点与引用均为一等公民）
	 */
	public toggleStep(index: number): boolean {
		if (index < 0 || index >= this.steps.length) {
			return false;
		}
		this.steps[index].toggle();
		return true;
	}

	/**
	 * 批量设置场景内所有步骤的启用/禁用状态
	 */
	public setAllStepsEnabled(targetEnabled: boolean): boolean {
		let hasChanged = false;
		for (const step of this.steps) {
			if (step instanceof Breakpoint) {
				if (step.enabled !== targetEnabled) {
					step.setEnabled(targetEnabled);
					hasChanged = true;
				}
			} else if (step instanceof SceneRef) {
				if (step.enabled !== targetEnabled) {
					step.toggle();
					hasChanged = true;
				}
			}
		}
		return hasChanged;
	}

	/**
	 * 获取当前场景中所有尚未提取有效指纹的物理断点（聚合根内部 kind 收窄）
	 */
	public getUnfingerprintedBreakpoints(): Breakpoint[] {
		return this.steps.filter((s): s is Breakpoint => s.kind === "breakpoint").filter(
			(bp) => bp.type !== "function" && !bp.isFingerprinted() && bp.file && bp.line,
		);
	}

	/**
	 * 将自愈修正后的断点集合回填到当前场景中，返回是否有断点发生了更新
	 * 仅具象断点参与自愈回填匹配（引用节点无物理身份）
	 */
	public backfillHealed(healedBreakpoints: Breakpoint[]): boolean {
		if (!healedBreakpoints?.length) return false;
		let hasChanged = false;

		for (const step of this.steps) {
			if (!(step instanceof Breakpoint)) continue;
			const bp = step;
			if (bp.type === "function") continue;
			const matched = healedBreakpoints.find((h) => bp.matchesHealedTarget(h));
			if (matched && bp.applyHealed(matched)) {
				hasChanged = true;
			}
		}

		return hasChanged;
	}

	/**
	 * 同步单个断点目标的启用/禁用状态（支持函数断点名匹配与文件路径归一化匹配）
	 * 仅具象断点参与 DAP 启停同步（引用无物理身份）
	 */
	public syncBreakpointEnabled(target: {
		file?: string;
		line?: number;
		functionName?: string;
		enabled: boolean;
	}): boolean {
		let changed = false;
		const targetEnabled = target.enabled ?? true;

		if (target.functionName) {
			for (const step of this.steps) {
				if (!(step instanceof Breakpoint)) continue;
				const bp = step;
				if (bp.type === "function" && bp.functionName === target.functionName) {
					if (bp.enabled !== targetEnabled) {
						bp.setEnabled(targetEnabled);
						changed = true;
					}
				}
			}
			return changed;
		}

		if (target.file && typeof target.line === "number") {
			const normTarget = target.file.replace(/\\/g, "/").toLowerCase();
			for (const step of this.steps) {
				if (!(step instanceof Breakpoint)) continue;
				const bp = step;
				if (bp.type === "function" || bp.line !== target.line || !bp.file) continue;
				const normBp = bp.file.replace(/\\/g, "/").toLowerCase();
				if (
					normBp === normTarget ||
					normTarget.endsWith("/" + normBp) ||
					normBp.endsWith("/" + normTarget)
				) {
					if (bp.enabled !== targetEnabled) {
						bp.setEnabled(targetEnabled);
						changed = true;
					}
				}
			}
		}

		return changed;
	}

	/**
	 * 深度克隆生成场景副本（断点走 clone，引用重建，保持声明结构）
	 */
	public clone(newName: string): Scene {
		const clonedSteps = this.steps.map((s) => {
			if (s instanceof Breakpoint) return s.clone();
			if (s instanceof SceneRef) return new SceneRef(s.name, s.desc, s.enabled);
			return s;
		});
		return new Scene(newName, clonedSteps);
	}

	/**
	 * 快速判定：场景是否含引用节点（激活管道/树视图决定是否走解析路径）
	 */
	public hasSceneRefs(): boolean {
		return this.steps.some((s) => s.kind === "scene-ref");
	}

	/**
	 * 将多个场景按“先到先得”排重策略 (INV-011) 合并生成一个新的场景实体
	 * 输入约束为视图场景（仅吸收具象断点，引用不参与合并，防止声明污染）
	 */
	public static merge(scenes: (Scene | undefined | null)[], mergedName: string = "merged"): Scene {
		const mergedBreakpoints: Breakpoint[] = [];
		for (const scene of scenes) {
			if (!scene) continue;
			for (const bp of scene.getConcreteBreakpoints()) {
				const exists = mergedBreakpoints.some((it) => it.matches(bp));
				if (!exists) {
					mergedBreakpoints.push(bp);
				}
			}
		}
		return new Scene(mergedName, mergedBreakpoints);
	}

	/**
	 * 将另一场景或断点集合按“先到先得”排重策略合并吸收至当前场景中
	 * 仅吸收具象断点（引用不跨场景吸收，防止声明污染）
	 */
	public mergeFrom(other: Scene | Breakpoint[]): void {
		const incoming = other instanceof Scene ? other.getConcreteBreakpoints() : other;
		for (const bp of incoming) {
			const exists = this.steps.some((it) => it.matches(bp));
			if (!exists) {
				this.steps.push(bp);
			}
		}
	}

	/**
	 * 具象断点投影（私有辅助，仅供 Scene 内部与视图场景合并使用）：
	 * 返回 steps 中 kind === "breakpoint" 的实体数组。不作为公开 API —— 公开读取口只有 getSteps()。
	 */
	private getConcreteBreakpoints(): Breakpoint[] {
		return this.steps.filter((s): s is Breakpoint => s.kind === "breakpoint");
	}

	/**
	 * 导出为纯数据步骤数组 DTO（断点与引用项混合的声明态）
	 */
	public toJSON(): SceneItem[] {
		return this.steps.map((s) => s.toJSON());
	}
}
