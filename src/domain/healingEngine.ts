import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextSnippet, SourceSceneBreakpoint } from "./types";


export type HealStatus = "matched" | "healed" | "unmatched";

export interface HealResult {
	healedLine: number;
	isHealed: boolean;
	status: HealStatus;
	confidence?: number;
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
 * 规范化单行代码内容：去除行首行尾所有空白，并将中间连续空白压缩为单空格
 * （让代码内容指纹与行首具体空格数彻底解耦，无论 2 空格、4 空格还是 Tab 缩进，纯代码指纹均 100% 一致）
 */
export function cleanLine(text: unknown): string {
	if (typeof text !== "string") return "";
	const normalized = text.trim().replace(/\s+/g, " ");
	return normalized.length > 140 ? normalized.substring(0, 140) : normalized;
}

/**
 * 剥离行尾单行注释 (// 或 # 或 --) 并清除尾部多余空白
 * 覆盖 C/C++, Java, C#, Go, Rust, Swift, Kotlin, JS/TS, Python, Ruby, Shell, SQL, Lua
 */
export function stripTrailingComment(line: string): string {
	if (!line) return "";
	return line.replace(/\s*(?:\/\/|#|--).*$/, "").trim();
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
 * 通用拓扑：向上穿透空行与纯空白，寻找第一条非空代码行
 */
export function findPrevNonEmptyLine(lines: string[], fromIdx: number): string | undefined {
	for (let i = fromIdx - 1; i >= 0; i--) {
		const line = lines[i];
		if (line && line.trim()) {
			return cleanLine(line);
		}
	}
	return undefined;
}

/**
 * 通用拓扑：向下穿透空行与纯空白，寻找第一条非空代码行
 */
export function findNextNonEmptyLine(lines: string[], fromIdx: number): string | undefined {
	for (let i = fromIdx + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line && line.trim()) {
			return cleanLine(line);
		}
	}
	return undefined;
}

/**
 * 通用几何：向上寻找第一条缩进严格小于当前行的代码行作为几何父结构锚点 (语言无关，穿透同层控制流)
 */
export function findGeometricParent(lines: string[], fromIdx: number, currentIndent: number): string | undefined {
	for (let i = fromIdx - 1; i >= 0; i--) {
		const line = lines[i];
		if (!line || !line.trim()) continue;
		const ind = countIndent(line);
		if (ind < currentIndent) {
			return cleanLine(line);
		}
	}
	return undefined;
}

/** 通用控制流保留字黑名单，杜绝将 if, for, while, switch, catch 误判为方法名 */
const CONTROL_FLOW_KEYWORDS = new Set([
	"if", "else", "elif", "for", "while", "do", "loop", "switch", "case",
	"catch", "finally", "with", "select", "defer", "go", "return", "throw"
]);

/**
 * 常见编程语言的函数/方法/类声明正则模式 (支持 JS/TS, Python, Go, Rust, Java, C#, C/C++, Swift, Kotlin, PHP, Ruby)
 */
const SCOPE_PATTERNS: RegExp[] = [
	// Python / Ruby: def foo(...) or async def foo(...)
	/^\s*(?:async\s+)?def\s+([a-zA-Z0-9_$]+)/,
	// JS / TS / PHP: function foo(...) or async function foo(...)
	/^\s*(?:export\s+)?(?:async\s+)?function(?:\s+([a-zA-Z0-9_$]+)|\s*\()/i,
	// Go / Swift / Kotlin: func (r *Receiver) Method(...) or fun Method(...)
	/^\s*(?:(?:pub|public|private|protected|internal|override|final)\s+)*(?:func|fun)\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_$]+)/i,
	// Rust: fn foo(...) or pub fn foo(...)
	/^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_$]+)/,
	// 类构造函数 constructor(...)
	/^\s*(?:public|private|protected)*\s*constructor\b/i,
	// 类属性访问器 get prop() / set prop(v)
	/^\s*(?:public|private|protected|static)*\s*(?:get|set)\s+([a-zA-Z0-9_$]+)/i,
	// Java / C# / C++ 类方法: 修饰符 + 返回类型(可能带泛型或指针) + 方法名(参数)
	/^\s*(?:(?:public|private|protected|static|final|native|synchronized|abstract|virtual|override|async)\s+)+[a-zA-Z0-9_$<>,\[\]\s*&]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\s*[{;]/i,
	// 类方法或对象方法: methodName(...) { or methodName = (...) =>
	/^\s*(?:public|private|protected|static|async)*\s*([a-zA-Z0-9_$]+)\s*(?:=\s*(?:async\s*)?(?:<[^>]*>)?\s*\([^)]*\)\s*=>|\([^)]*\)\s*[{:])/i,
	// Class / Struct / Interface / Trait / Enum / Type
	/^\s*(?:export\s+)?(?:class|struct|interface|trait|enum|type)\s+([a-zA-Z0-9_$]+)/,
	// Rust impl 块: impl Trait for Struct or impl Struct
	/^\s*impl(?:\s+<[^>]+>)?(?:\s+[a-zA-Z0-9_$]+)?\s+for\s+([a-zA-Z0-9_$]+)/,
	/^\s*impl(?:\s+<[^>]+>)?\s+([a-zA-Z0-9_$]+)/,
];

