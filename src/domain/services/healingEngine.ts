import type { ILineReader } from "#src/domain/ports/lineReader";
import type { ContextSnippet } from "#src/domain/types";
import { Fingerprint, extractContextSnippetFromLines } from "#src/domain/models/fingerprint";
export { extractContextSnippetFromLines };
import {
	cleanLine,
	stripTrailingComment,
	calculateSimilarity,
} from "#src/shared/utils/stringSimilarity";
import {
	countIndent,
	findPrevNonEmptyLine,
	findNextNonEmptyLine,
	findGeometricParent,
	extractScopeAnchor,
	findScopeAnchorLine,
} from "#src/shared/utils/textUtils";

export type HealStatus = "matched" | "healed" | "unmatched";

export interface HealResult {
	healedLine: number;
	isHealed: boolean;
	status: HealStatus;
	confidence?: number;
}

export interface CandidateScoreResult {
	score: number;
	hasDirectMatch: boolean;
}

export interface SnippetSpec {
	targetCurrent: string;
	targetPrev?: string;
	targetNext?: string;
	targetScope?: string;
	targetIndent?: number;
}

/** 自愈判定通过所需的动态置信率门槛 (达到理论满分的 60% 判定为高置信度命中) */
export const HEALING_CONFIDENCE_THRESHOLD = 0.60;

/** 双向滑动窗口最大探测偏移量 (向下/向上各辐射探测 30 行) */
export const HEALING_SEARCH_WINDOW = 30;

/** 向上回溯探测函数/方法作用域的最大代码行数 (避免深层嵌套无限回溯) */
export const SCOPE_MAX_LOOKUP_LINES = 60;

/** 针对大跨度代码位移，以函数声明行为基点向后展开作用域巡航的最大行数 (覆盖绝大多数函数体) */
export const SCOPE_BODY_SEARCH_WINDOW = 150;

/**
 * 纯领域重载适配：兼容接收纯文本行数组或具备 lineAt 与 lineCount 的鸭子对象，解耦宿主
 */
export function extractContextSnippet(
	docOrLines: string[] | { lineAt(line: number): { text: string }; lineCount: number },
	lineZeroBased: number,
): ContextSnippet {
	if (Array.isArray(docOrLines)) {
		return extractContextSnippetFromLines(docOrLines, lineZeroBased);
	}
	const lines: string[] = [];
	for (let i = 0; i < docOrLines.lineCount; i++) {
		lines.push(docOrLines.lineAt(i).text);
	}
	return extractContextSnippetFromLines(lines, lineZeroBased);
}


/**
 * 对单条候选源码行执行全维特征加权打分
 */
export function calculateCandidateLineScore(
	lines: string[],
	i: number,
	snippet: {
		targetCurrent: string;
		targetPrev?: string;
		targetNext?: string;
		targetScope?: string;
		targetIndent?: number;
	},
	getCandidateScope: (lineIdx: number) => string | undefined,
	distancePenalty: number,
): CandidateScoreResult {
	const lineText = cleanLine(lines[i]);
	let score = 0;

	// (1) 当前行精确匹配与行尾注释容错
	const isCurrentExactMatch = lineText === snippet.targetCurrent;
	let hasDirectMatch = isCurrentExactMatch;
	if (isCurrentExactMatch) {
		score += 10;
	} else if (
		snippet.targetCurrent &&
		stripTrailingComment(lineText) === stripTrailingComment(snippet.targetCurrent) &&
		stripTrailingComment(lineText).length > 0
	) {
		score += 9;
		hasDirectMatch = true;
	}

	// (2) 非空拓扑伴随行协同打分
	let hasPrevMatch = false;
	const candPrev = findPrevNonEmptyLine(lines, i);
	if (snippet.targetPrev && candPrev === snippet.targetPrev) {
		score += 5;
		hasPrevMatch = true;
	}

	let hasNextMatch = false;
	const candNext = findNextNonEmptyLine(lines, i);
	if (snippet.targetNext && candNext === snippet.targetNext) {
		score += 5;
		hasNextMatch = true;
	}
	const hasContextMatch = hasPrevMatch || hasNextMatch;

	// (3) 软相似度打分
	if (!isCurrentExactMatch && hasContextMatch) {
		const sim = calculateSimilarity(lineText, snippet.targetCurrent);
		if (sim >= 0.70) {
			score += Math.round(sim * 6);
			hasDirectMatch = true;
		}
	}

	// (3.1) 双侧拓扑上下文闭环夹逼
	if (hasPrevMatch && hasNextMatch) {
		hasDirectMatch = true;
	}

	// (4) 几何缩进深度协同打分
	let candIndent = 0;
	if (snippet.targetIndent !== undefined) {
		candIndent = countIndent(lines[i]);
		if (candIndent === snippet.targetIndent) {
			score += 3;
		} else if (candIndent === snippet.targetIndent * 2 || snippet.targetIndent === candIndent * 2) {
			score += 2;
		}
	}

	// (5) 作用域锚点/几何父节点双重佐证
	if (snippet.targetScope && score >= 5) {
		const candParent = findGeometricParent(lines, i, candIndent);
		const candidateScope = getCandidateScope(i);
		if (
			(candidateScope && candidateScope === snippet.targetScope) ||
			(candParent && candParent.includes(snippet.targetScope))
		) {
			score += 5;
		}
	}

	// (6) 距离微惩罚
	score -= distancePenalty;

	return { score, hasDirectMatch };
}

