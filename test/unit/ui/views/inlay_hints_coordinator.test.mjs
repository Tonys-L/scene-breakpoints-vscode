import assert from "node:assert/strict";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import {
	isInlayHintsAlwaysOn,
	toggleInlayHintsMode,
	promptInlayHintsModeIfFirstTime,
	inlayHintsCoordinator,
} from "#src/ui/views/inlayHintsCoordinator.ts";

export async function runInlayHintsCoordinatorTests() {
	console.log("  ▶ [Inlay Hints Coordinator] 运行 InlayHintsCoordinator 单元测试套件...");

	// 1. 门面对象方法绑定验证
	assert.strictEqual(typeof inlayHintsCoordinator.isAlwaysOn, "function");
	assert.strictEqual(typeof inlayHintsCoordinator.toggleMode, "function");
	assert.strictEqual(typeof inlayHintsCoordinator.promptIfFirstTime, "function");

	// 2. isInlayHintsAlwaysOn 模式判定
	__resetMockVscodeState();
	let configInlay = "offUnlessPressed";
	vscode.workspace.getConfiguration = (section) => {
		if (section === "editor.inlayHints") {
			return {
				get: () => configInlay,
				update: async (_key, val) => {
					configInlay = val;
				},
			};
		}
		return { get: () => undefined, update: async () => {} };
	};

	assert.strictEqual(isInlayHintsAlwaysOn(), false);
	configInlay = "on";
	assert.strictEqual(isInlayHintsAlwaysOn(), true);

	// 3. toggleInlayHintsMode 模式互斥切换与提示
	let infoMessages = [];
	vscode.window.showInformationMessage = async (msg) => {
		infoMessages.push(msg);
	};

	// 3.1 从 "on" 切换到 "offUnlessPressed"
	configInlay = "on";
	infoMessages = [];
	const res1 = await toggleInlayHintsMode();
	assert.strictEqual(res1, false);
	assert.strictEqual(configInlay, "offUnlessPressed");
	assert.strictEqual(infoMessages.length, 1);

	// 3.2 从 "offUnlessPressed" 切换到 "on"
	infoMessages = [];
	const res2 = await toggleInlayHintsMode();
	assert.strictEqual(res2, true);
	assert.strictEqual(configInlay, "on");
	assert.strictEqual(infoMessages.length, 1);

	// 4. promptInlayHintsModeIfFirstTime 首次引导判定
	const storage = new Map();
	const mockMemento = {
		get: (key) => storage.get(key),
		update: async (key, val) => {
			storage.set(key, val);
		},
	};

	// 4.1 当已处于 Always-On 时，直接跳过不弹窗
	configInlay = "on";
	let promptCalled = false;
	vscode.window.showInformationMessage = async () => {
		promptCalled = true;
	};
	await promptInlayHintsModeIfFirstTime(mockMemento);
	assert.strictEqual(promptCalled, false, "处于 Always-On 时严禁打扰用户");

	// 4.2 当处于非 Always-On 且未忽略时，弹出引导
	configInlay = "offUnlessPressed";
	promptCalled = false;
	vscode.window.showInformationMessage = async (_prompt, btn1) => {
		promptCalled = true;
		return btn1; // 模拟点击 "Enable Always-On"
	};
	await promptInlayHintsModeIfFirstTime(mockMemento);
	assert.strictEqual(promptCalled, true, "首次非 Always-On 时必须弹窗提示");
	assert.strictEqual(configInlay, "on", "点击启用后必须更新为 on");
	assert.strictEqual(storage.get("sceneBreakpoints.inlayHintsPromptDismissed"), true, "必须记录已提示状态");

	// 4.3 已记录已提示状态时，二次激活不再打扰
	configInlay = "offUnlessPressed";
	promptCalled = false;
	await promptInlayHintsModeIfFirstTime(mockMemento);
	assert.strictEqual(promptCalled, false, "已记录已提示状态时绝不二次弹窗");

	console.log("  ✅ [Inlay Hints Coordinator] InlayHintsCoordinator 单元测试全部通过！");
}

if (process.argv[1]?.endsWith("inlay_hints_coordinator.test.mjs")) {
	runInlayHintsCoordinatorTests();
}
