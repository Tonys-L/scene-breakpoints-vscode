import assert from "node:assert/strict";
import {
	normalizeFsPath,
	isSameFsPath,
	isFilePathMatch,
} from "#src/shared/utils/pathUtils.ts";

export function runPathUtilsTests() {
	console.log("  ▶ [Path Utils] 运行 pathUtils 跨平台路径标准化与匹配单元测试套件...");

	// 1. normalizeFsPath 测试
	{
		assert.strictEqual(normalizeFsPath(""), "");
		assert.strictEqual(
			normalizeFsPath("C:\\Project\\MyRepo\\src\\Foo.ts"),
			"c:/project/myrepo/src/foo.ts",
		);
		assert.strictEqual(
			normalizeFsPath("/Users/dev/repo/src/bar.ts"),
			"/users/dev/repo/src/bar.ts",
		);
		// 校验相对路径冗余段消除
		assert.strictEqual(
			normalizeFsPath("src/a/../b/foo.ts"),
			"src/b/foo.ts",
		);
	}

	// 2. isSameFsPath 跨平台等价性测试
	{
		assert.strictEqual(
			isSameFsPath("C:\\repo\\file.ts", "c:/repo/file.ts"),
			true,
			"Windows 反斜杠与小写盘符应等价",
		);
		assert.strictEqual(
			isSameFsPath("C:/REPO/FILE.TS", "c:/repo/file.ts"),
			true,
			"大小写差异应等价判定",
		);
		assert.strictEqual(
			isSameFsPath("C:/repo/a.ts", "C:/repo/b.ts"),
			false,
			"不同文件路径不得判定为相同",
		);
	}

	// 3. isFilePathMatch 场景断点与目标文件匹配测试
	{
		const workspaceRoot = "C:/projects/my-app";

		// 3.1 绝对路径完全一致
		assert.strictEqual(
			isFilePathMatch(
				"c:/projects/my-app/src/index.ts",
				"C:\\projects\\my-app\\src\\index.ts",
				workspaceRoot,
			),
			true,
		);

		// 3.2 相对断点路径在 workspaceRoot 展开后匹配
		assert.strictEqual(
			isFilePathMatch(
				"C:/projects/my-app/src/index.ts",
				"src/index.ts",
				workspaceRoot,
			),
			true,
		);

		// 3.3 相对断点路径带有反斜杠
		assert.strictEqual(
			isFilePathMatch(
				"C:/projects/my-app/src/index.ts",
				"src\\index.ts",
				workspaceRoot,
			),
			true,
		);

		// 3.4 跨 monorepo/子目录尾部后缀容错对齐 (即使无 workspaceRoot)
		assert.strictEqual(
			isFilePathMatch(
				"D:/monorepo/packages/backend/src/service.ts",
				"packages/backend/src/service.ts",
			),
			true,
		);

		// 3.5 不匹配场景拦截
		assert.strictEqual(
			isFilePathMatch(
				"C:/projects/my-app/src/other.ts",
				"src/index.ts",
				workspaceRoot,
			),
			false,
		);

		// 3.6 空入参防灾
		assert.strictEqual(isFilePathMatch("", "src/index.ts"), false);
		assert.strictEqual(isFilePathMatch("src/index.ts", ""), false);
	}

	console.log("  ✅ [Path Utils] pathUtils 单元测试全部通过！");
}

if (process.argv[1]?.endsWith("path_utils.test.mjs")) {
	runPathUtilsTests();
}
