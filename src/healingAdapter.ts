import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ContextSnippet, SourceSceneBreakpoint } from "./types";

/** 自愈判定通过所需的动态置信率门槛 (达到理论满分的 68% 判定为高置信度命中) */
export const HEALING_CONFIDENCE_THRESHOLD = 0.68;

/** 双向滑动窗口最大探测偏移量 (向下/向上各辐射探测 30 行) */
export const HEALING_SEARCH_WINDOW = 30;

/** 向上回溯探测函数/方法作用域的最大代码行数 (避免深层嵌套无限回溯) */
export const SCOPE_MAX_LOOKUP_LINES = 60;

/**
 * 规范化单行代码内容：去除行首行尾所有空白，并将中间连续空白压缩为单空格
 * （让代码内容指纹与行首具体空格数彻底解耦，无论 2 空格、4 空格还是 Tab 缩进，纯代码指纹均 100% 一致）
 */
export function cleanLine(text: unknown): string {
	if (typeof text !== "string") return "";
	const normalized = text.trim().replace(/\s+/g, " ");
	return normalized.length > 140 ? normalized.substring(0, 140) : normalized;
}

/**
 * 计算文本行的前导空格缩进深度 (将单个 Tab 等效统计为 2 个空格深度)
 */
export function countIndent(text: unknown): number {
	if (typeof text !== "string") return 0;
	const match = text.replace(/\t/g, "  ").match(/^(\s*)/);
	return match ? match[1].length : 0;
}

/**
 * 常见编程语言的函数/方法声明正则模式 (支持 JS/TS, Python, Go, Rust, Java, C/C++)
 */
const SCOPE_PATTERNS: RegExp[] = [
	// Python: def foo(...) or class Foo(...)
	/^\s*(?:async\s+)?def\s+([a-zA-Z0-9_$]+)/,
	// JS/TS/PHP: function foo(...) or async function foo(...)
	/^\s*(?:export\s+)?(?:async\s+)?function(?:\s+([a-zA-Z0-9_$]+)|\s*\()/i,
	// Go: func (r *Receiver) Method(...) or func Function(...)
	/^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_$]+)/,
	// Rust: fn foo(...) or pub fn foo(...)
	/^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_$]+)/,
	// 类方法或对象方法: methodName(...) { or methodName = (...) =>
	/^\s*(?:public|private|protected|static|async)*\s*([a-zA-Z0-9_$]+)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\([^)]*\)\s*[{:])/i,
	// Class / Struct / Interface
	/^\s*(?:export\s+)?(?:class|struct|interface|type)\s+([a-zA-Z0-9_$]+)/,
];

/**
 * 从当前行向上轻量回溯抓取最近的函数/方法名作为作用域辅助锚点
 */
export function extractScopeAnchor(lines: string[], lineZeroBased: number): string | undefined {
	const maxLookup = Math.max(0, lineZeroBased - SCOPE_MAX_LOOKUP_LINES);
	for (let i = lineZeroBased; i >= maxLookup; i--) {
		const rawLine = lines[i];
		if (!rawLine || !rawLine.trim()) continue;

		for (const pattern of SCOPE_PATTERNS) {
			const match = rawLine.match(pattern);
			if (match) {
				const identifier = match[1] || match[2] || match[3];
				if (identifier && identifier.trim()) {
					return identifier.trim();
				}
			}
		}
	}
	return undefined;
}

/**
 * 从文本编辑器文档中提取目标行的全维上下文伴随指纹
 */
export function extractContextSnippet(doc: vscode.TextDocument, lineZeroBased: number): ContextSnippet {
	const currentLineText = doc.lineAt(lineZeroBased).text;
	const current = cleanLine(currentLineText);
	const indent = countIndent(currentLineText);

	let prev: string | undefined;
	let next: string | undefined;

	if (lineZeroBased > 0) {
		const prevText = cleanLine(doc.lineAt(lineZeroBased - 1).text);
		if (prevText.trim().length > 0) prev = prevText;
	}

	if (lineZeroBased < doc.lineCount - 1) {
		const nextText = cleanLine(doc.lineAt(lineZeroBased + 1).text);
		if (nextText.trim().length > 0) next = nextText;
	}

	// 向上提取作用域辅助锚点
	const sampleLines: string[] = [];
	const startIdx = Math.max(0, lineZeroBased - 60);
	for (let i = startIdx; i <= lineZeroBased; i++) {
		sampleLines.push(doc.lineAt(i).text);
	}
	const scopeAnchor = extractScopeAnchor(sampleLines, sampleLines.length - 1);

	return { prev, current, next, scopeAnchor, indent };
}

