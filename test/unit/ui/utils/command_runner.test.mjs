import * as assert from "node:assert";
import * as vscode from "vscode";
import { runWithWorkspace } from "#src/ui/utils/commandRunner";

export async function runCommandRunnerTests() {
	console.log("  ▶ [CommandRunner] 运行命令执行上下文工具函数单元测试...");

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

	console.log("  ✅ [CommandRunner] 命令执行上下文工具函数单元测试全部通过！\n");
}

if (process.argv[1]?.endsWith("command_runner.test.mjs")) {
	runCommandRunnerTests();
}
