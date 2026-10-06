import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import { saveScenesConfig, loadScenesConfig } from "#src/infra/storage/jsonFileSceneRepository";
import { applySceneCommand } from "#src/ui/commands/sceneCommands";
import { sceneStateManager } from "#src/application/sceneStateManager";

/**
 * sceneCommands 1:1 镜像单测
 * 覆盖高危未测函数：
 * - handleDirtyCheckBeforeSwitch：Dirty 状态下场景切换的用户决策守卫全分支
 * - showActivationFeedback 匿名回调：脱靶告警 "Locate Code" 定位联动
 */
export async function runSceneCommandsTests() {
	console.log("  ▶ [Scene Commands] 运行场景激活命令 Dirty 守卫与脱靶定位联动单测（真实源码）...");

	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-scene-cmd-"));
	vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpRoot } }];

	const { configureDependencies } = await import("#src/application/index");
	const { jsonFileSceneRepository, vscodeBreakpointBridge, echoLoopGuard } = await import("#src/infra/index");
	configureDependencies({
		sceneRepository: jsonFileSceneRepository,
		breakpointBridge: vscodeBreakpointBridge,
		loopGuard: echoLoopGuard,
		lineReader: {
			readLines: async (filePath) => {
				try {
					const content = fs.readFileSync(filePath, "utf-8");
					return content.split(/\r?\n/);
				} catch {
					return undefined;
				}
			},
			clearCache: () => {},
		},
	});

	// 弹窗与编辑器交互间谍
	const warningCalls = [];
	let warningChoice = undefined;
	let openedDocs = [];
	let shownEditors = [];
	let revealCalls = [];
	const mockEditor = {
		selection: undefined,
		revealRange: (range, revealType) => revealCalls.push({ range, revealType }),
	};

	vscode.window.showWarningMessage = (message, ...rest) => {
		warningCalls.push({ message, rest });
		return Promise.resolve(warningChoice);
	};
	vscode.window.showInformationMessage = (message) => {
		vscode.window.messages.push({ level: "info", message });
		return Promise.resolve(undefined);
	};
	vscode.window.showTextDocument = async (doc) => {
		shownEditors.push(doc);
		return mockEditor;
	};
	vscode.workspace.openTextDocument = async (uriOrPath) => {
		const filePath = typeof uriOrPath === "string" ? uriOrPath : uriOrPath.fsPath;
		openedDocs.push(filePath);
		const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
		const lines = content.split(/\r?\n/);
		return {
			uri: vscode.Uri.file(filePath),
			fileName: filePath,
			lineCount: lines.length,
			lineAt: (i) => ({ text: lines[i] ?? "" }),
			getText: () => content,
		};
	};

	try {
		// 准备脱靶场景：contextSnippet 与实际文件内容完全不匹配 -> 激活时安全标记 unmatched
		const targetFile = path.join(tmpRoot, "src", "target.ts");
		fs.mkdirSync(path.dirname(targetFile), { recursive: true });
		fs.writeFileSync(
			targetFile,
			["function realCode() {", "  const a = 1;", "  const b = 2;", "  const c = 3;", "}"].join("\n"),
			"utf-8",
		);

		saveScenesConfig(tmpRoot, {
			scenes: {
				"feedback-scene": [
					{
						file: "src/target.ts",
						line: 2,
						type: "line",
						enabled: true,
						contextSnippet: { current: "const totallyDifferentGarbageLine = 999;" },
					},
					{
						file: "src/target.ts",
						line: 3,
						type: "line",
						enabled: true,
						contextSnippet: { current: "const anotherMismatchedSnippet = 888;" },
					},
				],
				"dirty-scene": [{ file: "src/target.ts", line: 4, type: "line", enabled: true }],
				"clean-scene": [{ file: "src/target.ts", line: 2, type: "line", enabled: true }],
			},
		});

		// ----------------------------------------------------
		// 1. showActivationFeedback 匿名回调：脱靶告警与 "Locate Code" 定位联动
		// ----------------------------------------------------
		sceneStateManager.resetState();
		warningCalls.length = 0;
		openedDocs = [];
		shownEditors = [];
		revealCalls = [];
		mockEditor.selection = undefined;
		warningChoice = "Locate Code"; // 点击定位动作 (l10n 确定性格式化原文)

		await applySceneCommand(["feedback-scene"]);

		// A. 脱靶告警必须以 warning 弹出且携带 Locate Code 动作
		assert.strictEqual(warningCalls.length, 1, "存在脱靶断点时必须弹出脱靶告警");
		assert.ok(
			warningCalls[0].message.includes("feedback-scene") && warningCalls[0].message.includes("2 breakpoint(s)"),
			"脱靶告警必须包含场景名与脱靶数量",
		);
		assert.strictEqual(warningCalls[0].rest[0], "Locate Code", "脱靶告警必须提供 Locate Code 动作按钮");

		// B. 点击 Locate Code 后必须打开首个脱靶文件并居中定位到漂移前行号
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.strictEqual(openedDocs.length, 1, "点击定位后必须打开首个脱靶文件");
		assert.strictEqual(openedDocs[0], targetFile, "相对路径必须拼接工作区根目录解析为绝对路径");
		assert.strictEqual(shownEditors.length, 1, "必须展示对应文本文档");
		assert.ok(mockEditor.selection, "必须设置编辑器选区到脱靶行");
		assert.strictEqual(
			mockEditor.selection.start.line,
			1,
			"选区必须定位到脱靶断点原行号的 0-based 位置 (第 2 行 -> line 1)",
		);
		assert.strictEqual(revealCalls.length, 1, "必须调用 revealRange 居中滚动");
		assert.strictEqual(revealCalls[0].revealType, vscode.TextEditorRevealType.InCenter, "必须使用居中滚动定位");

		// C. 用户直接关闭告警 (undefined) -> 不定位任何文件
		sceneStateManager.resetState();
		warningCalls.length = 0;
		openedDocs = [];
		warningChoice = undefined;
		await applySceneCommand(["feedback-scene"]);
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.strictEqual(openedDocs.length, 0, "用户关闭告警时绝不可打开任何文件");

		// D. 打开文档失败 -> 静默容错不抛出
		sceneStateManager.resetState();
		warningCalls.length = 0;
		warningChoice = "Locate Code";
		const origOpen = vscode.workspace.openTextDocument;
		vscode.workspace.openTextDocument = async () => {
			throw new Error("cannot open");
		};
		await applySceneCommand(["feedback-scene"]); // 不抛出即通过
		await new Promise((resolve) => setTimeout(resolve, 20));
		vscode.workspace.openTextDocument = origOpen;

		// ----------------------------------------------------
		// 2. handleDirtyCheckBeforeSwitch：Dirty 状态切换守卫全分支
		// ----------------------------------------------------
		// A. 无激活场景 (无 currentActive) -> 无弹窗直接放行
		sceneStateManager.resetState();
		warningCalls.length = 0;
		await applySceneCommand(["dirty-scene"]);
		assert.strictEqual(warningCalls.length, 0, "无激活场景时切换必须直接放行不弹窗");
		assert.ok(
			vscode.window.messages.some((m) => m.level === "info" && m.message.includes("dirty-scene")),
			"无激活场景时必须正常完成场景激活",
		);

		// B. 有激活场景但非 Dirty -> 无弹窗直接放行
		sceneStateManager.resetState();
		sceneStateManager.setActiveScenes(["dirty-scene"], 1);
		sceneStateManager.setDirty(false);
		warningCalls.length = 0;
		await applySceneCommand(["dirty-scene"]);
		assert.strictEqual(warningCalls.length, 0, "非 Dirty 状态切换必须直接放行不弹窗");

		// C. Dirty + 用户取消弹窗 -> 中止切换且不激活
		sceneStateManager.resetState();
		sceneStateManager.setActiveScenes(["dirty-scene"], 1);
		sceneStateManager.setDirty(true);
		vscode.window.messages.length = 0;
		warningCalls.length = 0;
		warningChoice = undefined;
		await applySceneCommand(["clean-scene"]);
		assert.strictEqual(warningCalls.length, 1, "Dirty 切换前必须弹出保存决策弹窗");
		assert.deepStrictEqual(warningCalls[0].rest[0], { modal: true }, "保存决策弹窗必须为模态");
		assert.strictEqual(warningCalls[0].rest.length, 3, "弹窗必须携带 保存追加 与 丢弃 两个动作");
		assert.ok(
			!vscode.window.messages.some((m) => m.level === "info" && m.message.includes("clean-scene")),
			"用户取消时必须中止场景激活",
		);

		// D. Dirty + 选择丢弃临时断点 -> 不落盘直接切换
		sceneStateManager.resetState();
		sceneStateManager.setActiveScenes(["dirty-scene"], 1);
		sceneStateManager.setDirty(true);
		warningCalls.length = 0;
		warningChoice = "Discard Temporary Breakpoints";
		const configBeforeDiscard = loadScenesConfig(tmpRoot);
		await applySceneCommand(["clean-scene"]);
		assert.strictEqual(warningCalls.length, 1, "Dirty 状态切换前必须弹出决策弹窗");
		assert.deepStrictEqual(
			loadScenesConfig(tmpRoot).scenes["dirty-scene"],
			configBeforeDiscard.scenes["dirty-scene"],
			"选择丢弃时绝不可将临时断点写盘",
		);
		assert.ok(
			vscode.window.messages.some((m) => m.level === "info" && m.message.includes("clean-scene")),
			"选择丢弃后必须继续完成场景激活",
		);

		// E. Dirty + 选择保存追加 -> 以 overwrite 模式导出当前宿主断点后继续激活
		sceneStateManager.resetState();
		sceneStateManager.setActiveScenes(["dirty-scene"], 1);
		sceneStateManager.setDirty(true);
		warningCalls.length = 0;
		warningChoice = "Save & Append to [dirty-scene]"; // l10n.t 确定性格式化结果

		// 宿主当前持有 1 个断点 (target.ts 第 5 行) 作为待保存的临时断点
		vscode.debug.breakpoints.length = 0;
		vscode.debug.breakpoints.push(
			new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(targetFile), new vscode.Position(4, 0))),
		);
		await applySceneCommand(["clean-scene"]);

		assert.strictEqual(warningCalls.length, 1, "Dirty 状态切换前必须弹出决策弹窗");
		const savedScene = loadScenesConfig(tmpRoot).scenes["dirty-scene"];
		assert.ok(
			savedScene.some((bp) => bp.file.includes("target.ts") && bp.line === 5),
			"选择保存追加时必须以 overwrite 模式将当前宿主断点写盘到原场景",
		);
		assert.ok(
			!savedScene.some((bp) => bp.line === 4 && bp.file.includes("target.ts")),
			"overwrite 模式必须覆盖场景原有断点而非追加",
		);
	} finally {
		__resetMockVscodeState();
		sceneStateManager.resetState();
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}

	console.log("  ✅ [Scene Commands] 场景激活命令 Dirty 守卫与脱靶定位联动单测全部通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runSceneCommandsTests();
}