/**
 * 从当前行向上回溯抓取最近的函数/方法名作为作用域辅助锚点 (支持控制流穿透)
 */
export function extractScopeAnchor(lines: string[], lineZeroBased: number): string | undefined {
	const maxLookup = Math.max(0, lineZeroBased - SCOPE_MAX_LOOKUP_LINES);
	for (let i = lineZeroBased; i >= maxLookup; i--) {
		const rawLine = lines[i];
		if (!rawLine || !rawLine.trim()) continue;

		// 拦截控制流语句，防止 if (x) { 或 while (x): 被误识别为类方法
		if (/^\s*(?:if|for|while|switch|catch|with|elif)\s*\(/.test(rawLine)) {
			continue;
		}

		for (const pattern of SCOPE_PATTERNS) {
			const match = rawLine.match(pattern);
			if (match) {
				const identifier = match[1] || (pattern.source.includes("constructor") ? "constructor" : undefined);
				if (identifier && identifier.trim() && !CONTROL_FLOW_KEYWORDS.has(identifier.trim())) {
					return identifier.trim();
				}
			}
		}
	}
	return undefined;
}

/**
 * 在源码行集合中全文快速检索指定作用域声明行 (函数/方法/类声明行号，0-based)
 */
export function findScopeAnchorLine(lines: string[], scopeAnchor: string): number | undefined {
	if (!scopeAnchor || !scopeAnchor.trim()) return undefined;
	const target = scopeAnchor.trim();

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i];
		if (!rawLine || !rawLine.trim() || !rawLine.includes(target)) continue;

		// 拦截控制流语句
		if (/^\s*(?:if|for|while|switch|catch|with|elif)\s*\(/.test(rawLine)) {
			continue;
		}

		for (const pattern of SCOPE_PATTERNS) {
			const match = rawLine.match(pattern);
			if (match) {
				const identifier = match[1] || (pattern.source.includes("constructor") ? "constructor" : undefined);
				if (identifier && identifier.trim() === target) {
					return i;
				}
			}
		}
	}
	return undefined;
}

/**
 * 纯领域函数：从纯文本行数组提取目标行全维上下文伴随指纹 (0 外部依赖，纯 TS 实现)
 */