/**
 * 结构化词法单元相似度估计 (结合词元比对与字符集，杜绝 return true 误判成 return false)
 */
export function calculateSimilarity(strA: string, strB: string): number {
	if (strA === strB) return 1.0;
	const trimA = strA.trim();
	const trimB = strB.trim();
	if (!trimA || !trimB) return 0.0;
	if (trimA === trimB) return 0.95;

	// 提取单词 token 进行语义单元比对
	const wordsA = trimA.match(/[a-zA-Z0-9_$]+/g) || [];
	const wordsB = trimB.match(/[a-zA-Z0-9_$]+/g) || [];
	if (wordsA.length > 0 && wordsB.length > 0) {
		const setA = new Set(wordsA);
		let matchedWords = 0;
		for (const w of wordsB) {
			if (setA.has(w)) matchedWords++;
		}
		const wordSim = matchedWords / Math.max(wordsA.length, wordsB.length);

		// 字符级交集作为微调
		const charSetA = new Set(trimA.split(""));
		let commonChars = 0;
		for (const ch of trimB) {
			if (charSetA.has(ch)) commonChars++;
		}
		const charSim = commonChars / Math.max(trimA.length, trimB.length);
		return wordSim * 0.7 + charSim * 0.3;
	}

	return 0.0;
}

/**
 * 核心自愈算法：保留缩进、交替辐射加权探测、上下文优先容错与动态边界加权
 * 返回计算得出的最精确行号 (1-indexed)，以及是否发生了行号自愈漂移修正
 */
