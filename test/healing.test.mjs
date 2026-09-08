import assert from "node:assert";

export function cleanLine(text) {
	if (typeof text !== "string") return "";
	const normalized = text.trim().replace(/\s+/g, " ");
	return normalized.length > 140 ? normalized.substring(0, 140) : normalized;
}

export function countIndent(text) {
	if (typeof text !== "string") return 0;
	const match = text.replace(/\t/g, "  ").match(/^(\s*)/);
	return match ? match[1].length : 0;
}

const HEALING_CONFIDENCE_THRESHOLD = 0.68;
const HEALING_SEARCH_WINDOW = 30;
const SCOPE_MAX_LOOKUP_LINES = 60;

const SCOPE_PATTERNS = [
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

export function extractScopeAnchor(lines, lineZeroBased) {
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

export function calculateSimilarity(strA, strB) {
	if (strA === strB) return 1.0;
	const trimA = strA.trim();
	const trimB = strB.trim();
	if (trimA === trimB) return 0.95;
	if (!trimA || !trimB) return 0.0;

	const wordsA = trimA.match(/[a-zA-Z0-9_$]+/g) || [];
	const wordsB = trimB.match(/[a-zA-Z0-9_$]+/g) || [];
	if (wordsA.length > 0 && wordsB.length > 0) {
		const setA = new Set(wordsA);
		let matchedWords = 0;
		for (const w of wordsB) {
			if (setA.has(w)) matchedWords++;
		}
		const wordSim = matchedWords / Math.max(wordsA.length, wordsB.length);

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

export function resolveHealedLineInMemory(lines, item) {
	if (!item || !item.contextSnippet || typeof item.contextSnippet.current !== "string" || !item.line) {
		return { healedLine: item?.line ?? 1, isHealed: false };
	}
	if (typeof item.line !== "number" || isNaN(item.line) || item.line <= 0) {
		return { healedLine: item.line, isHealed: false };
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

	// 快路径
	if (origIdx >= 0 && origIdx < lines.length) {
		if (cleanLine(lines[origIdx]) === targetCurrent) {
			return { healedLine: item.line, isHealed: false };
		}
	}

	// 慢路径
	const offsets = [];
	for (let step = 1; step <= HEALING_SEARCH_WINDOW; step++) {
		offsets.push(step);
		offsets.push(-step);
	}

	const scopeCache = new Map();
	const getCandidateScope = (lineIdx) => {
		if (scopeCache.has(lineIdx)) return scopeCache.get(lineIdx);
		const scope = extractScopeAnchor(lines, lineIdx);
		scopeCache.set(lineIdx, scope);
		return scope;
	};

	let maxPossibleScore = 10;
	if (targetPrev) maxPossibleScore += 5;
	if (targetNext) maxPossibleScore += 5;
	if (targetScope) maxPossibleScore += 5;
	if (targetIndent !== undefined) maxPossibleScore += 3;

	let bestIdx = -1;
	let bestScore = -1;

	for (const offset of offsets) {
		const i = origIdx + offset;
		if (i < 0 || i >= lines.length) continue;

		const lineText = cleanLine(lines[i]);
		let score = 0;

		const isCurrentExactMatch = lineText === targetCurrent;
		if (isCurrentExactMatch) {
			score += 10;
		}

		let hasContextMatch = false;
		if (targetPrev && i > 0 && cleanLine(lines[i - 1]) === targetPrev) {
			score += 5;
			hasContextMatch = true;
		}
		if (targetNext && i < lines.length - 1 && cleanLine(lines[i + 1]) === targetNext) {
			score += 5;
			hasContextMatch = true;
		}

		if (!isCurrentExactMatch && hasContextMatch) {
			const sim = calculateSimilarity(lineText, targetCurrent);
			if (sim >= 0.70) {
				score += Math.round(sim * 6);
			}
		}

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

		if (targetScope && score >= 5) {
			const candidateScope = getCandidateScope(i);
			if (candidateScope && candidateScope === targetScope) {
				score += 5;
			}
		}

		const distance = Math.abs(offset);
		score -= distance * 0.05;

		if (score > bestScore) {
			bestScore = score;
			bestIdx = i;
		}
	}

	const confidenceRatio = maxPossibleScore > 0 ? bestScore / maxPossibleScore : 0;
	if (bestIdx !== -1 && confidenceRatio >= HEALING_CONFIDENCE_THRESHOLD) {
		const newHealedLine = bestIdx + 1;
		return {
			healedLine: newHealedLine,
			isHealed: newHealedLine !== item.line,
		};
	}

	return { healedLine: item.line, isHealed: false };
}

export function runHealingTests() {
	console.log("  ▶ [Healing] 运行自愈算法全维边界测试套件...");

	// 1. 文件第 1 行断点（首行极值：无上一行、无回溯作用域）
	{
		const bpLine1 = {
			file: "main.ts",
			line: 1,
			contextSnippet: {
				current: "import * as os from 'os';",
				next: "import * as fs from 'fs';",
				indent: 0,
			},
		};
		const newLines = [
			"// Added license banner",
			"import * as os from 'os';", // 漂移到第 2 行
			"import * as fs from 'fs';",
		];
		const res = resolveHealedLineInMemory(newLines, bpLine1);
		assert.strictEqual(res.healedLine, 2, "首行断点下移应准确自愈到第 2 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 2. 文件最后一行断点（末行极值：无下一行）
	{
		const bpLast = {
			file: "main.ts",
			line: 3,
			contextSnippet: {
				prev: "const app = createApp();",
				current: "export default app;",
				indent: 0,
			},
		};
		const newLines = [
			"const app = createApp();",
			"// Extra log inserted",
			"const app2 = createApp();",
			"export default app;", // 漂移到第 4 行
		];
		const res = resolveHealedLineInMemory(newLines, bpLast);
		assert.strictEqual(res.healedLine, 4, "末行断点下移应准确自愈到第 4 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 3. 代码行被彻底删除（必须安全回退原行，严禁乱飘）
	{
		const bpDeleted = {
			file: "del.ts",
			line: 3,
			contextSnippet: {
				prev: "const x = 1;",
				current: "const debugToken = 'dead-code-to-remove';",
				next: "const y = 2;",
			},
		};
		const newLines = [
			"const x = 1;",
			"const y = 2;",
			"return x + y;",
		];
		const res = resolveHealedLineInMemory(newLines, bpDeleted);
		assert.strictEqual(res.healedLine, 3, "代码删除后无法达标应平滑回退原行号");
		assert.strictEqual(res.isHealed, false);
	}

	// 4. 超大跨度偏移（超出 ±30 行窗口限制，必须安全回退）
	{
		const bpFar = {
			file: "far.ts",
			line: 5,
			contextSnippet: {
				current: "const TARGET_STMT = true;",
			},
		};
		const newLines = [];
		// 插入 50 行注释使原先第 5 行变为第 55 行 (超出 30 步窗口)
		for (let k = 0; k < 50; k++) {
			newLines.push(`// Spacer comment ${k}`);
		}
		newLines.push("const TARGET_STMT = true;");

		const res = resolveHealedLineInMemory(newLines, bpFar);
		assert.strictEqual(res.healedLine, 5, "超出滑动窗口步长限制应安全回退");
		assert.strictEqual(res.isHealed, false);
	}

	// 5. 异常空值与无效入参守卫 (Null-safety & Boundary)
	{
		assert.strictEqual(resolveHealedLineInMemory([], { line: 10 }).isHealed, false);
		assert.strictEqual(resolveHealedLineInMemory(["a", "b"], null).isHealed, false);
		assert.strictEqual(resolveHealedLineInMemory(["a", "b"], { line: 0 }).isHealed, false);
		assert.strictEqual(resolveHealedLineInMemory(["a", "b"], { line: -10 }).isHealed, false);
		assert.strictEqual(resolveHealedLineInMemory(["a", "b"], { line: NaN }).isHealed, false);
		assert.strictEqual(resolveHealedLineInMemory(["a", "b"], { line: 2, contextSnippet: undefined }).isHealed, false);
	}

	// 6. 超长代码行截断 (>140 字符)
	{
		const ultraLong = "const svgData = '" + "A".repeat(200) + "';";
		const cleaned = cleanLine(ultraLong);
		assert.strictEqual(cleaned.length, 140, "超长代码行必须安全截断为 140 字符");
	}

	// 7. 多语言作用域提取模式测试
	{
		// (1) Go 语言带 receiver 方法: func (r *Repo) Query(ctx context.Context)
		const goLines = [
			"package main",
			"func (r *Repo) Query(ctx context.Context) error {",
			"    return nil",
		];
		assert.strictEqual(extractScopeAnchor(goLines, 2), "Query", "Go 方法 Receiver 正确识别函数名");

		// (2) Rust 公共异步函数: pub async fn handle(req: Request) -> Result<()>
		const rustLines = [
			"pub async fn handle(req: Request) -> Result<()> {",
			"    let x = 10;",
		];
		assert.strictEqual(extractScopeAnchor(rustLines, 1), "handle", "Rust pub async fn 正确识别函数名");

		// (3) TS 类成员私有方法与箭头函数: private onClick = (e) =>
		const tsLines = [
			"class Button {",
			"    private onClick = (e: Event) => {",
			"        console.log(e);",
		];
		assert.strictEqual(extractScopeAnchor(tsLines, 2), "onClick", "TS 类成员箭头函数名正确识别");
	}

	// 8. 软容错上下文硬门禁（当前行更名但上下文全失配时严禁自愈）
	{
		const lines = [
			"function render() {",
			"    const targetTitle = 'home';",
			"    return null;",
			"}",
		];
		const bp = {
			file: "render.ts",
			line: 2,
			contextSnippet: {
				prev: "function notMatch() {",
				current: "const title = 'home';",
				next: "return undefined;",
			},
		};
		const res = resolveHealedLineInMemory(lines, bp);
		assert.strictEqual(res.healedLine, 2);
		assert.strictEqual(res.isHealed, false, "上下文全未匹配时严禁给当前行软容错分");
	}

	console.log("  ✅ [Healing] 自愈算法全维边界套件（8 大核心边界）全部通过！");
}
