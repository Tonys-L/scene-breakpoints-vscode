import assert from "node:assert";

/**
 * 容错清洗并装箱目标激活场景配置
 */
export function extractTargetActiveScenes(rawActive) {
	if (Array.isArray(rawActive)) {
		const cleaned = rawActive
			.filter((item) => typeof item === "string")
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
		return Array.from(new Set(cleaned));
	}
	if (typeof rawActive === "string") {
		const trimmed = rawActive.trim();
		return trimmed.length > 0 ? [trimmed] : [];
	}
	return [];
}

/**
 * 幽灵场景防御审计 (Ghost Scene Guard / INV-007)
 */
export function filterGhostScenes(candidates, scenesDict) {
	if (!Array.isArray(candidates) || candidates.length === 0) {
		return [];
	}
	if (!scenesDict || typeof scenesDict !== "object" || Array.isArray(scenesDict)) {
		return [];
	}
	const declaredKeys = Object.keys(scenesDict);
	const result = [];
	for (const candidate of candidates) {
		const matched = declaredKeys.find((k) => k.toLowerCase() === candidate.toLowerCase());
		if (matched && !result.includes(matched)) {
			result.push(matched);
		}
	}
	return result;
}

/**
 * 计算断点核心拓扑指纹 Hash
 */
export function computeBreakpointsTopologyHash(breakpoints) {
	if (!Array.isArray(breakpoints) || breakpoints.length === 0) {
		return "";
	}
	const tokens = breakpoints.map((bp) => {
		const isEnabled = bp.enabled ?? true;
		if (bp.type === "function") {
			return `fn:${bp.functionName || ""}:${bp.condition || ""}:${bp.hitCondition || ""}:${isEnabled}`;
		}
		const normFile = (bp.file || "").replace(/\\/g, "/").toLowerCase();
		return `src:${normFile}:${bp.line}:${bp.type}:${bp.condition || ""}:${bp.hitCondition || ""}:${bp.logMessage || ""}:${isEnabled}`;
	});
	return tokens.sort().join("|");
}

/**
 * 比对外部写入的 activeScenes 与当前激活场景，计算调度动作 (纯领域逻辑)
 */
export function resolveActiveScenesDiff(params) {
	const { allowAiActivation, currentActiveScenes, rawActiveScenes, scenesDict } = params;

	// 1. 权限守卫：未开启授权时坚决不调度
	if (!allowAiActivation) {
		return { shouldApply: false, action: "noop", targetScenes: [] };
	}

	// 2. 清洗装箱并过滤幽灵场景
	const extracted = extractTargetActiveScenes(rawActiveScenes);
	const targetScenes = filterGhostScenes(extracted, scenesDict);

	// 3. 幂等拦截检查：比对当前激活集合与目标集合是否完全一致
	const currentSorted = [...(currentActiveScenes || [])].sort();
	const targetSorted = [...targetScenes].sort();

	const isIdentical =
		currentSorted.length === targetSorted.length &&
		currentSorted.every((s, i) => s === targetSorted[i]);

	if (isIdentical) {
		return { shouldApply: false, action: "noop", targetScenes };
	}

	// 4. 判定动作类型
	if (targetScenes.length > 0) {
		return { shouldApply: true, action: "apply", targetScenes };
	}

	if (currentActiveScenes && currentActiveScenes.length > 0) {
		return { shouldApply: true, action: "clear", targetScenes: [] };
	}

	return { shouldApply: false, action: "noop", targetScenes: [] };
}

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

		const rawContent = Buffer.from("# Skill: manage-scenes\n\nDemo", "utf-8");

		// 测试 Cursor MDC 规则注入
		const cursorTarget = {
			label: "Cursor",
			dir: ".cursor/rules",
			file: "manage-scenes.mdc",
			customHeader: `---\ndescription: Manage and declare breakpoint scenes for debugging\nglobs: **\n---\n\n`,
		};
		const cursorResult = formatSkillContent(rawContent, cursorTarget).toString("utf-8");
		assert.ok(cursorResult.startsWith("---\ndescription:"), "Cursor MDC 必须携带专属 Frontmatter 头部");
		assert.ok(cursorResult.includes("# Skill: manage-scenes"), "Cursor MDC 必须保留原始 Skill 指南主体");

		// 测试标准 Agent（如 Windsurf / Cline / Antigravity）
		const windsurfTarget = {
			label: "Windsurf",
			dir: ".windsurf/rules",
			file: "manage-scenes.md",
		};
		const windsurfResult = formatSkillContent(rawContent, windsurfTarget).toString("utf-8");
		assert.strictEqual(windsurfResult, "# Skill: manage-scenes\n\nDemo", "非定制 Agent 必须原生保持无损 Markdown");

		console.log("    ✔ 主流 Agent 矩阵与 Cursor MDC 模版格式化验证通过");
	}

	console.log("  ✅ [AI Activation] 声明式场景激活与核心拓扑全维测试套件全部通过！");
}

if (process.argv[1]?.endsWith("ai_scene_activation.test.mjs")) {
	runAiActivationTests();
}
