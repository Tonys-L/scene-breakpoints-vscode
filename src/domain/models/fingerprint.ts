import {
	calculateSimilarity,
	cleanLine,
} from "#src/shared/utils/stringSimilarity";
import {
	countIndent,
	findPrevNonEmptyLine,
	findNextNonEmptyLine,
	extractScopeAnchor,
} from "#src/shared/utils/textUtils";
import type { ContextSnippet } from "#src/domain/types";

/**
 * 纯文本行数组提取目标行全维上下文伴随指纹 (0 外部依赖，纯 TS 实现)
 */
export function extractContextSnippetFromLines(lines: string[], lineZeroBased: number): ContextSnippet {
	const currentLineText = lines[lineZeroBased] ?? "";
	const current = cleanLine(currentLineText);
	const indent = countIndent(currentLineText);

	const prev = findPrevNonEmptyLine(lines, lineZeroBased);
	const next = findNextNonEmptyLine(lines, lineZeroBased);
	const scopeAnchor = extractScopeAnchor(lines, lineZeroBased);

	return { prev, current, next, scopeAnchor, indent };
}

export interface FingerprintProps {
	current: string;
	prev?: string;
	next?: string;
	scopeAnchor?: string;
	indent?: number;
}

/**
 * 代码伴随指纹值对象 (Fingerprint Value Object)
 * 职责：作为不可变值对象，封装断点伴随上下文三行指纹、作用域锚点、文本归一化清洗、注释剥离与相似度比对行为
 */
export class Fingerprint {
	public readonly current: string;
	public readonly prev?: string;
	public readonly next?: string;
	public readonly scopeAnchor?: string;
	public readonly indent?: number;

	constructor(props: FingerprintProps) {
		this.current = cleanLine(props.current || "");
		this.prev = props.prev ? cleanLine(props.prev) : undefined;
		this.next = props.next ? cleanLine(props.next) : undefined;
		this.scopeAnchor = props.scopeAnchor ? cleanLine(props.scopeAnchor) : undefined;
		this.indent = typeof props.indent === "number" ? props.indent : undefined;

		// 保证值对象绝对不可变
		Object.freeze(this);
	}

	/**
	 * 从纯数据 DTO 创建指纹值对象
	 */
	public static fromSnippet(snippet?: ContextSnippet): Fingerprint | undefined {
		if (!snippet || typeof snippet.current !== "string" || !snippet.current.trim()) {
			return undefined;
		}
		return new Fingerprint({
			current: snippet.current,
			prev: snippet.prev,
			next: snippet.next,
			scopeAnchor: snippet.scopeAnchor,
			indent: snippet.indent,
		});
	}

	/**
	 * 静态工厂：直接从源码文本行数组在指定行号位置提取并构建指纹值对象
	 * @param lines 源码文本行数组 (0-indexed 数组)
	 * @param targetLine 目标代码行号 (1-indexed)
	 */
	public static fromLines(lines: string[], targetLine: number): Fingerprint | undefined {
		if (!Array.isArray(lines) || targetLine < 1 || targetLine > lines.length) {
			return undefined;
		}
		const rawLine = lines[targetLine - 1];
		if (!rawLine || !rawLine.trim()) {
			return undefined;
		}

		const snippet = extractContextSnippetFromLines(lines, targetLine - 1);
		return new Fingerprint(snippet);
	}

	/**
	 * 指纹是否有效（具备非空当前行）
	 */
	public isValid(): boolean {
		return Boolean(this.current);
	}

	/**
	 * 是否具备上级函数/方法作用域锚点
	 */
	public hasScope(): boolean {
		return Boolean(this.scopeAnchor);
	}

	/**
	 * 检查候选代码行文本是否与当前指纹精准匹配或剥离注释后匹配
	 */
	public matches(candidateText: unknown): boolean {
		if (typeof candidateText !== "string") return false;
		const cleanedCandidate = cleanLine(candidateText);
		if (!cleanedCandidate) return false;

		return cleanedCandidate === this.current;
	}

	/**
	 * 计算候选代码行文本与当前指纹的抗混淆词法单元相似度 (0 ~ 1.0)
	 */
	public similarity(candidateText: unknown): number {
		if (typeof candidateText !== "string") return 0;
		return calculateSimilarity(this.current, candidateText);
	}

	/**
	 * 值对象等价性比较（两个指纹属性全部相同则等价）
	 */
	public equals(other?: Fingerprint): boolean {
		if (!other || !(other instanceof Fingerprint)) return false;
		return (
			this.current === other.current &&
			this.prev === other.prev &&
			this.next === other.next &&
			this.scopeAnchor === other.scopeAnchor
		);
	}

	/**
	 * 序列化为纯数据 DTO，用于落盘持久化或跨层传输
	 */
	public toJSON(): ContextSnippet {
		const res: ContextSnippet = {
			current: this.current,
		};
		if (this.prev) res.prev = this.prev;
		if (this.next) res.next = this.next;
		if (this.scopeAnchor) res.scopeAnchor = this.scopeAnchor;
		if (typeof this.indent === "number") res.indent = this.indent;
		return res;
	}
}
