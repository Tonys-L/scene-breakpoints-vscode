import assert from "node:assert";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import {
	initStatusBarItem,
	formatScenesLabel,
	getStatusBarItem,
} from "#src/infra/vscode/statusBarView";
import { sceneStateManager } from "#src/domain/sceneStateManager";

function resetStateManager() {
	sceneStateManager.setActiveScene(undefined);
	sceneStateManager.setLastAppliedTopologyHash("");
	sceneStateManager.setPendingTopologyUpdate(false);
	sceneStateManager.setDirty(false);
}

export async function runStatusBarViewTests() {
	console.log("  ▶ [Status Bar View] 运行 statusBarView 状态栏视觉渲染单元测试套件（真实源码）...");

	__resetMockVscodeState();
	resetStateManager();

	const ctx = { subscriptions: [] };
	initStatusBarItem(ctx);
	const item = getStatusBarItem();
	assert.ok(item, "initStatusBarItem 必须创建状态栏项");
	assert.strictEqual(item.command, "sceneBreakpoints.showMenu");

	// 1. Case A: None 态 (无激活场景)
	sceneStateManager.setActiveScenes([]);
	assert.strictEqual(item.text, "$(circle-outline) Scene: (None)");
	assert.strictEqual(item.color, undefined, "None 态下颜色必须为 undefined 继承默认前景色");

	// 2. Case B: Clean 态 (已激活场景且未被临时修改)
	sceneStateManager.setActiveScenes(["user-login"]);
	assert.strictEqual(item.text, "$(circle-filled) Scene: [user-login]");
	assert.strictEqual(item.color, "#49c998", "Clean 激活态必须为高对比度翠绿色 (#49c998)");

	// 3. Case C: Dirty 态 (已激活场景且存在临时脏断点)
	sceneStateManager.setDirty(true);
	assert.strictEqual(item.text, "$(circle-filled) Scene: [user-login]*", "Dirty 态必须在标签末尾追加星号提示");
	assert.strictEqual(item.color, "#cca700", "Dirty 态必须呈现警示黄色 (#cca700)");
	assert.ok(String(item.tooltip).includes("Unsaved"), "Dirty 态悬浮提示必须包含未保存说明");

	// 4. 智能长度自适应标签折叠 formatScenesLabel
	assert.strictEqual(formatScenesLabel([]), "(None)");
	assert.strictEqual(formatScenesLabel(["auth"]), "[auth]");
	assert.strictEqual(formatScenesLabel(["auth", "order"]), "[auth + order]", "短场景链必须完整展示");
	assert.strictEqual(
		formatScenesLabel(["a", "b", "c".repeat(20)]),
		"[a + b, +1]",
		"超长场景链必须折叠为前 2 个 + 剩余计数",
	);
	assert.strictEqual(
		formatScenesLabel(["authentication-module", "order-processing", "payment-gateway", "notification-center"]),
		"[authentication-module, +3]",
		"前 2 个仍超长时必须优雅回退为首个场景 + 剩余计数",
	);

	console.log("  ✅ [Status Bar View] statusBarView 单元测试全部通过！");
}