/**
 * HealingEngine 领域引擎
 * 职责：纯内存两阶段加权自愈决策策略 (阶段一交替辐射探测 + 阶段二作用域巡航动态重锚定) 与当前行本体守卫 (Target Existence Guard)
 * 纯 TS 实现，零 Node.js fs / path 依赖
 */
export class HealingEngine {
	constructor(
		public readonly confidenceThreshold: number = HEALING_CONFIDENCE_THRESHOLD,
		public readonly searchWindow: number = HEALING_SEARCH_WINDOW,
		public readonly scopeBodyWindow: number = SCOPE_BODY_SEARCH_WINDOW,
	) {}

	/**
	 * 计算指纹特征理论满分分值
	 */
	private computeMaxPossibleScore(spec: SnippetSpec): number {
		let score = 10;
		if (spec.targetPrev) score += 5;
		if (spec.targetNext) score += 5;
		if (spec.targetScope) score += 5;
		if (spec.targetIndent !== undefined) score += 3;
		return score;
	}

	/**
	 * 阶段一：原址近距辐射探测 (零分配双向辐射探测)
	 */
	private probeNearRadius(
		lines: string[],
		origIdx: number,
		spec: SnippetSpec,
		maxPossibleScore: number,
	): HealResult | undefined {
		const getCandidateScope = (lineIdx: number): string | undefined => extractScopeAnchor(lines, lineIdx);
		let bestIdx = -1;
		let bestScore = -1;

		for (let step = 1; step <= this.searchWindow; step++) {
			for (const offset of [step, -step]) {
				const i = origIdx + offset;
				if (i < 0 || i >= lines.length) continue;

				const { score, hasDirectMatch } = calculateCandidateLineScore(
					lines,
					i,
					spec,
					getCandidateScope,
					step * 0.05,
				);
				if (hasDirectMatch && score > bestScore) {
					bestScore = score;
					bestIdx = i;
				}
			}
		}

		const confidenceRatio = bestScore / maxPossibleScore;
		if (bestScore >= 12.5 || confidenceRatio >= this.confidenceThreshold) {
			return {
				healedLine: bestIdx + 1,
				isHealed: true,
				status: "healed",
				confidence: confidenceRatio,
			};
		}
		return undefined;
	}

