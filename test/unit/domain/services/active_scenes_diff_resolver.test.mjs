import assert from "node:assert";
import { ActiveScenesDiffResolver } from "#src/domain/services/activeScenesDiffResolver.ts";

export const computeBreakpointsTopologyHash = ActiveScenesDiffResolver.computeTopologyHash;
export const extractTargetActiveScenes = ActiveScenesDiffResolver.extractTargetScenes;
export const filterGhostScenes = ActiveScenesDiffResolver.filterGhostScenes;
export const resolveActiveScenesDiff = ActiveScenesDiffResolver.resolveActiveScenesDiff;

/**
 * 声明式场景激活全维测试套件
 */
export function runAiActivationTests() {
	console.log("  ▶ [AI Activation] 运行 AI 声明式场景激活与核心拓扑全维测试套件 (TDD)...");

	// ==========================================
	// 1. extractTargetActiveScenes 容错与装箱测试
	// ==========================================
	{
		const res1 = extractTargetActiveScenes(["login", "order"]);
		assert.deepStrictEqual(res1, ["login", "order"], "标准字符串数组应原样保留");

		const res2 = extractTargetActiveScenes("login-debug");
		assert.deepStrictEqual(res2, ["login-debug"], "单个字符串应自动容错装箱为单元素数组");

		assert.deepStrictEqual(extractTargetActiveScenes([]), [], "空数组应返回空数组");
		assert.deepStrictEqual(extractTargetActiveScenes(null), [], "null 应返回空数组");
		assert.deepStrictEqual(extractTargetActiveScenes(undefined), [], "undefined 应返回空数组");
		assert.deepStrictEqual(extractTargetActiveScenes(12345), [], "非字符串/数组应安全返回空数组");

		const res3 = extractTargetActiveScenes([" login ", "", "   ", "order", "login"]);
		assert.deepStrictEqual(res3, ["login", "order"], "应去除前后空白、过滤空串并去重");

		console.log("    ✔ extractTargetActiveScenes 容错装箱与清洗测试通过");
	}

	// ==========================================
	// 2. filterGhostScenes 幽灵场景防御测试
	// ==========================================
	{
		const scenesDict = {
			"login-flow": [],
			"pay-service": [],
		};

		const res1 = filterGhostScenes(["login-flow", "ghost-scene", "pay-service"], scenesDict);
		assert.deepStrictEqual(res1, ["login-flow", "pay-service"], "应严格剔除未在 scenes 中声明的幽灵场景");

		const resCase = filterGhostScenes(["LOGIN-FLOW", "Pay-Service"], scenesDict);
		assert.deepStrictEqual(resCase, ["login-flow", "pay-service"], "应支持大小写容错并校准返回原始键名");

		const res2 = filterGhostScenes(["fake-1", "fake-2"], scenesDict);
		assert.deepStrictEqual(res2, [], "全部为幽灵场景时应返回空数组");

		assert.deepStrictEqual(filterGhostScenes(["login-flow"], null), [], "scenesDict 为空时应安全返回空数组");
		assert.deepStrictEqual(filterGhostScenes([], scenesDict), [], "targetScenes 为空时应安全返回空数组");
		assert.deepStrictEqual(ActiveScenesDiffResolver.extractTargetActiveScenes(["test"]), ["test"], "静态方法别名必须正确导出");

		console.log("    ✔ filterGhostScenes 幽灵场景防御测试通过");
	}

	// ==========================================
	// 3. resolveActiveScenesDiff 差异比对与调度决策测试
	// ==========================================
	{
		const diff1 = resolveActiveScenesDiff({
			allowAiActivation: false,
			currentActiveScenes: ["login"],
			rawActiveScenes: ["order"],
			scenesDict: { order: [] },
		});
		assert.strictEqual(diff1.shouldApply, false, "未开启授权时坚决不允许调度");
		assert.strictEqual(diff1.action, "noop", "未开启授权动作必须为 noop");

		const diff2 = resolveActiveScenesDiff({
			allowAiActivation: true,
			currentActiveScenes: ["login", "order"],
			rawActiveScenes: ["order", "login"],
			scenesDict: { login: [], order: [] },
		});
		assert.strictEqual(diff2.shouldApply, false, "场景集合完全一致时应幂等拦截");
		assert.strictEqual(diff2.action, "noop");

		const diff3 = resolveActiveScenesDiff({
			allowAiActivation: true,
			currentActiveScenes: ["login"],
			rawActiveScenes: ["order"],
			scenesDict: { login: [], order: [] },
		});
		assert.strictEqual(diff3.shouldApply, true);
		assert.strictEqual(diff3.action, "apply");
		assert.deepStrictEqual(diff3.targetScenes, ["order"]);

		const diff4 = resolveActiveScenesDiff({
			allowAiActivation: true,
			currentActiveScenes: ["login"],
			rawActiveScenes: ["login", "pay"],
			scenesDict: { login: [], pay: [] },
		});
		assert.strictEqual(diff4.shouldApply, true);
		assert.strictEqual(diff4.action, "apply");
		assert.deepStrictEqual(diff4.targetScenes, ["login", "pay"]);

		const diff5 = resolveActiveScenesDiff({
			allowAiActivation: true,
			currentActiveScenes: ["login"],
			rawActiveScenes: [],
			scenesDict: { login: [] },
		});
		assert.strictEqual(diff5.shouldApply, true);
		assert.strictEqual(diff5.action, "clear");
		assert.deepStrictEqual(diff5.targetScenes, []);

		// 场景 3.6: allowAiActivation 缺省未传，默认必须为 true 允许调度 (斩杀默认值变异体)
		const diffDefault = resolveActiveScenesDiff({
			currentActiveScenes: ["login"],
			rawActiveScenes: ["order"],
			scenesDict: { login: [], order: [] },
		});
		assert.strictEqual(diffDefault.shouldApply, true);
		assert.strictEqual(diffDefault.action, "apply");

		console.log("    ✔ resolveActiveScenesDiff 差异比对与调度测试通过");
	}

	// ==========================================
	// 4. computeBreakpointsTopologyHash 核心断点拓扑 Diff 判定测试
	// ==========================================
	{
		const bpsOriginal = [
			{ type: "line", file: "src/auth.ts", line: 45, enabled: true, desc: "检查 user" },
			{ type: "condition", file: "src/auth.ts", line: 52, condition: "x > 5", enabled: true },
		];

		// 场景 4.1: 仅修改了 desc 说明文字，拓扑 Hash 必须 100% 保持不变
		const bpsOnlyDescChanged = [
			{ type: "line", file: "src/auth.ts", line: 45, enabled: true, desc: "修改后的纯注释说明" },
			{ type: "condition", file: "src/auth.ts", line: 52, condition: "x > 5", enabled: true },
		];
		assert.strictEqual(
			computeBreakpointsTopologyHash(bpsOriginal),
			computeBreakpointsTopologyHash(bpsOnlyDescChanged),
			"仅修改 desc 注释说明文字时，拓扑 Hash 必须严格相同，杜绝误触发重刷",
		);

		// 场景 4.2: 改变了 line 行号，拓扑 Hash 必须改变
		const bpsLineChanged = [
			{ type: "line", file: "src/auth.ts", line: 46, enabled: true, desc: "检查 user" },
			{ type: "condition", file: "src/auth.ts", line: 52, condition: "x > 5", enabled: true },
		];
		assert.notStrictEqual(
			computeBreakpointsTopologyHash(bpsOriginal),
			computeBreakpointsTopologyHash(bpsLineChanged),
			"修改 line 行号时拓扑 Hash 必须改变",
		);

		// 场景 4.3: 改变了 enabled 启用状态，拓扑 Hash 必须改变
		const bpsEnabledChanged = [
			{ type: "line", file: "src/auth.ts", line: 45, enabled: false, desc: "检查 user" },
			{ type: "condition", file: "src/auth.ts", line: 52, condition: "x > 5", enabled: true },
		];
		assert.notStrictEqual(
			computeBreakpointsTopologyHash(bpsOriginal),
			computeBreakpointsTopologyHash(bpsEnabledChanged),
			"切换断点启用/禁用状态时拓扑 Hash 必须改变",
		);

		// 场景 4.4: 边界防御——空数组与非法入参必须返回空串
		assert.strictEqual(computeBreakpointsTopologyHash([]), "");
		assert.strictEqual(computeBreakpointsTopologyHash(null), "");
		assert.strictEqual(computeBreakpointsTopologyHash(undefined), "");

		// 场景 4.5: 顺序不敏感性与分隔符存在性 (斩杀 sort 与 join 分隔符变异体)
		const bpsA = [
			{ type: "line", file: "src/a.ts", line: 10, enabled: true },
			{ type: "line", file: "src/b.ts", line: 20, enabled: true },
		];
		const bpsB = [
			{ type: "line", file: "src/b.ts", line: 20, enabled: true },
			{ type: "line", file: "src/a.ts", line: 10, enabled: true },
		];
		assert.strictEqual(
			computeBreakpointsTopologyHash(bpsA),
			computeBreakpointsTopologyHash(bpsB),
			"断点数组元素乱序输入时，计算得出的拓扑 Hash 必须严格相同",
		);
		assert.ok(computeBreakpointsTopologyHash(bpsA).includes("|"), "多断点拓扑哈希必须包含竖线分隔符");

		// 场景 4.6: 路径大小写与 Windows 反斜杠归一化 (斩杀 toLowerCase 与反斜杠正则替换变异体)
		const bpsWin = [{ type: "line", file: "src\\WINDOWS\\Path.ts", line: 10, enabled: true }];
		const bpsNorm = [{ type: "line", file: "src/windows/path.ts", line: 10, enabled: true }];
		assert.strictEqual(
			computeBreakpointsTopologyHash(bpsWin),
			computeBreakpointsTopologyHash(bpsNorm),
			"Windows 反斜杠与大小写必须归一化一致",
		);

		// 场景 4.7: 函数断点各字段及空串回退 (斩杀 function 核心字段及 || '' 变异体)
		const fnBp1 = [{ type: "function", functionName: "loginFunc", condition: "u != null", hitCondition: ">3", enabled: true }];
		const fnBp2 = [{ type: "function", functionName: "loginFunc", condition: "u != null", hitCondition: ">3", enabled: false }];
		const fnBpEmpty = [{ type: "function", functionName: "loginFunc" }];
		const fnBpNoName = [{ type: "function" }];
		assert.notStrictEqual(computeBreakpointsTopologyHash(fnBp1), computeBreakpointsTopologyHash(fnBp2));
		assert.strictEqual(computeBreakpointsTopologyHash(fnBp1), "fn:loginFunc:u != null:>3:true");
		assert.strictEqual(computeBreakpointsTopologyHash(fnBpEmpty), "fn:loginFunc:::true");
		assert.strictEqual(computeBreakpointsTopologyHash(fnBpNoName), "fn::::true");

		// 场景 4.8: 源码断点全字段 condition, hitCondition, logMessage 完整性与缺省回退
		const srcFull = [{
			type: "condition",
			file: "src/calc.ts",
			line: 15,
			condition: "a > 1",
			hitCondition: "== 2",
			logMessage: "log me",
			enabled: true,
		}];
		const srcEmptyFields = [{
			type: "line",
			file: "src/calc.ts",
			line: 15,
		}];
		const srcNoFile = [{
			type: "line",
			line: 15,
		}];
		assert.strictEqual(computeBreakpointsTopologyHash(srcFull), "src:src/calc.ts:15:condition:a > 1:== 2:log me:true");
		assert.strictEqual(computeBreakpointsTopologyHash(srcEmptyFields), "src:src/calc.ts:15:line::::true");
		assert.strictEqual(computeBreakpointsTopologyHash(srcNoFile), "src::15:line::::true");

		// 场景 4.9: 实例代理方法一致性
		const resolverInstance = new ActiveScenesDiffResolver();
		assert.strictEqual(
			resolverInstance.computeTopologyHash(bpsOriginal),
			computeBreakpointsTopologyHash(bpsOriginal),
		);

		console.log("    ✔ computeBreakpointsTopologyHash 核心断点拓扑 Diff 验证通过");
	}

	// ==========================================
	// 5. 主流 Agent 目标矩阵与模版格式化测试
	// ==========================================
	{
		function formatSkillContent(baseContent, target) {
			if (target.customHeader) {
				const baseStr = Buffer.from(baseContent).toString("utf-8");
				return Buffer.from(target.customHeader + baseStr, "utf-8");
			}
			return baseContent;
		}

		const rawContent = Buffer.from("---\nname: scene-breakpoints\ndescription: demo\n---\n\n# Skill: scene-breakpoints\n\nDemo", "utf-8");

		// 测试 Cursor MDC 规则注入
		const cursorTarget = {
			label: "Cursor",
			dir: ".cursor/rules",
			file: "scene-breakpoints.mdc",
			customHeader: `---\ndescription: Manage and declare breakpoint scenes for debugging\nglobs: **\n---\n\n`,
		};
		const cursorResult = formatSkillContent(rawContent, cursorTarget).toString("utf-8");
		assert.ok(cursorResult.startsWith("---\ndescription:"), "Cursor MDC 必须携带专属 Frontmatter 头部");
		assert.ok(cursorResult.includes("# Skill: scene-breakpoints"), "Cursor MDC 必须保留原始 Skill 指南主体");

		// 测试标准 Agent（如 Windsurf / Cline / Antigravity）
		const windsurfTarget = {
			label: "Windsurf",
			dir: ".windsurf/rules",
			file: "scene-breakpoints.md",
		};
		const windsurfResult = formatSkillContent(rawContent, windsurfTarget).toString("utf-8");
		assert.ok(windsurfResult.includes("# Skill: scene-breakpoints\n\nDemo"), "非定制 Agent 必须原生保持无损 Markdown");

		console.log("    ✔ 主流 Agent 矩阵与 Cursor MDC 模版格式化验证通过");
	}

	console.log("  ✅ [AI Activation] 声明式场景激活与核心拓扑全维测试套件全部通过！");
}

if (
	process.argv[1]?.endsWith("active_scenes_diff_resolver.test.mjs") ||
	process.argv[1]?.endsWith("active_scenes_diff_resolver.test.mjs")
) {
	runAiActivationTests();
}

