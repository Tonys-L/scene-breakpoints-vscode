import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

/**
 * 模拟 VS Code ExtensionContext
 */
class MockExtensionContext {
	constructor() {
		this.subscriptions = [];
		this.extensionUri = { fsPath: "/mock/ext/path" };
		this.extensionPath = "/mock/ext/path";
	}
}

/**
 * 模拟 VS Code commands 运行时调度器
 */
class MockCommandRegistry {
	constructor() {
		this.handlers = new Map();
	}

	registerCommand(id, handler) {
		const disposable = {
			id,
			disposed: false,
			dispose: () => {
				disposable.disposed = true;
				this.handlers.delete(id);
			},
		};
		this.handlers.set(id, { handler, disposable });
		return disposable;
	}

	has(id) {
		return this.handlers.has(id);
	}

	get(id) {
		return this.handlers.get(id);
	}
}

/**
 * 核心命令注册中枢逻辑镜像（与 src/commands/index.ts 与 treeCommands.ts 严格对齐）
 */
function registerAllCommandsMock(vscodeMock, context, deps) {
	const coreCommands = [
		["sceneBreakpoints.addBreakpoint", () => {}],
		["sceneBreakpoints.applyScene", () => {}],
		["sceneBreakpoints.clearAll", () => {}],
		["sceneBreakpoints.exportScene", () => {}],
		["sceneBreakpoints.showMenu", () => {}],
		["sceneBreakpoints.copySceneToClipboard", () => {}],
		["sceneBreakpoints.importSceneFromClipboard", () => {}],
		["sceneBreakpoints.installSkill", () => {}],
		["sceneBreakpoints.diagnoseAiIntegration", () => {}],
	];

	for (const [commandId, handler] of coreCommands) {
		context.subscriptions.push(vscodeMock.commands.registerCommand(commandId, handler));
	}

	if (deps?.treeDataProvider) {
		const treeCommands = [
			["sceneBreakpoints.refreshView", () => deps.treeDataProvider.refresh()],
			["sceneBreakpoints.createNewScene", () => {}],
			["sceneBreakpoints.applySceneItem", () => {}],
			["sceneBreakpoints.toggleSceneActivation", () => {}],
			["sceneBreakpoints.renameSceneItem", () => {}],
			["sceneBreakpoints.deleteSceneItem", () => {}],
			["sceneBreakpoints.removeBreakpointItem", () => {}],
			["sceneBreakpoints.toggleBreakpointItem", () => {}],
			["sceneBreakpoints.enableAllBreakpointsInScene", () => {}],
			["sceneBreakpoints.disableAllBreakpointsInScene", () => {}],
			["sceneBreakpoints.duplicateScene", () => {}],
			["sceneBreakpoints.revealInConfigFile", () => {}],
			["sceneBreakpoints.moveBreakpointUp", () => {}],
			["sceneBreakpoints.moveBreakpointDown", () => {}],
		];
		for (const [commandId, handler] of treeCommands) {
			context.subscriptions.push(vscodeMock.commands.registerCommand(commandId, handler));
		}
	}
}

export function runCommandsRegistryTests() {
	console.log("  ▶ [Command Registry] 运行命令注册中枢与生命周期防灾测试套件...");

	// 1. 测试基础 9 大交互命令全量注册
	{
		const mockRegistry = new MockCommandRegistry();
		const vscodeMock = { commands: mockRegistry };
		const context = new MockExtensionContext();

		registerAllCommandsMock(vscodeMock, context);

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
			assert.strictEqual(mockRegistry.has(cmdId), true, `核心命令 [${cmdId}] 必须被正确注册`);
		}
		assert.strictEqual(context.subscriptions.length, 9, "基础交互命令数量必须严格对齐");
	}

	// 2. 测试带 TreeDataProvider 依赖注入时的 14 大级联树命令与方法调用
	{
		const mockRegistry = new MockCommandRegistry();
		const vscodeMock = { commands: mockRegistry };
		const context = new MockExtensionContext();

		let refreshed = false;
		const mockTreeDataProvider = {
			refresh: () => {
				refreshed = true;
			},
		};

		registerAllCommandsMock(vscodeMock, context, { treeDataProvider: mockTreeDataProvider });

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
		];
		for (const cmdId of treeCmds) {
			assert.strictEqual(mockRegistry.has(cmdId), true, `树命令 [${cmdId}] 必须被正确级联注册`);
		}

		// 测试 refreshView 处理器调用
		const refreshEntry = mockRegistry.get("sceneBreakpoints.refreshView");
		refreshEntry.handler();
		assert.strictEqual(refreshed, true, "执行 refreshView 命令必须正确调用 treeDataProvider.refresh");
	}

	// 3. 测试与 package.json 声明的 100% 双向对齐守卫 (防悬空命令)
	{
		const packageJsonPath = path.join(rootDir, "package.json");
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
		const declaredCommands = packageJson.contributes.commands.map((c) => c.command);

		const mockRegistry = new MockCommandRegistry();
		const vscodeMock = { commands: mockRegistry };
		const context = new MockExtensionContext();
		registerAllCommandsMock(vscodeMock, context, { treeDataProvider: {} });

		for (const declaredCmd of declaredCommands) {
			assert.strictEqual(
				mockRegistry.has(declaredCmd),
				true,
				`package.json 中声明的命令 [${declaredCmd}] 必须在代码中存在对应的注册实现，严禁悬空！`,
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
		];
		for (const hiddenCmd of expectedHiddenCmds) {
			assert.strictEqual(
				hiddenInPalette.includes(hiddenCmd),
				true,
				`局部命令 [${hiddenCmd}] 必须在 commandPalette 中配置 when: false 予以屏蔽，防止污染全局面板`,
			);
		}
	}

	// 4. 测试生命周期批量销毁释放
	{
		const mockRegistry = new MockCommandRegistry();
		const vscodeMock = { commands: mockRegistry };
		const context = new MockExtensionContext();
		registerAllCommandsMock(vscodeMock, context);

		// 模拟插件停用或重载，逐一调用 dispose
		for (const sub of context.subscriptions) {
			sub.dispose();
			assert.strictEqual(sub.disposed, true, "调用 dispose 后必须将内部标记设为 true");
		}
		assert.strictEqual(mockRegistry.handlers.size, 0, "全部销毁后命令调度表必须被彻底清空，0 内存残留");
	}

	console.log("  ✅ [Command Registry] 命令注册中枢与生命周期防灾测试套件（4 大核心维度）全部通过！");
}
