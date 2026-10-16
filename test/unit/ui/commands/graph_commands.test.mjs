import assert from "node:assert/strict";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import {
	setGraphCommandDeps,
	showGraphCommand,
	openGraphInEditorCommand,
	exportGraphMermaidCommand,
	refreshGraphCanvas,
} from "#src/ui/commands/graphCommands";

export async function runGraphCommandsTests() {
	console.log("  ▶ [Graph Commands] 运行 graphCommands 画布命令单测套件...");

	__resetMockVscodeState();

	// 消息捕获（对齐 skill_commands 捕获式弹窗先例）
	let lastInfo = null;
	let lastWarn = null;
	vscode.window.showInformationMessage = async (msg) => {
		lastInfo = msg;
		return undefined;
	};
	vscode.window.showWarningMessage = async (msg) => {
		lastWarn = msg;
		return undefined;
	};

	const setWorkspace = (root) => {
		vscode.workspace.workspaceFolders.length = 0;
		if (root) {
			vscode.workspace.workspaceFolders.push({ uri: vscode.Uri.file(root), name: "ws", index: 0 });
		}
	};

	try {
		// ----------------------------------------------------
		// 1. 无工作区时 showGraph 必须告警且不触碰控制器
		// ----------------------------------------------------
		{
			let showCalls = 0;
			setGraphCommandDeps({
				controller: { show: () => showCalls++ },
				loadSnapshot: () => {
					throw new Error("should not load snapshot");
				},
			});
			setWorkspace(null);
			lastWarn = null;
			await showGraphCommand();
			assert.strictEqual(showCalls, 0, "无工作区不得打开画布");
			assert.ok(lastWarn, "无工作区必须弹告警");
		}

		// ----------------------------------------------------
		// 2. showGraph 将工作区根透传给 controller.show
		// ----------------------------------------------------
		{
			const showArgs = [];
			setGraphCommandDeps({
				controller: { show: (root) => showArgs.push(root) },
				loadSnapshot: () => {
					throw new Error("should not load snapshot");
				},
			});
			setWorkspace("/ws/graph");
			await showGraphCommand();
			assert.deepEqual(showArgs, ["/ws/graph"], "必须以工作区根打开画布");
		}

		// ----------------------------------------------------
		// 2.1 openGraphInEditor 将工作区根透传给 controller.showInEditor
		// ----------------------------------------------------
		{
			const showInEditorArgs = [];
			setGraphCommandDeps({
				controller: { showInEditor: (root) => showInEditorArgs.push(root) },
				loadSnapshot: () => {
					throw new Error("should not load snapshot");
				},
			});
			setWorkspace(null);
			lastWarn = null;
			await openGraphInEditorCommand();
			assert.strictEqual(showInEditorArgs.length, 0, "无工作区不得打开全屏画布");
			assert.ok(lastWarn, "无工作区必须弹告警");

			setWorkspace("/ws/full-editor");
			await openGraphInEditorCommand();
			assert.deepEqual(showInEditorArgs, ["/ws/full-editor"], "必须以工作区根打开全屏画布");
		}

		// ----------------------------------------------------
		// 2.2 refreshGraphCanvas 联动触发 controller.resendAll
		// ----------------------------------------------------
		{
			let resendAllCalled = false;
			setGraphCommandDeps({
				controller: {
					resendAll: () => {
						resendAllCalled = true;
					},
				},
				loadSnapshot: () => {
					throw new Error("should not load snapshot");
				},
			});
			refreshGraphCanvas();
			assert.strictEqual(resendAllCalled, true, "refreshGraphCanvas 必须调用 controller.resendAll");
		}

		// ----------------------------------------------------
		// 3. 无工作区时 exportMermaid 必须告警且不写剪贴板
		// ----------------------------------------------------
		{
			setWorkspace(null);
			await vscode.env.clipboard.writeText("SENTINEL");
			lastWarn = null;
			await exportGraphMermaidCommand();
			assert.strictEqual(await vscode.env.clipboard.readText(), "SENTINEL", "无工作区不得写剪贴板");
			assert.ok(lastWarn, "无工作区必须弹告警");
		}

		// ----------------------------------------------------
		// 4. 空快照（可见泳道为空）必须告警短路，零剪贴板写入
		// ----------------------------------------------------
		{
			let snapshotLoads = 0;
			let passedScenes = "unset";
			setGraphCommandDeps({
				controller: { show: () => {}, getVisibleScenes: () => undefined },
				loadSnapshot: (root, scenes) => {
					snapshotLoads++;
					passedScenes = scenes;
					return { lanes: [], warnings: [], activeScenes: [], workspaceRoot: "/ws" };
				},
			});
			setWorkspace("/ws");
			await vscode.env.clipboard.writeText("SENTINEL");
			lastWarn = null;
			await exportGraphMermaidCommand();
			assert.strictEqual(snapshotLoads, 1, "空快照仍需经 loadSnapshot 只读投影");
			assert.strictEqual(passedScenes, undefined, "无 scope 选择时必须以缺省（跟随激活集）投影");
			assert.strictEqual(await vscode.env.clipboard.readText(), "SENTINEL", "空快照不得写剪贴板");
			assert.ok(lastWarn, "空快照必须弹告警");
			assert.strictEqual(lastWarn, "No scenes in the current scope to export.", "告警文案对齐 Scope 语义");
		}

		// ----------------------------------------------------
		// 5. 正常快照：Mermaid 文本落剪贴板 + 成功提示（零落盘）；导出对齐画布 Scope 所见即所得
		// ----------------------------------------------------
		{
			let passedScenes = "unset";
			setGraphCommandDeps({
				controller: { show: () => {}, getVisibleScenes: () => ["login"] },
				loadSnapshot: (root, scenes) => {
					passedScenes = scenes;
					return {
						lanes: [
							{
								id: "scene:login",
								sceneName: "login",
								nodes: [
									{
										id: "login#0",
										kind: "breakpoint",
										ownerScene: "login",
										refPath: ["login"],
										file: "src/a.ts",
										line: 3,
										enabled: true,
										status: "idle",
									},
								],
							},
						],
						warnings: [],
						activeScenes: ["login"],
						workspaceRoot: "/ws",
					};
				},
			});
			lastInfo = null;
			await exportGraphMermaidCommand();
			assert.deepStrictEqual(passedScenes, ["login"], "导出必须透传画布当前 Scope 选择");
			const clipboard = await vscode.env.clipboard.readText();
			assert.match(clipboard, /^flowchart TD\n/, "剪贴板必须为 Mermaid flowchart 文本");
			assert.match(clipboard, /subgraph .*"login"/, "泳道必须导出为 subgraph");
			assert.ok(lastInfo, "导出成功必须有提示");
		}
	} finally {
		__resetMockVscodeState();
	}

	console.log("  ✅ [Graph Commands] 画布命令单测全部通过！");
}
