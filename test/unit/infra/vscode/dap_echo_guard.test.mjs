import assert from "node:assert/strict";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "vscode";
import { resolveFileUri } from "#src/infra/vscode/vscodeBreakpointBridge.ts";
import { dapEchoGuard } from "#src/infra/vscode/dapEchoGuard.ts";

export async function runDapEchoGuardTests() {
	console.log("  ▶ [Infra VSCode] 运行 DAP 并发锁与路径解析辅助单元测试套件（真实源码）...");

	__resetMockVscodeState();

	// 1. withApplyingLock 原子锁保护验证（直连 dapEchoGuard 专职模块）
	let ran = false;
	await dapEchoGuard.withApplyingLock(async () => {
		assert.strictEqual(dapEchoGuard.isApplyingBreakpoints(), true, "执行动作期间 isApplyingBreakpoints 必须为 true");
		ran = true;
	});
	assert.strictEqual(ran, true, "锁内业务动作必须被执行");
	dapEchoGuard.reset();

	// 2. resolveFileUri 路径解析与缓存
	const cache = new Map();
	const uri1 = await resolveFileUri(process.cwd(), "package.json", cache);
	assert.ok(uri1 instanceof vscode.Uri, "package.json 必须解析出有效 Uri");
	assert.strictEqual(cache.has("package.json"), true, "解析结果必须写入缓存");

	const uriCached = await resolveFileUri(process.cwd(), "package.json", cache);
	assert.strictEqual(uriCached, uri1, "缓存二次读取必须直接复用引用");

	const uriInvalid = await resolveFileUri(process.cwd(), "", cache);
	assert.strictEqual(uriInvalid, undefined, "空路径必须安全返回 undefined");

	console.log("  ✅ [Infra VSCode] DAP 并发锁与路径解析辅助单测通过！");
}

export const runDapBridgeTests = runDapEchoGuardTests;

if (process.argv[1]?.endsWith("dap_echo_guard.test.mjs")) {
	runDapEchoGuardTests();
}
