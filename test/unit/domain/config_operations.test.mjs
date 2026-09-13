import assert from "node:assert";
import {
	upsertBreakpointToScene as upsertBreakpointToSceneDomain,
	mergeScenesBreakpoints,
	setAllBreakpointsEnabledInScene,
	duplicateSceneInConfig,
	syncEditorBreakpointChangesToConfig,
	removeBreakpointFromConfig,
	toggleBreakpointEnabledInConfig,
} from "../../../src/domain/sceneOperations.ts";
import { resolveLaunchBoundScenes } from "../../../src/domain/launchResolver.ts";
import {
	stripJsonComments,
	hasGitConflictMarkers,
	sanitizeScenesConfig,
} from "../../../src/infra/storage/jsonFileSceneRepository.ts";
import {
	serializeScenePayload,
	parseScenePayload,
	stripMarkdownCodeBlocks,
} from "../../../src/application/payloadSerializer.ts";
import { SaveLoopGuard } from "../../../src/infra/storage/saveLoopGuard.ts";

const _testGuard = new SaveLoopGuard();
export function setLastSavedContent(content) {
	_testGuard.setLastSavedContent(content);
}
export function isContentMatchingLastSaved(content) {
	return _testGuard.isContentMatchingLastSaved(content);
}

/** 包装层：使 list 维度的旧单测无缝接入生产真实 upsertBreakpointToScene(config, sceneName, bp) 契约 */
export function upsertBreakpointToScene(existingBps, newBp) {
	const config = { scenes: { __test__: [...existingBps] } };
	upsertBreakpointToSceneDomain(config, "__test__", newBp);
	return config.scenes.__test__;
}

