import { cleanLine } from "./stringSimilarity";

/** 通用控制流保留字黑名单，杜绝将 if, for, while, switch, catch 误判为方法名 */
const CONTROL_FLOW_KEYWORDS = new Set([
	"if", "else", "elif", "for", "while", "do", "loop", "switch", "case",
	"catch", "finally", "with", "select", "defer", "go", "return", "throw"
]);

/** 常见编程语言的函数/方法/类声明正则模式 */
const SCOPE_PATTERNS: RegExp[] = [
	/^\s*(?:async\s+)?def\s+([a-zA-Z0-9_$]+)/,
	/^\s*(?:export\s+)?(?:async\s+)?function(?:\s+([a-zA-Z0-9_$]+)|\s*\()/i,
	/^\s*(?:(?:pub|public|private|protected|internal|override|final)\s+)*(?:func|fun)\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_$]+)/i,
	/^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_$]+)/,
	/^\s*(?:public|private|protected)*\s*(constructor)\b/i,
	/^\s*(?:public|private|protected|static)*\s*(?:get|set)\s+([a-zA-Z0-9_$]+)/i,
	/^\s*(?:(?:public|private|protected|static|final|native|synchronized|abstract|virtual|override|async)\s+)+[a-zA-Z0-9_$<>,\[\]\s*&]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\s*[{;]/i,
	/^\s*(?:public|private|protected|static|async)*\s*([a-zA-Z0-9_$]+)\s*(?:=\s*(?:async\s*)?(?:<[^>]*>)?\s*\([^)]*\)\s*=>|\([^)]*\)\s*[{:])/i,
	/^\s*(?:export\s+)?(?:class|struct|interface|trait|enum|type)\s+([a-zA-Z0-9_$]+)/,
	/^\s*impl(?:\s+<[^>]+>)?(?:\s+[a-zA-Z0-9_$]+)?\s+for\s+([a-zA-Z0-9_$]+)/,
	/^\s*impl(?:\s+<[^>]+>)?\s+([a-zA-Z0-9_$]+)/,
];

/**
 * 计算文本行的前导空格缩进深度 (将单个 Tab 等效统计为 2 个空格深度) (纯工具)
 */
export function countIndent(text: unknown): number {
	if (typeof text !== "string") return 0;
	const match = text.replace(/\t/g, "  ").match(/^(\s*)/);
	return match ? match[1].length : 0;
}

/**
 * 向上穿透空行与纯空白，寻找第一条非空代码行 (纯工具)
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
 * 向下穿透空行与纯空白，寻找第一条非空代码行 (纯工具)
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
 * 向上寻找第一条缩进严格小于当前行的代码行作为几何父结构锚点 (纯工具)
 */
export function findGeometricParent(lines: string[], fromIdx: number, currentIndent: number): string | undefined {
	for (let i = fromIdx - 1; i >= 0; i--) {
		const line = lines[i];
		if (!line?.trim()) continue;
		const ind = countIndent(line);
		if (ind < currentIndent) {
			return cleanLine(line);
		}
	}
	return undefined;
}

/**
 * 从当前行向上回溯提取第一层有效的作用域声明名称 (纯工具)
 */
export function extractScopeAnchor(lines: string[], fromIdx: number, maxLookup = 60): string | undefined {
	if (!lines?.length || fromIdx < 0) return undefined;
	const startIdx = Math.min(fromIdx, lines.length - 1);
	const endIdx = Math.max(0, startIdx - maxLookup);

	for (let i = startIdx; i >= endIdx; i--) {
		const rawLine = lines[i];
		if (!rawLine?.trim()) continue;

		for (const pattern of SCOPE_PATTERNS) {
			const match = rawLine.match(pattern);
			if (match) {
				const identifier = match[1];
				if (identifier && !CONTROL_FLOW_KEYWORDS.has(identifier)) {
					return identifier;
				}
			}
		}
	}
	return undefined;
}

/**
 * 在源码行集合中全文检索指定作用域声明行 (0-based) (纯工具)
 */
export function findScopeAnchorLine(lines: string[], scopeAnchor: string): number | undefined {
	if (!scopeAnchor?.trim() || !lines?.length) return undefined;
	const target = scopeAnchor.trim();

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i];
		if (!rawLine?.includes(target)) continue;

		for (const pattern of SCOPE_PATTERNS) {
			const match = rawLine.match(pattern);
			if (match) {
				const identifier = match[1];
				if (identifier && identifier.trim() === target) {
					return i;
				}
			}
		}
	}
	return undefined;
}

/**
 * 自动剥离外层的 Markdown 代码块包裹（如 ```json ... ```） (纯工具)
 */
export function stripMarkdown(text: string): string {
	const trimmed = (text || "").trim();
	const blockMatch = trimmed.match(/^```(?:json|jsonc)?[\r\n]+([\s\S]*?)[\r\n]+```$/i);
	if (blockMatch) {
		return blockMatch[1].trim();
	}
	return trimmed;
}

/**
 * 清洗 JSON 字符串中的注释（单行 // 与多行 /* *\/）以及行尾悬挂逗号 (纯工具)
 */
export function stripComments(jsonStr: string): string {
	if (typeof jsonStr !== "string") return "{}";
	const stripped = jsonStr
		.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (_match, stringLiteral) => {
			return stringLiteral ? stringLiteral : "";
		})
		.replace(/,\s*([\]}])/g, "$1")
		.trim();
	return stripped.length > 0 ? stripped : "{}";
}

/**
 * 检测文本中是否包含未解决的 Git 合并冲突标记 (<<<<<<<, =======, >>>>>>>) (纯工具)
 */
export function hasGitConflictMarkers(text: string): boolean {
	if (typeof text !== "string") return false;
	return /^[<]{7}\s|^[=]{7}$|^[>]{7}\s/m.test(text);
}


