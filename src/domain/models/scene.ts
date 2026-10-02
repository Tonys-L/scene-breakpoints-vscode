import { Breakpoint } from "./breakpoint";
import type { SceneBreakpoint } from "#src/domain/types";

/**
 * 场景局部实体 (Scene Entity)
 * 职责：作为断点的聚合容器，负责场景内断点的有序排列、查重覆盖(INV-001)、排序与批量启闭
 */
export class Scene {
	public name: string;
	private breakpoints: Breakpoint[];

	constructor(name: string, initialBreakpoints: (Breakpoint | SceneBreakpoint)[] = []) {
		this.name = (name || "").trim();
		this.breakpoints = initialBreakpoints.map((b) => (b instanceof Breakpoint ? b : new Breakpoint(b)));
	}

	/**
	 * 获取当前场景内的断点列表（只读副本引用）
	 */
	public getBreakpoints(): Breakpoint[] {
		return this.breakpoints;
	}

	/**
	 * 获取指定索引位置的断点
	 */
	public getBreakpoint(index: number): Breakpoint | undefined {
		if (index < 0 || index >= this.breakpoints.length) {
			return undefined;
		}
		return this.breakpoints[index];
	}

	/**
	 * 全量替换场景内的断点列表（常用于全量覆盖模式）
	 */
	public setBreakpoints(newBreakpoints: (Breakpoint | SceneBreakpoint)[] = []): void {
		this.breakpoints = newBreakpoints.map((b) => (b instanceof Breakpoint ? b : new Breakpoint(b)));
	}

	/**
	 * 清空场景内全部断点
	 */
	public clearBreakpoints(): void {
		this.breakpoints = [];
	}

	/**
	 * 向场景添加断点，遵循同位置唯一性查重覆盖契约 (INV-001)
	 */
	public upsertBreakpoint(newBp: Breakpoint): void {
		const bpInstance = newBp instanceof Breakpoint ? newBp : new Breakpoint(newBp);
		const existIdx = this.breakpoints.findIndex((it) => it.matches(bpInstance));

		if (existIdx >= 0) {
			this.breakpoints[existIdx] = bpInstance;
		} else {
			this.breakpoints.push(bpInstance);
		}
	}

	/**
	 * 从场景中移除指定索引位置的断点
	 */
	public removeBreakpoint(index: number): boolean {
		if (index < 0 || index >= this.breakpoints.length) {
			return false;
		}
		this.breakpoints.splice(index, 1);
		return true;
	}

	/**
	 * 调整断点在场景内的排列次序（上移/下移/置顶/置底）
	 */
	public moveBreakpoint(index: number, direction: "up" | "down" | "top" | "bottom"): boolean {
		if (index < 0 || index >= this.breakpoints.length) {
			return false;
		}

		if (direction === "top") {
			if (index === 0) return false;
			const [item] = this.breakpoints.splice(index, 1);
			this.breakpoints.unshift(item);
			return true;
		}

		if (direction === "bottom") {
			if (index === this.breakpoints.length - 1) return false;
			const [item] = this.breakpoints.splice(index, 1);
			this.breakpoints.push(item);
			return true;
		}

		const targetIndex = direction === "up" ? index - 1 : index + 1;
		if (targetIndex < 0 || targetIndex >= this.breakpoints.length) {
			return false;
		}

		const temp = this.breakpoints[index];
		this.breakpoints[index] = this.breakpoints[targetIndex];
		this.breakpoints[targetIndex] = temp;
		return true;
	}

	/**
	 * 拖拽重排断点至目标索引位置 (reorder)
	 */
	public reorderBreakpoint(sourceIndex: number, targetIndex: number): boolean {
		if (
			sourceIndex < 0 ||
			sourceIndex >= this.breakpoints.length ||
			targetIndex < 0 ||
			targetIndex >= this.breakpoints.length ||
			sourceIndex === targetIndex
		) {
			return false;
		}

		const [item] = this.breakpoints.splice(sourceIndex, 1);
		this.breakpoints.splice(targetIndex, 0, item);
		return true;
	}

	/**
	 * 切换场景中指定索引断点的启用/禁用状态
	 */
	public toggleBreakpointEnabled(index: number): boolean {
		if (index < 0 || index >= this.breakpoints.length) {
			return false;
		}
		const bp = this.breakpoints[index];
		bp.enabled = !bp.enabled;
		return true;
	}

	public toggleBreakpoint(index: number): boolean {
		return this.toggleBreakpointEnabled(index);
	}


	/**
	 * 批量设置场景内所有断点的启用/禁用状态
	 */
	public setAllEnabled(targetEnabled: boolean): boolean {
		let hasChanged = false;
		for (const bp of this.breakpoints) {
			if (bp.enabled !== targetEnabled) {
				bp.enabled = targetEnabled;
				hasChanged = true;
			}
		}
		return hasChanged;
	}

	/**
	 * 获取当前场景中所有尚未提取有效指纹的物理断点
	 */
	public getUnfingerprintedBreakpoints(): Breakpoint[] {
		return this.breakpoints.filter(
			(bp) => bp.type !== "function" && !bp.isFingerprinted() && bp.file && bp.line,
		);
	}

	/**
	 * 将自愈修正后的断点集合回填到当前场景中，返回是否有断点发生了更新
	 */
	public backfillHealed(healedBreakpoints: Breakpoint[]): boolean {
		if (!healedBreakpoints?.length) return false;
		let hasChanged = false;

		for (const bp of this.breakpoints) {
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
			for (const bp of this.breakpoints) {
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
			for (const bp of this.breakpoints) {
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
	 * 深度克隆生成场景副本
	 */
	public clone(newName: string): Scene {
		const clonedBps = this.breakpoints.map((b) => b.clone());
		return new Scene(newName, clonedBps);
	}

	/**
	 * 将多个场景按“先到先得”排重策略 (INV-004, INV-011) 合并生成一个新的场景实体
	 */
	public static merge(scenes: (Scene | undefined | null)[], mergedName: string = "merged"): Scene {
		const mergedBreakpoints: Breakpoint[] = [];
		for (const scene of scenes) {
			if (!scene) continue;
			for (const bp of scene.getBreakpoints()) {
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
	 */
	public mergeFrom(other: Scene | Breakpoint[]): void {
		const incoming = other instanceof Scene ? other.getBreakpoints() : other;
		for (const bp of incoming) {
			const exists = this.breakpoints.some((it) => it.matches(bp));
			if (!exists) {
				this.breakpoints.push(bp);
			}
		}
	}

	/**
	 * 导出为纯数据断点数组 DTO
	 */
	public toJSON(): SceneBreakpoint[] {
		return this.breakpoints.map((b) => b.toJSON());
	}
}
