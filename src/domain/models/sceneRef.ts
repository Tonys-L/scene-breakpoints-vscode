import type { SceneRefItem } from "#src/domain/types";
import type { SceneStep } from "./sceneStep";

/**
 * 场景引用实体：声明世界的引用节点，纯数据 + 协议行为，不持有 catalog（展开是解析器职责）
 */
export class SceneRef implements SceneStep {
	public readonly kind = "scene-ref" as const;

	constructor(
		public readonly name: string,
		public desc?: string,
		public enabled: boolean = true,
	) {}

	public matches(other: SceneStep): boolean {
		return other instanceof SceneRef && other.name === this.name;
	}

	public toggle(): void {
		this.enabled = !this.enabled;
	}

	/** 缺省不落盘：enabled === true 与 desc === undefined 时不写键，保持 JSON 最小形状 */
	public toJSON(): SceneRefItem {
		const out: SceneRefItem = { type: "scene", name: this.name };
		if (this.desc !== undefined) out.desc = this.desc;
		if (this.enabled === false) out.enabled = false;
		return out;
	}

	/** 工厂：从 DTO 构造（name 非空校验，非法返回 undefined 交由调用方丢弃） */
	public static from(dto: SceneRefItem): SceneRef | undefined {
		const name = dto?.name?.trim();
		if (!name) return undefined;
		return new SceneRef(name, dto.desc?.trim() || undefined, dto.enabled !== false);
	}
}
