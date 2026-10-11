import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "vscode";
import { createVsCodeLineReader, vscodeLineReader } from "#src/infra/vscode/vscodeLineReader.ts";

export async function runVsCodeLineReaderTests() {
	console.log("  ▶ [Infra VSCode] 运行 vscodeLineReader 源码行提取与脏缓存清除单元测试套件...");

	__resetMockVscodeState();

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-line-reader-test-"));
	const testFile = path.join(tempDir, "sample.ts");
	fs.writeFileSync(testFile, "line 1\nline 2\nline 3\n", "utf-8");

	try {
		// 1. 创建 reader 并验证读取正常文件 (走 openTextDocument 逻辑)
		const reader = createVsCodeLineReader(tempDir);
		assert.ok(reader, "createVsCodeLineReader 应返回有效实例");

		const lines = await reader.readLines(testFile);
		assert.ok(Array.isArray(lines), "readLines 应返回行数组");
		assert.strictEqual(lines.length, 4, "行数应与文件内容行数一致 (含末尾空行)");
		assert.strictEqual(lines[0], "line 1", "第一行内容应为 line 1");
		assert.strictEqual(lines[1], "line 2", "第二行内容应为 line 2");

		// 2. 验证 openTextDocument 异常时的 fallback (catch 分支)
		const originalOpen = vscode.workspace.openTextDocument;
		try {
			vscode.workspace.openTextDocument = async () => {
				throw new Error("Simulated document open error");
			};
			const failingReader = createVsCodeLineReader(tempDir);
			// 虽 openTextDocument 抛出异常，但底层 FileLineReader 会回退到直接读物理磁盘文件
			const fallbackLines = await failingReader.readLines(testFile);
			assert.ok(Array.isArray(fallbackLines), "openTextDocument 抛错时应回退到物理磁盘文件成功读取");
			assert.strictEqual(fallbackLines[0], "line 1");
		} finally {
			vscode.workspace.openTextDocument = originalOpen;
		}

		// 3. 验证 onDidChangeTextDocument 触发 reader.clearCache()
		const cachedReader = createVsCodeLineReader(tempDir);
		const initialLines = await cachedReader.readLines(testFile);
		assert.strictEqual(initialLines[0], "line 1");

		// 修改物理文件内容
		fs.writeFileSync(testFile, "modified line 1\nline 2\n", "utf-8");

		// 触发文档变动回调
		for (const cb of vscode.workspace._docChangeCbs) {
			cb({ document: { uri: vscode.Uri.file(testFile) } });
		}

		// 清除缓存后重新读取，应获取到新内容
		const refreshedLines = await cachedReader.readLines(testFile);
		assert.strictEqual(refreshedLines[0], "modified line 1", "触发 onDidChangeTextDocument 后缓存应被清空并读出新行");

		// 4. 验证默认导出的全局单例对象
		assert.ok(vscodeLineReader, "vscodeLineReader 单例应存在且有效");
		const singletonLines = await vscodeLineReader.readLines(testFile);
		assert.strictEqual(singletonLines[0], "modified line 1");

		console.log("  ✅ [Infra VSCode] vscodeLineReader 单元测试全部通过！");
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

if (process.argv[1]?.endsWith("vscode_line_reader.test.mjs")) {
	runVsCodeLineReaderTests();
}
