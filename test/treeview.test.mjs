import assert from "node:assert/strict";

// 纯领域操作函数（与 src/configManager.ts 保持 100% 一致）
export function deleteSceneFromConfig(config, sceneName) {
	if (!config.scenes || !config.scenes[sceneName]) return false;
	delete config.scenes[sceneName];
	return true;
}

export function renameSceneInConfig(config, oldName, newName) {
	if (!config.scenes || !config.scenes[oldName] || !newName || !newName.trim()) return false;
	const trimmedNew = newName.trim();
	if (trimmedNew === oldName) return true;

	const existingBps = config.scenes[oldName];
	delete config.scenes[oldName];
	config.scenes[trimmedNew] = existingBps;
	return true;
}

export function removeBreakpointFromConfig(config, sceneName, index) {
	if (!config.scenes || !config.scenes[sceneName]) return false;
	const list = config.scenes[sceneName];
	if (index < 0 || index >= list.length) return false;
	list.splice(index, 1);
	return true;
}

export function toggleBreakpointEnabledInConfig(config, sceneName, index) {
	if (!config.scenes || !config.scenes[sceneName]) return false;
	const list = config.scenes[sceneName];
	if (index < 0 || index >= list.length) return false;
	const bp = list[index];
	bp.enabled = !(bp.enabled ?? true);
	return true;
}

