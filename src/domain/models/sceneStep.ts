import type { SceneItem } from "#src/domain/types";

/**
 * 场景步骤协议 —— 声明世界最小行为契约 (INV-030)
 * 声明世界由具象断点（kind: "breakpoint"）与引用节点（kind: "scene-ref"）穿插构成；
 * 物理世界（自愈、指纹、DAP 装配）只认 Breakpoint[]，必须经 sceneResolver 展开收窄。
 * 只收编有真实消费者的行为，拒绝胖接口：
 * 指纹/自愈方法（needsFingerprint/absorbHealed 等）不进协议，
 * 它们只作用于解析后的纯断点视图场景。
 */
export interface SceneStep {
	/** 类型判别：序列化分支与 instanceof 之外的类型收窄 */
	readonly kind: "breakpoint" | "scene-ref";
	/** INV-001/011 去重锚点：断点按位置等价，引用按 name 等价 */
	matches(other: SceneStep): boolean;
	/** 树节点启停：两类节点均为一等公民 */
	toggle(): void;
	/** 持久化往返 */
	toJSON(): SceneItem;
}
