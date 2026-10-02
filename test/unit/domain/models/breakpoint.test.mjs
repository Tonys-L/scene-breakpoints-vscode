import assert from "node:assert/strict";
import { Breakpoint } from "#src/domain/models/breakpoint.ts";
import { Fingerprint } from "#src/domain/models/fingerprint.ts";
import { HealingEngine, defaultHealingEngine } from "#src/domain/services/healingEngine.ts";

export function runBreakpointEntityTests() {
	console.log("  ▶ [Breakpoint Entity] 运行断点充血实体与指纹全维单元测试套件 (TDD)...");

	// ----------------------------------------------------
	// 1. 基础构造与 5 类断点类型多态测试
	// ----------------------------------------------------
	{
		// A. 普通行断点
		const lineBp = new Breakpoint({
			file: "src/auth.ts",
			line: 10,
			type: "line",
		});
		assert.strictEqual(lineBp.type, "line");
		assert.strictEqual(lineBp.file, "src/auth.ts");
		assert.strictEqual(lineBp.line, 10);
		assert.strictEqual(lineBp.enabled, true, "默认必须为启用态 (enabled: true)");
		assert.strictEqual(lineBp.isFingerprinted(), false, "初始无 contextSnippet 时必须判定为未提取指纹");

		// B. 条件断点
		const condBp = new Breakpoint({
			file: "src/calc.ts",
			line: 25,
			type: "condition",
			condition: "x > 100",
			enabled: false,
		});
		assert.strictEqual(condBp.type, "condition");
		assert.strictEqual(condBp.condition, "x > 100");
		assert.strictEqual(condBp.enabled, false);

		// C. 命中计数断点
		const hitBp = new Breakpoint({
			file: "src/loop.ts",
			line: 5,
			type: "hitCount",
			hitCondition: "> 10",
		});
		assert.strictEqual(hitBp.type, "hitCount");
		assert.strictEqual(hitBp.hitCondition, "> 10");

		// D. 日志断点
		const logBp = new Breakpoint({
			file: "src/log.ts",
			line: 12,
			type: "logpoint",
			logMessage: "User logged in: {user.id}",
		});
		assert.strictEqual(logBp.type, "logpoint");
		assert.strictEqual(logBp.logMessage, "User logged in: {user.id}");

		// E. 函数断点
		const funcBp = new Breakpoint({
			type: "function",
			functionName: "handleRequest",
		});
		assert.strictEqual(funcBp.type, "function");
		assert.strictEqual(funcBp.functionName, "handleRequest");
	}

	// ----------------------------------------------------
	// 2. 物理位置比对与跨平台路径归一化 (matches)
	// ----------------------------------------------------
	{
		const bp1 = new Breakpoint({
			file: "src/components/button.tsx",
			line: 42,
		});

		// 跨平台反斜杠匹配
		const bp2 = new Breakpoint({
			file: "src\\components\\button.tsx",
			line: 42,
		});
		assert.strictEqual(bp1.matches(bp2), true, "Windows 反斜杠与 POSIX 正斜杠必须判定为相同断点");

		// 行号不同
		const bpDiffLine = new Breakpoint({
			file: "src/components/button.tsx",
			line: 43,
		});
		assert.strictEqual(bp1.matches(bpDiffLine), false, "行号不同不能匹配");

		// 函数断点匹配
		const fn1 = new Breakpoint({ type: "function", functionName: "loginUser" });
		const fn2 = new Breakpoint({ type: "function", functionName: "loginUser" });
		const fn3 = new Breakpoint({ type: "function", functionName: "logoutUser" });
		assert.strictEqual(fn1.matches(fn2), true, "同名函数断点必须匹配");
		assert.strictEqual(fn1.matches(fn3), false, "不同名函数断点不能匹配");
	}

	// ----------------------------------------------------
	// 3. 断点伴随指纹提取与固化行为 (enrich)
	// ----------------------------------------------------
	{
		const sourceLines = [
			"// Line 1: header",
			"function calculateTotal(price: number, tax: number) {",
			"    const subtotal = price * 1.1;",
			"    return subtotal + tax;",
			"}",
		];

		const bp = new Breakpoint({
			file: "src/calc.ts",
			line: 3, // 第 3 行: "    const subtotal = price * 1.1;"
		});

		assert.strictEqual(bp.isFingerprinted(), false);

		// 触发指纹就地提取
		const changed = bp.enrich(sourceLines);
		assert.strictEqual(changed, true, "首次提取指纹必须返回 true");
		assert.strictEqual(bp.isFingerprinted(), true, "提取后必须判定为已加固");

		const fp = bp.getFingerprint();
		assert.ok(fp, "指纹对象必须存在");
		assert.strictEqual(fp.current, "const subtotal = price * 1.1;");
		assert.strictEqual(fp.prev, "function calculateTotal(price: number, tax: number) {");
		assert.strictEqual(fp.next, "return subtotal + tax;");

		// 再次提取，已存在指纹，必须幂等返回 false
		const changedAgain = bp.enrich(sourceLines);
		assert.strictEqual(changedAgain, false, "已有指纹时重复提取必须 0 毫秒跳过");

		// 边界：lines 为空数组或非数组，或者 line <= 0 / 越界
		const bpEmptyLines = new Breakpoint({ file: "src/a.ts", line: 1 });
		assert.strictEqual(bpEmptyLines.enrich([]), false);
		assert.strictEqual(bpEmptyLines.enrich(null), false);
		assert.strictEqual(bpEmptyLines.enrich("invalid-lines"), false);

		const bpInvalidLine = new Breakpoint({ file: "src/a.ts", line: 0 });
		assert.strictEqual(bpInvalidLine.enrich(["code"]), false);

		const bpOutOfBound = new Breakpoint({ file: "src/a.ts", line: 999 });
		assert.strictEqual(bpOutOfBound.enrich(["line 1"]), false);
	}

	// ----------------------------------------------------
	// 4. 自愈比对与物理行号自我修正 (healAgainst)
	// ----------------------------------------------------
	{
		const bp = new Breakpoint({
			file: "src/calc.ts",
			line: 3,
			contextSnippet: {
				prev: "function calculateTotal(price: number, tax: number) {",
				current: "const subtotal = price * 1.1;",
				next: "return subtotal + tax;",
			},
		});


		// 模拟源码在头部插入了 2 行新注释，目标行从第 3 行漂移到了第 5 行
		const driftedLines = [
			"// Line 1: New license comment",
			"// Line 2: Another comment line",
			"// Line 3: header",
			"function calculateTotal(price: number, tax: number) {",
			"    const subtotal = price * 1.1;", // 新真实行号: 5
			"    return subtotal + tax;",
			"}",
		];

		const healResult = defaultHealingEngine.heal(driftedLines, bp.line, bp.getFingerprint());
		assert.strictEqual(healResult.isHealed, true, "自愈引擎必须成功探测到漂移");
		assert.strictEqual(healResult.healedLine, 5, "新行号必须精准锁定为第 5 行");
		bp.updateLine(healResult.healedLine);
		assert.strictEqual(bp.line, 5, "实体自身的 line 属性必须完成自我修正更新");

		// 验证纯领域引擎独立推导 + 实体显式更新的能力 (无副作用胶水)
		bp.updateLine(3); // 人工重置回老行号
		const result = defaultHealingEngine.heal(driftedLines, bp.line, bp.getFingerprint());
		assert.strictEqual(result.isHealed, true);
		assert.strictEqual(result.healedLine, 5);
		bp.updateLine(result.healedLine);
		assert.strictEqual(bp.line, 5, "实体行号成功被显式更新为自愈计算结果");
	}

	// ----------------------------------------------------
	// 5. 纯正 JSON 序列化保真度与深拷贝 (toJSON & clone)
	// ----------------------------------------------------
	{
		const originalData = {
			file: "src/demo.ts",
			line: 20,
			type: "condition",
			condition: "total > 0",
			enabled: true,
			desc: "检查金额",
			contextSnippet: {
				current: "const total = sum();",
			},
		};

		const bp = new Breakpoint(originalData);
		const json = bp.toJSON();

		assert.deepStrictEqual(json, originalData, "toJSON 导出的数据结构必须与原始纯 JSON 100% 保真对齐");

		// 深拷贝测试
		const cloned = bp.clone();
		assert.strictEqual(cloned !== bp, true, "克隆对象必须为全新独立实例");
		cloned.line = 99;
		assert.strictEqual(bp.line, 20, "修改克隆对象绝不污染原始断点");

		// raw 属性验证
		assert.deepStrictEqual(bp.raw, originalData);

		// enrichFingerprint 别名验证
		const unFpBp = new Breakpoint({ file: "src/sample.ts", line: 1 });
		assert.strictEqual(unFpBp.enrichFingerprint(["export const x = 1;"]), true);

		// 函数断点不支持 enrich
		const fnBp = new Breakpoint({ type: "function", functionName: "calc" });
		assert.strictEqual(fnBp.enrich(["function calc() {}"]), false);

		// matches 边界分支
		assert.strictEqual(bp.matches(null), false);
		assert.strictEqual(bp.matches(fnBp), false);
		assert.strictEqual(fnBp.matches(bp), false);
	}

	// ----------------------------------------------------
	// 6. 【变异斩杀】resolveFullPath 绝对与相对路径跨平台解析
	// ----------------------------------------------------
	{
		const fnBp = new Breakpoint({ type: "function", functionName: "login" });
		assert.strictEqual(fnBp.resolveFullPath("C:/workspace"), "", "函数断点没有物理文件路径");

		const noFileBp = new Breakpoint({ line: 10 });
		noFileBp.file = undefined;
		assert.strictEqual(noFileBp.resolveFullPath("C:/workspace"), "");

		// 相对路径，无 workspaceRoot
		const relBp = new Breakpoint({ file: "src\\utils\\math.ts", line: 5 });
		assert.strictEqual(relBp.resolveFullPath(), "src/utils/math.ts");

		// 相对路径，有 workspaceRoot (含反斜杠与尾部斜杠)
		assert.strictEqual(
			relBp.resolveFullPath("D:\\project\\app\\"),
			"D:/project/app/src/utils/math.ts",
		);

		// Windows 盘符绝对路径 (正则 ^[a-zA-Z]:/)
		const winAbsBp = new Breakpoint({ file: "E:\\app\\main.ts", line: 1 });
		assert.strictEqual(winAbsBp.resolveFullPath("D:/other"), "E:/app/main.ts");

		// POSIX 绝对路径
		const posixAbsBp = new Breakpoint({ file: "/usr/src/app.ts", line: 1 });
		assert.strictEqual(posixAbsBp.resolveFullPath("/var/root"), "/usr/src/app.ts");
	}

	// ----------------------------------------------------
	// 7. 【变异斩杀】updateLine 严格行号合法性防御与幂等拦截
	// ----------------------------------------------------
	{
		const fnBp = new Breakpoint({ type: "function", functionName: "calc" });
		assert.strictEqual(fnBp.updateLine(10), false, "函数断点不可更新行号");

		const lineBp = new Breakpoint({ file: "src/a.ts", line: 20 });
		// 非数字、NaN、负数、零
		assert.strictEqual(lineBp.updateLine("25"), false);
		assert.strictEqual(lineBp.updateLine(NaN), false);
		assert.strictEqual(lineBp.updateLine(-5), false);
		assert.strictEqual(lineBp.updateLine(0), false);
		assert.strictEqual(lineBp.line, 20, "非法入参时行号绝不可改变");

		// 相同行号拦截
		assert.strictEqual(lineBp.updateLine(20), false, "行号相同时应返回 false");

		// 合法更新
		assert.strictEqual(lineBp.updateLine(25), true);
		assert.strictEqual(lineBp.line, 25);
	}

	// ----------------------------------------------------
	// 8. 【变异斩杀】toggle 与 setEnabled 启闭控制
	// ----------------------------------------------------
	{
		const bp = new Breakpoint({ file: "src/b.ts", line: 1, enabled: true });
		assert.strictEqual(bp.toggle(), false);
		assert.strictEqual(bp.enabled, false);
		assert.strictEqual(bp.toggle(), true);
		assert.strictEqual(bp.enabled, true);

		bp.setEnabled(false);
		assert.strictEqual(bp.enabled, false);
		bp.setEnabled(true);
		assert.strictEqual(bp.enabled, true);
	}

	// ----------------------------------------------------
	// 9. 【变异斩杀】matchesHealedTarget 与 applyHealed 自愈匹配吸收
	// ----------------------------------------------------
	{
		const fnBp1 = new Breakpoint({ type: "function", functionName: "fn1" });
		const fnBp2 = new Breakpoint({ type: "function", functionName: "fn2" });
		const lineBp1 = new Breakpoint({
			file: "src\\logic.ts",
			line: 10,
			contextSnippet: { current: "const x = 1;" },
		});
		const lineBp2 = new Breakpoint({
			file: "src/logic.ts",
			line: 15,
			contextSnippet: { current: "const x = 1;" },
		});
		const diffFileBp = new Breakpoint({
			file: "src/other.ts",
			line: 10,
			contextSnippet: { current: "const x = 1;" },
		});
		const diffSnippetBp = new Breakpoint({
			file: "src/logic.ts",
			line: 10,
			contextSnippet: { current: "const y = 2;" },
		});

		// 函数断点自愈比对必须返回 false
		assert.strictEqual(fnBp1.matchesHealedTarget(fnBp2), false);
		assert.strictEqual(fnBp1.matchesHealedTarget(lineBp1), false);
		assert.strictEqual(lineBp1.matchesHealedTarget(fnBp1), false);
		assert.strictEqual(fnBp1.applyHealed(fnBp2), false);
		assert.strictEqual(fnBp1.applyHealed(lineBp1), false);

		// 不同文件比对返回 false
		assert.strictEqual(lineBp1.matchesHealedTarget(diffFileBp), false);

		// 同文件且指纹 current 一致（跨反斜杠归一化）：即便行号不同也判定匹配
		assert.strictEqual(lineBp1.matchesHealedTarget(lineBp2), true);

		// 同文件且无指纹时回退到行号比对
		const noSnippetBp1 = new Breakpoint({ file: "src/c.ts", line: 10 });
		const noSnippetBp2 = new Breakpoint({ file: "src/c.ts", line: 10 });
		const noSnippetBp3 = new Breakpoint({ file: "src/c.ts", line: 11 });
		assert.strictEqual(noSnippetBp1.matchesHealedTarget(noSnippetBp2), true);
		assert.strictEqual(noSnippetBp1.matchesHealedTarget(noSnippetBp3), false);

		// applyHealed 吸收：行号改变与指纹吸收
		const targetToHeal = new Breakpoint({
			file: "src/logic.ts",
			line: 10,
		});
		const healedCandidate = new Breakpoint({
			file: "src/logic.ts",
			line: 18,
			contextSnippet: { current: "const x = 1;", prev: "line 17" },
		});
		const hasChanged = targetToHeal.applyHealed(healedCandidate);
		assert.strictEqual(hasChanged, true);
		assert.strictEqual(targetToHeal.line, 18);
		assert.strictEqual(targetToHeal.contextSnippet?.current, "const x = 1;");
		assert.strictEqual(targetToHeal.contextSnippet?.prev, "line 17");

		// 再次 apply 完全相同断点，返回 false
		assert.strictEqual(targetToHeal.applyHealed(healedCandidate), false);

		// 当候选断点 current 代码改变时，再次吸收并返回 true
		const codeShiftCandidate = new Breakpoint({
			file: "src/logic.ts",
			line: 18,
			contextSnippet: { current: "const x = 2;" },
		});
		assert.strictEqual(targetToHeal.applyHealed(codeShiftCandidate), true);
		assert.strictEqual(targetToHeal.contextSnippet?.current, "const x = 2;");

		// 双方均有 contextSnippet，但 current 不相等：坚决不匹配（返回 false，斩杀 return true 变异体）
		const snippetMismatchCandidate = new Breakpoint({
			file: "src/logic.ts",
			line: 10,
			contextSnippet: { current: "totally different code;" },
		});
		assert.strictEqual(lineBp1.matchesHealedTarget(snippetMismatchCandidate), false);

		// 一方有指纹，另一方无指纹，但行号不同：返回 false（斩杀 || 变异体）
		const noSnippetDiffLine = new Breakpoint({ file: "src/logic.ts", line: 99 });
		assert.strictEqual(lineBp1.matchesHealedTarget(noSnippetDiffLine), false);

		// applyHealed: 仅行号改变但无指纹时，必须返回 true (斩杀 changed=true 变异体)
		const noFpTarget = new Breakpoint({ file: "src/a.ts", line: 10 });
		const noFpHealed = new Breakpoint({ file: "src/a.ts", line: 20 });
		assert.strictEqual(noFpTarget.applyHealed(noFpHealed), true);
		assert.strictEqual(noFpTarget.line, 20);
	}

	// ----------------------------------------------------
	// 10. 【变异斩杀】contextSnippet getter/setter 与 setFingerprint
	// ----------------------------------------------------
	{
		const bp = new Breakpoint({ file: "src/snippet.ts", line: 1 });
		assert.strictEqual(bp.contextSnippet, undefined);
		assert.strictEqual(bp.isFingerprinted(), false);

		// setter 赋有效指纹
		bp.contextSnippet = { current: "let a = 100;" };
		assert.strictEqual(bp.isFingerprinted(), true);
		assert.strictEqual(bp.contextSnippet.current, "let a = 100;");

		// setter 置空
		bp.contextSnippet = undefined;
		assert.strictEqual(bp.contextSnippet, undefined);
		assert.strictEqual(bp.isFingerprinted(), false);

		// setFingerprint
		const fp = Fingerprint.fromSnippet({ current: "code;" });
		bp.setFingerprint(fp);
		assert.strictEqual(bp.isFingerprinted(), true);
		assert.strictEqual(bp.getFingerprint(), fp);
	}

	// ----------------------------------------------------
	// 11. 【变异斩杀】toJSON 完整字段投影与缺省字段过滤
	// ----------------------------------------------------
	{
		// 函数断点全字段序列化
		const fnFull = new Breakpoint({
			type: "function",
			functionName: "fullFunc",
			enabled: false,
			condition: "flag",
			hitCondition: ">= 5",
			desc: "函数断点描述",
		});
		const fnJson = fnFull.toJSON();
		assert.strictEqual(fnJson.type, "function");
		assert.strictEqual(fnJson.functionName, "fullFunc");
		assert.strictEqual(fnJson.enabled, false);
		assert.strictEqual(fnJson.condition, "flag");
		assert.strictEqual(fnJson.hitCondition, ">= 5");
		assert.strictEqual(fnJson.desc, "函数断点描述");

		// 函数断点空缺字段序列化：不污染空 key
		const fnEmpty = new Breakpoint({ type: "function", functionName: "simple" });
		const fnEmptyJson = fnEmpty.toJSON();
		assert.strictEqual("condition" in fnEmptyJson, false);
		assert.strictEqual("hitCondition" in fnEmptyJson, false);
		assert.strictEqual("desc" in fnEmptyJson, false);

		// 源码断点全字段序列化
		const srcFull = new Breakpoint({
			type: "condition",
			file: "src/full.ts",
			line: 88,
			enabled: true,
			condition: "x > 0",
			hitCondition: "1",
			logMessage: "log",
			desc: "desc",
			contextSnippet: { current: "val = 1;" },
		});
		const srcJson = srcFull.toJSON();
		assert.strictEqual(srcJson.type, "condition");
		assert.strictEqual(srcJson.file, "src/full.ts");
		assert.strictEqual(srcJson.line, 88);
		assert.strictEqual(srcJson.condition, "x > 0");
		assert.strictEqual(srcJson.hitCondition, "1");
		assert.strictEqual(srcJson.logMessage, "log");
		assert.strictEqual(srcJson.desc, "desc");
		assert.strictEqual(srcJson.contextSnippet.current, "val = 1;");

		// 缺省字段过滤
		const srcSimple = new Breakpoint({ file: "src/simple.ts", line: 1 });
		const srcSimpleJson = srcSimple.toJSON();
		assert.strictEqual("condition" in srcSimpleJson, false);
		assert.strictEqual("hitCondition" in srcSimpleJson, false);
		assert.strictEqual("logMessage" in srcSimpleJson, false);
		assert.strictEqual("desc" in srcSimpleJson, false);
		assert.strictEqual("contextSnippet" in srcSimpleJson, false);

		// 无效指纹不输出 contextSnippet
		srcSimple.contextSnippet = { current: "   " }; // 纯空白为无效指纹
		assert.strictEqual("contextSnippet" in srcSimple.toJSON(), false);
	}

	// ----------------------------------------------------
	// 12. 【变异斩杀】matches 跨平台大小写与空对象防御
	// ----------------------------------------------------
	{
		const bpA = new Breakpoint({ file: "SRC\\UTILS\\CALC.TS", line: 10 });
		const bpB = new Breakpoint({ file: "src/utils/calc.ts", line: 10 });
		assert.strictEqual(bpA.matches(bpB), true, "路径大小写与反斜杠必须匹配");

		const fnA = new Breakpoint({ type: "function", functionName: "sameName" });
		const fnB = new Breakpoint({ type: "function", functionName: "sameName" });
		const fnC = new Breakpoint({ type: "function", functionName: "otherName" });
		assert.strictEqual(fnA.matches(fnB), true);
		assert.strictEqual(fnA.matches(fnC), false);
		assert.strictEqual(fnA.matches({ type: "line", file: "a.ts", line: 1 }), false);
		assert.strictEqual(bpA.matches({ type: "function", functionName: "f" }), false);

		// 源码断点 file 为空或 other.file 为空
		const bpEmptyFile = new Breakpoint({ line: 10 });
		bpEmptyFile.file = "";
		assert.strictEqual(bpEmptyFile.matches({ file: "a.ts", line: 10 }), false);
		assert.strictEqual(bpA.matches({ file: "", line: 10 }), false);
		assert.strictEqual(bpA.matches({ file: "src\\utils\\calc.ts", line: 10 }), true);

		// toJSON 空串回退
		const emptyFuncBp = new Breakpoint({ type: "function" });
		assert.strictEqual(emptyFuncBp.toJSON().functionName, "");

		const emptySourceBp = new Breakpoint({ line: 1 });
		emptySourceBp.file = undefined;
		assert.strictEqual(emptySourceBp.toJSON().file, "");
	}

	// ----------------------------------------------------
	// 13. 【变异斩杀】路径多斜杠清洗、相对路径盘符、自愈交叉拦截与 matches 类型守卫
	// ----------------------------------------------------
	{
		// (1) resolveFullPath 多重尾部斜杠清洗 (杀 regex 变异)
		const multiSlashBp = new Breakpoint({ file: "src/a.ts", line: 1 });
		assert.strictEqual(
			multiSlashBp.resolveFullPath("D:/my-project///"),
			"D:/my-project/src/a.ts",
			"多重尾部斜杠必须规整为单斜杠拼接",
		);

		// (2) 相对路径中段包含类似盘符文本 (如 sub/c:/test.ts) 不可被误判为绝对路径 (杀 ^[a-zA-Z]:/ 变异)
		const fakeAbsBp = new Breakpoint({ file: "sub/c:/test.ts", line: 1 });
		assert.strictEqual(
			fakeAbsBp.resolveFullPath("E:/root"),
			"E:/root/sub/c:/test.ts",
			"中段带冒号的相对路径必须正确拼装工作区根路径",
		);

		// (3) matchesHealedTarget 与 applyHealed 交叉类型拦截 (行断点 vs 函数断点)
		const normalLineBp = new Breakpoint({ file: "src/main.ts", line: 10 });
		const targetFuncBp = new Breakpoint({ type: "function", functionName: "login" });
		assert.strictEqual(normalLineBp.matchesHealedTarget(targetFuncBp), false);
		assert.strictEqual(normalLineBp.applyHealed(targetFuncBp), false);

		// (4) matches 函数断点与带同名属性的非函数断点比对 (杀 (other).type === 'function' 变异)
		const pureFuncBp = new Breakpoint({ type: "function", functionName: "submit" });
		assert.strictEqual(
			pureFuncBp.matches({ functionName: "submit", line: 10 }),
			false,
			"缺少 type: function 声明的对象绝不可判定为函数断点匹配",
		);
		assert.strictEqual(
			normalLineBp.matches({ type: "function", functionName: "submit" }),
			false,
			"行断点与函数断点比对必须返回 false",
		);

		// (5) matches 两端 file 均未定义且行号相同时比对
		const noFileA = new Breakpoint({ line: 5 });
		noFileA.file = undefined;
		const noFileB = new Breakpoint({ line: 5 });
		noFileB.file = undefined;
		assert.strictEqual(noFileA.matches(noFileB), true);

		// (6) enrich 缺失行号或函数断点
		const noLineBp = new Breakpoint({ file: "src/a.ts" });
		noLineBp.line = undefined;
		assert.strictEqual(noLineBp.enrich(["code line"]), false);
		assert.strictEqual(targetFuncBp.enrich(["code line"]), false);
	}

	console.log("  ✅ [Breakpoint Entity] 断点充血实体与指纹全维单元测试全部通过！");
}

if (
	process.argv[1]?.endsWith("breakpoint.test.mjs") ||
	import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`
) {
	runBreakpointEntityTests();
}

