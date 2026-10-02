import { Fingerprint } from "./fingerprint";
import type {
	BreakpointType,
	ContextSnippet,
	FunctionSceneBreakpoint,
	SceneBreakpoint,
	SourceSceneBreakpoint,
} from "#src/domain/types";

export interface RawBreakpointInput {
	type?: BreakpointType;
	file?: string;
	line?: number;
	enabled?: boolean;
	condition?: string;
	hitCondition?: string;
	logMessage?: string;
	functionName?: string;
	desc?: string;
	contextSnippet?: ContextSnippet;
}

/**
 * 断点充血领域实体 (Breakpoint Entity)
 * 职责：封装 5 类断点的物理属性、启用状态、伴随指纹提取与物理行号自我修正
 */
export class Breakpoint {
	public type: BreakpointType;
	public file?: string;
	public line?: number;
	public enabled: boolean;
	public condition?: string;
	public hitCondition?: string;
	public logMessage?: string;
	public functionName?: string;
	public desc?: string;
	private fingerprint?: Fingerprint;

	constructor(data: SceneBreakpoint | RawBreakpointInput) {
		const raw = data as any;
		this.type = raw.type || (raw.functionName ? "function" : "line");
		this.enabled = raw.enabled ?? true;
		this.desc = raw.desc;
		this.condition = raw.condition;
		this.hitCondition = raw.hitCondition;

		if (raw.contextSnippet) {
			this.fingerprint = Fingerprint.fromSnippet(raw.contextSnippet);
		}

		if (this.type === "function") {
			this.functionName = (data as FunctionSceneBreakpoint).functionName || "";
		} else {
			const src = data as SourceSceneBreakpoint;
			this.file = src.file ? src.file.replace(/\\/g, "/") : "";
			this.line = typeof src.line === "number" ? src.line : 1;
			this.logMessage = src.logMessage;
		}
	}

	/**
	 * 获取或设置上下文指纹 (与内部不可变指纹值对象 Fingerprint 100% 桥接)
	 */
	public get contextSnippet(): ContextSnippet | undefined {
		return this.fingerprint ? this.fingerprint.toJSON() : undefined;
	}

	public set contextSnippet(val: ContextSnippet | undefined) {
		if (val) {
			this.fingerprint = Fingerprint.fromSnippet(val);
		} else {
			this.fingerprint = undefined;
		}
	}

	/**
	 * 检查当前断点是否已具备有效的代码伴随指纹
	 */
	public isFingerprinted(): boolean {
		return this.fingerprint?.isValid() ?? false;
	}

	/**
	 * 获取当前断点的指纹值对象
	 */
	public getFingerprint(): Fingerprint | undefined {
		return this.fingerprint;
	}

	/**
	 * 附加或更新当前断点的伴随指纹
	 */
	public setFingerprint(fingerprint: Fingerprint): void {
		this.fingerprint = fingerprint;
	}

	/**
	 * 启闭切换
	 */
	public toggle(): boolean {
		this.enabled = !this.enabled;
		return this.enabled;
	}

	/**
	 * 设置启用状态
	 */
	public setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	/**
	 * 解析断点物理绝对路径（跨平台纯净实现）
	 */
	public resolveFullPath(workspaceRoot?: string): string {
		if (this.type === "function" || !this.file) return "";
		const normFile = this.file.replace(/\\/g, "/");
		const isAbs = /^[a-zA-Z]:\//.test(normFile) || normFile.startsWith("/");
		if (isAbs || !workspaceRoot) {
			return normFile;
		}
		const normRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
		const rel = normFile.replace(/^\/+/, "");
		return `${normRoot}/${rel}`;
	}

	/**
	 * 更新断点物理代码行号 (自愈命中或行号校准)
	 */
	public updateLine(newLine: number): boolean {
		if (this.type === "function") return false;
		if (typeof newLine !== "number" || isNaN(newLine) || newLine <= 0) return false;
		if (this.line === newLine) return false;
		this.line = newLine;
		return true;
	}

