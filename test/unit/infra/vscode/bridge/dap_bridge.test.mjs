import assert from "node:assert/strict";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "vscode";
import { resolveFileUri, withApplyingLock } from "#src/infra/vscode/bridge/dapHelpers.ts";
import { sceneStateManager } from "#src/application/sceneStateManager.ts";

export async function runDapBridgeTests() {
	console.log("  ▶ [Infra VSCode Bridge] 运行 DAP 核心辅助桥接单测套件...");

	__resetMockVscodeState();

	// 1. withApplyingLock 原子锁保护验证
	let ran = false;
	await withApplyingLock(async () => {
		assert.strictEqual(sceneStateManager.isApplying, true, "执行动作期间 isApplying 必须为 true");
		ran = true;
	});
	assert.strictEqual(ran, true, "锁内业务动作必须被执行");

	// 2. resolveFileUri 路径解析与缓存
	const cache = new Map();
	const uri1 = await resolveFileUri(process.cwd(), "package.json", cache);
	assert.ok(uri1 instanceof vscode.Uri, "package.json 必须解析出有效 Uri");
	assert.strictEqual(cache.has("package.json"), true, "解析结果必须写入缓存");

	const uriCached = await resolveFileUri(process.cwd(), "package.json", cache);
	assert.strictEqual(uriCached, uri1, "缓存二次读取必须直接复用引用");

	const uriInvalid = await resolveFileUri(process.cwd(), "", cache);
	assert.strictEqual(uriInvalid, undefined, "空路径必须安全返回 undefined");

	console.log("  ✅ [Infra VSCode Bridge] DAP 核心辅助桥接单测通过！");
}

if (process.argv[1]?.endsWith("dap_bridge.test.mjs")) {
	runDapBridgeTests();
}
