import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import {
	jsonFileSceneRepository,
	getScenesConfigPath,
	loadScenesConfig,
	saveScenesConfig,
	stripJsonComments,
} from "#src/infra/storage/jsonFileSceneRepository";
import { saveLoopGuard } from "#src/infra/storage/saveLoopGuard";

export async function runSceneRepositoryTests() {
	console.log("  ▶ [Scene Repository] 运行 jsonFileSceneRepository 磁盘持久化单元测试套件（真实源码）...");

	__resetMockVscodeState();
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-storage-test-"));

	try {
		// 1. 配置文件路径推导
		const configPath = getScenesConfigPath(tmpRoot);
		assert.strictEqual(configPath, path.join(tmpRoot, ".vscode", "debug-scenes.json"));

		// 2. 文件不存在时安全返回空配置
		assert.deepStrictEqual(
			jsonFileSceneRepository.loadScenesConfig(tmpRoot),
			{ scenes: {} },
			"配置文件不存在时必须返回空场景配置",
		);

		// 3. 常规保存与回读
		const config = {
			scenes: { auth: [{ file: "auth.ts", line: 10, type: "line" }] },
			activeScenes: ["auth"],
		};
		saveScenesConfig(tmpRoot, config);
		assert.strictEqual(fs.existsSync(configPath), true, "saveScenesConfig 必须真实落盘");

		const loaded = loadScenesConfig(tmpRoot);
		assert.strictEqual(loaded.scenes.auth[0].file, "auth.ts");
		assert.strictEqual(loaded.scenes.auth[0].line, 10);
		assert.deepStrictEqual(loaded.activeScenes, ["auth"], "activeScenes 权威 SSOT 必须随盘持久化并回读");

		// 4. 写盘防回环守卫：保存后必须标记内部写盘保护窗与内容指纹 (INV-008)
		assert.strictEqual(saveLoopGuard.isInternalSaving(), true, "saveScenesConfig 后必须处于内部写盘保护窗内");
		assert.strictEqual(
			saveLoopGuard.isContentMatchingLastSaved(fs.readFileSync(configPath, "utf-8")),
			true,
			"落盘内容必须与防回环指纹一致",
		);

		// 5. 高频连击：连续保存时最终落盘的必须是最新版本
		saveScenesConfig(tmpRoot, { scenes: { v: 1 } });
		saveScenesConfig(tmpRoot, { scenes: { v: 2 } });
		saveScenesConfig(tmpRoot, { scenes: { v: 3 } });
		assert.strictEqual(
			JSON.parse(fs.readFileSync(configPath, "utf-8")).scenes.v,
			3,
			"磁盘最终持久化的必须是最新的配置版本 (v: 3)",
		);

		// 6. JSONC 容错：注释与尾随逗号必须被剥离后正常解析
		const jsoncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-jsonc-test-"));
		try {
			fs.mkdirSync(path.dirname(getScenesConfigPath(jsoncRoot)), { recursive: true });
			fs.writeFileSync(
				getScenesConfigPath(jsoncRoot),
				`{
					// 场景注释
					"scenes": {
						"auth": [ /* 行内注释 */ { "file": "a.ts", "line": 3, } ]
					}
				}`,
				"utf-8",
			);
			const jsoncLoaded = loadScenesConfig(jsoncRoot);
			assert.strictEqual(jsoncLoaded.scenes.auth[0].line, 3, "JSONC 注释与尾随逗号必须被容错解析");
		} finally {
			fs.rmSync(jsoncRoot, { recursive: true, force: true });
		}

		// 7. stripJsonComments 工具函数单元边界
		assert.strictEqual(stripJsonComments(""), "{}", "空字符串必须安全回退为合法的空对象 JSON '{}'");
		assert.strictEqual(stripJsonComments('{"a": 1} // comment'), '{"a": 1}');
		assert.strictEqual(stripJsonComments('{"a": 1 /* multi */, "b": 2}'), '{"a": 1 , "b": 2}');

		// 8. Git 冲突标记防御：冲突文件必须拒绝解析并保持既有断点安全
		const conflictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-conflict-test-"));
		try {
			fs.mkdirSync(path.dirname(getScenesConfigPath(conflictRoot)), { recursive: true });
			fs.writeFileSync(
				getScenesConfigPath(conflictRoot),
				"<<<<<<< HEAD\n\"scenes\": {}\n=======\n\"scenes\": {}\n>>>>>>> branch\n",
				"utf-8",
			);
			const conflictLoaded = loadScenesConfig(conflictRoot);
			assert.deepStrictEqual(conflictLoaded, { scenes: {} }, "Git 冲突内容必须拒绝解析并返回空配置");
			assert.ok(
				vscode.window.messages.some((m) => m.level === "error"),
				"冲突防御必须向用户推送错误提示",
			);
		} finally {
			fs.rmSync(conflictRoot, { recursive: true, force: true });
		}
	} finally {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}

	console.log("  ✅ [Scene Repository] jsonFileSceneRepository 单元测试全部通过！");
}
