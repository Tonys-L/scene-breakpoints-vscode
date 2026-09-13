import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "vscode";
import { registerAllCommands } from "../../../src/infra/vscode/commands/index.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");

/**
 * 模拟 VS Code ExtensionContext
 */
class MockExtensionContext {
	constructor() {
		this.subscriptions = [];
		this.extensionUri = vscode.Uri.file("/mock/ext/path");
		this.extensionPath = "/mock/ext/path";
	}
}

export function runCommandsRegistryTests() {
	console.log("  ▶ [Command Registry] 运行命令注册中枢与生命周期防灾测试套件（直连生产源码）...");

	// 1. 测试基础 9 大交互命令全量注册（直连 registerAllCommands）
	{
		__resetMockVscodeState();
		const context = new MockExtensionContext();

		registerAllCommands(context);

		const expectedCoreCmds = [
			"sceneBreakpoints.addBreakpoint",
			"sceneBreakpoints.applyScene",
			"sceneBreakpoints.clearAll",
			"sceneBreakpoints.exportScene",
			"sceneBreakpoints.showMenu",
			"sceneBreakpoints.copySceneToClipboard",
			"sceneBreakpoints.importSceneFromClipboard",
			"sceneBreakpoints.installSkill",
			"sceneBreakpoints.diagnoseAiIntegration",
		];
		for (const cmdId of expectedCoreCmds) {
			assert.strictEqual(vscode.commands._registered.has(cmdId), true, `核心命令 [${cmdId}] 必须被生产代码正确注册`);
		}
		assert.strictEqual(context.subscriptions.length, 9, "基础交互命令数量必须严格对齐 9 个");
	}

	// 2. 测试带 TreeDataProvider 依赖注入时的 14 大级联树命令与真实方法调度
	{
		__resetMockVscodeState();
		const context = new MockExtensionContext();

		let refreshed = false;
		const mockTreeDataProvider = {
			refresh: () => {
				refreshed = true;
			},
		};

		registerAllCommands(context, { treeDataProvider: mockTreeDataProvider });

		const treeCmds = [
			"sceneBreakpoints.refreshView",
			"sceneBreakpoints.createNewScene",
			"sceneBreakpoints.applySceneItem",
			"sceneBreakpoints.toggleSceneActivation",
			"sceneBreakpoints.renameSceneItem",
			"sceneBreakpoints.deleteSceneItem",
			"sceneBreakpoints.removeBreakpointItem",
			"sceneBreakpoints.toggleBreakpointItem",
			"sceneBreakpoints.enableAllBreakpointsInScene",
			"sceneBreakpoints.disableAllBreakpointsInScene",
			"sceneBreakpoints.duplicateScene",
			"sceneBreakpoints.revealInConfigFile",
			"sceneBreakpoints.moveBreakpointUp",
			"sceneBreakpoints.moveBreakpointDown",
			"sceneBreakpoints.moveBreakpointToTop",
			"sceneBreakpoints.moveBreakpointToBottom",
		];
		for (const cmdId of treeCmds) {
			assert.strictEqual(vscode.commands._registered.has(cmdId), true, `树命令 [${cmdId}] 必须被生产代码正确级联注册`);
		}
		assert.strictEqual(context.subscriptions.length, 9 + 16, "核心命令 + 树命令总数必须严格为 25 个");

		// 测试 refreshView 处理器真实调度
		assert.strictEqual(refreshed, false);
		const refreshEntry = vscode.commands._registered.get("sceneBreakpoints.refreshView");
		refreshEntry.handler();
		assert.strictEqual(refreshed, true, "执行 refreshView 命令必须正确调用 treeDataProvider.refresh");
	}

	// 3. 测试与 package.json 声明的 100% 双向对齐守卫 (防悬空命令)
	{
		__resetMockVscodeState();
		const packageJsonPath = path.join(rootDir, "package.json");
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
		const declaredCommands = packageJson.contributes.commands.map((c) => c.command);

		const context = new MockExtensionContext();
		registerAllCommands(context, { treeDataProvider: { refresh: () => {} } });

		for (const declaredCmd of declaredCommands) {
			assert.strictEqual(
				vscode.commands._registered.has(declaredCmd),
				true,
				`package.json 中声明的命令 [${declaredCmd}] 必须在生产代码中存在对应的注册实现，严禁悬空！`,
			);
		}

		// 验证 commandPalette 隐藏屏蔽守卫：所有 14 个树视图局部微操命令必须在全局命令面板屏蔽
		const hiddenInPalette = (packageJson.contributes?.menus?.commandPalette || [])
			.filter((entry) => entry.when === "false")
			.map((entry) => entry.command);
		const expectedHiddenCmds = [
			"sceneBreakpoints.refreshView",
			"sceneBreakpoints.createNewScene",
			"sceneBreakpoints.applySceneItem",
			"sceneBreakpoints.toggleSceneActivation",
			"sceneBreakpoints.renameSceneItem",
			"sceneBreakpoints.deleteSceneItem",
			"sceneBreakpoints.removeBreakpointItem",
			"sceneBreakpoints.toggleBreakpointItem",
			"sceneBreakpoints.enableAllBreakpointsInScene",
			"sceneBreakpoints.disableAllBreakpointsInScene",
			"sceneBreakpoints.duplicateScene",
			"sceneBreakpoints.revealInConfigFile",
			"sceneBreakpoints.moveBreakpointUp",
			"sceneBreakpoints.moveBreakpointDown",
			"sceneBreakpoints.moveBreakpointToTop",
			"sceneBreakpoints.moveBreakpointToBottom",
		];
		for (const hiddenCmd of expectedHiddenCmds) {
			assert.strictEqual(
				hiddenInPalette.includes(hiddenCmd),
				true,
				`局部命令 [${hiddenCmd}] 必须在 commandPalette 中配置 when: false 予以屏蔽，防止污染全局面板`,
			);
		}
	}

	// 4. 测试生命周期批量销毁释放（真正清空注册表）
	{
		__resetMockVscodeState();
		const context = new MockExtensionContext();
		registerAllCommands(context, { treeDataProvider: { refresh: () => {} } });

		assert.strictEqual(vscode.commands._registered.size, 25, "注册完成后应有 25 个已注册命令");

		// 模拟插件停用或重载，逐一调用 subscriptions 中的 dispose
		for (const sub of context.subscriptions) {
			sub.dispose();
		}
		assert.strictEqual(
			vscode.commands._registered.size,
			0,
			"全部 subscriptions 销毁后命令注册表必须被彻底清空，0 内存残留",
		);
	}

	console.log("  ✅ [Command Registry] 命令注册中枢与生命周期防灾测试套件（直连生产源码）全部通过！");
}