export async function resolveHealedLine(
	workspaceRoot: string,
	item: SourceSceneBreakpoint,
	fileLinesCache?: Map<string, string[]>,
): Promise<{ healedLine: number; isHealed: boolean }> {
	// 若无自愈指纹或行号/文件名不合法，直接安全返回原行号
	if (!item.contextSnippet || typeof item.contextSnippet.current !== "string" || !item.line) {
		return { healedLine: item.line, isHealed: false };
	}
	if (!item.file || typeof item.file !== "string") {
		return { healedLine: item.line, isHealed: false };
	}

	const filePath = path.isAbsolute(item.file) ? item.file : path.join(workspaceRoot, item.file);

	// 1. 获取目标文件源码行集合（优先命中批处理内存缓存与已打开的文档，减少磁盘 IO）
	let lines: string[] | undefined;
	if (fileLinesCache && fileLinesCache.has(filePath)) {
		lines = fileLinesCache.get(filePath);
	} else {
		const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === filePath);
		if (openDoc) {
			lines = [];
			for (let i = 0; i < openDoc.lineCount; i++) {
				lines.push(openDoc.lineAt(i).text);
			}
		} else if (fs.existsSync(filePath)) {
			try {
				const content = await fs.promises.readFile(filePath, "utf-8");
				lines = content.split(/\r?\n/);
			} catch {
				return { healedLine: item.line, isHealed: false };
			}
		}
		if (lines && fileLinesCache) {
			fileLinesCache.set(filePath, lines);
		}
	}

	if (!lines || lines.length === 0) {
		return { healedLine: item.line, isHealed: false };
	}

	const origIdx = item.line - 1;
	const targetCurrent = cleanLine(item.contextSnippet.current);
	const targetPrev = item.contextSnippet.prev ? cleanLine(item.contextSnippet.prev) : undefined;
	const targetNext = item.contextSnippet.next ? cleanLine(item.contextSnippet.next) : undefined;
	const targetScope = item.contextSnippet.scopeAnchor;
	const targetIndent = item.contextSnippet.indent;

	// 2. 快路径 (Fast Path)：检查原行号是否完全吻合（90% 未变更场景零算法开销）
	if (origIdx >= 0 && origIdx < lines.length) {
		if (cleanLine(lines[origIdx]) === targetCurrent) {
			return { healedLine: item.line, isHealed: false };
		}
	}

	// 3. 慢路径 (Slow Path)：双向交替辐射探测序列 (+1, -1, +2, -2, ..., +30, -30)
	// 优先向下探测（80% 的代码变动是增添行向下偏移）
	const offsets: number[] = [];
	for (let step = 1; step <= HEALING_SEARCH_WINDOW; step++) {
		offsets.push(step); // 优先向下偏移 +step
		offsets.push(-step); // 其次向上偏移 -step
	}

	// 局部作用域缓存，杜绝重复向上回溯导致的 O(n²) 性能卡顿
	const scopeCache = new Map<number, string | undefined>();
	const getCandidateScope = (lineIdx: number): string | undefined => {
		if (scopeCache.has(lineIdx)) return scopeCache.get(lineIdx);
		const scope = extractScopeAnchor(lines, lineIdx);
		scopeCache.set(lineIdx, scope);
		return scope;
	};

	// 计算当前场景的理论满分（自适应首行、末行和缺失项）
	let maxPossibleScore = 10; // 当前行
	if (targetPrev) maxPossibleScore += 5; // 上一行
	if (targetNext) maxPossibleScore += 5; // 下一行
	if (targetScope) maxPossibleScore += 5; // 作用域锚点
	if (targetIndent !== undefined) maxPossibleScore += 3; // 缩进

	let bestIdx = -1;
	let bestScore = -1;

	for (const offset of offsets) {
		const i = origIdx + offset;
		if (i < 0 || i >= lines.length) continue;

		const lineText = cleanLine(lines[i]);
		let score = 0;

		// (1) 当前行精确匹配
		const isCurrentExactMatch = lineText === targetCurrent;
		if (isCurrentExactMatch) {
			score += 10;
		}

		// (2) 上下文协同打分 (防止重复 return/break 误判，支持当前行轻度重构自愈)
		let hasContextMatch = false;
		if (targetPrev && i > 0 && cleanLine(lines[i - 1]) === targetPrev) {
			score += 5;
			hasContextMatch = true;
		}
		if (targetNext && i < lines.length - 1 && cleanLine(lines[i + 1]) === targetNext) {
			score += 5;
			hasContextMatch = true;
		}

		// (3) 软相似度打分（受上下文门禁严格保护）
		// 核心铁律：仅当当前行未完全匹配、但至少有 1 行上下文（prev/next）获得 100% 精确匹配时，才允许启用软相似度容错！
		// 若上下文全未匹配（或处于首尾行无上下文），软分直接为 0，彻底根除 return true 误判为 return false 等高估漏洞
		if (!isCurrentExactMatch && hasContextMatch) {
			const sim = calculateSimilarity(lineText, targetCurrent);
			if (sim >= 0.70) {
				score += Math.round(sim * 6);
			}
		}

		// (4) 缩进深度协同打分（精准缩进给 3 分；2空格 ↔ 4空格等全局格式化整倍数重构给 2 分容错）
		if (targetIndent !== undefined) {
			const candidateIndent = countIndent(lines[i]);
			if (candidateIndent === targetIndent) {
				score += 3;
			} else if (
				targetIndent > 0 &&
				candidateIndent > 0 &&
				(candidateIndent === targetIndent * 2 || targetIndent === candidateIndent * 2)
			) {
				score += 2;
			}
		}

		// (5) 作用域辅助锚点协同打分（仅在 score >= 5 且有命中证据时按需计算，彻底消除 O(n²) 正则扫描卡顿）
		if (targetScope && score >= 5) {
			const candidateScope = getCandidateScope(i);
			if (candidateScope && candidateScope === targetScope) {
				score += 5;
			}
		}

		// (6) 辐射距离微惩罚 (同等分数下优先贴近原始行)
		const distance = Math.abs(offset);
		score -= distance * 0.05;

		if (score > bestScore) {
			bestScore = score;
			bestIdx = i;
		}
	}

	// 4. 判定自愈阈值：
	// 动态置信度百分比判定 (满足满分的 HEALING_CONFIDENCE_THRESHOLD 即高置信度通过，自动适应首行与轻度重构场景)
	const confidenceRatio = maxPossibleScore > 0 ? bestScore / maxPossibleScore : 0;

	if (bestIdx !== -1 && confidenceRatio >= HEALING_CONFIDENCE_THRESHOLD) {
		const newHealedLine = bestIdx + 1;
		return {
			healedLine: newHealedLine,
			isHealed: newHealedLine !== item.line,
		};
	}

	// 5. 若发生破坏性重构或代码已被彻底删除，平滑回退至原行号
	return { healedLine: item.line, isHealed: false };
}
