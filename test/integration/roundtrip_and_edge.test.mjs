import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// 纯函数与核心算法（与 src/healingAdapter.ts 及 src/configManager.ts 保持 100% 契约一致）
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

const SCOPE_MAX_LOOKUP_LINES = 60;
const SCOPE_PATTERNS = [
	/^\s*(?:async\s+)?def\s+([a-zA-Z0-9_$]+)/,
	/^\s*(?:export\s+)?(?:async\s+)?function(?:\s+([a-zA-Z0-9_$]+)|\s*\()/i,
	/^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_$]+)/,
	/^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_$]+)/,
	/^\s*(?:public|private|protected|static|async)*\s*([a-zA-Z0-9_$]+)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\([^)]*\)\s*[{:])/i,
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

export function extractContextSnippet(doc, lineZeroBased) {
	const currentLineText = doc.lineAt(lineZeroBased).text;
	const current = cleanLine(currentLineText);
	const indent = countIndent(currentLineText);

	let prev;
	let next;

	if (lineZeroBased > 0) {
		const prevText = cleanLine(doc.lineAt(lineZeroBased - 1).text);
		if (prevText.trim().length > 0) prev = prevText;
	}

	if (lineZeroBased < doc.lineCount - 1) {
		const nextText = cleanLine(doc.lineAt(lineZeroBased + 1).text);
		if (nextText.trim().length > 0) next = nextText;
	}

	const sampleLines = [];
	const startIdx = Math.max(0, lineZeroBased - 60);
	for (let i = startIdx; i <= lineZeroBased; i++) {
		sampleLines.push(doc.lineAt(i).text);
	}
	const scopeAnchor = extractScopeAnchor(sampleLines, sampleLines.length - 1);

	return { prev, current, next, scopeAnchor, indent };
}

export function calculateSimilarity(strA, strB) {
	if (strA === strB) return 1.0;
	const trimA = strA.trim();
	const trimB = strB.trim();
	if (!trimA || !trimB) return 0.0;
	if (trimA === trimB) return 0.95;

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

export function stripJsonComments(jsonStr) {
	if (typeof jsonStr !== "string") return "{}";
	const stripped = jsonStr
		.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (_match, stringLiteral) => {
			return stringLiteral ? stringLiteral : "";
		})
		.replace(/,\s*([\]}])/g, "$1")
		.trim();
	return stripped.length > 0 ? stripped : "{}";
}

export function upsertBreakpointToScene(config, sceneName, newEntry) {
	if (!config.scenes) {
		config.scenes = {};
	}
	const list = config.scenes[sceneName] || [];

	if (newEntry.type === "function") {
		const existIdx = list.findIndex(
			(b) => b.type === "function" && b.functionName === newEntry.functionName,
		);
		if (existIdx >= 0) {
			list[existIdx] = newEntry;
		} else {
			list.push(newEntry);
		}
	} else {
		const existIdx = list.findIndex(
			(b) => b.type !== "function" && b.file === newEntry.file && b.line === newEntry.line,
		);
		if (existIdx >= 0) {
			list[existIdx] = newEntry;
		} else {
			list.push(newEntry);
		}
	}

	config.scenes[sceneName] = list;
}

export function saveScenesConfig(workspaceRoot, config) {
	const configPath = path.join(workspaceRoot, ".vscode", "debug-scenes.json");
	const vscodeDir = path.dirname(configPath);
	if (!fs.existsSync(vscodeDir)) {
		fs.mkdirSync(vscodeDir, { recursive: true });
	}
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function loadScenesConfig(workspaceRoot) {
	const configPath = path.join(workspaceRoot, ".vscode", "debug-scenes.json");
	if (fs.existsSync(configPath)) {
		const raw = fs.readFileSync(configPath, "utf-8");
		const sanitized = stripJsonComments(raw);
		const parsed = JSON.parse(sanitized);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const candidateScenes = (parsed.scenes && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes))
				? parsed.scenes
				: parsed;
			const cleanScenes = {};
			for (const [k, v] of Object.entries(candidateScenes)) {
				if (k !== "$schema" && Array.isArray(v)) {
					cleanScenes[k] = v.filter((it) => it && typeof it === "object");
				}
			}
			return { scenes: cleanScenes };
		}
	}
	return { scenes: {} };
}

