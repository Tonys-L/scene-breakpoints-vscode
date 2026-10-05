import assert from "node:assert/strict";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import {
	promptSceneName,
	confirmModalAction,
	promptSelectScenes,
	promptSceneCollision,
	showPayloadFormatError,
} from "#src/ui/utils/promptHelpers.ts";

async function testPromptSceneName() {
	// 1. 正常输入并首尾去空白
	let capturedOptions = null;
	vscode.window.showInputBox = async (options) => {
		capturedOptions = options;
		return "  auth-flow  ";
	};

	const scene1 = await promptSceneName({ prompt: "Enter name", placeHolder: "e.g. auth" });
	assert.strictEqual(scene1, "auth-flow", "必须返回首尾去除空白的名称");
	assert.strictEqual(capturedOptions.prompt, "Enter name");
	assert.strictEqual(capturedOptions.placeHolder, "e.g. auth");

	// 测试内置 validateInput
	assert.notStrictEqual(capturedOptions.validateInput(""), null, "空字符串应校验失败");
	assert.notStrictEqual(capturedOptions.validateInput("   "), null, "纯空白字符应校验失败");
	assert.strictEqual(capturedOptions.validateInput("valid-name"), null, "合法字符应返回 null");

	// 2. 用户取消输入
	vscode.window.showInputBox = async () => undefined;
	const sceneCancelled = await promptSceneName({ prompt: "Enter name" });
	assert.strictEqual(sceneCancelled, undefined, "用户取消时应返回 undefined");

	// 3. 用户输入空串
	vscode.window.showInputBox = async () => "   ";
	const sceneEmpty = await promptSceneName({ prompt: "Enter name" });
	assert.strictEqual(sceneEmpty, undefined, "输入纯空白时安全返回 undefined");
}

async function testConfirmModalAction() {
	// 1. 用户确认
	let capturedWarning = null;
	vscode.window.showWarningMessage = async (msg, opts, ...actions) => {
		capturedWarning = { msg, opts, actions };
		return "Delete";
	};

	const confirmed = await confirmModalAction("Delete this scene?", "Delete");
	assert.strictEqual(confirmed, true, "点击确认动作时返回 true");
	assert.strictEqual(capturedWarning.opts.modal, true, "必须以模态弹窗方式展示");
	assert.strictEqual(capturedWarning.actions[0], "Delete");

	// 2. 用户取消
	vscode.window.showWarningMessage = async () => undefined;
	const cancelled = await confirmModalAction("Delete this scene?", "Delete");
	assert.strictEqual(cancelled, false, "用户取消时返回 false");
}

async function testPromptSelectScenes() {
	// 1. 用户选择
	vscode.window.showQuickPick = async (items) => {
		return [items[0], items[1]];
	};

	const selected = await promptSelectScenes(
		["sceneA", "sceneB", "sceneC"],
		{ sceneA: 2, sceneB: 0, sceneC: 5 },
		["sceneA"],
	);
	assert.deepStrictEqual(selected, ["sceneA", "sceneB"], "应返回勾选场景的标签列表");

	// 2. 用户按 ESC 取消
	vscode.window.showQuickPick = async () => undefined;
	const pickCancelled = await promptSelectScenes(["sceneA"], { sceneA: 1 }, []);
	assert.strictEqual(pickCancelled, undefined, "取消选择时返回 undefined");
}

async function testPromptSceneCollision() {
	// 1. 默认仅提供 overwrite 与 append
	let collisionItems = null;
	vscode.window.showQuickPick = async (items) => {
		collisionItems = items;
		return items.find((it) => it.value === "overwrite");
	};
	const resOverwrite = await promptSceneCollision({ sceneName: "auth" });
	assert.deepStrictEqual(resOverwrite, { sceneName: "auth", mode: "overwrite" });
	assert.strictEqual(collisionItems.length, 2, "默认选项仅包含 overwrite 与 append");

	// 2. append 选项
	vscode.window.showQuickPick = async (items) => items.find((it) => it.value === "append");
	const resAppend = await promptSceneCollision({ sceneName: "auth" });
	assert.deepStrictEqual(resAppend, { sceneName: "auth", mode: "append" });

	// 3. 取消选择
	vscode.window.showQuickPick = async () => undefined;
	const resCancelled = await promptSceneCollision({ sceneName: "auth" });
	assert.strictEqual(resCancelled, null, "取消选择返回 null");

	// 4. allowRename: true 且输入新名称
	vscode.window.showQuickPick = async (items) => items.find((it) => it.value === "rename");
	vscode.window.showInputBox = async () => "auth-v2";
	const resRename = await promptSceneCollision({ sceneName: "auth", allowRename: true });
	assert.deepStrictEqual(resRename, { sceneName: "auth-v2", mode: "overwrite" });

	// 5. allowRename: true 但取消输入新名称
	vscode.window.showQuickPick = async (items) => items.find((it) => it.value === "rename");
	vscode.window.showInputBox = async () => undefined;
	const resRenameCancelled = await promptSceneCollision({ sceneName: "auth", allowRename: true });
	assert.strictEqual(resRenameCancelled, null, "取消输入新名称时返回 null");
}

async function testShowPayloadFormatError() {
	const origOpenTextDocument = vscode.workspace.openTextDocument;
	const origShowTextDocument = vscode.window.showTextDocument;

	try {
		// 1. 用户直接关闭/取消错误通知
		let capturedError = null;
		let openedDoc = null;
		vscode.window.showErrorMessage = async (msg, ...actions) => {
			capturedError = { msg, actions };
			return undefined;
		};
		await showPayloadFormatError("Invalid JSON syntax");
		assert.ok(capturedError.msg.includes("Invalid JSON syntax"));
		assert.strictEqual(openedDoc, null, "关闭弹窗时不应打开文档");

		// 2. 用户点击引导动作
		let openedOptions = null;
		let shownInEditor = null;
		vscode.window.showErrorMessage = async (_msg, ...actions) => actions[0];
		vscode.workspace.openTextDocument = async (options) => {
			openedOptions = options;
			return { uri: vscode.Uri.parse("untitled:formats.json"), ...options };
		};
		vscode.window.showTextDocument = async (doc, options) => {
			shownInEditor = { doc, options };
		};

		await showPayloadFormatError("Schema mismatch");
		assert.strictEqual(openedOptions?.language, "jsonc");
		assert.ok(openedOptions?.content?.includes("debug-scenes"));
		assert.strictEqual(shownInEditor?.options?.preview, true);
	} finally {
		vscode.workspace.openTextDocument = origOpenTextDocument;
		vscode.window.showTextDocument = origShowTextDocument;
	}
}

export async function runPromptHelpersTests() {
	console.log("  ▶ [UI Utils] 运行 promptHelpers 统一交互弹窗与校验单测套件...");

	__resetMockVscodeState();

	try {
		await testPromptSceneName();
		await testConfirmModalAction();
		await testPromptSelectScenes();
		await testPromptSceneCollision();
		await testShowPayloadFormatError();
	} finally {
		__resetMockVscodeState();
	}

	console.log("  ✅ [UI Utils] promptHelpers 单测全部通过！");
}

if (process.argv[1]?.endsWith("prompt_helpers.test.mjs")) {
	runPromptHelpersTests();
}
