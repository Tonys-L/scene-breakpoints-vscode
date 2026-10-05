import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import { saveScenesConfig } from "#src/infra/storage/jsonFileSceneRepository";

export async function runCommandsExecutionTests() {
	console.log("  ▶ [Commands Execution] 运行 VS Code 宿主交互命令单测套件...");

	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cmd-test-"));
	// 挂载工作区 mock
	vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpRoot } }];

	const { configureDependencies } = await import("#src/application/index");
	const { jsonFileSceneRepository, vscodeBreakpointBridge, echoLoopGuard } = await import("#src/infra/index");
	configureDependencies({
		sceneRepository: jsonFileSceneRepository,
		breakpointBridge: vscodeBreakpointBridge,
		loopGuard: echoLoopGuard,
		fileLinesReader: async (filePath) => {
			try {
				const content = fs.readFileSync(filePath, "utf-8");
				return content.split(/\r?\n/);
			} catch {
				return undefined;
			}
		},
	});

	const { registerAllCommands } = await import("#src/ui/commands/index");

	const mockTreeDataProvider = {
		refresh: () => {},
	};
	const extensionRoot = path.resolve(".");
	const memState = {
		_map: new Map(),
		get(k, def) {
			return this._map.has(k) ? this._map.get(k) : def;
		},
		async update(k, v) {
			this._map.set(k, v);
		},
	};
	const context = {
		subscriptions: [],
		extensionPath: extensionRoot,
		extensionUri: vscode.Uri.file(extensionRoot),
		workspaceState: memState,
		globalState: memState,
		extension: {
			packageJSON: { version: "1.0.9" },
		},
	};
	registerAllCommands(context, { treeDataProvider: mockTreeDataProvider });

	try {
		// 准备基础配置文件
		saveScenesConfig(tmpRoot, {
			scenes: {
				login: [
					{ file: "src/login.ts", line: 10, type: "line", enabled: true },
					{ file: "src/login.ts", line: 20, type: "line", enabled: true },
				],
				empty: [],
			},
			activeScenes: ["login"],
		});

		// ----------------------------------------------------
		// 1. copySceneToClipboard 各种分支
		// ----------------------------------------------------
		// A. 复制已有场景到剪贴板
		await vscode.commands.executeCommand("sceneBreakpoints.copySceneToClipboard", "login");
		const copiedText = await vscode.env.clipboard.readText();
		assert.ok(copiedText.includes("src/login.ts"), "剪贴板中必须包含场景断点信息");

		// B. 复制空场景弹 warning
		await vscode.commands.executeCommand("sceneBreakpoints.copySceneToClipboard", "empty");

		// C. 无参时通过 showQuickPick 选择
		vscode.window.showQuickPick = async (items) => items[0];
		await vscode.commands.executeCommand("sceneBreakpoints.copySceneToClipboard");

		// D. showQuickPick 取消
		vscode.window.showQuickPick = async () => undefined;
		await vscode.commands.executeCommand("sceneBreakpoints.copySceneToClipboard");

		// ----------------------------------------------------
		// 2. importSceneFromClipboard 分支
		// ----------------------------------------------------
		// A. 剪贴板为空
		await vscode.env.clipboard.writeText("");
		await vscode.commands.executeCommand("sceneBreakpoints.importSceneFromClipboard");

		// B. 剪贴板为破坏性格式
		await vscode.env.clipboard.writeText("invalid non-json text");
		await vscode.commands.executeCommand("sceneBreakpoints.importSceneFromClipboard");

		// C. 导入全新场景
		const validPayload = JSON.stringify({
			scene: "imported-flow",
			breakpoints: [{ file: "src/imported.ts", line: 5, enabled: true }],
		});
		await vscode.env.clipboard.writeText(validPayload);
		vscode.window.showInformationMessage = async () => undefined;
		await vscode.commands.executeCommand("sceneBreakpoints.importSceneFromClipboard");

		// D. 格式错误时点击 View Supported Formats 动作
		vscode.window.showErrorMessage = async (msg, ...actions) => {
			vscode.window.messages.push({ level: "error", message: msg });
			return actions[0];
		};
		await vscode.env.clipboard.writeText("invalid non-json text");
		await vscode.commands.executeCommand("sceneBreakpoints.importSceneFromClipboard");

		// E. 导入已存在场景 -> Overwrite
		const existingPayload = JSON.stringify({
			sceneName: "login",
			breakpoints: [{ file: "src/login.ts", line: 10, enabled: false, type: "line" }],
		});
		await vscode.env.clipboard.writeText(existingPayload);
		vscode.window.showQuickPick = async (items) => items.find((i) => i.value === "overwrite");
		await vscode.commands.executeCommand("sceneBreakpoints.importSceneFromClipboard");

		// F. 导入已存在场景 -> Append 并点击激活
		const appendPayload = JSON.stringify({
			sceneName: "login",
			breakpoints: [{ file: "src/login.ts", line: 30, enabled: true, type: "line" }],
		});
		await vscode.env.clipboard.writeText(appendPayload);
		vscode.window.showQuickPick = async (items) => items.find((i) => i.value === "append");
		vscode.window.showInformationMessage = async (msg, ...actions) => actions[0];
		await vscode.commands.executeCommand("sceneBreakpoints.importSceneFromClipboard");

		// G. 导入已存在场景 -> Rename
		const renamePayload = JSON.stringify({
			sceneName: "login",
			breakpoints: [{ file: "src/login.ts", line: 40, enabled: true, type: "line" }],
		});
		await vscode.env.clipboard.writeText(renamePayload);
		vscode.window.showQuickPick = async (items) => items.find((i) => i.value === "rename");
		vscode.window.showInputBox = async () => "login-third-copy";
		await vscode.commands.executeCommand("sceneBreakpoints.importSceneFromClipboard");

		// ----------------------------------------------------
		// 3. createNewScene 新建场景分支
		// ----------------------------------------------------
		// A. 用户取消输入
		vscode.window.showInputBox = async () => undefined;
		await vscode.commands.executeCommand("sceneBreakpoints.createNewScene");

		// B. 用户输入已存在的名称
		vscode.window.showInputBox = async () => "login";
		await vscode.commands.executeCommand("sceneBreakpoints.createNewScene");

		// C. 成功创建新场景
		vscode.window.showInputBox = async () => "checkout-flow";
		await vscode.commands.executeCommand("sceneBreakpoints.createNewScene");

		// ----------------------------------------------------
		// 4. renameScene 重命名场景分支
		// ----------------------------------------------------
		vscode.window.showInputBox = async () => "login-renamed";
		await vscode.commands.executeCommand("sceneBreakpoints.renameScene", { sceneName: "login" });

		// ----------------------------------------------------
		// 5. deleteScene 删除场景分支
		// ----------------------------------------------------
		vscode.window.showWarningMessage = async () => "Delete";
		await vscode.commands.executeCommand("sceneBreakpoints.deleteScene", { sceneName: "empty" });

		// ----------------------------------------------------
		// 6. toggleAllInScene 批量启用/禁用
		// ----------------------------------------------------
		await vscode.commands.executeCommand("sceneBreakpoints.disableAllInScene", { sceneName: "login-renamed" });
		await vscode.commands.executeCommand("sceneBreakpoints.enableAllInScene", { sceneName: "login-renamed" });

		// ----------------------------------------------------
		// 7. 树视图交互命令 (treeCommands) 全面覆盖
		// ----------------------------------------------------
		const { SceneNode, BreakpointNode } = await import("#src/ui/views/sceneTreeProvider");
		const sceneNode = new SceneNode("login-renamed", 2, true, false);
		const bpNode0 = new BreakpointNode("login-renamed", 0, { file: "src/login.ts", line: 10, type: "line", enabled: true }, tmpRoot, extensionRoot);
		const bpNode1 = new BreakpointNode("login-renamed", 1, { file: "src/login.ts", line: 20, type: "line", enabled: true }, tmpRoot, extensionRoot);

		await vscode.commands.executeCommand("sceneBreakpoints.refreshView");
		await vscode.commands.executeCommand("sceneBreakpoints.applySceneItem", sceneNode);
		await vscode.commands.executeCommand("sceneBreakpoints.toggleSceneActivation", sceneNode);
		await vscode.commands.executeCommand("sceneBreakpoints.enableAllBreakpointsInScene", sceneNode);
		await vscode.commands.executeCommand("sceneBreakpoints.disableAllBreakpointsInScene", sceneNode);
		await vscode.commands.executeCommand("sceneBreakpoints.toggleBreakpointItem", bpNode0);
		await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointDown", bpNode0);
		await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointUp", bpNode1);
		await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointToBottom", bpNode0);
		await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointToTop", bpNode1);

		// 克隆/复制场景
		vscode.window.showInputBox = async () => "login-copy";
		await vscode.commands.executeCommand("sceneBreakpoints.duplicateScene", sceneNode);

		// 定位配置文件
		await vscode.commands.executeCommand("sceneBreakpoints.revealInConfigFile", bpNode0);

		// 移除断点
		await vscode.commands.executeCommand("sceneBreakpoints.removeBreakpointItem", bpNode0);

		// 树重命名与删除场景
		vscode.window.showInputBox = async () => "login-tree-renamed";
		await vscode.commands.executeCommand("sceneBreakpoints.renameSceneItem", sceneNode);
		vscode.window.showWarningMessage = async () => "Delete";
		await vscode.commands.executeCommand("sceneBreakpoints.deleteSceneItem", new SceneNode("login-copy", 2, false, false));

		// ----------------------------------------------------
		// 8. clearAll 清空全局断点
		// ----------------------------------------------------
		await vscode.commands.executeCommand("sceneBreakpoints.clearAll");

		// ----------------------------------------------------
		// 9. applyScene 全分支测试
		// ----------------------------------------------------
		// A. 数组传参
		await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-renamed"]);

		// B. 逗号字符串传参
		await vscode.commands.executeCommand("sceneBreakpoints.applyScene", "login-renamed, checkout-flow");

		// C. 不存在的幽灵场景拦截
		await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["non-existent-scene"]);

		// D. 空场景激活
		await vscode.commands.executeCommand("sceneBreakpoints.applyScene", []);

		// ----------------------------------------------------
		// 10. addBreakpoint 全类型与新建场景测试
		// ----------------------------------------------------
		// A. 无 activeTextEditor 时退出
		vscode.window.activeTextEditor = undefined;
		await vscode.commands.executeCommand("sceneBreakpoints.addBreakpoint");

		// B. 模拟真实活动编辑器
		const sampleFile = path.join(tmpRoot, "src", "sample.ts");
		fs.mkdirSync(path.dirname(sampleFile), { recursive: true });
		fs.writeFileSync(sampleFile, "const x = 100;\nconst y = 200;\n", "utf-8");

		vscode.window.activeTextEditor = {
			document: {
				fileName: sampleFile,
				uri: vscode.Uri.file(sampleFile),
				lineCount: 2,
				lineAt: (i) => ({ text: i === 0 ? "const x = 100;" : "const y = 200;" }),
			},
			selection: {
				active: new vscode.Position(0, 0),
			},
		};

		// 添加普通行断点到已存在场景
		let pickStep = 0;
		vscode.window.showQuickPick = async (items) => {
			pickStep++;
			if (pickStep === 1) return items.find((i) => i.sceneName === "login-renamed");
			if (pickStep === 2) return items.find((i) => i.type === "line");
			return items[0];
		};
		await vscode.commands.executeCommand("sceneBreakpoints.addBreakpoint");

		// 添加条件断点并新建场景
		pickStep = 0;
		vscode.window.showQuickPick = async (items) => {
			pickStep++;
			if (pickStep === 1) return items.find((i) => i.sceneName === "__NEW__");
			if (pickStep === 2) return items.find((i) => i.type === "condition");
			return items[0];
		};
		vscode.window.showInputBox = async (opts) => {
			if (opts && opts.prompt && opts.prompt.includes("identifier")) return "condition-scene";
			return "x > 50";
		};
		await vscode.commands.executeCommand("sceneBreakpoints.addBreakpoint");

		// ----------------------------------------------------
		// 11. exportScene 全分支测试
		// ----------------------------------------------------
		// A. 宿主无断点时弹 warning
		vscode.debug.breakpoints.length = 0;
		await vscode.commands.executeCommand("sceneBreakpoints.exportScene");

		// B. 宿主有断点时成功导出
		vscode.debug.breakpoints.push(
			new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(sampleFile), new vscode.Position(1, 0))),
		);
		vscode.window.showQuickPick = async (items) => {
			if (items.some((i) => i.action === "overwrite")) return items.find((i) => i.action === "overwrite");
			return items[0];
		};
		await vscode.commands.executeCommand("sceneBreakpoints.exportScene");

		// ----------------------------------------------------
		// 12. showMenu 主菜单测试 (基于 createQuickPick)
		// ----------------------------------------------------
		vscode.window.showQuickPick = async (items, options) => {
			if (options && options.canPickMany) {
				return items ? [items[0]] : [];
			}
			return items ? items[0] : undefined;
		};

		// A. 用户直接取消主菜单
		await vscode.commands.executeCommand("sceneBreakpoints.showMenu");
		if (vscode.window._lastQuickPick) {
			vscode.window._lastQuickPick.hide();
		}

		// B. 用户点击 multiSelect 项
		await vscode.commands.executeCommand("sceneBreakpoints.showMenu");
		if (vscode.window._lastQuickPick) {
			const item = vscode.window._lastQuickPick.items.find((i) => i.action === "multiSelect");
			if (item) await vscode.window._lastQuickPick._triggerAccept(item);
		}

		// C. 用户点击 switch 切换场景
		await vscode.commands.executeCommand("sceneBreakpoints.showMenu");
		if (vscode.window._lastQuickPick) {
			const item = vscode.window._lastQuickPick.items.find((i) => i.action === "switch");
			if (item) await vscode.window._lastQuickPick._triggerAccept(item);
		}

		// D. 用户点击 export 导出场景
		await vscode.commands.executeCommand("sceneBreakpoints.showMenu");
		if (vscode.window._lastQuickPick) {
			const item = vscode.window._lastQuickPick.items.find((i) => i.action === "export");
			if (item) await vscode.window._lastQuickPick._triggerAccept(item);
		}

		// E. 用户点击 importClipboard 剪贴板导入
		await vscode.commands.executeCommand("sceneBreakpoints.showMenu");
		if (vscode.window._lastQuickPick) {
			const item = vscode.window._lastQuickPick.items.find((i) => i.action === "importClipboard");
			if (item) await vscode.window._lastQuickPick._triggerAccept(item);
		}

		// F. 用户点击 clear 清空
		await vscode.commands.executeCommand("sceneBreakpoints.showMenu");
		if (vscode.window._lastQuickPick) {
			const item = vscode.window._lastQuickPick.items.find((i) => i.action === "clear");
			if (item) await vscode.window._lastQuickPick._triggerAccept(item);
		}

		// G. 用户点击 openConfig 打开配置
		await vscode.commands.executeCommand("sceneBreakpoints.showMenu");
		if (vscode.window._lastQuickPick) {
			const item = vscode.window._lastQuickPick.items.find((i) => i.action === "openConfig");
			if (item) await vscode.window._lastQuickPick._triggerAccept(item);
		}

		// H. 用户点击 toggleInlayHintsMode 切换内嵌提示
		await vscode.commands.executeCommand("sceneBreakpoints.showMenu");
		if (vscode.window._lastQuickPick) {
			const item = vscode.window._lastQuickPick.items.find((i) => i.action === "toggleInlayHintsMode");
			if (item) await vscode.window._lastQuickPick._triggerAccept(item);
		}

		// ----------------------------------------------------
		// 13. installSkill 安装技能命令
		// ----------------------------------------------------
		// A. 用户取消选择
		vscode.window.showQuickPick = async () => undefined;
		await vscode.commands.executeCommand("sceneBreakpoints.installSkill");

		// B. 用户勾选特定平台进行安装
		// 模拟用户选择 Antigravity 与 Cursor
		vscode.window.showQuickPick = async (items) => {
			return items.filter((i) => i.label.includes("Antigravity") || i.label.includes("Cursor"));
		};
		await vscode.commands.executeCommand("sceneBreakpoints.installSkill");

		// 验证技能文件是否成功落盘
		const antigravitySkillPath = path.join(tmpRoot, ".agents/skills/scene-breakpoints/SKILL.md");
		assert.ok(fs.existsSync(antigravitySkillPath), "Antigravity Skill 文件必须成功写入");

		// ----------------------------------------------------
		// 14. diagnoseAiIntegration 诊断命令
		// ----------------------------------------------------
		vscode.window.showQuickPick = async (items) => {
			const target = items.find((i) => typeof i.action === "function");
			return target;
		};
		await vscode.commands.executeCommand("sceneBreakpoints.diagnoseAiIntegration");

		// ----------------------------------------------------
		// 15. checkAndPromptSkillUpdates 巡检
		// ----------------------------------------------------
		const { checkAndPromptSkillUpdates } = await import("#src/ui/commands/skillCommands");
		vscode.window.showInformationMessage = async (msg, ...actions) => actions[0];
		await checkAndPromptSkillUpdates(context, tmpRoot);
	} finally {
		__resetMockVscodeState();
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}

	console.log("  ✅ [Commands Execution] VS Code 宿主交互命令单测全部通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runCommandsExecutionTests();
}
