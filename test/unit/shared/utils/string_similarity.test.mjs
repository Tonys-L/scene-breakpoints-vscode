import assert from "node:assert/strict";
import {
	stripTrailingComment,
	cleanLine,
	calculateSimilarity,
} from "#src/shared/utils/stringSimilarity.ts";

export function runStringSimilarityTests() {
	console.log("  ▶ [Shared Utils] 运行 stringSimilarity 纯算法单测套件...");

	// 1. stripTrailingComment 注释剥离
	assert.strictEqual(stripTrailingComment(null), "");
	assert.strictEqual(stripTrailingComment("const x = 1; // comment"), "const x = 1;");
	assert.strictEqual(stripTrailingComment("const str = '// not a comment'; // comment"), "const str = '// not a comment';");
	assert.strictEqual(stripTrailingComment("const x = 1; /* block comment */ const y = 2;"), "const x = 1;  const y = 2;");
	assert.strictEqual(stripTrailingComment("x = 10 # python comment"), "x = 10");
	assert.strictEqual(stripTrailingComment("SELECT * FROM table -- sql comment"), "SELECT * FROM table");

	// 【变异斩杀】转义引号 \" 与 \' 字符串内部注释符保护
	assert.strictEqual(stripTrailingComment('const str = "escaped \\" quote"; // comment'), 'const str = "escaped \\" quote";');
	assert.strictEqual(stripTrailingComment("const str = 'escaped \\' quote'; // comment"), "const str = 'escaped \\' quote';");
	assert.strictEqual(stripTrailingComment("const t = `template // not comment`; // comment"), "const t = `template // not comment`;");
	assert.strictEqual(stripTrailingComment("const s = 'single // not comment'; // comment"), "const s = 'single // not comment';");

	// 【变异斩杀】未闭合块注释 /* 与连续多个块注释替换
	assert.strictEqual(stripTrailingComment("const a = 1; /* unclosed block comment"), "const a = 1;");
	assert.strictEqual(stripTrailingComment("const a = /* c1 */ 1; const b = /* c2 */ 2; // end"), "const a =  1; const b =  2;");
	assert.strictEqual(stripTrailingComment("   plain text with spaces   "), "plain text with spaces");

	// 【变异斩杀】Lua 注释 -- 独立性（杜绝减号表达式误伤）
	assert.strictEqual(stripTrailingComment("const a = 1 - -2;"), "const a = 1 - -2;");

	// 2. cleanLine 空白规整与注释清除
	assert.strictEqual(cleanLine(123), "");
	assert.strictEqual(cleanLine("   const   a   =   1;  // log  "), "const a = 1;");
	assert.strictEqual(cleanLine("   hello world   "), "hello world");

	// 【变异斩杀】超长截断精确边界 (139, 140, 141 字符)
	assert.strictEqual(cleanLine("a".repeat(139)).length, 139);
	assert.strictEqual(cleanLine("a".repeat(140)).length, 140);
	assert.strictEqual(cleanLine("a".repeat(141)).length, 140);
	assert.strictEqual(cleanLine("a".repeat(200)).length, 140);

	// 3. calculateSimilarity 词法+字符混合相似度计算
	assert.strictEqual(calculateSimilarity("exactMatch()", "exactMatch()"), 1.0);
	assert.strictEqual(calculateSimilarity("", "other"), 0.0);
	assert.strictEqual(calculateSimilarity("other", ""), 0.0);
	assert.strictEqual(calculateSimilarity("  cleanedSame()  ", "cleanedSame()"), 0.95);

	// 【变异斩杀】单侧空白与仅含注释的空行清洗拦截（击杀 !clean1 && !clean2 突变）
	assert.strictEqual(calculateSimilarity("validCode()", "// only comment"), 0.0);
	assert.strictEqual(calculateSimilarity("// only comment", "validCode()"), 0.0);

	// 【变异斩杀】纯符号与无词法单元字符串比对
	assert.strictEqual(calculateSimilarity("+++", "---"), 0.0);
	assert.strictEqual(calculateSimilarity("const a = 1;", "+++"), 0.0);
	assert.strictEqual(calculateSimilarity("+++", "const a = 1;"), 0.0);

	// 【变异斩杀】精准数学浮点数比对（强杀加权系数 0.7/0.3 倒置与 Math.max 变异）
	const exactScore = calculateSimilarity("const a = 1;", "const b = 1;");
	assert.strictEqual(exactScore.toFixed(4), "0.7417", "等长加权综合得分必须精确为 0.7417");

	// 【变异斩杀】不等长字符串相似度（强杀 Math.max -> Math.min 变异体）
	const unequalScore = calculateSimilarity("const a = 1;", "const a = 1; let b = 2;");
	assert.strictEqual(unequalScore.toFixed(4), "0.5978", "不等长时必须基于 Math.max 归一化");

	// 词法重叠但不同
	const simHigh = calculateSimilarity("const result = calculate(a, b);", "const result = calculate(a, c);");
	assert.ok(simHigh > 0.70, "相近代码相似度应大于 0.70");

	// 词法完全不重叠
	const simZero = calculateSimilarity("abcdef", "123456");
	assert.strictEqual(simZero, 0.0);

	console.log("  ✅ [Shared Utils] stringSimilarity 单测全部通过！");
}

if (process.argv[1]?.endsWith("string_similarity.test.mjs")) {
	runStringSimilarityTests();
}
