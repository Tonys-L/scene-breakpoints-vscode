/**
 * 剔除单行/块级注释 (纯文本处理纯工具)
 */
export function stripTrailingComment(line: string): string {
	if (!line) return "";
	let inString: string | null = null;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === '"' || char === "'" || char === "`") {
			if (!inString) inString = char;
			else if (inString === char && line[i - 1] !== "\\") inString = null;
		} else if (!inString) {
			if (char === "/" && line[i + 1] === "/") {
				return line.slice(0, i).trim();
			}
			if (char === "#" || (char === "-" && line[i + 1] === "-")) {
				return line.slice(0, i).trim();
			}
			if (char === "/" && line[i + 1] === "*") {
				const endIdx = line.indexOf("*/", i + 2);
				if (endIdx !== -1) {
					line = line.slice(0, i) + line.slice(endIdx + 2);
					i--;
					continue;
				} else {
					return line.slice(0, i).trim();
				}
			}
		}
	}
	return line.trim();
}

/**
 * 规范化文本空白与代码行清洗 (纯文本处理纯工具)
 */
export function cleanLine(text: unknown): string {
	if (typeof text !== "string") return "";
	const uncommented = stripTrailingComment(text);
	const normalized = uncommented.trim().replace(/\s+/g, " ");
	return normalized.length > 140 ? normalized.substring(0, 140) : normalized;
}

/**
 * 结构化词法单元 + 字符二元加权相似度算法 (Token + Char Hybrid Jaccard Similarity)
 */
export function calculateSimilarity(str1: string, str2: string): number {
	if (str1 === str2) return 1.0;
	const clean1 = cleanLine(str1);
	const clean2 = cleanLine(str2);

	if (!clean1 || !clean2) return 0.0;
	if (clean1 === clean2) return 0.95;

	const wordsA = clean1.match(/[a-zA-Z0-9_$]+/g) || [];
	const wordsB = clean2.match(/[a-zA-Z0-9_$]+/g) || [];
	if (wordsA.length > 0 && wordsB.length > 0) {
		const setA = new Set(wordsA);
		let matchedWords = 0;
		for (const w of wordsB) {
			if (setA.has(w)) matchedWords++;
		}
		const wordSim = matchedWords / Math.max(wordsA.length, wordsB.length);

		const charSetA = new Set(clean1.split(""));
		let commonChars = 0;
		for (const ch of clean2) {
			if (charSetA.has(ch)) commonChars++;
		}
		const charSim = commonChars / Math.max(clean1.length, clean2.length);

		return wordSim * 0.7 + charSim * 0.3;
	}

	return 0.0;
}
