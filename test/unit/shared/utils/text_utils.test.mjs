import assert from "node:assert/strict";
import {
	countIndent,
	findPrevNonEmptyLine,
	findNextNonEmptyLine,
	findGeometricParent,
	extractScopeAnchor,
	findScopeAnchorLine,
	stripMarkdown,
	stripComments,
	hasGitConflictMarkers,
} from "#src/shared/utils/textUtils.ts";

export function runTextUtilsTests() {
	console.log("  ▶ [Shared Utils] 运行 textUtils 纯工具单测套件...");

	// 1. countIndent 缩进深度计算
	assert.strictEqual(countIndent(null), 0);
	assert.strictEqual(countIndent("noIndent"), 0);
	assert.strictEqual(countIndent("  twoSpaces"), 2);
	assert.strictEqual(countIndent("\toneTabTwoSpaces"), 2);
	assert.strictEqual(countIndent("\t\ttwoTabs"), 4);

	// 2. findPrevNonEmptyLine & findNextNonEmptyLine
	const lines = [
		"const a = 1;",
		"",
		"   ",
		"const b = 2;",
		"",
		"const c = 3;",
	];
	assert.strictEqual(findPrevNonEmptyLine(lines, 3), "const a = 1;");
	assert.strictEqual(findNextNonEmptyLine(lines, 0), "const b = 2;");
	assert.strictEqual(findPrevNonEmptyLine(lines, 0), undefined);
	assert.strictEqual(findNextNonEmptyLine(lines, 5), undefined);

	// 3. findGeometricParent 几何父结构行寻找
	const indentedLines = [
		"function outer() {", // indent 0
		"  const x = 1;",     // indent 2
		"    const y = 2;",   // indent 4
		"}",
	];
	assert.strictEqual(findGeometricParent(indentedLines, 2, 4), "const x = 1;");
	assert.strictEqual(findGeometricParent(indentedLines, 1, 2), "function outer() {");
	assert.strictEqual(findGeometricParent(indentedLines, 0, 0), undefined);

	// 【变异斩杀】同缩进兄弟行绝不能作为几何父节点（击杀 ind <= currentIndent 突变）
	const siblingLines = [
		"function parent() {", // 0
		"  const a = 1;",      // 1: indent 2
		"  const b = 2;",      // 2: indent 2
		"}",
	];
	assert.strictEqual(findGeometricParent(siblingLines, 2, 2), "function parent() {", "同缩进兄弟行严禁被误判为几何父结构");

	// 4. extractScopeAnchor 作用域锚点提取
	const codeSnippet = [
		"class Calculator {",
		"  public calculateTotal(items: Item[]) {",
		"    if (items.length === 0) return 0;",
		"    return 100;",
		"  }",
		"}",
	];
	// 从第 3 行向上找作用域锚点，必须跳过 if 关键字，提取到 calculateTotal
	assert.strictEqual(extractScopeAnchor(codeSnippet, 3), "calculateTotal");
	// 从第 0 行向上找，提取到 Calculator
	assert.strictEqual(extractScopeAnchor(codeSnippet, 0), "Calculator");

	// 【变异斩杀】全量控制流关键字黑名单过滤循环验证（击杀 CONTROL_FLOW_KEYWORDS 字符串变异）
	const keywordsSnippet = [
		"function validScope() {",
		"  if (cond) {",
		"  else () {",
		"  elif (cond) {",
		"  for (item) {",
		"  while (cond) {",
		"  do () {",
		"  loop () {",
		"  switch (x) {",
		"  case (1) {",
		"  catch (e) {",
		"  finally () {",
		"  with (ctx) {",
		"  select () {",
		"  defer () {",
		"  go () {",
		"  return () {",
		"  throw () {",
		"}",
	];
	for (let i = 1; i < keywordsSnippet.length; i++) {
		assert.strictEqual(
			extractScopeAnchor(keywordsSnippet, i),
			"validScope",
			`第 ${i} 行向上回溯必须跳过控制流关键字`,
		);
	}

	// 【变异斩杀】maxLookup 深度截断验证
	const deepSnippet = ["function topScope() {", ...Array(70).fill("  const line = 1;"), "}"];
	assert.strictEqual(extractScopeAnchor(deepSnippet, 65), undefined, "超过默认 60 行查找深度必须返回 undefined");
	assert.strictEqual(extractScopeAnchor(deepSnippet, 65, 80), "topScope", "显式声明更大深度可命中");

	// 【变异斩杀】11 大跨语言作用域模式覆盖与行号精确反查
	const multiLangSnippet = [
		"async def async_fetch_data(url):",                                // 0: Python def
		"export async function handleRequest(req, res) {",                 // 1: JS/TS function
		"public override func performAction(sender: Any) {",               // 2: Kotlin/Swift func
		"pub async fn process_records(data: &[u8]) -> Result<()> {",       // 3: Rust fn
		"  public constructor(private readonly service: Service) {",        // 4: Constructor
		"  public static get instance() {",                                // 5: Getter
		"  public static synchronized final List<String> getAllUsers() {", // 6: Java/C++ method
		"  onCancel = async (e) => {",                               // 7: Arrow function
		"export interface UserProfile {",                                  // 8: Interface/struct
		"impl Display for CustomError {",                                  // 9: Rust impl for
		"impl DataProcessor {",                                            // 10: Rust impl
		"  while (true) {",                                                // 11: Control flow keyword
		"    return 42;",                                                  // 12: Return keyword
		"  }",                                                             // 13
	];

	// (1) Python def
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 0), "async_fetch_data");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "async_fetch_data"), 0);

	// (2) JS/TS function
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 1), "handleRequest");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "handleRequest"), 1);

	// (3) Kotlin/Swift func
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 2), "performAction");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "performAction"), 2);

	// (4) Rust fn
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 3), "process_records");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "process_records"), 3);

	// (5) Constructor
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 4), "constructor");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "constructor"), 4);

	// (6) Getter
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 5), "instance");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "instance"), 5);

	// (7) Java/C++ method
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 6), "getAllUsers");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "getAllUsers"), 6);

	// (8) Arrow function
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 7), "onCancel");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "onCancel"), 7);

	// (9) Interface
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 8), "UserProfile");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "UserProfile"), 8);

	// (10) Rust impl for
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 9), "CustomError");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "CustomError"), 9);

	// (11) Rust impl
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 10), "DataProcessor");
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "DataProcessor"), 10);

	// (12) 控制流与关键字跳过（从第 12 行向上必须跳过 return 和 while，命中 DataProcessor）
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 12), "DataProcessor");

	// 【变异斩杀】extractScopeAnchor 与 findScopeAnchorLine 边界与异常入参
	assert.strictEqual(extractScopeAnchor([], 0), undefined);
	// @ts-ignore
	assert.strictEqual(extractScopeAnchor(null, 0), undefined);
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, -1), undefined);
	// fromIdx 超过 length
	assert.strictEqual(extractScopeAnchor(multiLangSnippet, 999), "DataProcessor");
	// findScopeAnchorLine 空值与非法入参
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, ""), undefined);
	// @ts-ignore
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, null), undefined);
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "   "), undefined);
	assert.strictEqual(findScopeAnchorLine(multiLangSnippet, "nonExistentScope"), undefined);

	// 5. findScopeAnchorLine 作用域锚点行索引查找
	assert.strictEqual(findScopeAnchorLine(codeSnippet, "calculateTotal"), 1);
	assert.strictEqual(findScopeAnchorLine(codeSnippet, "  calculateTotal  "), 1, "必须支持带空白 scopeAnchor 反查");
	assert.strictEqual(findScopeAnchorLine(codeSnippet, "Calculator"), 0);
	assert.strictEqual(findScopeAnchorLine(codeSnippet, "nonExistent"), undefined);

	// 6. stripMarkdown 代码块剥离全边界
	assert.strictEqual(stripMarkdown("```json\n{\"a\": 1}\n```"), "{\"a\": 1}");
	assert.strictEqual(stripMarkdown("```json\n  {\"a\": 1}  \n```"), "{\"a\": 1}", "内部首尾空白必须被 trim");
	assert.strictEqual(stripMarkdown("```jsonc\r\n{\"b\": 2}\r\n```"), "{\"b\": 2}");
	assert.strictEqual(stripMarkdown("```JSON\n{\"c\": 3}\n```"), "{\"c\": 3}");
	assert.strictEqual(stripMarkdown("```\n{\"d\": 4}\n```"), "{\"d\": 4}");
	assert.strictEqual(stripMarkdown("plain text"), "plain text");
	assert.strictEqual(stripMarkdown("   plain text with spaces   "), "plain text with spaces");
	assert.strictEqual(stripMarkdown(""), "");
	// @ts-ignore
	assert.strictEqual(stripMarkdown(null), "");

	// 7. stripComments 注释清洗与悬挂逗号修复全边界
	const jsonWithComments = `
	{
		// single line comment
		"name": "test", /* block comment */
		"items": [1, 2, ],
	}
	`;
	const cleaned = stripComments(jsonWithComments);
	assert.doesNotThrow(() => JSON.parse(cleaned), "清洗后的 JSON 必须可被正常解析");
	assert.deepStrictEqual(JSON.parse(cleaned), { name: "test", items: [1, 2] });

	// 【变异斩杀】stripComments 非字符串与纯注释空串返回 "{}"
	// @ts-ignore
	assert.strictEqual(stripComments(null), "{}");
	// @ts-ignore
	assert.strictEqual(stripComments(123), "{}");
	assert.strictEqual(stripComments("// only comment"), "{}");
	assert.strictEqual(stripComments("/* only block comment */"), "{}");
	// 8. hasGitConflictMarkers Git 冲突标记检测
	assert.strictEqual(hasGitConflictMarkers(null), false);
	assert.strictEqual(hasGitConflictMarkers(""), false);
	assert.strictEqual(hasGitConflictMarkers("normal code without conflicts"), false);
	assert.strictEqual(hasGitConflictMarkers("<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>> feature"), true);
	assert.strictEqual(hasGitConflictMarkers("<<<<<<< ours\nsome code"), true);
	assert.strictEqual(hasGitConflictMarkers("======="), true);
	assert.strictEqual(hasGitConflictMarkers(">>>>>>> theirs"), true);
	assert.strictEqual(hasGitConflictMarkers("const x = 7 < 8; // less than"), false);

	console.log("  ✅ [Shared Utils] textUtils 单测全部通过！");
}

if (process.argv[1]?.endsWith("text_utils.test.mjs")) {
	runTextUtilsTests();
}

