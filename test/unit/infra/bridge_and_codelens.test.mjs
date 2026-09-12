import assert from "node:assert";
import * as path from "node:path";
import { upsertBreakpointToScene } from "../domain/config_operations.test.mjs";
import { resolveHealedLineInMemory } from "../domain/healing.test.mjs";

function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePathToPosix(filePath, workspaceRoot) {
	const isWindowsPath = /^[a-zA-Z]:/.test(filePath) || /^[a-zA-Z]:/.test(workspaceRoot) || filePath.includes("\\");
	const p = isWindowsPath ? path.win32 : path;
	const relPath = p.relative(workspaceRoot, filePath).replace(/\\/g, "/");
	return relPath;
}

function inferBreakpointTypeAndData(bp) {
	if (bp.functionName) {
		return {
			type: "function",
			functionName: bp.functionName,
			enabled: bp.enabled ?? true,
			condition: bp.condition?.trim() || undefined,
			hitCondition: bp.hitCondition?.trim() || undefined,
		};
	}

	let bpType = "line";
	if (bp.logMessage) {
		bpType = "logpoint";
	} else if (bp.hitCondition) {
		bpType = "hitCount";
	} else if (bp.condition) {
		bpType = "condition";
	}

	return {
		type: bpType,
		file: bp.file,
		line: bp.line,
		enabled: bp.enabled ?? true,
		condition: bp.condition?.trim() || undefined,
		hitCondition: bp.hitCondition?.trim() || undefined,
		logMessage: bp.logMessage?.trim() || undefined,
	};
}