	/**
	 * 阶段二：作用域巡航大跨度重锚定
	 */
	private cruiseScopeAnchor(
		lines: string[],
		origIdx: number,
		targetLine: number,
		targetScope: string,
		spec: SnippetSpec,
		maxPossibleScore: number,
	): HealResult | undefined {
		const scopeHeaderIdx = findScopeAnchorLine(lines, targetScope);
		if (scopeHeaderIdx === undefined) return undefined;

		const getCandidateScope = (lineIdx: number): string | undefined => extractScopeAnchor(lines, lineIdx);
		let p2BestIdx = -1;
		let p2BestScore = -1;
		const searchEnd = Math.min(lines.length - 1, scopeHeaderIdx + this.scopeBodyWindow);
		const headerLine = lines[scopeHeaderIdx] || "";
		const isPythonStyle = headerLine.trim().endsWith(":");
		const headerIndent = countIndent(headerLine);

		for (let i = scopeHeaderIdx; i <= searchEnd; i++) {
			if (isPythonStyle && i > scopeHeaderIdx) {
				const trimmed = lines[i]?.trim();
				if (trimmed && !trimmed.startsWith("#") && countIndent(lines[i]) <= headerIndent) {
					break;
				}
			}

			const distance = Math.abs(i - origIdx);
			const { score, hasDirectMatch } = calculateCandidateLineScore(
				lines,
				i,
				spec,
				getCandidateScope,
				distance * 0.01,
			);
			if (hasDirectMatch && score > p2BestScore) {
				p2BestScore = score;
				p2BestIdx = i;
			}
		}

		const p2Ratio = p2BestScore / maxPossibleScore;
		if (p2BestScore >= 12.5 || p2Ratio >= this.confidenceThreshold) {
			const newHealedLine = p2BestIdx + 1;
			const isHealed = newHealedLine !== targetLine;
			return {
				healedLine: newHealedLine,
				isHealed,
				status: isHealed ? "healed" : "matched",
				confidence: p2Ratio,
			};
		}
		return undefined;
	}

	/**
	 * 对给定代码行数组及伴随指纹执行两阶段自愈运算 (纯内存算法)
	 */
	public heal(
		lines: string[],
		targetLine: number,
		fp?: Fingerprint | ContextSnippet,
	): HealResult {
		if (typeof targetLine !== "number" || isNaN(targetLine) || targetLine <= 0) {
			return { healedLine: targetLine || 1, isHealed: false, status: "matched" };
		}
		if (!lines || lines.length === 0) {
			return { healedLine: targetLine, isHealed: false, status: "unmatched" };
		}

		const fingerprint = fp instanceof Fingerprint ? fp : Fingerprint.fromSnippet(fp);
		if (!fingerprint || !fingerprint.isValid()) {
			return { healedLine: targetLine, isHealed: false, status: "matched" };
		}

		const origIdx = targetLine - 1;
		const spec: SnippetSpec = {
			targetCurrent: fingerprint.current,
			targetPrev: fingerprint.prev,
			targetNext: fingerprint.next,
			targetScope: fingerprint.scopeAnchor,
			targetIndent: fingerprint.indent,
		};

		// 1. 快路径 (Fast Path)
		if (origIdx < lines.length && cleanLine(lines[origIdx]) === spec.targetCurrent) {
			return { healedLine: targetLine, isHealed: false, status: "matched", confidence: 1.0 };
		}

		const maxPossibleScore = this.computeMaxPossibleScore(spec);

		// 2. 阶段一：原址近距辐射探测
		const phase1Result = this.probeNearRadius(lines, origIdx, spec, maxPossibleScore);
		if (phase1Result) return phase1Result;

		// 3. 阶段二：作用域巡航大跨度重锚定
		if (spec.targetScope) {
			const phase2Result = this.cruiseScopeAnchor(lines, origIdx, targetLine, spec.targetScope, spec, maxPossibleScore);
			if (phase2Result) return phase2Result;
		}

		// 4. 若两阶段均未达标，安全标记为 unmatched 脱靶
		return { healedLine: targetLine, isHealed: false, status: "unmatched" };
	}

	/**
	 * 面向 ILineReader 端口读取并执行自愈 (零 fs 依赖，依赖倒置)
	 */
	public async healWithReader(
		reader: ILineReader,
		filePath: string,
		targetLine: number,
		fp?: Fingerprint | ContextSnippet,
	): Promise<HealResult> {
		const lines = await reader.readLines(filePath);
		return this.heal(lines as string[], targetLine, fp);
	}

	// 静态快捷调用
	public static heal(
		lines: string[],
		targetLine: number,
		fp?: Fingerprint | ContextSnippet,
	): HealResult {
		return defaultHealingEngine.heal(lines, targetLine, fp);
	}
}

export const defaultHealingEngine = new HealingEngine();
