import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "vscode";
import { appEventBus } from "#src/application/eventBus.ts";
import { echoLoopGuard } from "#src/infra/storage/echoLoopGuard.ts";
import {
	registerConfigFileWatcherService,
	handleExternalScenesFileChange,
} from "#src/infra/vscode/listeners/configFileWatcherListener.ts";

export async function runConfigFileWatcherListenerTests() {
	console.log("  ▶ [Listeners] 运行 configFileWatcherListener 文件变动监听与防回环单元测试套件...");

	__resetMockVscodeState();
	echoLoopGuard.reset();
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-watcher-test-"));
	vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(tmpRoot) }];

	const configDir = path.join(tmpRoot, ".vscode");
	fs.mkdirSync(configDir, { recursive: true });
	const configFile = path.join(configDir, "debug-scenes.json");
	fs.writeFileSync(configFile, JSON.stringify({ scenes: { test: [] }, activeScenes: ["test"] }), "utf-8");

	try {
		// 1. handleExternalScenesFileChange 独立测试 (包含 status bar message)
		await handleExternalScenesFileChange(tmpRoot);
		assert.ok(true, "handleExternalScenesFileChange 正常运行完成");

		// 2. 注册服务并获取 watcher
		const watcher = registerConfigFileWatcherService();
		assert.ok(watcher, "registerConfigFileWatcherService 必须返回有效 watcher");

		// 3. 测试 onDidCreate 和 onDidDelete
		let eventFired = false;
		let lastReason = "";
		const sub = appEventBus.on("scenes:changed", (payload) => {
			eventFired = true;
			lastReason = payload.reason;
		});

		// 触发 create
		eventFired = false;
		for (const cb of watcher._createCbs) {
			cb(vscode.Uri.file(configFile));
		}
		assert.strictEqual(eventFired, true, "onDidCreate 必须触发 scenes:changed");
		assert.strictEqual(lastReason, "file_created");

		// 触发 delete
		eventFired = false;
		for (const cb of watcher._deleteCbs) {
			cb(vscode.Uri.file(configFile));
		}
		assert.strictEqual(eventFired, true, "onDidDelete 必须触发 scenes:changed");
		assert.strictEqual(lastReason, "file_deleted");

		// 4. 测试 onDidChange 防回环过滤 (内容匹配最近保存)
		const currentContent = fs.readFileSync(configFile, "utf-8");
		echoLoopGuard.setLastSavedContentForKey(configFile, currentContent);

		eventFired = false;
		for (const cb of watcher._changeCbs) {
			cb(vscode.Uri.file(configFile));
		}
		// 等待 debounce 150ms
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.strictEqual(eventFired, false, "内容与最近保存一致时必须阻断触发，防止回环");

		// 5. 测试 onDidChange 外部修改触发
		echoLoopGuard.reset();
		fs.writeFileSync(configFile, JSON.stringify({ scenes: { modified: [] } }), "utf-8");
		eventFired = false;
		for (const cb of watcher._changeCbs) {
			cb(vscode.Uri.file(configFile));
		}
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.strictEqual(eventFired, true, "外部修改且指纹不一致时必须触发变更广播");
		assert.strictEqual(lastReason, "external_file_change");

		sub.dispose();
		watcher.dispose();
		console.log("  ✅ [Listeners] configFileWatcherListener 单元测试全部通过！");
	} finally {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
}

if (process.argv[1]?.endsWith("config_file_watcher_listener.test.mjs")) {
	runConfigFileWatcherListenerTests();
}
