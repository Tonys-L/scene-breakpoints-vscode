import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileLineReader, defaultFileLineReader } from "#src/infra/storage/fileLineReader.ts";

export async function runFileLineReaderTests() {
	console.log("  ▶ [File Line Reader] 运行 FileLineReader 文件行提取单元测试套件...");

	// 1. 非法入参防御与类型守卫
	{
		const reader = new FileLineReader();
		assert.strictEqual(await reader.readLines(""), undefined);
		assert.strictEqual(await reader.readLines(null), undefined);
		assert.strictEqual(await reader.readLines(undefined), undefined);
		assert.strictEqual(await reader.readLines(12345), undefined);
		assert.strictEqual(await reader.readLines({}), undefined);
	}

	// 2. 内存缓存命中与独立缓存实例（验证 undefined 不被缓存）
	{
		const cache = new Map();
		cache.set("/virtual/test.ts", ["line 1", "line 2"]);
		const reader = new FileLineReader({ cache });

		const lines = await reader.readLines("/virtual/test.ts");
		assert.deepStrictEqual(lines, ["line 1", "line 2"]);

		reader.clearCache();
		// 清空缓存后找不到文件应返回 undefined，且缓存不得存入 undefined（斩杀 if (lines) -> if (true)）
		assert.strictEqual(await reader.readLines("/virtual/test.ts"), undefined);
		assert.strictEqual(cache.has("/virtual/test.ts"), false, "undefined 结果绝对不得写入缓存");
	}

	// 3. 优先命中编辑器未保存脏缓冲区 (getDocumentLines)（即便磁盘物理文件同时存在）
	{
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-reader-dirty-"));
		try {
			const dirtyDiskFile = path.join(tmpDir, "dirty.ts");
			fs.writeFileSync(dirtyDiskFile, "disk stale code", "utf-8");

			let getDocLinesCalled = false;
			const reader = new FileLineReader({
				workspaceRoot: tmpDir,
				getDocumentLines: (filePath) => {
					getDocLinesCalled = true;
					if (filePath.endsWith("dirty.ts")) {
						return ["dirty code 1", "dirty code 2"];
					}
					return undefined;
				},
			});

			// 验证：即使磁盘上物理文件同时存在，内存脏行必须享有绝对优先权，绝不被 readFile 覆盖
			const dirtyLines = await reader.readLines("dirty.ts");
			assert.strictEqual(getDocLinesCalled, true);
			assert.deepStrictEqual(dirtyLines, ["dirty code 1", "dirty code 2"], "必须优先采纳活动文档脏内容");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}

	// 3.1 优先命中异步编辑器文档提供者 (Promise<string[] | undefined>)
	{
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-reader-async-"));
		try {
			const asyncReader = new FileLineReader({
				workspaceRoot: tmpDir,
				getDocumentLines: async (filePath) => {
					if (filePath.endsWith("async.ts")) {
						return ["async line 1", "async line 2"];
					}
					return undefined;
				},
			});

			const lines = await asyncReader.readLines("async.ts");
			assert.deepStrictEqual(lines, ["async line 1", "async line 2"], "必须正确解析异步文档提供者返回的内容");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}

	// 4. 磁盘物理文件读取、相对路径与绝对路径互斥解析
	{
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-reader-test-"));
		try {
			const targetFile = path.join(tmpDir, "sample.txt");
			fs.writeFileSync(targetFile, "alpha\r\nbeta\ngamma", "utf-8");

			// 4.1 相对路径 + workspaceRoot
			const readerWithRoot = new FileLineReader({ workspaceRoot: tmpDir });
			const lines = await readerWithRoot.readLines("sample.txt");
			assert.deepStrictEqual(lines, ["alpha", "beta", "gamma"], "支持混合 CRLF 与 LF 换行解析");

			// 4.2 缓存自动写入生效
			fs.unlinkSync(targetFile);
			const cachedLines = await readerWithRoot.readLines("sample.txt");
			assert.deepStrictEqual(cachedLines, ["alpha", "beta", "gamma"]);

			// 4.3 显式绝对路径（不受 workspaceRoot 干扰）
			const absFile = path.join(tmpDir, "absolute-target.txt");
			fs.writeFileSync(absFile, "line abs", "utf-8");
			const absLines = await readerWithRoot.readLines(absFile);
			assert.deepStrictEqual(absLines, ["line abs"]);

			// 4.4 未设置 workspaceRoot 时的相对路径直接处理
			const readerWithoutRoot = new FileLineReader();
			const missingLines = await readerWithoutRoot.readLines("non-existent-rel.txt");
			assert.strictEqual(missingLines, undefined);

			// 4.5 尝试读取目录（触发 readFile 异常 catch 分支安全返回 undefined）
			const subDir = path.join(tmpDir, "sub-dir");
			fs.mkdirSync(subDir, { recursive: true });
			const dirReadResult = await readerWithRoot.readLines(subDir);
			assert.strictEqual(dirReadResult, undefined, "读取目录时必须捕获 EISDIR 并安全返回 undefined");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}

	// 5. 单例 defaultFileLineReader 健全性验证
	{
		assert.ok(defaultFileLineReader instanceof FileLineReader);
		assert.strictEqual(await defaultFileLineReader.readLines(""), undefined);
		defaultFileLineReader.clearCache();
	}

	console.log("  ✅ [File Line Reader] FileLineReader 单元测试全部通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runFileLineReaderTests();
}