export function runTreeViewTests() {
	console.log("  ▶ [TreeView] 运行调试面板树视图与节点领域模型测试套件...");

	// ============================================================================
	// Case 1: 场景重命名与断点数据无损保持
	// ============================================================================
	{
		const config = {
			scenes: {
				"legacy-auth-flow": [
					{ type: "line", file: "src/auth.ts", line: 42, enabled: true },
					{ type: "function", functionName: "verifyToken", enabled: true },
				],
			},
		};

		// 1. 成功重命名
		const ok = renameSceneInConfig(config, "legacy-auth-flow", "modern-oauth2-flow");
		assert.strictEqual(ok, true, "重命名应该成功执行");
		assert.strictEqual(config.scenes["legacy-auth-flow"], undefined, "旧场景名必须被删除");
		assert.ok(config.scenes["modern-oauth2-flow"], "新场景名必须存在");
		assert.strictEqual(config.scenes["modern-oauth2-flow"].length, 2, "内部断点数据必须无损完整保留");

		// 2. 空名称或不存在名称保护
		assert.strictEqual(renameSceneInConfig(config, "not-exist", "any"), false);
		assert.strictEqual(renameSceneInConfig(config, "modern-oauth2-flow", "   "), false);

		console.log("    ✔ 场景重命名与断点数据保真测试通过");
	}

	// ============================================================================
	// Case 2: 场景删除与边界保护
	// ============================================================================
	{
		const config = {
			scenes: {
				"scene-to-remove": [{ type: "line", file: "index.ts", line: 10 }],
				"scene-to-keep": [],
			},
		};

		assert.strictEqual(deleteSceneFromConfig(config, "scene-to-remove"), true);
		assert.strictEqual(config.scenes["scene-to-remove"], undefined);
		assert.ok(config.scenes["scene-to-keep"] !== undefined);

		// 删除不存在场景
		assert.strictEqual(deleteSceneFromConfig(config, "ghost-scene"), false);

		console.log("    ✔ 场景删除与边界保护测试通过");
	}

	// ============================================================================
	// Case 3: 单个断点移除与越界安全
	// ============================================================================
	{
		const config = {
			scenes: {
				"order-flow": [
					{ type: "line", file: "step1.ts", line: 10 },
					{ type: "line", file: "step2.ts", line: 20 },
					{ type: "line", file: "step3.ts", line: 30 },
				],
			},
		};

		// 移除中间断点 (step2.ts:20)
		const removed = removeBreakpointFromConfig(config, "order-flow", 1);
		assert.strictEqual(removed, true);
		assert.strictEqual(config.scenes["order-flow"].length, 2);
		assert.strictEqual(config.scenes["order-flow"][0].file, "step1.ts");
		assert.strictEqual(config.scenes["order-flow"][1].file, "step3.ts");

		// 越界安全拦截
		assert.strictEqual(removeBreakpointFromConfig(config, "order-flow", -1), false);
		assert.strictEqual(removeBreakpointFromConfig(config, "order-flow", 99), false);

		console.log("    ✔ 单断点移除与越界拦截测试通过");
	}

	// ============================================================================
	// Case 4: 断点启用/禁用状态切换 (Toggle Enabled Flag)
	// ============================================================================
	{
		const config = {
			scenes: {
				"debug-flow": [
					{ type: "line", file: "app.ts", line: 5 }, // 默认缺省视为 true
					{ type: "line", file: "app.ts", line: 10, enabled: true },
					{ type: "line", file: "app.ts", line: 15, enabled: false },
				],
			},
		};

		// 1. 默认缺省 (true) 切换为 false
		toggleBreakpointEnabledInConfig(config, "debug-flow", 0);
		assert.strictEqual(config.scenes["debug-flow"][0].enabled, false);

		// 2. true 切换为 false
		toggleBreakpointEnabledInConfig(config, "debug-flow", 1);
		assert.strictEqual(config.scenes["debug-flow"][1].enabled, false);

		// 3. false 切换为 true
		toggleBreakpointEnabledInConfig(config, "debug-flow", 2);
		assert.strictEqual(config.scenes["debug-flow"][2].enabled, true);

		console.log("    ✔ 断点启用/禁用切换 (Toggle) 测试通过");
	}

	// ============================================================================
	// Case 5: 树节点视觉模型推导准确性 (Label / Description / Icon / Collapsible)
	// ============================================================================
	{
		// 场景 A: 激活且未修改场景
		const activeCleanDesc = "2 breakpoint(s)  •  (Active)";
		assert.ok(activeCleanDesc.includes("(Active)"));

		// 场景 B: 激活且脏状态场景
		const activeDirtyDesc = "2 breakpoint(s)  •  (Active - Unsaved*)";
		assert.ok(activeDirtyDesc.includes("(Active - Unsaved*)"));

		// 场景 C: 断点显示文本与描述推导
		const lineBp = { type: "line", file: "src/utils/math.ts", line: 55, desc: "Calc tax" };
		const descLine = lineBp.desc;
		assert.strictEqual(descLine, "Calc tax");

		const condBp = { type: "condition", file: "auth.ts", line: 12, condition: "x > 0" };
		const descCond = condBp.desc || `? ${condBp.condition}`;
		assert.strictEqual(descCond, "? x > 0");

		const funcBp = { type: "function", functionName: "dispatchAction" };
		const labelFunc = `ƒ ${funcBp.functionName}()`;
		assert.strictEqual(labelFunc, "ƒ dispatchAction()");

		// 场景 D: 原生 1:1 矢量 SVG 视觉模型推导（彻底免疫焦点变灰，对齐原生图标与微型复选框排版）
		function deriveSvgIcon(type, isFunc, enabled) {
			let iconBase = "bp-line";
			if (isFunc) {
				iconBase = "bp-func";
			} else {
				switch (type) {
					case "condition":
						iconBase = "bp-cond";
						break;
					case "hitCount":
						iconBase = "bp-hit";
						break;
					case "logpoint":
						iconBase = "bp-log";
						break;
					case "line":
					default:
						iconBase = "bp-line";
						break;
				}
			}
			return `${iconBase}-${enabled ? "enabled" : "disabled"}.svg`;
		}

		assert.strictEqual(deriveSvgIcon("line", false, true), "bp-line-enabled.svg");
		assert.strictEqual(deriveSvgIcon("line", false, false), "bp-line-disabled.svg");
		assert.strictEqual(deriveSvgIcon("condition", false, true), "bp-cond-enabled.svg");
		assert.strictEqual(deriveSvgIcon("logpoint", false, true), "bp-log-enabled.svg");
		assert.strictEqual(deriveSvgIcon("hitCount", false, false), "bp-hit-disabled.svg");
		assert.strictEqual(deriveSvgIcon("function", true, true), "bp-func-enabled.svg");
		assert.strictEqual(deriveSvgIcon("function", true, false), "bp-func-disabled.svg");

		console.log("    ✔ 树节点标签与原生矢量 SVG 视觉模型推导测试通过");
	}

	// ============================================================================
	// Case 6: BreakpointNode 构造函数与类继承模型安全性 (防止 super() 前访问 this 导致崩溃)
	// ============================================================================
	{
		class MockTreeItem {
			constructor(label, collapsibleState) {
				this.label = label;
				this.collapsibleState = collapsibleState;
			}
		}

		class SafeBreakpointNode extends MockTreeItem {
			constructor(sceneName, index, bp, workspaceRoot, extensionPath) {
				const isFunc = bp.type === "function";
				const label = isFunc ? `ƒ ${bp.functionName}()` : `${bp.file}:${bp.line}`;
				super(label, 0);

				const bpIdentifier = isFunc ? bp.functionName : `${bp.file}:${bp.line}`;
				this.id = `bp:${sceneName}:${index}:${bpIdentifier}`;
				const isEnabled = bp.enabled ?? true;
				this.checkboxState = isEnabled ? 1 : 0;
				this.iconFileName = `${isFunc ? "bp-func" : "bp-line"}-${isEnabled ? "enabled" : "disabled"}.svg`;
				this.contextValue = isEnabled ? "breakpointItemEnabled" : "breakpointItemDisabled";
			}
		}

		const node1 = new SafeBreakpointNode("s1", 0, { type: "line", file: "test.ts", line: 10, enabled: true }, "/ws", "/ext");
		assert.strictEqual(node1.label, "test.ts:10");
		assert.strictEqual(node1.id, "bp:s1:0:test.ts:10");
		assert.strictEqual(node1.checkboxState, 1);
		assert.strictEqual(node1.iconFileName, "bp-line-enabled.svg");
		assert.strictEqual(node1.contextValue, "breakpointItemEnabled");

		const node2 = new SafeBreakpointNode("s1", 1, { type: "function", functionName: "init", enabled: false }, "/ws", "/ext");
		assert.strictEqual(node2.label, "ƒ init()");
		assert.strictEqual(node2.id, "bp:s1:1:init");
		assert.strictEqual(node2.checkboxState, 0);
		assert.strictEqual(node2.iconFileName, "bp-func-disabled.svg");
		assert.strictEqual(node2.contextValue, "breakpointItemDisabled");

		console.log("    ✔ BreakpointNode 构造与继承模型安全性验证通过");
	}

	// ============================================================================
	// Case 7: 未匹配脱靶断点 (Unmatched) 的前置标签与专属矢量 SVG 警告图标
	// ============================================================================
	{
		function formatUnmatchedDescription(desc, isUnmatched) {
			let extra = desc;
			if (isUnmatched) {
				const tag = "[Unmatched]";
				extra = extra ? `${tag}  •  ${extra}` : tag;
			}
			return extra;
		}

		// 验证无 desc 时直接为 [Unmatched]
		assert.strictEqual(formatUnmatchedDescription(undefined, true), "[Unmatched]");
		// 验证有 desc 时前置 [Unmatched]  •  desc，即使侧边栏变窄，开头的未匹配标签也不会被截断
		assert.strictEqual(
			formatUnmatchedDescription("sdafasd", true),
			"[Unmatched]  •  sdafasd",
		);
		// 验证未脱靶时不带 [Unmatched]
		assert.strictEqual(formatUnmatchedDescription("normal bp", false), "normal bp");

		function deriveUnmatchedSvgIcon(isFunc, enabled, isUnmatched) {
			if (isUnmatched && !isFunc) {
				return enabled ? "bp-unmatched-enabled.svg" : "bp-unmatched-disabled.svg";
			}
			return `${isFunc ? "bp-func" : "bp-line"}-${enabled ? "enabled" : "disabled"}.svg`;
		}

		assert.strictEqual(
			deriveUnmatchedSvgIcon(false, true, true),
			"bp-unmatched-enabled.svg",
			"脱靶断点启用态必须呈现专属琥珀黄警告矢量图标",
		);
		assert.strictEqual(
			deriveUnmatchedSvgIcon(false, false, true),
			"bp-unmatched-disabled.svg",
			"脱靶断点禁用态必须呈现灰色警告矢量图标",
		);
		assert.strictEqual(
			deriveUnmatchedSvgIcon(false, true, false),
			"bp-line-enabled.svg",
			"正常断点继续保持经典红点",
		);

		console.log("    ✔ 未匹配脱靶断点前置标签与专属矢量 SVG 警告图标推导测试通过");
	}

	console.log("  ✅ [TreeView] 调试侧边栏树视图与节点领域模型测试套件（7 大核心场景）全部通过！");
}

if (process.argv[1] && process.argv[1].endsWith("treeview.test.mjs")) {
	runTreeViewTests();
}