export function runRoundtripAndEdgeTests() {
	console.log("🚀 Running Roundtrip & Edge Cases Test Suite...\n");

// ============================================================================
// Case 1: 场景导出追加去重测试 (Upsert Deduplication)
// ============================================================================
{
	console.log("▶ Case 1: 场景追加导出去重与原子合并测试 (Append Upsert Dedup)");

	const config = {
		scenes: {
			"checkout-flow": [
				{
					type: "line",
					file: "src/order.ts",
					line: 42,
					enabled: true,
					desc: "Initial step",
				},
				{
					type: "function",
					functionName: "validatePayment",
					enabled: true,
				},
			],
		},
	};

	// 模拟当前编辑器提取出的断点集合：包含一个重复更新项和一个全新项
	const exportedBps = [
		{
			type: "line",
			file: "src/order.ts",
			line: 42,
			enabled: false, // 状态更新
			condition: "order.total > 100", // 新增条件
			desc: "Updated step with condition",
		},
		{
			type: "line",
			file: "src/payment.ts",
			line: 88,
			enabled: true,
			desc: "New payment breakpoint",
		},
		{
			type: "function",
			functionName: "validatePayment",
			enabled: false,
			condition: "amount <= 0", // 函数断点更新
		},
	];

	// 模拟执行追加导出
	for (const bp of exportedBps) {
		upsertBreakpointToScene(config, "checkout-flow", bp);
	}

	const list = config.scenes["checkout-flow"];
	// 断点总数应该为 3（原 order.ts:42 被更新，validatePayment 被更新，新追加 payment.ts:88），绝不能产生 5 个重复项！
	assert.strictEqual(list.length, 3, "追加导出后应精确去重为 3 个断点，杜绝重复副本");

	// 验证覆盖更新的属性是否生效
	const orderBp = list.find((b) => b.file === "src/order.ts" && b.line === 42);
	assert.strictEqual(orderBp.enabled, false);
	assert.strictEqual(orderBp.condition, "order.total > 100");
	assert.strictEqual(orderBp.desc, "Updated step with condition");

	const funcBp = list.find((b) => b.functionName === "validatePayment");
	assert.strictEqual(funcBp.enabled, false);
	assert.strictEqual(funcBp.condition, "amount <= 0");

	console.log("  ✔ 追加导出原子去重合并验证通过");
}

// ============================================================================
// Case 2: extractContextSnippet 极端边界（首行、末行、单行、空行与超长截断）
// ============================================================================
{
	console.log("\n▶ Case 2: 上下文指纹提取全边界测试 (extractContextSnippet Edges)");

	// 构造轻量 Mock Document
	function createMockDoc(lines) {
		return {
			lineCount: lines.length,
			lineAt: (i) => ({ text: lines[i] }),
		};
	}

	// 场景 A: 首行断点 (lineZeroBased = 0)
	const docA = createMockDoc([
		"const orderId = req.body.id;", // Line 1
		"if (!orderId) throw new Error('Missing ID');", // Line 2
		"return orderId;", // Line 3
	]);
	const snippetFirstLine = extractContextSnippet(docA, 0);
	assert.strictEqual(snippetFirstLine.prev, undefined, "首行提取时 prev 必须严格为 undefined");
	assert.strictEqual(snippetFirstLine.current, "const orderId = req.body.id;");
	assert.strictEqual(snippetFirstLine.next, "if (!orderId) throw new Error('Missing ID');");

	// 场景 B: 末行断点 (lineZeroBased = last)
	const snippetLastLine = extractContextSnippet(docA, 2);
	assert.strictEqual(snippetLastLine.prev, "if (!orderId) throw new Error('Missing ID');");
	assert.strictEqual(snippetLastLine.current, "return orderId;");
	assert.strictEqual(snippetLastLine.next, undefined, "末行提取时 next 必须严格为 undefined");

	// 场景 C: 单行文件 (lineCount = 1, lineZeroBased = 0)
	const docC = createMockDoc(["console.log('Single line script');"]);
	const snippetSingle = extractContextSnippet(docC, 0);
	assert.strictEqual(snippetSingle.prev, undefined, "单行文件 prev 为 undefined");
	assert.strictEqual(snippetSingle.current, "console.log('Single line script');");
	assert.strictEqual(snippetSingle.next, undefined, "单行文件 next 为 undefined");

	// 场景 D: 上下行为纯空白行
	const docD = createMockDoc([
		"    \t   ", // 上行为纯空白
		"const active = true;",
		"   \n", // 下行为纯空白
	]);
	const snippetSurroundedByBlanks = extractContextSnippet(docD, 1);
	assert.strictEqual(snippetSurroundedByBlanks.prev, undefined, "上行为纯空白行时不应污染 prev");
	assert.strictEqual(snippetSurroundedByBlanks.next, undefined, "下行为纯空白行时不应污染 next");
	assert.strictEqual(snippetSurroundedByBlanks.current, "const active = true;");

	// 场景 E: 超长行自动截断至 140 字符
	const longLine = "const veryLongStatement = " + "a".repeat(200) + ";";
	const docE = createMockDoc([longLine]);
	const snippetLong = extractContextSnippet(docE, 0);
	assert.strictEqual(snippetLong.current.length, 140, "超长代码行必须严格截断至 140 字符");

	// 场景 F: 缩进深度统计 (Tab 统计为 2 空格)
	assert.strictEqual(countIndent("\t\tconst x = 1;"), 4);
	assert.strictEqual(countIndent("      const x = 1;"), 6);
	assert.strictEqual(countIndent(null), 0);

	console.log("  ✔ 上下文指纹首行/末行/单行/空行/超长行边界全部验证通过");
}

// ============================================================================
// Case 3: 词法单元相似度抗混淆测试 (calculateSimilarity)
// ============================================================================
{
	console.log("\n▶ Case 3: 词法单元相似度抗混淆测试 (calculateSimilarity)");

	// 验证 1: 完全一致
	assert.strictEqual(calculateSimilarity("const user = fetch();", "const user = fetch();"), 1.0);

	// 验证 2: 仅空格/trim 差异
	assert.strictEqual(calculateSimilarity("  const user = fetch();  ", "const user = fetch();"), 0.95);

	// 验证 3: 核心抗混淆！return true vs return false 绝不能被误判为高相似度！
	const boolSim = calculateSimilarity("return true;", "return false;");
	assert.ok(boolSim < 0.65, `return true vs return false 相似度必须低于 0.65 (实际: ${boolSim})`);

	// 验证 4: 合理重构（变量名重命名与微调）能保持高于 0.70 的容错识别
	const renameSim = calculateSimilarity(
		"const userSummary = computeUserProfile(userId);",
		"const userProfile = computeUserProfile(userId);",
	);
	assert.ok(renameSim >= 0.70, `变量微调重命名相似度应达到容错阈值 (实际: ${renameSim})`);

	// 验证 5: 边界空值
	assert.strictEqual(calculateSimilarity("", "abc"), 0.0);
	assert.strictEqual(calculateSimilarity("   ", ""), 0.0);

	console.log("  ✔ 词法单元相似度抗混淆精度验证通过");
}

// ============================================================================
// Case 4: 复杂 JSONC 与复合注释清洗边界 (stripJsonComments)
// ============================================================================
{
	console.log("\n▶ Case 4: 复杂复合注释与极端 JSONC 清洗测试");

	// 场景 1: 单行内多个块级注释
	const input1 = "/* comment 1 */ { /* comment 2 */ \"scene\": \"v1\" /* comment 3 */ }";
	const clean1 = JSON.parse(stripJsonComments(input1));
	assert.strictEqual(clean1.scene, "v1");

	// 场景 2: 字符串内的 URL 包含协议斜杠与类似注释的路径
	const input2 = JSON.stringify({
		endpoint: "https://api.github.com/v1//repos",
		authUrl: "http://localhost:8080/auth/*key*",
	});
	const clean2 = JSON.parse(stripJsonComments(input2));
	assert.strictEqual(clean2.endpoint, "https://api.github.com/v1//repos");
	assert.strictEqual(clean2.authUrl, "http://localhost:8080/auth/*key*");

	// 场景 3: 复合换行与纯注释
	const input3 = "// 单行注释 1\r\n// 单行注释 2\r\n/* 多行注释 \r\n 换行 */\r\n   \n";
	const clean3 = stripJsonComments(input3);
	assert.strictEqual(clean3, "{}", "纯注释与换行混合应安全兜底为 '{}'");

	console.log("  ✔ 复杂复合注释与极端 JSONC 清洗验证通过");
}

// ============================================================================
// Case 5: 场景断点数据无损往返保真度测试 (Full Roundtrip Fidelity)
// ============================================================================
{
	console.log("\n▶ Case 5: 全场景断点模型无损往返保真度测试 (Roundtrip Fidelity)");

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-roundtrip-test-"));

	try {
		const originalConfig = {
			scenes: {
				"full-matrix": [
					// 1. 普通行断点
					{
						type: "line",
						file: "src/index.ts",
						line: 15,
						enabled: true,
						desc: "Entry point",
						contextSnippet: {
							current: "export function run() {",
							prev: "import * as os from 'os';",
							next: "  const code = 0;",
							scopeAnchor: "run",
							indent: 0,
						},
					},
					// 2. 条件断点
					{
						type: "condition",
						file: "src/auth.ts",
						line: 30,
						enabled: true,
						condition: "user.role === 'admin' && token !== null",
						desc: "Admin guard",
					},
					// 3. 命中次数断点
					{
						type: "hitCount",
						file: "src/loop.ts",
						line: 55,
						enabled: false, // 禁用态
						hitCondition: "> 100",
					},
					// 4. 日志断点
					{
						type: "logpoint",
						file: "src/logger.ts",
						line: 72,
						enabled: true,
						logMessage: "User {user.name} logged in at {new Date()}",
					},
					// 5. 函数断点
					{
						type: "function",
						functionName: "handlePaymentWebhook",
						enabled: true,
						condition: "event.type === 'charge.succeeded'",
						hitCondition: "1",
						desc: "Stripe webhook",
					},
				],
			},
		};

		// 1. 序列化落盘
		saveScenesConfig(tmpDir, originalConfig);

		// 2. 验证落盘文件存在且内容有效
		const savedPath = path.join(tmpDir, ".vscode", "debug-scenes.json");
		assert.ok(fs.existsSync(savedPath), "debug-scenes.json 必须成功生成落盘");

		// 3. 反序列化读取
		const reloadedConfig = loadScenesConfig(tmpDir);

		// 4. 逐字段深度校验数据保真度
		const list = reloadedConfig.scenes["full-matrix"];
		assert.strictEqual(list.length, 5, "所有 5 种断点必须 100% 完整保留");

		// 校验行断点及其指纹
		const bp1 = list[0];
		assert.strictEqual(bp1.type, "line");
		assert.strictEqual(bp1.file, "src/index.ts");
		assert.strictEqual(bp1.line, 15);
		assert.strictEqual(bp1.enabled, true);
		assert.strictEqual(bp1.contextSnippet.current, "export function run() {");
		assert.strictEqual(bp1.contextSnippet.scopeAnchor, "run");

		// 校验条件断点
		const bp2 = list[1];
		assert.strictEqual(bp2.type, "condition");
		assert.strictEqual(bp2.condition, "user.role === 'admin' && token !== null");

		// 校验命中次数断点与禁用态
		const bp3 = list[2];
		assert.strictEqual(bp3.type, "hitCount");
		assert.strictEqual(bp3.enabled, false);
		assert.strictEqual(bp3.hitCondition, "> 100");

		// 校验日志断点
		const bp4 = list[3];
		assert.strictEqual(bp4.type, "logpoint");
		assert.strictEqual(bp4.logMessage, "User {user.name} logged in at {new Date()}");

		// 校验函数断点
		const bp5 = list[4];
		assert.strictEqual(bp5.type, "function");
		assert.strictEqual(bp5.functionName, "handlePaymentWebhook");
		assert.strictEqual(bp5.condition, "event.type === 'charge.succeeded'");
		assert.strictEqual(bp5.hitCondition, "1");

		console.log("  ✔ 全场景断点模型无损往返保真度 100% 验证通过");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

console.log("\n🎉 ALL ROUNDTRIP & EDGE TESTS PASSED!\n");
}

if (process.argv[1] && process.argv[1].endsWith("roundtrip_and_edge.test.mjs")) {
	runRoundtripAndEdgeTests();
}