export function extractContextSnippetFromLines(lines: string[], lineZeroBased: number): ContextSnippet {
	const currentLineText = lines[lineZeroBased] ?? "";
	const current = cleanLine(currentLineText);
	const indent = countIndent(currentLineText);

	// 穿透空行提取拓扑伴随行
	const prev = findPrevNonEmptyLine(lines, lineZeroBased);
	const next = findNextNonEmptyLine(lines, lineZeroBased);

	// 向上提取作用域辅助锚点 (穿透控制流)
	const sampleLines = lines.slice(Math.max(0, lineZeroBased - 60), lineZeroBased + 1);
	const scopeAnchor = extractScopeAnchor(sampleLines, sampleLines.length - 1);

	return { prev, current, next, scopeAnchor, indent };
}

/**
 * 纯领域重载适配：兼容接收纯文本行数组或具备 lineAt 与 lineCount 的鸭子对象，彻底解耦 vscode.TextDocument
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
 * 对单条候选源码行执行全维特征加权打分 (当前行 + 上下文拓扑 + 缩进 + 作用域/几何父节点)
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
): { score: number; hasDirectMatch: boolean } {
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

	// (2) 非空拓扑伴随行协同打分 (穿透空行与注释，彻底根除空行敏感)
	let hasPrevMatch = false;
	const candPrev = findPrevNonEmptyLine(lines, i);
	if (
		snippet.targetPrev &&
		candPrev &&
		(candPrev === snippet.targetPrev || (i > 0 && cleanLine(lines[i - 1]) === snippet.targetPrev))
	) {
		score += 5;
		hasPrevMatch = true;
	}

	let hasNextMatch = false;
	const candNext = findNextNonEmptyLine(lines, i);
	if (
		snippet.targetNext &&
		candNext &&
		(candNext === snippet.targetNext || (i < lines.length - 1 && cleanLine(lines[i + 1]) === snippet.targetNext))
	) {
		score += 5;
		hasNextMatch = true;
	}
	let hasContextMatch = hasPrevMatch || hasNextMatch;

	// (3) 软相似度打分（受上下文门禁严格保护，且作为当前行本体证据之一）
	if (!isCurrentExactMatch && hasContextMatch) {
		const sim = calculateSimilarity(lineText, snippet.targetCurrent);
		if (sim >= 0.70) {
			score += Math.round(sim * 6);
			hasDirectMatch = true;
		}
	}

	// (3.1) 双侧拓扑上下文闭环夹逼 (prev 与 next 同时吻合，证明目标行位于确定夹层内)
	if (hasPrevMatch && hasNextMatch) {
		hasDirectMatch = true;
	}

	// (4) 几何缩进深度协同打分
	let candIndent = 0;
	if (snippet.targetIndent !== undefined) {
		candIndent = countIndent(lines[i]);
		if (candIndent === snippet.targetIndent) {
			score += 3;
		} else if (
			snippet.targetIndent > 0 &&
			candIndent > 0 &&
			(candIndent === snippet.targetIndent * 2 || snippet.targetIndent === candIndent * 2)
		) {
			score += 2;
		}
	}

	// (5) 语言无关几何父节点 / 语法作用域锚点双重佐证
	if (snippet.targetScope && score >= 5) {
		const candParent = findGeometricParent(lines, i, candIndent);
		const candidateScope = getCandidateScope(i);
		if (
			(candidateScope && candidateScope === snippet.targetScope) ||
			(candParent && (candParent === snippet.targetScope || candParent.includes(snippet.targetScope)))
		) {
			score += 5;
			hasContextMatch = true;
		}
	}

	// (6) 距离微惩罚
	score -= distancePenalty;

	return { score, hasDirectMatch };
}

/**
 * 核心自愈算法：保留缩进、交替辐射加权探测、上下文优先容错与动态边界加权
 * 返回计算得出的最精确行号 (1-indexed), 以及是否发生了行号自愈漂移修正
 */
/**
 * 纯内存自愈计算核心算法 (输入行数组与断点项，零 I/O、零宿主环境依赖)
 */
