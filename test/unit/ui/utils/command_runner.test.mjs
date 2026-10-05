import * as assert from "node:assert";
import * as vscode from "vscode";
import { runWithWorkspace, getWorkspaceRoot, runWithActiveEditor } from "#src/ui/utils/commandRunner";

export async function runCommandRunnerTests() {
	console.log("  ▶ [CommandRunner] 运行命令执行上下文工具函数单元测试...");

	// 0. getWorkspaceRoot 单元测试
	vscode.workspace.workspaceFolders = [];
	vscode.window.messages.length = 0;

	// 0.1 warnIfMissing = false: 不弹警告
	const rootWithoutWarn = getWorkspaceRoot(false);
	assert.strictEqual(rootWithoutWarn, undefined);
	assert.strictEqual(vscode.window.messages.length, 0, "warnIfMissing=false 时不得触发弹窗");

	// 0.2 warnIfMissing = true: 弹出警告
	const rootWithWarn = getWorkspaceRoot(true);
	assert.strictEqual(rootWithWarn, undefined);
	assert.ok(
		vscode.window.messages.some((m) => m.level === "warning" && m.message.includes("workspace")),
		"warnIfMissing=true 时必须弹出警告",
	);

	// 0.3 有工作区时安全返回路径且不弹警告
	vscode.workspace.workspaceFolders = [{ uri: { fsPath: "/workspace/demo" } }];
	vscode.window.messages.length = 0;
	assert.strictEqual(getWorkspaceRoot(true), "/workspace/demo");
	assert.strictEqual(vscode.window.messages.length, 0);

	// 1. 无工作区时：安全返回 undefined 并弹出警告
	vscode.workspace.workspaceFolders = [];
	vscode.window.messages.length = 0;

	const noResult = await runWithWorkspace(true, () => {
		return "should_not_run";
	});
	assert.strictEqual(noResult, undefined);
	assert.ok(
		vscode.window.messages.some((m) => m.level === "warning"),
		"无工作区且 warnIfMissing=true 时必须弹出警告",
	);

	// 2. 正常工作区时：透传并返回结果 (支持两参数与单参数重载)
	vscode.workspace.workspaceFolders = [{ uri: { fsPath: "/workspace/demo" } }];
	const successResult = await runWithWorkspace(true, (root) => {
		return `handled_${root}`;
	});
	assert.strictEqual(successResult, "handled_/workspace/demo");

	// 2.1 单参数缺省重载（默认 warnIfMissing = true）
	const defaultResult = await runWithWorkspace((root) => {
		return `default_${root}`;
	});
	assert.strictEqual(defaultResult, "default_/workspace/demo");

	// 3. 异步 handler 异常捕获与错误提示
	vscode.window.messages.length = 0;
	const failResult = await runWithWorkspace(true, async () => {
		throw new Error("Disk IO failed");
	});
	assert.strictEqual(failResult, undefined);
	assert.ok(
		vscode.window.messages.some((m) => m.level === "error" && m.message.includes("Disk IO failed")),
		"handler 抛异常时必须自动拦截并弹出错误提示",
	);

	// 4. runWithActiveEditor 单元测试
	// 4.1 无活动编辑器时：返回 undefined 并弹出警告
	vscode.window.activeTextEditor = undefined;
	vscode.window.messages.length = 0;
	const noEditorRes = await runWithActiveEditor(() => "should_not_run");
	assert.strictEqual(noEditorRes, undefined);
	assert.ok(
		vscode.window.messages.some((m) => m.level === "warning" && m.message.includes("No active editor")),
		"无活动编辑器时必须弹出警告",
	);

	// 4.2 有活动编辑器且位于工作区内：正确传递 editor 与 workspaceRoot
	const fakeDoc = {
		uri: { fsPath: "/workspace/demo/src/index.ts" },
		fileName: "/workspace/demo/src/index.ts",
	};
	vscode.window.activeTextEditor = { document: fakeDoc };
	vscode.workspace.getWorkspaceFolder = (uri) => {
		if (uri.fsPath.startsWith("/workspace/demo")) {
			return { uri: { fsPath: "/workspace/demo" } };
		}
		return undefined;
	};
	const editorRes = await runWithActiveEditor((editor, wsRoot) => {
		return `${editor.document.fileName}@${wsRoot}`;
	});
	assert.strictEqual(editorRes, "/workspace/demo/src/index.ts@/workspace/demo");

	// 4.3 有活动编辑器但无工作区：回退至 dirname
	vscode.workspace.workspaceFolders = [];
	vscode.workspace.getWorkspaceFolder = () => undefined;
	const standaloneDoc = {
		uri: { fsPath: "/tmp/script.js" },
		fileName: "/tmp/script.js",
	};
	vscode.window.activeTextEditor = { document: standaloneDoc };
	const standaloneRes = await runWithActiveEditor((_editor, wsRoot) => wsRoot);
	assert.ok(standaloneRes.includes("tmp"), "无工作区时应回退至文件所在目录");

	// 4.4 runWithActiveEditor 异常拦截
	vscode.window.messages.length = 0;
	const editorFailRes = await runWithActiveEditor(async () => {
		throw new Error("Editor command crash");
	});
	assert.strictEqual(editorFailRes, undefined);
	assert.ok(
		vscode.window.messages.some((m) => m.level === "error" && m.message.includes("Editor command crash")),
		"runWithActiveEditor 抛异常时必须自动拦截并弹出错误提示",
	);

	console.log("  ✅ [CommandRunner] 命令执行上下文工具函数单元测试全部通过！\n");
}

if (process.argv[1]?.endsWith("command_runner.test.mjs")) {
	runCommandRunnerTests();
}
