import assert from "node:assert";
import { Fingerprint, extractContextSnippetFromLines } from "#src/domain/models/fingerprint.ts";

export function runFingerprintVoTests() {
	console.log("\n  ▶ [Fingerprint VO] 运行指纹值对象全维单测 (TDD)...");

	// 1. 基础属性与不可变性 (Immutability)
	{
		const fp = new Fingerprint({
			current: "const total = price * quantity;",
			prev: "if (isValid) {",
			next: "return total;",
			scopeAnchor: "function calculateTotal(price, quantity) {",
		});

		assert.strictEqual(fp.current, "const total = price * quantity;");
		assert.strictEqual(fp.prev, "if (isValid) {");
		assert.strictEqual(fp.next, "return total;");
		assert.strictEqual(fp.scopeAnchor, "function calculateTotal(price, quantity) {");
		assert.strictEqual(fp.isValid(), true);
		assert.strictEqual(fp.hasScope(), true);

		// 不可变性验证：冻结对象禁止修改
		assert.throws(() => {
			// @ts-ignore
			fp.current = "modified";
		}, /Cannot assign to read only property/);
	}

	// 2. 空白与换行归一化清洗 (Normalization)
	{
		const dirtyFp = new Fingerprint({
			current: "   const   x   =   10;   ",
			prev: "\t\tlet y = 20;\n",
		});
		assert.strictEqual(dirtyFp.current, "const x = 10;");
		assert.strictEqual(dirtyFp.prev, "let y = 20;");
	}

	// 3. 值对象相等性比较 (equals)
	{
		const fp1 = new Fingerprint({ current: "console.log(msg);", prev: "if (debug) {" });
		const fp2 = new Fingerprint({ current: "console.log(msg);", prev: "if (debug) {" });
		const fp3 = new Fingerprint({ current: "console.log(msg);", prev: "if (verbose) {" });

		assert.strictEqual(fp1.equals(fp2), true, "相同属性的值对象必须判定为相等");
		assert.strictEqual(fp1.equals(fp3), false, "属性不同的值对象必须判定为不相等");
		assert.strictEqual(fp1.equals(undefined), false);
	}

	// 4. matches 与注释剥离匹配 (stripTrailingComment)
	{
		const fp = new Fingerprint({ current: "const timeout = 5000;" });

		// 精确匹配
		assert.strictEqual(fp.matches("const timeout = 5000;"), true);
		// 空白容错
		assert.strictEqual(fp.matches("   const   timeout   =   5000;  "), true);
		// 剥离注释匹配 (//, #, --)
		assert.strictEqual(fp.matches("const timeout = 5000; // 默认超时时间"), true);
		assert.strictEqual(fp.matches("const timeout = 5000; # Python 注释"), true);
		assert.strictEqual(fp.matches("const timeout = 5000; -- Lua 注释"), true);
		// 不匹配
		assert.strictEqual(fp.matches("const timeout = 3000;"), false);
	}

	// 5. 相似度抗混淆评分 (similarity)
	{
		const fp = new Fingerprint({ current: "return orderService.createOrder(userId, items);" });
		const exactScore = fp.similarity("return orderService.createOrder(userId, items);");
		assert.strictEqual(exactScore, 1.0, "完全一致文本相似度必须为 1.0");

		const slightMod = fp.similarity("return orderService.createOrder(userId, items, options);");
		assert.ok(slightMod > 0.7 && slightMod < 1.0, "微小改动相似度应在 0.7~1.0 之间");

		const totallyDiff = fp.similarity("import * as path from 'path';");
		assert.ok(totallyDiff < 0.3, "无关代码相似度应极低");
	}

	// 6. 静态工厂方法：从文本行数组提取指纹 (Fingerprint.fromLines)
	{
		const lines = [
			"function processPayment() {",
			"    // validate balance",
			"    if (balance <= 0) {",
			"        throw new Error('insufficient balance');",
			"    }",
			"    return true;",
			"}",
		];

		// 目标行：第 4 行 (1-indexed: "throw new Error('insufficient balance');")
		const fp = Fingerprint.fromLines(lines, 4);
		assert.ok(fp, "必须成功提取指纹");
		assert.strictEqual(fp.current, "throw new Error('insufficient balance');");
		// 向上穿透注释和空行寻找非空伴随行
		assert.strictEqual(fp.prev, "if (balance <= 0) {");
		assert.strictEqual(fp.next, "}");
		assert.ok(fp.scopeAnchor?.includes("processPayment"), "必须提取到作用域声明");
	}

	// 7. 越界与空行防御
	{
		const lines = ["", "   ", "code line"];
		// 针对空行提取应该返回 undefined 或标记为无效
		const emptyFp = Fingerprint.fromLines(lines, 1);
		assert.strictEqual(emptyFp, undefined, "空代码行不可提取有效指纹");

		const outOfBoundFp = Fingerprint.fromLines(lines, 99);
		assert.strictEqual(outOfBoundFp, undefined, "越界行号不可提取指纹");
	}

	// 8. 序列化与反序列化 (toJSON / fromSnippet) 与极端入参防御
	{
		const dto = {
			current: "const a = 1;",
			prev: "let b = 2;",
			next: "return a + b;",
			scopeAnchor: "function foo() {",
		};
		const fp = Fingerprint.fromSnippet(dto);
		assert.ok(fp);
		assert.deepStrictEqual(fp.toJSON(), dto);

		// fromSnippet 空/非法参数
		assert.strictEqual(Fingerprint.fromSnippet(undefined), undefined);
		assert.strictEqual(Fingerprint.fromSnippet({ current: "" }), undefined);
		assert.strictEqual(Fingerprint.fromSnippet({ current: "   " }), undefined);

		// fromLines 非法入参
		assert.strictEqual(Fingerprint.fromLines([], 1), undefined);
		assert.strictEqual(Fingerprint.fromLines(["a"], 0), undefined);
		assert.strictEqual(Fingerprint.fromLines(["a"], -1), undefined);

		// matches 非字符串与空串
		assert.strictEqual(fp.matches(null), false);
		assert.strictEqual(fp.matches(123), false);
		assert.strictEqual(fp.matches(""), false);
		assert.strictEqual(fp.matches("   "), false);

		// matches 剥离行尾单行注释匹配分支 (strippedCandidate === strippedCurrent)
		const commentFp = new Fingerprint({ current: "const val = 100; // default value" });
		assert.strictEqual(commentFp.matches("const val = 100; // different comment"), true);

		// similarity 非字符串
		assert.strictEqual(fp.similarity(null), 0);
		assert.strictEqual(fp.similarity(123), 0);

		// equals 极端入参
		assert.strictEqual(fp.equals(null), false);
		assert.strictEqual(fp.equals({}), false);
	}

	// 9. 【变异斩杀】fromLines 首尾行边界与行索引偏移保真
	{
		const sampleLines = ["first line", "second line", "third line"];
		// 目标行索引 1 (首行)：验证取值严格为 sampleLines[0]，绝不可偏移为 sampleLines[2]
		const firstFp = Fingerprint.fromLines(sampleLines, 1);
		assert.ok(firstFp);
		assert.strictEqual(firstFp.current, "first line", "首行提取行内容必须精准吻合");
		// 目标行索引 3 (末行)
		const lastFp = Fingerprint.fromLines(sampleLines, 3);
		assert.ok(lastFp);
		assert.strictEqual(lastFp.current, "third line", "末行提取行内容必须精准吻合");
		// 越界：正好等于 length + 1 (4) 必须被拦截返回 undefined
		assert.strictEqual(Fingerprint.fromLines(sampleLines, 4), undefined);
		// 遇到空代码行或仅含空白的行，必须返回 undefined
		const blankLines = ["line 1", "     ", "line 3"];
		assert.strictEqual(Fingerprint.fromLines(blankLines, 2), undefined);
	}

	// 10. 【变异斩杀】isValid 与 hasScope 空白边界防御
	{
		const blankFp = new Fingerprint({ current: "   " });
		assert.strictEqual(blankFp.isValid(), false, "纯空格 current 必须判定为无效指纹");

		const noScopeFp = new Fingerprint({ current: "const a = 1;" });
		assert.strictEqual(noScopeFp.hasScope(), false, "未指定 scopeAnchor 时 hasScope 必须严格返回 false");

		const blankScopeFp = new Fingerprint({ current: "const a = 1;", scopeAnchor: "   \t  " });
		assert.strictEqual(blankScopeFp.hasScope(), false, "纯空格 scopeAnchor 必须判定为无 scope");

		const validScopeFp = new Fingerprint({ current: "const a = 1;", scopeAnchor: "function foo() {" });
		assert.strictEqual(validScopeFp.hasScope(), true, "合法 scopeAnchor 必须判定为有 scope");
	}

	// 11. 【变异斩杀】equals 独立维度对偶校验（四字段逐一不同与全等）
	{
		const base = new Fingerprint({
			current: "const c = 1;",
			prev: "const p = 0;",
			next: "const n = 2;",
			scopeAnchor: "function s() {",
		});
		// current 不同
		const diffCurrent = new Fingerprint({
			current: "const c = 999;",
			prev: "const p = 0;",
			next: "const n = 2;",
			scopeAnchor: "function s() {",
		});
		assert.strictEqual(base.equals(diffCurrent), false, "current 不同必须不相等");

		// prev 不同
		const diffPrev = new Fingerprint({
			current: "const c = 1;",
			prev: "const p = 999;",
			next: "const n = 2;",
			scopeAnchor: "function s() {",
		});
		assert.strictEqual(base.equals(diffPrev), false, "prev 不同必须不相等");

		// next 不同
		const diffNext = new Fingerprint({
			current: "const c = 1;",
			prev: "const p = 0;",
			next: "const n = 999;",
			scopeAnchor: "function s() {",
		});
		assert.strictEqual(base.equals(diffNext), false, "next 不同必须不相等");

		// scopeAnchor 不同
		const diffScope = new Fingerprint({
			current: "const c = 1;",
			prev: "const p = 0;",
			next: "const n = 2;",
			scopeAnchor: "function sDiff() {",
		});
		assert.strictEqual(base.equals(diffScope), false, "scopeAnchor 不同必须不相等");

		// 四项全部相同
		const same = new Fingerprint({
			current: "const c = 1;",
			prev: "const p = 0;",
			next: "const n = 2;",
			scopeAnchor: "function s() {",
		});
		assert.strictEqual(base.equals(same), true, "四项完全相同必须相等");
	}

	// 12. 【变异斩杀】toJSON 纯净度与缺省可选字段校验
	{
		const minimalFp = new Fingerprint({ current: "let x = 1;" });
		const minimalJson = minimalFp.toJSON();
		assert.strictEqual(minimalJson.current, "let x = 1;");
		assert.strictEqual("prev" in minimalJson, false, "缺少 prev 时 toJSON 不可输出该键");
		assert.strictEqual("next" in minimalJson, false, "缺少 next 时 toJSON 不可输出该键");
		assert.strictEqual("scopeAnchor" in minimalJson, false, "缺少 scopeAnchor 时 toJSON 不可输出该键");
		assert.strictEqual("indent" in minimalJson, false, "缺少 indent 时 toJSON 不可输出该键");

		// 带有明确缩进属性的指纹
		const indentFp = new Fingerprint({ current: "let x = 1;", indent: 4 });
		const indentJson = indentFp.toJSON();
		assert.strictEqual(indentJson.indent, 4, "必须正确导出 indent 属性");
	}

	// 13. 【变异斩杀】matches 注释双向剥离比对与返回值锁定
	{
		const fpWithComment = new Fingerprint({ current: "const rate = 0.05; // tax rate" });
		// 剥离注释后匹配成功，必须返回 true
		assert.strictEqual(fpWithComment.matches("const rate = 0.05; // different comment"), true);
		assert.strictEqual(fpWithComment.matches("const rate = 0.05;"), true);
		// 剥离注释后核心语句不一致，必须返回 false
		assert.strictEqual(fpWithComment.matches("const rate = 0.08; // tax rate"), false);
		// 非字符串或空字符串必须返回 false
		assert.strictEqual(fpWithComment.matches(null), false);
		assert.strictEqual(fpWithComment.matches("   "), false);
	}

	// 14. 【变异斩杀】构造函数空值回退与非数字缩进类型拦截
	{
		const emptyCurrentFp = new Fingerprint({ current: "" });
		assert.strictEqual(emptyCurrentFp.current, "", "传空字符串不可被默认串替代");

		// 非数字 indent 必须被安全降级为 undefined
		// @ts-ignore
		const strIndentFp = new Fingerprint({ current: "let x = 1;", indent: "4" });
		assert.strictEqual(strIndentFp.indent, undefined, "字符串 indent 必须降级为 undefined");
		// @ts-ignore
		const nullIndentFp = new Fingerprint({ current: "let x = 1;", indent: null });
		assert.strictEqual(nullIndentFp.indent, undefined, "null indent 必须降级为 undefined");
	}

	// 15. 【变异斩杀】fromSnippet 非字符串 current 拦截
	{
		// @ts-ignore
		assert.strictEqual(Fingerprint.fromSnippet({ current: 12345 }), undefined);
		// @ts-ignore
		assert.strictEqual(Fingerprint.fromSnippet({ current: null }), undefined);
		// @ts-ignore
		assert.strictEqual(Fingerprint.fromSnippet({ current: {} }), undefined);
	}

	// 16. 【变异斩杀】fromLines 极限空值与越界拦截全矩阵
	{
		// @ts-ignore
		assert.strictEqual(Fingerprint.fromLines(null, 1), undefined);
		// @ts-ignore
		assert.strictEqual(Fingerprint.fromLines(undefined, 1), undefined);
		assert.strictEqual(Fingerprint.fromLines([], 1), undefined);
		assert.strictEqual(Fingerprint.fromLines(["a"], 0), undefined);
		assert.strictEqual(Fingerprint.fromLines(["a"], 2), undefined);
		// 数组元素包含空/未定义
		// @ts-ignore
		assert.strictEqual(Fingerprint.fromLines([null], 1), undefined);
		// @ts-ignore
		assert.strictEqual(Fingerprint.fromLines([undefined], 1), undefined);
	}

	// 17. 【变异斩杀】纯注释行剥离后为空串的防御拦截（杀 strippedCandidate && strippedCurrent 变异）
	{
		const pureCommentFp = new Fingerprint({ current: "// just a comment" });
		assert.strictEqual(
			pureCommentFp.matches("// another comment"),
			false,
			"纯注释行剥离后为空字符串，绝不可判定为匹配",
		);
		// 仅一边有剥离结果
		assert.strictEqual(pureCommentFp.matches("const actualCode = 1;"), false);
	}

	// 18. 【变异斩杀】首行函数提取作用域、similarity 异常值与 equals 类型守卫
	{
		const singleLine = ["function main() {"];
		const snippet = Fingerprint.fromLines(singleLine, 1);
		assert.ok(snippet);
		assert.strictEqual(snippet.current, "function main() {");
		assert.ok(snippet.hasScope(), "首行即为函数声明时必须提取到作用域");

		// similarity 非字符串防御拦截
		assert.strictEqual(snippet.similarity(null), 0);
		assert.strictEqual(snippet.similarity(undefined), 0);
		assert.strictEqual(snippet.similarity({}), 0);
		assert.strictEqual(snippet.similarity(123), 0);

		// equals 必须是 Fingerprint 实例，普通纯对象必须返回 false
		assert.strictEqual(snippet.equals({ current: "function main() {" }), false);
		assert.strictEqual(snippet.equals(null), false);
		assert.strictEqual(snippet.equals(undefined), false);
	}

	// 19. 【变异斩杀】extractContextSnippetFromLines 越界默认空串与 60 行作用域探测窗口防御
	{
		const sampleLines = [];
		for (let i = 0; i < 100; i++) {
			if (i === 10) {
				sampleLines.push("function farAwayFunction() {");
			} else if (i === 50) {
				sampleLines.push("function nearbyFunction() {");
			} else {
				sampleLines.push(`    const line${i} = ${i};`);
			}
		}

		// (1) 越界行号：回退为空串，击杀 ?? "Stryker was here!" 突变体
		const outOfRangeSnippet = extractContextSnippetFromLines(sampleLines, 999);
		assert.strictEqual(outOfRangeSnippet.current, "", "越界行号必须严格回退为空字符串");

		// (2) 60 行作用域窗口探测：在第 90 行断点，探测窗口为 30~91 行
		// 第 50 行的 nearbyFunction 在窗口内，第 10 行的 farAwayFunction 超出窗口
		const farSnippet = extractContextSnippetFromLines(sampleLines, 90);
		assert.strictEqual(farSnippet.current, "const line90 = 90;");
		assert.ok(farSnippet.scopeAnchor?.includes("nearbyFunction"), "60 行内的作用域锚点必须被成功捕获");
		assert.strictEqual(
			farSnippet.scopeAnchor?.includes("farAwayFunction") ?? false,
			false,
			"超过 60 行的作用域锚点不可被截取（击杀 sampleLines = lines 变异体）",
		);

		// (3) 首行 (0) 的边界切片：Math.max(0, 0 - 60) 保证切片不越界
		const firstLineSnippet = extractContextSnippetFromLines(["    const first = 1;"], 0);
		assert.strictEqual(firstLineSnippet.indent, 4);
		assert.strictEqual(firstLineSnippet.prev, undefined);

		// (4) 后置函数绝不可反向渗透到前序断点：若突变成 sampleLines = lines，会导致从末尾反向回溯提取到 bottomFunction
		const linesWithBottom = [...sampleLines, "function bottomFunction() {", "    return 42;", "}"];
		const earlySnippet = extractContextSnippetFromLines(linesWithBottom, 20);
		assert.strictEqual(
			earlySnippet.scopeAnchor?.includes("bottomFunction") ?? false,
			false,
			"位于当前断点行之后的作用域绝不可逆向渗透为 scopeAnchor（击杀 sampleLines = lines 变异）",
		);

		// (5) 前 60 行内断点在长文件中探测（击杀 Math.min(0, lineZeroBased - 60) 负数 slice 倒置变异）
		const longLines = [];
		for (let i = 0; i < 120; i++) {
			if (i === 2) {
				longLines.push("function earlyScopeFunction() {");
			} else {
				longLines.push(`    const val${i} = ${i};`);
			}
		}
		// 目标在第 15 行 (lineZeroBased = 14)，14 - 60 = -46。若变异为 Math.min 则切片为 lines.slice(-46, 15) 返回空数组
		const earlyScopeSnippet = extractContextSnippetFromLines(longLines, 14);
		assert.ok(
			earlyScopeSnippet.scopeAnchor?.includes("earlyScopeFunction"),
			"前序 60 行内断点必须正确提取到作用域（击杀 Math.min 负数切片空数组变异）",
		);
	}

	// 20. 【变异斩杀】matches 注释剥离纯匹配分支精准断言与异常输入拦截
	{
		const commentFp = new Fingerprint({ current: "let timeout = 1000; // default timeout" });
		// 剥离注释后内容完全相等，必须命中分支 2 并返回 true (强杀 strippedCandidate === strippedCurrent 变异体)
		assert.strictEqual(commentFp.matches("let timeout = 1000; // modified timeout"), true);
		assert.strictEqual(commentFp.matches("let timeout = 1000; # python style"), true);
		assert.strictEqual(commentFp.matches("let timeout = 1000; -- lua style"), true);
		assert.strictEqual(commentFp.matches("let timeout = 1000;"), true);

		// 剥离后内容不等，必须返回 false
		assert.strictEqual(commentFp.matches("let timeout = 2000; // modified timeout"), false);

		// 非字符串输入类型防御
		assert.strictEqual(commentFp.matches(12345), false);
		assert.strictEqual(commentFp.matches(null), false);
		assert.strictEqual(commentFp.matches(undefined), false);
		assert.strictEqual(commentFp.matches({}), false);

		// similarity 非字符串输入
		assert.strictEqual(commentFp.similarity(null), 0);
		assert.strictEqual(commentFp.similarity(12345), 0);

		// equals 非 Fingerprint 实例拦截
		assert.strictEqual(commentFp.equals(null), false);
		assert.strictEqual(commentFp.equals(undefined), false);
		assert.strictEqual(commentFp.equals({ current: "let timeout = 1000;" }), false);

		// fromLines 纯空格代码行拦截
		const blankLines = ["    \t   ", "const valid = true;"];
		assert.strictEqual(Fingerprint.fromLines(blankLines, 1), undefined);
	}

	console.log("  ✅ [Fingerprint VO] 指纹值对象全维单测全部通过！");
}

if (process.argv[1]?.endsWith("fingerprint.test.mjs")) {
	runFingerprintVoTests();
}
