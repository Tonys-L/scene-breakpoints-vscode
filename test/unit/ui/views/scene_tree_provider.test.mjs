import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "vscode";
import { SceneCatalog, Scene } from "#src/domain/models/index.ts";
import {
	BreakpointNode,
	SceneNode,
	SceneTreeDataProvider,
	PlaceholderNode,
} from "#src/ui/views/sceneTreeProvider.ts";
import { sceneStateManager } from "#src/application/sceneStateManager.ts";
import { configureDependencies } from "#src/application/dependencies.ts";
import { saveScenesConfig, jsonFileSceneRepository } from "#src/infra/storage/jsonFileSceneRepository.ts";
import { findBreakpointLineInJson } from "#src/ui/locators/sceneJsonLocator.ts";

export async function runTreeViewTests() {
	console.log("  ▶ [TreeView] 运行调试面板树视图与节点领域模型测试套件（直连生产源码）...");

	configureDependencies({ sceneRepository: jsonFileSceneRepository });

	// ============================================================================
	// Case 1: 场景重命名与断点数据无损保持（直连 SceneCatalog 生产源码）
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
		const catalog = SceneCatalog.fromConfig(config);

		// 1. 成功重命名
		const ok = catalog.renameScene("legacy-auth-flow", "modern-oauth2-flow");
		assert.strictEqual(ok, true, "重命名应该成功执行");
		assert.strictEqual(catalog.hasScene("legacy-auth-flow"), false, "旧场景名必须被删除");
		assert.ok(catalog.hasScene("modern-oauth2-flow"), "新场景名必须存在");
		assert.strictEqual(catalog.getScene("modern-oauth2-flow").getBreakpoints().length, 2, "内部断点数据必须无损完整保留");

		// 2. 空名称或不存在名称保护
		assert.strictEqual(catalog.renameScene("not-exist", "any"), false);
		assert.strictEqual(catalog.renameScene("modern-oauth2-flow", "   "), false);

		console.log("    ✔ 场景重命名与断点数据保真测试通过");
	}

	// ============================================================================
	// Case 2: 场景删除与边界保护（直连 SceneCatalog 生产源码）
	// ============================================================================
	{
		const config = {
			scenes: {
				"scene-to-remove": [{ type: "line", file: "index.ts", line: 10 }],
				"scene-to-keep": [],
			},
		};
		const catalog = SceneCatalog.fromConfig(config);

		assert.strictEqual(catalog.deleteScene("scene-to-remove"), true);
		assert.strictEqual(catalog.hasScene("scene-to-remove"), false);
		assert.ok(catalog.hasScene("scene-to-keep"));

		// 删除不存在场景
		assert.strictEqual(catalog.deleteScene("ghost-scene"), false);

		console.log("    ✔ 场景删除与边界保护测试通过");
	}

	// ============================================================================
	// Case 3: 单个断点移除与越界安全（直连 Scene 生产源码）
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
		const catalog = SceneCatalog.fromConfig(config);
		const scene = catalog.getScene("order-flow");

		// 移除中间断点 (step2.ts:20)
		const removed = scene.removeBreakpoint(1);
		assert.strictEqual(removed, true);
		assert.strictEqual(scene.getBreakpoints().length, 2);
		assert.strictEqual(scene.getBreakpoints()[0].file, "step1.ts");
		assert.strictEqual(scene.getBreakpoints()[1].file, "step3.ts");

		// 越界安全拦截
		assert.strictEqual(scene.removeBreakpoint(-1), false);
		assert.strictEqual(scene.removeBreakpoint(99), false);

		console.log("    ✔ 单断点移除与越界拦截测试通过");
	}

	// ============================================================================
	// Case 4: 断点启用/禁用状态切换（直连 Scene 生产源码）
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
		const catalog = SceneCatalog.fromConfig(config);
		const scene = catalog.getScene("debug-flow");

		// 1. 默认缺省 (true) 切换为 false
		scene.toggleBreakpointEnabled(0);
		assert.strictEqual(scene.getBreakpoints()[0].enabled, false);

		// 2. true 切换为 false
		scene.toggleBreakpointEnabled(1);
		assert.strictEqual(scene.getBreakpoints()[1].enabled, false);

		// 3. false 切换为 true
		scene.toggleBreakpointEnabled(2);
		assert.strictEqual(scene.getBreakpoints()[2].enabled, true);

		console.log("    ✔ 断点启用/禁用切换 (Toggle) 测试通过");
	}

	// ============================================================================
	// Case 5: 树节点视觉模型推导准确性（直连 SceneNode 生产类）
	// ============================================================================
	{
		// 场景 A: 激活且未修改场景
		const nodeClean = new SceneNode("auth-flow", 2, true, false);
		assert.ok(nodeClean.description.includes("(Active)"), "激活场景 description 必须包含 (Active)");
		assert.strictEqual(nodeClean.contextValue, "activeSceneItem");

		// 场景 B: 激活且脏状态场景
		const nodeDirty = new SceneNode("auth-flow", 2, true, true);
		assert.ok(nodeDirty.description.includes("(Active - Unsaved*)"), "脏状态场景 description 必须包含 (Active - Unsaved*)");
		assert.strictEqual(nodeDirty.contextValue, "activeSceneItem");

		// 场景 C: 未激活场景
		const nodeInactive = new SceneNode("order-flow", 5, false, false);
		assert.strictEqual(nodeInactive.contextValue, "sceneItem");
		assert.strictEqual(nodeInactive.id, "scene:order-flow");

		console.log("    ✔ 树节点标签与原生矢量 SVG 视觉模型推导测试通过");
	}

	// ============================================================================
	// Case 6: BreakpointNode 构造函数与类继承模型安全性（直连 BreakpointNode 生产类）
	// ============================================================================
	{
		__resetMockVscodeState();
		sceneStateManager.setActiveScenes([], 0);

		// 普通行断点
		const lineBp = { type: "line", file: "src/user.ts", line: 10, enabled: true, desc: "User check" };
		const node1 = new BreakpointNode("s1", 0, lineBp, "/ws", "/ext");
		assert.strictEqual(node1.label, "user.ts:10");
		assert.strictEqual(node1.id, "bp:s1:0:src/user.ts:10");
		assert.strictEqual(node1.checkboxState, vscode.TreeItemCheckboxState.Checked);
		assert.ok(node1.iconPath.fsPath.endsWith("bp-line-enabled.svg"));
		assert.strictEqual(node1.contextValue, "breakpointItemEnabled");
		assert.strictEqual(node1.description, "User check");

		// 禁用的函数断点
		const funcBp = { type: "function", functionName: "init", enabled: false };
		const node2 = new BreakpointNode("s1", 1, funcBp, "/ws", "/ext");
		assert.strictEqual(node2.label, "ƒ init()");
		assert.strictEqual(node2.id, "bp:s1:1:init");
		assert.strictEqual(node2.checkboxState, vscode.TreeItemCheckboxState.Unchecked);
		assert.ok(node2.iconPath.fsPath.endsWith("bp-func-disabled.svg"));
		assert.strictEqual(node2.contextValue, "breakpointItemDisabled");

		// 运行时命中暂停态 (isPaused: true)
		const pausedBp = { type: "line", file: "src/main.ts", line: 42, enabled: true };
		const nodePaused = new BreakpointNode(
			"s1",
			2,
			pausedBp,
			"/ws",
			"/ext",
			{ file: "/ws/src/main.ts", line: 42 },
		);
		assert.strictEqual(nodePaused.isPausedAtBreakpoint(), true);
		assert.ok(nodePaused.description.includes("[PAUSED]"), "命中暂停断点 description 必须带有 [PAUSED] 标识");
		assert.ok(nodePaused.iconPath.fsPath.endsWith("bp-paused.svg"), "命中暂停断点图标必须切换为专属高亮 bp-paused.svg");

		console.log("    ✔ BreakpointNode 构造与继承模型安全性验证通过 (包含 isPaused 运行时高亮)");
	}

	// ============================================================================
	// Case 7: 未匹配脱靶断点 (Unmatched) 的前置标签与专属矢量 SVG 警告图标（直连 BreakpointNode）
	// ============================================================================
	{
		__resetMockVscodeState();
		sceneStateManager.setActiveScenes(["s1"], 1);
		sceneStateManager.setUnmatchedBreakpoints(["src/lost.ts:50"]);

		// 激活场景下的脱靶启用态断点
		const unmatchedBp = { type: "line", file: "src/lost.ts", line: 50, enabled: true, desc: "Lost logic" };
		const nodeUnmatched = new BreakpointNode("s1", 0, unmatchedBp, "/ws", "/ext");

		assert.ok(
			nodeUnmatched.description.startsWith("[Unmatched]"),
			"脱靶断点 description 必须前置 [Unmatched] 标签",
		);
		assert.ok(
			nodeUnmatched.iconPath.fsPath.endsWith("bp-unmatched-enabled.svg"),
			"脱靶断点启用态必须呈现专属琥珀黄警告矢量图标 bp-unmatched-enabled.svg",
		);

		// 脱靶禁用态断点
		const unmatchedDisabledBp = { type: "line", file: "src/lost.ts", line: 50, enabled: false };
		const nodeUnmatchedDis = new BreakpointNode("s1", 1, unmatchedDisabledBp, "/ws", "/ext");
		assert.ok(
			nodeUnmatchedDis.iconPath.fsPath.endsWith("bp-unmatched-disabled.svg"),
			"脱靶断点禁用态必须呈现专属灰色警告矢量图标 bp-unmatched-disabled.svg",
		);

		// 未脱靶正常断点
		const normalBp = { type: "line", file: "src/normal.ts", line: 20, enabled: true };
		const nodeNormal = new BreakpointNode("s1", 2, normalBp, "/ws", "/ext");
		assert.ok(
			nodeNormal.iconPath.fsPath.endsWith("bp-line-enabled.svg"),
			"正常断点继续保持经典红点 bp-line-enabled.svg",
		);

		// 清理状态
		sceneStateManager.setUnmatchedBreakpoints([]);

		console.log("    ✔ 未匹配脱靶断点前置标签与专属矢量 SVG 警告图标推导测试通过");
	}

	// ============================================================================
	// Case 8: 断点排序微调（直连 Scene 生产源码）
	// ============================================================================
	{
		const config = {
			scenes: {
				"sort-test": [
					{ type: "line", file: "a.ts", line: 1 },
					{ type: "line", file: "b.ts", line: 2 },
					{ type: "line", file: "c.ts", line: 3 },
				],
			},
		};
		const catalog = SceneCatalog.fromConfig(config);
		const scene = catalog.getScene("sort-test");

		// 1. 下移首项
		assert.strictEqual(scene.moveBreakpoint(0, "down"), true);
		assert.strictEqual(scene.getBreakpoints()[0].file, "b.ts");
		assert.strictEqual(scene.getBreakpoints()[1].file, "a.ts");

		// 2. 上移次项
		assert.strictEqual(scene.moveBreakpoint(1, "up"), true);
		assert.strictEqual(scene.getBreakpoints()[0].file, "a.ts");

		// 3. 置顶 (top)
		assert.strictEqual(scene.moveBreakpoint(2, "top"), true);
		assert.strictEqual(scene.getBreakpoints()[0].file, "c.ts");
		assert.strictEqual(scene.moveBreakpoint(0, "top"), false); // 已经是第 0 个

		// 4. 置底 (bottom)
		assert.strictEqual(scene.moveBreakpoint(0, "bottom"), true);
		assert.strictEqual(scene.getBreakpoints()[2].file, "c.ts");
		assert.strictEqual(scene.moveBreakpoint(2, "bottom"), false); // 已经是末尾

		// 5. 拖拽重排 (reorderBreakpoint)
		assert.strictEqual(scene.reorderBreakpoint(2, 0), true);
		assert.strictEqual(scene.getBreakpoints()[0].file, "c.ts");
		assert.strictEqual(scene.reorderBreakpoint(0, 0), false);
		assert.strictEqual(scene.reorderBreakpoint(-1, 1), false);

		// 6. 边界越界保护 (首项不能再上移，末项不能再下移)
		assert.strictEqual(scene.moveBreakpoint(0, "up"), false);
		assert.strictEqual(scene.moveBreakpoint(2, "down"), false);

		console.log("    ✔ 断点排序微调、置顶/置底、拖拽重排与边界越界保护测试通过");
	}

	// ============================================================================
	// Case 9: 在 debug-scenes.json 中快速精准行号定位检索（直连 SceneCatalog.findBreakpointLineInJson 生产源码）
	// ============================================================================
	{
		const sampleJson = `{
  "activeScenes": ["flow-a"],
  "scenes": {
    "flow-a": [
      {
        "type": "line",
        "file": "src/index.ts",
        "line": 42
      }
    ],
    "flow-b": [
      {
        "type": "function",
        "functionName": "loginHandler"
      }
    ]
  }
}`;

		const line1 = findBreakpointLineInJson(sampleJson, "flow-a", { type: "line", file: "src/index.ts", line: 42 });
		assert.strictEqual(line1, 7, "应当精准命中 flow-a 的 src/index.ts 断点行");

		const line2 = findBreakpointLineInJson(sampleJson, "flow-b", { type: "function", functionName: "loginHandler" });
		assert.strictEqual(line2, 14, "应当精准命中 flow-b 的 loginHandler 函数断点行");

		console.log("    ✔ debug-scenes.json 断点精准行号检索测试通过");
	}

	// ============================================================================
	// Case 10: 调试运行时暂停命中匹配与路径标准化比对（直连 BreakpointNode.isPausedAtBreakpoint 生产源码）
	// ============================================================================
	{
		const bp = { type: "line", file: "src/utils.ts", line: 88 };

		const nodeWindows = new BreakpointNode("s1", 0, bp, "d:/project", "/ext", {
			file: "d:/project/src/utils.ts",
			line: 88,
		});
		assert.strictEqual(nodeWindows.isPausedAtBreakpoint(), true, "Windows 规范路径应正常匹配");

		const nodeMixedSlash = new BreakpointNode("s1", 0, bp, "d:\\project", "/ext", {
			file: "D:\\Project\\src\\utils.ts",
			line: 88,
		});
		assert.strictEqual(nodeMixedSlash.isPausedAtBreakpoint(), true, "不同大小写与路径斜杠混用应标准化匹配");

		const nodeDiffLine = new BreakpointNode("s1", 0, bp, "d:\\project", "/ext", {
			file: "D:\\Project\\src\\utils.ts",
			line: 89,
		});
		assert.strictEqual(nodeDiffLine.isPausedAtBreakpoint(), false, "行号不符应判定未暂停于此");

		console.log("    ✔ 调试运行时暂停命中匹配与路径标准化比对测试通过");
	}

	// ============================================================================
	// Case 11: SceneTreeDataProvider.getChildren 与节点检索全维覆盖（直连生产源码）
	// ============================================================================
	{
		const provider = new SceneTreeDataProvider("/mock/ext");

		// A. 无工作区时返回占位提示节点
		vscode.workspace.workspaceFolders = [];
		const noWsChildren = await provider.getChildren();
		assert.strictEqual(noWsChildren.length, 1);
		assert.ok(noWsChildren[0] instanceof PlaceholderNode);

		// B. 工作区无任何场景时返回新建引导占位节点
		const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "sb-tree-test-"));
		vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpWs } }];
		saveScenesConfig(tmpWs, { scenes: {} });

		const emptyScenesChildren = await provider.getChildren();
		assert.strictEqual(emptyScenesChildren.length, 1);
		assert.ok(emptyScenesChildren[0] instanceof PlaceholderNode);

		// C. 包含场景时返回 SceneNode 列表并支持 getTreeItem 与 getParent
		saveScenesConfig(tmpWs, {
			scenes: {
				"checkout-flow": [
					{ type: "line", file: "src/pay.ts", line: 20, enabled: true },
					{ type: "function", functionName: "doPay", enabled: false },
				],
				"empty-flow": [],
			},
			activeScenes: ["checkout-flow"],
		});
		sceneStateManager.setActiveScenes(["checkout-flow"], 2);

		const rootNodes = await provider.getChildren();
		assert.strictEqual(rootNodes.length, 2);
		const checkoutNode = rootNodes.find((n) => n instanceof SceneNode && n.sceneName === "checkout-flow");
		const emptyNode = rootNodes.find((n) => n instanceof SceneNode && n.sceneName === "empty-flow");
		assert.ok(checkoutNode && checkoutNode.isActive);
		assert.ok(emptyNode && !emptyNode.isActive);

		// D. 展开无断点的空场景 -> 返回占位节点
		const emptyChildren = await provider.getChildren(emptyNode);
		assert.strictEqual(emptyChildren.length, 1);
		assert.ok(emptyChildren[0] instanceof PlaceholderNode);

		// E. 展开有断点的场景 -> 返回 BreakpointNode 列表
		const bpChildren = await provider.getChildren(checkoutNode);
		assert.strictEqual(bpChildren.length, 2);
		assert.ok(bpChildren[0] instanceof BreakpointNode);
		assert.strictEqual(bpChildren[0].index, 0);

		// F. 测试 getTreeItem 与 getParent
		const treeItem = provider.getTreeItem(bpChildren[0]);
		assert.ok(treeItem);
		const parentNode = provider.getParent(bpChildren[0]);
		assert.ok(parentNode instanceof SceneNode);
		assert.strictEqual(parentNode.sceneName, "checkout-flow");

		// G. 测试深接口 getBreakpointNodes 直接查询场景断点
		const directBpNodes = await provider.getBreakpointNodes("checkout-flow");
		assert.strictEqual(directBpNodes.length, 2);
		assert.strictEqual(directBpNodes[0].index, 0);
		assert.strictEqual(typeof directBpNodes[0].isUnmatched(), "boolean");

		// H. 测试 SceneNode 展开状态封装方法
		SceneNode.markExpanded("test-expanded-scene");
		assert.strictEqual(SceneNode.isExpanded("test-expanded-scene"), true);
		SceneNode.markCollapsed("test-expanded-scene");
		assert.strictEqual(SceneNode.isExpanded("test-expanded-scene"), false);

		// I. 传入未知节点
		const unknownChildren = await provider.getChildren(new PlaceholderNode("test"));
		assert.deepStrictEqual(unknownChildren, []);

		// 清理临时工作区
		fs.rmSync(tmpWs, { recursive: true, force: true });
		console.log("    ✔ SceneTreeDataProvider.getChildren 与节点检索全维覆盖通过");
	}

	// ============================================================================
	// Case 12: SceneTreeDataProvider 拖拽排序控制器 (Drag & Drop) 测试
	// ============================================================================
	{
		const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dnd-test-"));
		vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpWs } }];
		saveScenesConfig(tmpWs, {
			scenes: {
				"reorder-flow": [
					{ type: "line", file: "src/a.ts", line: 10, enabled: true },
					{ type: "line", file: "src/b.ts", line: 20, enabled: true },
					{ type: "line", file: "src/c.ts", line: 30, enabled: true },
				],
			},
		});

		const provider = new SceneTreeDataProvider("/mock/ext");
		const rootNodes = await provider.getChildren();
		const sceneNode = rootNodes[0];
		const bpNodes = await provider.getChildren(sceneNode);
		assert.strictEqual(bpNodes.length, 3);

		// A. 测试 handleDrag 包装传输数据
		const dataTransferMap = new Map();
		const mockDataTransfer = {
			set: (mime, item) => dataTransferMap.set(mime, item),
			get: (mime) => dataTransferMap.get(mime),
		};
		provider.handleDrag([bpNodes[0]], mockDataTransfer, {});
		assert.ok(dataTransferMap.has("application/vnd.code.tree.sceneBreakpointsView"));

		// B. 测试 handleDrop 拖拽断点重排 (将第 0 项拖至第 2 项)
		await provider.handleDrop(bpNodes[2], mockDataTransfer, {});

		// 验证重排后结果
		const updatedBpNodes = await provider.getChildren(sceneNode);
		assert.strictEqual(updatedBpNodes.length, 3);

		fs.rmSync(tmpWs, { recursive: true, force: true });
		console.log("    ✔ SceneTreeDataProvider 拖拽排序控制器 (Drag & Drop) 验证通过");
	}

	// ============================================================================
	// Case 13: revealPausedLocation 自动展开定位与守卫测试
	// ============================================================================
	{
		const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "sb-reveal-test-"));
		vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpWs } }];
		saveScenesConfig(tmpWs, {
			scenes: {
				"active-flow": [
					{ type: "line", file: "src/target.ts", line: 99, enabled: true },
				],
			},
			activeScenes: ["active-flow"],
		});
		sceneStateManager.setActiveScenes(["active-flow"], 1);

		const provider = new SceneTreeDataProvider("/mock/ext");
		let revealedTarget = null;
		const mockTreeView = {
			reveal: async (target) => {
				revealedTarget = target;
			},
		};

		// A. 命中已激活场景中的断点位置
		await provider.revealPausedLocation(mockTreeView, path.join(tmpWs, "src/target.ts"), 99);
		assert.deepStrictEqual(provider.getPausedLocation(), { file: path.join(tmpWs, "src/target.ts"), line: 99 });
		assert.ok(revealedTarget, "必须驱动 TreeView 展开并选中命中断点");

		// B. 清除高亮
		provider.clearPausedLocation();
		assert.strictEqual(provider.getPausedLocation(), null);

		fs.rmSync(tmpWs, { recursive: true, force: true });
		console.log("    ✔ revealPausedLocation 自动展开定位与高亮复位测试通过");
	}

	console.log("  ✅ [TreeView] 调试侧边栏树视图与节点领域模型测试套件（直连生产源码）全部通过！");
}

if (process.argv[1]?.endsWith("scene_tree_provider.test.mjs")) {
	runTreeViewTests();
}