export function resolveHealedLineFromLines(
	lines: string[],
	item: SourceSceneBreakpoint,
): HealResult {
	if (!item.contextSnippet || typeof item.contextSnippet.current !== "string" || !item.line) {
		return { healedLine: item.line, isHealed: false, status: "matched" };
	}
	if (typeof item.line !== "number" || isNaN(item.line) || item.line <= 0) {
		return { healedLine: item.line, isHealed: false, status: "matched" };
	}
	if (!lines || lines.length === 0) {
		return { healedLine: item.line, isHealed: false, status: "unmatched" };
	}

	const origIdx = item.line - 1;
	const targetCurrent = cleanLine(item.contextSnippet.current);
	const targetPrev = item.contextSnippet.prev ? cleanLine(item.contextSnippet.prev) : undefined;
	const targetNext = item.contextSnippet.next ? cleanLine(item.contextSnippet.next) : undefined;
	const targetScope = item.contextSnippet.scopeAnchor;
	const targetIndent = item.contextSnippet.indent;

	// 1. 快路径 (Fast Path)：检查原行号是否完全吻合（90% 未变更场景零算法开销）
	if (origIdx >= 0 && origIdx < lines.length) {
		if (cleanLine(lines[origIdx]) === targetCurrent) {
			return { healedLine: item.line, isHealed: false, status: "matched", confidence: 1.0 };
		}
	}

	// 2. 阶段一：原址近距辐射探测 (Phase 1: Local Radiative Search) (+1, -1, +2, -2, ..., +30, -30)
	// 优先向下探测（80% 的代码变动是增添行向下偏移）
	const offsets: number[] = [];
	for (let step = 1; step <= HEALING_SEARCH_WINDOW; step++) {
		offsets.push(step);
		offsets.push(-step);
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
	let maxPossibleScore = 10;
	if (targetPrev) maxPossibleScore += 5;
	if (targetNext) maxPossibleScore += 5;
	if (targetScope) maxPossibleScore += 5;
	if (targetIndent !== undefined) maxPossibleScore += 3;

	const snippetSpec = { targetCurrent, targetPrev, targetNext, targetScope, targetIndent };

	let bestIdx = -1;
	let bestScore = -1;

	for (const offset of offsets) {
		const i = origIdx + offset;
		if (i < 0 || i >= lines.length) continue;

		const { score, hasDirectMatch } = calculateCandidateLineScore(
			lines,
			i,
			snippetSpec,
			getCandidateScope,
			Math.abs(offset) * 0.05,
		);
		// 当前行本体守卫 (Target Existence Guard)：严禁为无本体证据的行挂载断点
		if (hasDirectMatch && score > bestScore) {
			bestScore = score;
			bestIdx = i;
		}
	}

	// 3. 判定阶段一自愈阈值
	const confidenceRatio = maxPossibleScore > 0 ? bestScore / maxPossibleScore : 0;
	if (bestIdx !== -1 && (bestScore >= 12.5 || confidenceRatio >= HEALING_CONFIDENCE_THRESHOLD)) {
		const newHealedLine = bestIdx + 1;
		const isHealed = newHealedLine !== item.line;
		return {
			healedLine: newHealedLine,
			isHealed,
			status: isHealed ? "healed" : "matched",
			confidence: confidenceRatio,
		};
	}

	// 4. 阶段二：作用域巡航大跨度重锚定 (Phase 2: Scope Cruise Large-drift Search)
	// 当代码发生超长跨度位移 (突破 30 行滑动窗口)，若存在 scopeAnchor 则在全文件中寻找其函数声明行
	if (targetScope) {
		const scopeHeaderIdx = findScopeAnchorLine(lines, targetScope);
		if (scopeHeaderIdx !== undefined) {
			let p2BestIdx = -1;
			let p2BestScore = -1;
			const searchEnd = Math.min(lines.length - 1, scopeHeaderIdx + SCOPE_BODY_SEARCH_WINDOW);
			const headerLine = lines[scopeHeaderIdx] || "";
			const isPythonStyle = headerLine.trim().endsWith(":");
			const headerIndent = countIndent(headerLine);

			for (let i = scopeHeaderIdx; i <= searchEnd; i++) {
				// Python 缩进边界保护：若进入后续行且缩进回退至 <= headerIndent 且为非空非注释代码，说明已脱离该 Python 函数作用域
				if (isPythonStyle && i > scopeHeaderIdx) {
					const lineContent = lines[i];
					if (lineContent && lineContent.trim() && !lineContent.trim().startsWith("#")) {
						if (countIndent(lineContent) <= headerIndent) {
							break; // 严格阻止跨函数误匹配
						}
					}
				}

				const distance = Math.abs(i - origIdx);
				const { score, hasDirectMatch } = calculateCandidateLineScore(
					lines,
					i,
					snippetSpec,
					getCandidateScope,
					distance * 0.01,
				);
				// 阶段二同样严守当前行本体守卫
				if (hasDirectMatch && score > p2BestScore) {
					p2BestScore = score;
					p2BestIdx = i;
				}
			}

			const p2Ratio = maxPossibleScore > 0 ? p2BestScore / maxPossibleScore : 0;
			if (p2BestIdx !== -1 && (p2BestScore >= 12.5 || p2Ratio >= HEALING_CONFIDENCE_THRESHOLD)) {
				const newHealedLine = p2BestIdx + 1;
				const isHealed = newHealedLine !== item.line;
				return {
					healedLine: newHealedLine,
					isHealed,
					status: isHealed ? "healed" : "matched",
					confidence: p2Ratio,
				};
			}
		}
	}

	// 5. 若两阶段均未达标，安全标记为 unmatched 脱靶，并回退原行号
	return { healedLine: item.line, isHealed: false, status: "unmatched", confidence: confidenceRatio };
}

/**
 * 完整自愈处理函数：加载文件内容并调度纯核心自愈计算
 * 返回计算得出的最精确行号 (1-indexed), 以及是否发生了行号自愈漂移修正
 */
export async function resolveHealedLine(
	workspaceRoot: string,
	item: SourceSceneBreakpoint,
	fileLinesCache?: Map<string, string[]>,
	getDocumentLines?: (filePath: string) => string[] | undefined,
): Promise<HealResult> {
	// 若无自愈指纹或行号/文件名不合法，直接安全返回原行号（视为 matched）
	if (!item.contextSnippet || typeof item.contextSnippet.current !== "string" || !item.line) {
		return { healedLine: item.line, isHealed: false, status: "matched" };
	}
	if (typeof item.line !== "number" || isNaN(item.line) || item.line <= 0) {
		return { healedLine: item.line, isHealed: false, status: "matched" };
	}
	if (!item.file || typeof item.file !== "string") {
		return { healedLine: item.line, isHealed: false, status: "matched" };
	}

	const filePath = path.isAbsolute(item.file) ? item.file : path.join(workspaceRoot, item.file);

	// 1. 获取目标文件源码行集合（优先命中批处理内存缓存与文档提供者，其次安全读取磁盘）
	let lines: string[] | undefined;
	if (fileLinesCache && fileLinesCache.has(filePath)) {
		lines = fileLinesCache.get(filePath);
	} else {
		if (getDocumentLines) {
			lines = getDocumentLines(filePath);
		}
		if (!lines && fs.existsSync(filePath)) {
			try {
				const content = await fs.promises.readFile(filePath, "utf-8");
				lines = content.split(/\r?\n/);
			} catch {
				return { healedLine: item.line, isHealed: false, status: "unmatched" };
			}
		}
		if (lines && fileLinesCache) {
			fileLinesCache.set(filePath, lines);
		}
	}

	if (!lines || lines.length === 0) {
		return { healedLine: item.line, isHealed: false, status: "unmatched" };
	}

	return resolveHealedLineFromLines(lines, item);
}