export function runConfigTests() {

	console.log("  ▶ [Config] 运行配置解析与防灾全维边界测试套件...");

	// 1. 字符串内部包含 URL 协议头 (http:// 或 https://) 绝对不得误杀
	{
		const jsonWithUrl = `{
			"scenes": {
				"webhook": [
					{
						"type": "logpoint",
						"file": "src/hook.ts",
						"line": 15,
						"logMessage": "Webhook target: https://api.service.internal/v1/notify"
					}
				]
			}
		}`;
		const cleaned = stripJsonComments(jsonWithUrl);
		const parsed = JSON.parse(cleaned);
		assert.strictEqual(
			parsed.scenes.webhook[0].logMessage,
			"Webhook target: https://api.service.internal/v1/notify",
			"字符串字面量内的 https:// 严禁被识别为注释清除",
		);
	}

	// 2. 纯注释与空文本防护
	{
		assert.strictEqual(stripJsonComments(""), "{}");
		assert.strictEqual(stripJsonComments("   "), "{}");
		assert.strictEqual(stripJsonComments(null), "{}");
		const pureComments = "// 全是注释\n/* 多行注释 */";
		const cleaned = stripJsonComments(pureComments);
		// 剥离后即便只有空字符或非完整结构，清洗器也能安全兜底
		const parsed = JSON.parse(cleaned || "{}");
		const config = sanitizeScenesConfig(parsed);
		assert.deepStrictEqual(config, { scenes: {} });
	}

	// 3. 根节点非法类型守卫（非对象、数组、纯布尔、字符串）
	{
		assert.deepStrictEqual(sanitizeScenesConfig(null), { scenes: {} });
		assert.deepStrictEqual(sanitizeScenesConfig([]), { scenes: {} });
		assert.deepStrictEqual(sanitizeScenesConfig(123), { scenes: {} });
		assert.deepStrictEqual(sanitizeScenesConfig("invalid"), { scenes: {} });
	}

	// 4. 场景数组中混杂脏数据（null / 数值 / 非法项）过滤清洗
	{
		const rawScenes = {
			scenes: {
				dirtyScene: [
					null,
					undefined,
					123,
					"string",
					{ type: "line", file: "valid.ts", line: 1 },
				],
			},
		};
		const sanitized = sanitizeScenesConfig(rawScenes);
		assert.strictEqual(sanitized.scenes.dirtyScene.length, 1, "必须过滤掉非对象脏数据项");
		assert.strictEqual(sanitized.scenes.dirtyScene[0].file, "valid.ts");
	}

	// 5. 多种变体格式的 Git 冲突标记全维识别
	{
		// 变体 A: 带 40 位 SHA-1 哈希
		const gitShaConflict = `<<<<<<< 7a9e34c2b9f8d1e2a3c4d5e6f7a8b9c0d1e2f3a4\n{}\n=======\n{}\n>>>>>>> branch`;
		assert.strictEqual(hasGitConflictMarkers(gitShaConflict), true);

		// 变体 B: 复杂分支名
		const gitBranchConflict = `<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> feature/JIRA-1024_auth-refactor`;
		assert.strictEqual(hasGitConflictMarkers(gitBranchConflict), true);

		// 变体 C: 冲突位于末尾
		const gitTailConflict = `{\n  "scenes": {}\n}\n>>>>>>> 98f12a\n`;
		assert.strictEqual(hasGitConflictMarkers(gitTailConflict), true);
	}

	// 6. 函数断点在场景内的 Upsert 覆盖与混合去重
	{
		const bps = [
			{ type: "function", functionName: "loginHandler", condition: "attempt > 3" },
			{ type: "line", file: "src/a.ts", line: 10 },
		];
		// 覆盖相同的 functionName
		const updated = upsertBreakpointToScene(bps, {
			type: "function",
			functionName: "loginHandler",
			condition: "attempt > 10",
		});
		assert.strictEqual(updated.length, 2, "相同函数名必须执行覆盖");
		assert.strictEqual(updated[0].condition, "attempt > 10");

		// 不同函数名追加
		const added = upsertBreakpointToScene(updated, {
			type: "function",
			functionName: "logoutHandler",
		});
		assert.strictEqual(added.length, 3);
	}

	// 7. 剪贴板标准 Payload 序列化与 POSIX 路径一致性
	{
		const sampleBps = [
			{
				type: "line",
				file: "src\\utils\\helper.ts",
				line: 42,
				desc: "测试反斜杠转斜杠",
			},
			{
				type: "function",
				functionName: "doAuth",
			},
		];
		const serialized = serializeScenePayload("auth-flow", sampleBps);
		const parsed = JSON.parse(serialized);
		assert.strictEqual(parsed.sceneName, "auth-flow");
		assert.strictEqual(parsed.breakpoints[0].file, "src/utils/helper.ts", "必须自动规范化为 POSIX 斜杠");
		assert.strictEqual(parsed.breakpoints.length, 2);
	}

	// 8. 剪贴板标准 Payload 防御性解析与指纹保真
	{
		const jsonText = JSON.stringify({
			sceneName: "checkout",
			breakpoints: [
				{
					type: "condition",
					file: "order/checkout.ts",
					line: 88,
					condition: "total > 1000",
					contextSnippet: {
						current: "const total = calculateTotal();",
						prev: "// compute",
						next: "return total;",
					},
				},
			],
		});
		const result = parseScenePayload(jsonText);
		assert.strictEqual(result.success, true);
		if (result.success) {
			assert.strictEqual(result.sceneName, "checkout");
			assert.strictEqual(result.breakpoints.length, 1);
			assert.strictEqual(result.breakpoints[0].contextSnippet.current, "const total = calculateTotal();");
		}
	}

	// 9. 剪贴板兼容模式解析 (纯断点数组与 scenes 字典)
	{
		// 纯数组模式
		const arrayText = JSON.stringify([
			{ type: "line", file: "app.ts", line: 10 },
			{ type: "logpoint", file: "app.ts", line: 20, logMessage: "hello" },
		]);
		const resArray = parseScenePayload(arrayText, "custom-scene");
		assert.strictEqual(resArray.success, true);
		if (resArray.success) {
			assert.strictEqual(resArray.sceneName, "custom-scene");
			assert.strictEqual(resArray.breakpoints.length, 2);
		}

		// scenes 字典模式
		const scenesText = JSON.stringify({
			scenes: {
				importedApi: [{ type: "function", functionName: "handleApi" }],
			},
		});
		const resScenes = parseScenePayload(scenesText);
		assert.strictEqual(resScenes.success, true);
		if (resScenes.success) {
			assert.strictEqual(resScenes.sceneName, "importedApi");
			assert.strictEqual(resScenes.breakpoints[0].functionName, "handleApi");
		}
	}

	// 10. 剪贴板防御性防灾 (损坏 JSON、空字符、超大尺寸与脏数据)
	{
		assert.strictEqual(parseScenePayload("").success, false);
		assert.strictEqual(parseScenePayload("   ").success, false);
		assert.strictEqual(parseScenePayload("{ invalid json").success, false);

		// 超过 1MB 自动拦截
		const hugeStr = "a".repeat(1024 * 1024 + 10);
		assert.strictEqual(parseScenePayload(hugeStr).success, false);

		// 含有脏数据自动清洗，合法断点保留
		const mixedPayload = JSON.stringify({
			sceneName: "safe-scene",
			breakpoints: [
				null,
				123,
				{ type: "line", file: "", line: 0 }, // 非法行号与文件名
				{ type: "line", file: "ok.ts", line: 5 }, // 合法
			],
		});
		const resMixed = parseScenePayload(mixedPayload);
		assert.strictEqual(resMixed.success, true);
		if (resMixed.success) {
			assert.strictEqual(resMixed.breakpoints.length, 1);
			assert.strictEqual(resMixed.breakpoints[0].file, "ok.ts");
		}

		// 带有 Markdown ```json ... ``` 包裹自动提取成功
		const mdWrapped = "```json\n" + JSON.stringify({
			sceneName: "md-scene",
			breakpoints: [{ type: "line", file: "md.ts", line: 8 }],
		}) + "\n```";
		const resMd = parseScenePayload(mdWrapped);
		assert.strictEqual(resMd.success, true);
		if (resMd.success) {
			assert.strictEqual(resMd.sceneName, "md-scene");
			assert.strictEqual(resMd.breakpoints[0].file, "md.ts");
		}
	}

	// 11. 多场景聚合与 INV-001 覆盖去重 (mergeScenesBreakpoints)
	{
		const mockConfig = {
			scenes: {
				auth: [
					{ type: "line", file: "src/auth.ts", line: 10, desc: "基础认证" },
					{ type: "function", functionName: "verifyToken", condition: "isValid" },
				],
				order: [
					// 覆盖 auth 场景中相同文件的第 10 行
					{ type: "line", file: "src/auth.ts", line: 10, desc: "订单场景定制认证覆盖" },
					{ type: "line", file: "src/order.ts", line: 20, desc: "创建订单" },
				],
				common: [
					{ type: "logpoint", file: "src/log.ts", line: 1, logMessage: "start" },
				],
			},
		};

		// 聚合 [auth, order] (根据 INV-011 先到先得 First-Declared-Wins 去重)
		const mergedAuthOrder = mergeScenesBreakpoints(mockConfig, ["auth", "order"]);
		assert.strictEqual(mergedAuthOrder.length, 3, "相同文件+行号必须去重，总数应为 3");
		const firstDeclared = mergedAuthOrder.find((b) => b.file === "src/auth.ts" && b.line === 10);
		assert.strictEqual(firstDeclared.desc, "基础认证", "根据 INV-011 先到先得规则，先声明的 auth 场景断点优先保留");

		// 聚合全部 3 个场景
		const mergedAll = mergeScenesBreakpoints(mockConfig, ["auth", "order", "common"]);
		assert.strictEqual(mergedAll.length, 4);

		// 空场景列表安全返回空数组
		const emptyResult = mergeScenesBreakpoints(mockConfig, []);
		assert.deepStrictEqual(emptyResult, []);
	}

	// 12. 调试启动配置自动联动场景推导三级优先级 (resolveLaunchBoundScenes)
	{
		const mockConfig = {
			bindings: {
				"Launch Server": "auth,order",
				"Launch Worker": ["order", "common"],
				"Launch Task": "common",
			},
			scenes: {
				"auth": [{ type: "line", file: "src/auth.ts", line: 1 }],
				"order": [{ type: "line", file: "src/order.ts", line: 1 }],
				"common": [{ type: "line", file: "src/common.ts", line: 1 }],
				"Run Unit Tests": [{ type: "line", file: "test/unit.ts", line: 1 }],
			},
		};

		// 优先级 1：环境变量显式覆盖（覆盖 bindings 与同名）
		const envResult = resolveLaunchBoundScenes(mockConfig, "Launch Server", "common, order");
		assert.deepStrictEqual(envResult, ["common", "order"], "DEBUG_SCENE 环境变量具备最高优先级");

		// 优先级 2：bindings 显式映射（逗号分隔字符串）
		const bindingStrResult = resolveLaunchBoundScenes(mockConfig, "Launch Server");
		assert.deepStrictEqual(bindingStrResult, ["auth", "order"], "字符串逗号分隔 bindings 应被正确解析为数组");

		// 优先级 2：bindings 显式映射（数组）
		const bindingArrResult = resolveLaunchBoundScenes(mockConfig, "Launch Worker");
		assert.deepStrictEqual(bindingArrResult, ["order", "common"], "数组形式 bindings 应被直接清洗返回");

		// 优先级 3：智能同名匹配（大小写不敏感）
		const nameMatchResult = resolveLaunchBoundScenes(mockConfig, "run unit tests");
		assert.deepStrictEqual(nameMatchResult, ["Run Unit Tests"], "当无 bindings 时，应大小写不敏感匹配同名场景");

		// 无匹配返回空数组
		const noMatch = resolveLaunchBoundScenes(mockConfig, "Unrelated Launch");
		assert.deepStrictEqual(noMatch, [], "无匹配时优雅返回空数组，不影响调试启动流程");

		// 防御性：环境变量指定不存在场景时，只保留有效场景或返回空数组，杜绝虚假激活
		const envGhostResult = resolveLaunchBoundScenes(mockConfig, "Launch Server", "non_existent, order");
		assert.deepStrictEqual(envGhostResult, ["order"], "不存在的场景必须被安全过滤");

		const envAllGhost = resolveLaunchBoundScenes(mockConfig, "Launch Server", "ghost1, ghost2");
		assert.deepStrictEqual(envAllGhost, [], "全不存在时返回空数组，防止状态栏虚假激活");
	}

	// 13. 编辑器原生断点变更反向同步 (syncEditorBreakpointChangesToConfig)
	{
		const mockConfig = {
			scenes: {
				sceneA: [
					{ type: "line", file: "src/app.ts", line: 10, enabled: true },
					{ type: "function", functionName: "bootstrap", enabled: true },
				],
				sceneB: [
					{ type: "condition", file: "src/app.ts", line: 20, condition: "x > 1", enabled: true },
				],
				inactiveScene: [
					{ type: "line", file: "src/app.ts", line: 10, enabled: true },
				],
			},
		};

		// 模拟编辑器中把 src/app.ts 第 10 行断点以及 bootstrap 函数断点禁用了 (enabled: false)
		const changedBreakpoints = [
			{ file: "src/app.ts", line: 10, enabled: false },
			{ functionName: "bootstrap", enabled: false },
		];

		// 当前激活场景为 [sceneA]
		const updated = syncEditorBreakpointChangesToConfig(mockConfig, ["sceneA"], changedBreakpoints);
		assert.strictEqual(updated, true, "存在状态翻转时应返回 true");
		assert.strictEqual(mockConfig.scenes.sceneA[0].enabled, false, "sceneA 中第 10 行断点状态必须反向更新为 false");
		assert.strictEqual(mockConfig.scenes.sceneA[1].enabled, false, "sceneA 中 bootstrap 函数断点状态必须反向更新为 false");

		// 未激活场景 inactiveScene 中的断点状态绝对不能被误改
		assert.strictEqual(mockConfig.scenes.inactiveScene[0].enabled, true, "未激活场景中的相同位置断点严禁被修改");

		// 再次同步相同状态（幂等），应返回 false 且无脏写
		const reSync = syncEditorBreakpointChangesToConfig(mockConfig, ["sceneA"], changedBreakpoints);
		assert.strictEqual(reSync, false, "断点状态无变化时应幂等返回 false，避免多余磁盘 IO");
	}

	// 14. 内部写盘指纹哈希守卫与外部修改区分 (isContentMatchingLastSaved)
	{
		const internalSaved = JSON.stringify({ scenes: { auth: [{ line: 10 }] } }, null, 2);
		setLastSavedContent(internalSaved);

		// 相同的 JSON 字符串或规范化后相同的 JSON 内容，必须匹配成功（用于拦截自身触发的 fileWatcher）
		assert.strictEqual(isContentMatchingLastSaved(internalSaved), true, "完全一致的内容必须精准匹配");
		const reformatted = JSON.stringify({ scenes: { auth: [{ line: 10 }] } });
		assert.strictEqual(isContentMatchingLastSaved(reformatted), true, "仅空白差异的等价 JSON 必须匹配");

		// 外部用户修改了配置（新增场景或断点），指纹不匹配，必须放行重绘与重载
		const externalEdited = JSON.stringify({ scenes: { auth: [{ line: 11 }] } }, null, 2);
		assert.strictEqual(isContentMatchingLastSaved(externalEdited), false, "外部修改内容不同时严禁误判匹配");
	}

	// 15. 场景内断点批量启用/禁用 (setAllBreakpointsEnabledInScene)
	{
		const mockConfig = {
			scenes: {
				orderFlow: [
					{ line: 10, enabled: true },
					{ line: 20, enabled: false },
					{ line: 30, enabled: true },
				],
			},
		};

		// 全部禁用
		const disabledAll = setAllBreakpointsEnabledInScene(mockConfig, "orderFlow", false);
		assert.strictEqual(disabledAll, true, "存在断点状态改变时应返回 true");
		assert.strictEqual(mockConfig.scenes.orderFlow.every((b) => b.enabled === false), true, "所有断点应全部被禁用");

		// 幂等重复禁用
		const reDisable = setAllBreakpointsEnabledInScene(mockConfig, "orderFlow", false);
		assert.strictEqual(reDisable, false, "状态无变化时应返回 false");

		// 全部启用
		const enabledAll = setAllBreakpointsEnabledInScene(mockConfig, "orderFlow", true);
		assert.strictEqual(enabledAll, true, "全部恢复启用时应返回 true");
		assert.strictEqual(mockConfig.scenes.orderFlow.every((b) => b.enabled === true), true, "所有断点应全部启用");
	}

	// 16. 场景克隆副本 (duplicateSceneInConfig)
	{
		const mockConfig = {
			scenes: {
				auth: [
					{ line: 10, enabled: true, desc: "login" },
				],
			},
		};

		// 成功克隆为 auth-copy
		const duplicated = duplicateSceneInConfig(mockConfig, "auth", "auth-copy");
		assert.strictEqual(duplicated, true, "克隆新场景成功应返回 true");
		assert.deepStrictEqual(mockConfig.scenes["auth-copy"], mockConfig.scenes.auth, "副本断点内容应完全一致");

		// 验证深拷贝隔离性
		mockConfig.scenes["auth-copy"][0].line = 99;
		assert.strictEqual(mockConfig.scenes.auth[0].line, 10, "修改副本断点绝对不能污染原场景");

		// 目标场景已存在时冲突拦截
		const conflict = duplicateSceneInConfig(mockConfig, "auth", "auth-copy");
		assert.strictEqual(conflict, false, "目标场景名已存在时严禁覆盖");

		// 非法全空格目标场景名拦截
		assert.strictEqual(duplicateSceneInConfig(mockConfig, "auth", "   "), false, "全空格目标名必须被安全拦截");
		assert.strictEqual(duplicateSceneInConfig(mockConfig, "auth", ""), false, "空目标名必须被安全拦截");
		assert.strictEqual(duplicateSceneInConfig({}, "auth", "auth-2"), false, "配置无 scenes 字典时必须安全返回 false");
	}

	// 17. 领域操作全维空指针与边界防御性测试 (Defensive Edge Guards)
	{
		// 1. upsertBreakpointToScene 针对空对象、空场景名、全空格场景名的防御
		const emptyConfig = { scenes: {} };
		upsertBreakpointToSceneDomain(emptyConfig, "", { type: "line", file: "a.ts", line: 1 });
		assert.strictEqual(Object.keys(emptyConfig.scenes).length, 0, "空场景名不应写入配置");

		upsertBreakpointToSceneDomain(emptyConfig, "   ", { type: "line", file: "a.ts", line: 1 });
		assert.strictEqual(Object.keys(emptyConfig.scenes).length, 0, "全空格场景名不应写入配置");

		upsertBreakpointToSceneDomain(emptyConfig, "valid", null);
		assert.strictEqual(Object.keys(emptyConfig.scenes).length, 0, "空断点实体不应写入配置");

		// 2. removeBreakpointFromConfig 与 toggleBreakpointEnabledInConfig 针对残缺配置的防御 (0 抛崩)
		assert.strictEqual(removeBreakpointFromConfig({}, "any", 0), false, "无 scenes 属性时安全返回 false");
		assert.strictEqual(toggleBreakpointEnabledInConfig({}, "any", 0), false, "无 scenes 属性时安全返回 false");
	}

	console.log("  ✅ [Config] 配置解析与防灾全维边界套件（17 大核心边界，包含场景批量控制与克隆）全部通过！");
}