	/**
	 * 判断当前断点是否匹配目标自愈候选断点（同文件下，优先指纹严格匹配，回退物理行号匹配）
	 */
	public matchesHealedTarget(healed: Breakpoint): boolean {
		if (this.type === "function" || healed.type === "function") return false;
		const normThisFile = (this.file || "").replace(/\\/g, "/").toLowerCase();
		const normHealedFile = (healed.file || "").replace(/\\/g, "/").toLowerCase();
		if (normThisFile !== normHealedFile) return false;

		if (this.contextSnippet?.current && healed.contextSnippet?.current) {
			return this.contextSnippet.current === healed.contextSnippet.current;
		}
		return this.line === healed.line;
	}

	/**
	 * 吸收并应用自愈修正结果（行号校准与指纹对齐），返回是否有实质性变更
	 */
	public applyHealed(healed: Breakpoint): boolean {
		if (this.type === "function" || healed.type === "function") return false;
		let changed = false;

		if (typeof healed.line === "number" && this.line !== healed.line) {
			this.line = healed.line;
			changed = true;
		}

		if (
			healed.contextSnippet &&
			(!this.contextSnippet || this.contextSnippet.current !== healed.contextSnippet.current)
		) {
			this.contextSnippet = JSON.parse(JSON.stringify(healed.contextSnippet));
			changed = true;
		}

		return changed;
	}

	/**
	 * 现场提取当前代码行的伴随指纹并持久化绑定 (幂等保护：若已具备有效指纹则跳过)
	 */
	public enrich(lines: string[]): boolean {
		if (this.isFingerprinted()) {
			return false;
		}

		if (this.type === "function" || !this.line) {
			return false;
		}

		const fp = Fingerprint.fromLines(lines, this.line);
		if (!fp) return false;

		this.fingerprint = fp;
		return true;
	}

	public enrichFingerprint(lines: string[]): boolean {
		return this.enrich(lines);
	}

	/**
	 * 物理位置比对与跨平台路径归一化匹配
	 */
	public matches(other: Breakpoint | SceneBreakpoint): boolean {
		if (!other) return false;

		if (this.type === "function") {
			return (
				(other as any).type === "function" &&
				(other as any).functionName === this.functionName
			);
		}

		if ((other as any).type === "function") {
			return false;
		}

		const otherFile = (other as SourceSceneBreakpoint).file
			? (other as SourceSceneBreakpoint).file.replace(/\\/g, "/")
			: "";
		const currentFile = this.file ? this.file.replace(/\\/g, "/") : "";

		return (
			currentFile.toLowerCase() === otherFile.toLowerCase() &&
			this.line === (other as SourceSceneBreakpoint).line
		);
	}

	/**
	 * 导出为符合 schema.json 规范的纯 DTO 对象
	 */
	public toJSON(): SceneBreakpoint {
		if (this.type === "function") {
			const res: FunctionSceneBreakpoint = {
				type: "function",
				functionName: this.functionName || "",
				enabled: this.enabled,
			};
			if (this.condition) res.condition = this.condition;
			if (this.hitCondition) res.hitCondition = this.hitCondition;
			if (this.desc) res.desc = this.desc;
			return res;
		}

		const res: SourceSceneBreakpoint = {
			type: this.type as "line" | "condition" | "hitCount" | "logpoint",
			file: this.file || "",
			line: this.line || 1,
			enabled: this.enabled,
		};
		if (this.condition) res.condition = this.condition;
		if (this.hitCondition) res.hitCondition = this.hitCondition;
		if (this.logMessage) res.logMessage = this.logMessage;
		if (this.desc) res.desc = this.desc;
		if (this.fingerprint && this.fingerprint.isValid()) {
			res.contextSnippet = this.fingerprint.toJSON();
		}
		return res;
	}

	public get raw(): SceneBreakpoint {
		return this.toJSON();
	}

	public clone(): Breakpoint {
		return new Breakpoint(this.toJSON());
	}
}