export function runAdapterAndCodeLensTests() {
	console.log("  ▶ [Adapter & CodeLens] 运行适配器、CodeLens与跨平台全维测试套件...");

	// 1. 跨平台路径斜杠归一化 (Windows \\ 必须转为标准 /)
	{
		const wsRoot = "D:/project/repo";
		const winFile = "D:\\project\\repo\\src\\components\\auth\\login.ts";
		const posixPath = normalizePathToPosix(winFile, wsRoot);
		assert.strictEqual(posixPath, "src/components/auth/login.ts", "Windows 反斜杠路径必须统一归一化为 /");
		assert.ok(!posixPath.includes("\\"), "路径中严禁残留 Windows 反斜杠");

		// POSIX 路径交叉验证
		const posixWsRoot = "/home/runner/work/repo";
		const posixFile = "/home/runner/work/repo/src/components/auth/login.ts";
		const posixResult = normalizePathToPosix(posixFile, posixWsRoot);
		assert.strictEqual(posixResult, "src/components/auth/login.ts", "POSIX 路径必须保持标准 /");
	}

	// 2. CodeLens 场景名正则逃逸 (特殊字符逃逸能力)
	{
		const complexSceneNames = [
			"api-v1.0.debug",
			"auth[special-token]+test",
			"user_query(scope)",
			"price*$calculated^value?",
		];

		for (const name of complexSceneNames) {
			const escaped = escapeRegex(name);
			const pattern = new RegExp(`^\\s*"${escaped}"\\s*:`);
			const line = `  "${name}": [`;
			assert.ok(pattern.test(line), `场景名 "${name}" 经 escapeRegex 后必须安全通过正则匹配`);
		}
	}

	// 3. 全类型断点推导与 enabled: false 禁用态持久化
	{
		// (1) 处于禁用状态的普通断点 (enabled: false)
		const disabledBp = inferBreakpointTypeAndData({
			file: "src/a.ts",
			line: 10,
			enabled: false,
		});
		assert.strictEqual(disabledBp.type, "line");
		assert.strictEqual(disabledBp.enabled, false, "必须忠实保留 enabled: false 状态");

		// (2) 条件断点
		const condBp = inferBreakpointTypeAndData({
			file: "src/b.ts",
			line: 20,
			condition: "user.id === 100",
		});
		assert.strictEqual(condBp.type, "condition");
		assert.strictEqual(condBp.condition, "user.id === 100");

		// (3) 命中计数断点
		const hitBp = inferBreakpointTypeAndData({
			file: "src/c.ts",
			line: 30,
			hitCondition: "> 50",
		});
		assert.strictEqual(hitBp.type, "hitCount");
		assert.strictEqual(hitBp.hitCondition, "> 50");

		// (4) 日志断点 (Logpoint)
		const logBp = inferBreakpointTypeAndData({
			file: "src/d.ts",
			line: 40,
			logMessage: "User token: {token}",
		});
		assert.strictEqual(logBp.type, "logpoint");
		assert.strictEqual(logBp.logMessage, "User token: {token}");

		// (5) 禁用的函数断点
		const funcDisabled = inferBreakpointTypeAndData({
			functionName: "handleAuth",
			enabled: false,
		});
		assert.strictEqual(funcDisabled.type, "function");
		assert.strictEqual(funcDisabled.functionName, "handleAuth");
		assert.strictEqual(funcDisabled.enabled, false);
	}

	// 4. 同文件不同行 / 不同文件同行号的 Upsert 并存隔离测试
	{
		const list = [
			{ type: "line", file: "src/index.ts", line: 10 },
		];

		// 同一文件，不同行号 (line 20) -> 必须追加并存！
		const list2 = upsertBreakpointToScene(list, {
			type: "line",
			file: "src/index.ts",
			line: 20,
		});
		assert.strictEqual(list2.length, 2, "同一文件不同行号必须安全并存");

		// 不同文件，相同行号 (line 10) -> 必须追加并存！
		const list3 = upsertBreakpointToScene(list2, {
			type: "line",
			file: "src/other.ts",
			line: 10,
		});
		assert.strictEqual(list3.length, 3, "不同文件相同行号必须安全并存");
	}

	// 5. 极端精简上下文（纯当前行，无任何上下文信息）
	{
		const lines = [
			"// Header",
			"const onlyCurrentStmt = 999;",
		];
		const bpMinimal = {
			file: "min.ts",
			line: 1, // 原在第 1 行，现漂移到第 2 行
			contextSnippet: {
				current: "const onlyCurrentStmt = 999;",
				// prev, next, scopeAnchor, indent 全部为 undefined
			},
		};
		const res = resolveHealedLineInMemory(lines, bpMinimal);
		assert.strictEqual(res.healedLine, 2, "极端缺少上下文时当前行 100% 匹配依然能够高置信自愈");
		assert.strictEqual(res.isHealed, true);
	}

	// 6. 增量 Diff 引擎：共有断点 0 闪烁原地保留，仅增删差量断点
	{
		function computeBreakpointDiff(currentList, targetList) {
			const toRemove = [];
			const toAdd = [];
			const preserved = [];

			for (const curr of currentList) {
				const match = targetList.find(
					(t) =>
						t.file === curr.file &&
						t.line === curr.line &&
						(t.enabled ?? true) === (curr.enabled ?? true) &&
						(t.condition?.trim() || "") === (curr.condition?.trim() || "") &&
						(t.hitCondition?.trim() || "") === (curr.hitCondition?.trim() || "") &&
						(t.logMessage?.trim() || "") === (curr.logMessage?.trim() || ""),
				);
				if (match) {
					preserved.push(curr);
				} else {
					toRemove.push(curr);
				}
			}

			for (const tgt of targetList) {
				const match = preserved.some(
					(p) =>
						p.file === tgt.file &&
						p.line === tgt.line &&
						(p.enabled ?? true) === (tgt.enabled ?? true) &&
						(p.condition?.trim() || "") === (tgt.condition?.trim() || "") &&
						(p.hitCondition?.trim() || "") === (tgt.hitCondition?.trim() || "") &&
						(p.logMessage?.trim() || "") === (tgt.logMessage?.trim() || ""),
				);
				if (!match) {
					toAdd.push(tgt);
				}
			}

			return { toRemove, toAdd, preserved };
		}

		const currentList = [
			{ file: "a.ts", line: 10, enabled: true }, // A: 场景切换后不再需要 -> toRemove
			{ file: "b.ts", line: 20, enabled: true }, // B: 目标场景中完全相同 -> preserved (0闪烁)
			{ file: "c.ts", line: 30, condition: "x === 1" }, // C: 目标场景中条件变更为 x === 2 -> toRemove & toAdd
		];

		const targetList = [
			{ file: "b.ts", line: 20, enabled: true }, // B
			{ file: "c.ts", line: 30, condition: "x === 2" }, // C (新条件)
			{ file: "d.ts", line: 40, enabled: true }, // D: 新增 -> toAdd
		];

		const diff = computeBreakpointDiff(currentList, targetList);

		assert.strictEqual(diff.preserved.length, 1, "共有且属性完全一致的断点必须被原地保留");
		assert.strictEqual(diff.preserved[0].file, "b.ts");
		assert.strictEqual(diff.toRemove.length, 2, "需要移除旧断点 A 和属性已改变的旧断点 C");
		assert.ok(diff.toRemove.some((bp) => bp.file === "a.ts"));
		assert.ok(diff.toRemove.some((bp) => bp.file === "c.ts"));
		assert.strictEqual(diff.toAdd.length, 2, "需要添加新属性断点 C 和全新断点 D");
		assert.ok(diff.toAdd.some((bp) => bp.file === "c.ts" && bp.condition === "x === 2"));
		assert.ok(diff.toAdd.some((bp) => bp.file === "d.ts"));
	}

	// 7. 自愈源码行解析短期缓存 (fileLinesCache) 命中与隔离测试
	{
		const fileLinesCache = new Map();
		const fakePath = "D:/project/repo/src/user.ts";
		const simulatedLines = [
			"import * as auth from './auth';",
			"export function getUser() {",
			"  const user = auth.verify();",
			"  return user;",
			"}",
		];

		// 第一次放入缓存
		fileLinesCache.set(fakePath, simulatedLines);

		// 两个断点位于同一文件
		const bp1 = {
			file: "src/user.ts",
			line: 2,
			contextSnippet: { current: "const user = auth.verify();" }, // 真实在第 3 行
		};
		const bp2 = {
			file: "src/user.ts",
			line: 3,
			contextSnippet: { current: "return user;" }, // 真实在第 4 行
		};

		// 命中内存缓存进行计算
		assert.ok(fileLinesCache.has(fakePath), "缓存中必须存在该文件行数据");
		const cachedLines = fileLinesCache.get(fakePath);
		const res1 = resolveHealedLineInMemory(cachedLines, bp1);
		const res2 = resolveHealedLineInMemory(cachedLines, bp2);

		assert.strictEqual(res1.healedLine, 3, "bp1 必须基于缓存行自愈到第 3 行");
		assert.strictEqual(res2.healedLine, 4, "bp2 必须基于缓存行自愈到第 4 行");
	}

	// 8. 自愈持久化多场景断点反向映射回写测试 (Loopback Persistence)
	{
		const config = {
			scenes: {
				"login-flow": [
					{ type: "line", file: "src/auth.ts", line: 10, contextSnippet: { current: "token = issueToken();" } },
				],
				"order-flow": [
					{ type: "line", file: "src/order.ts", line: 20, contextSnippet: { current: "order = createOrder();" } },
				],
			},
		};

		// 模拟激活两个场景后，底层自愈引擎修正了 order.ts 的行号 (20 -> 25)
		const healedBreakpoints = [
			{ type: "line", file: "src/auth.ts", line: 10, contextSnippet: { current: "token = issueToken();" } }, // 未漂移
			{ type: "line", file: "src/order.ts", line: 25, contextSnippet: { current: "order = createOrder();" } }, // 自愈为 25
		];

		const targetScenes = ["login-flow", "order-flow"];
		let hasPersisted = false;

		// 运行反向映射回写逻辑
		for (const sceneName of targetScenes) {
			const sceneList = config.scenes[sceneName];
			if (!Array.isArray(sceneList)) continue;
			for (const item of sceneList) {
				if (item.type === "function") continue;
				const srcItem = item;
				const matched = healedBreakpoints.find(
					(h) =>
						h.type !== "function" &&
						h.file === srcItem.file &&
						h.contextSnippet?.current === srcItem.contextSnippet?.current,
				);
				if (matched && srcItem.line !== matched.line) {
					srcItem.line = matched.line;
					hasPersisted = true;
				}
			}
		}

		assert.strictEqual(hasPersisted, true, "必须标记为需要持久化写盘");
		assert.strictEqual(config.scenes["order-flow"][0].line, 25, "order-flow 场景中的行号必须成功被更新为自愈后的 25");
		assert.strictEqual(config.scenes["login-flow"][0].line, 10, "login-flow 场景未漂移断点保持原样");
	}

	// 9. 复杂注释与尾逗号 JSONC 下 CodeLens 提取与激活状态感知测试
	{
		function stripJsonComments(jsonStr) {
			if (typeof jsonStr !== "string") return "{}";
			const stripped = jsonStr
				.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (_match, stringLiteral) => {
					return stringLiteral ? stringLiteral : "";
				})
				.replace(/,\s*([\]}])/g, "$1")
				.trim();
			return stripped.length > 0 ? stripped : "{}";
		}

		const rawJsonc = `
		{
			// 系统配置头注释
			/* 块注释说明 */
			"scenes": {
				"auth-login": [
					{ "file": "src/auth.ts", "line": 15 }, // 行末注释
				],
				"pay-flow": [
					{ "file": "src/pay.ts", "line": 88 },
				], // 场景尾部逗号
			},
		}
		`;

		const cleaned = stripJsonComments(rawJsonc);
		const parsed = JSON.parse(cleaned);
		assert.ok(parsed.scenes["auth-login"], "JSONC 清洗后必须成功解析出 auth-login");
		assert.ok(parsed.scenes["pay-flow"], "JSONC 清洗后必须成功解析出 pay-flow");

		// 验证激活态标题推导
		const activeScenes = ["auth-login"];
		const title1 = activeScenes.includes("auth-login") ? "✔ Active (1 bps)" : "▶ Apply Scene (1 bps)";
		const title2 = activeScenes.includes("pay-flow") ? "✔ Active (1 bps)" : "▶ Apply Scene (1 bps)";

		assert.strictEqual(title1, "✔ Active (1 bps)", "已激活场景透镜标题必须带有 ✔ 徽标");
		assert.strictEqual(title2, "▶ Apply Scene (1 bps)", "未激活场景透镜标题展示 ▶ Apply");
	}

	console.log("  ✅ [Adapter & CodeLens] 适配器、CodeLens与跨平台全维套件（9 大核心场景）全部通过！");
}
