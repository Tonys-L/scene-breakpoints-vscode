import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import {
	jsonFileSceneRepository,
	getScenesConfigPath,
	getLocalScenesConfigPath,
	loadScenesConfig,
	loadMergedScenesConfig,
	saveScenesConfig,
	saveScenesLayers,
	ensureLocalScenesGitignore,
	stripJsonComments,
	isContentMatchingLastSaved,
	getLastSavedContent,
} from "#src/infra/storage/jsonFileSceneRepository";
import { echoLoopGuard } from "#src/infra/storage/echoLoopGuard";

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
		assert.strictEqual(echoLoopGuard.isInternalSaving(), true, "saveScenesConfig 后必须处于内部写盘保护窗内");
		assert.strictEqual(
			echoLoopGuard.isContentMatchingLastSaved(fs.readFileSync(configPath, "utf-8")),
			true,
			"落盘内容必须与防回环指纹一致",
		);

		// 5. 高频连击：连续保存时最终落盘的必须是最新版本（v1.2.0 新场景缺省落 local 私有层，合并视图回读）
		saveScenesConfig(tmpRoot, { scenes: { v: 1 } });
		saveScenesConfig(tmpRoot, { scenes: { v: 2 } });
		saveScenesConfig(tmpRoot, { scenes: { v: 3 } });
		assert.strictEqual(
			fs.existsSync(getLocalScenesConfigPath(tmpRoot)),
			true,
			"溯源表缺失的新场景必须落 local 私有层文件 (INV-032)",
		);
		assert.strictEqual(
			JSON.parse(fs.readFileSync(getLocalScenesConfigPath(tmpRoot), "utf-8")).scenes.v,
			3,
			"私有层磁盘最终持久化的必须是最新的配置版本 (v: 3)",
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

		// 9. 内部写盘指纹与内容匹配辅助函数覆盖（team 层主文件键控基线）
		saveScenesConfig(tmpRoot, { scenes: { flow: [] } });
		const lastSaved = getLastSavedContent();
		assert.ok(lastSaved && lastSaved.includes('"scenes"'), "必须正确读取最近一次主文件（team 层）保存的磁盘快照");
		assert.strictEqual(
			lastSaved,
			fs.readFileSync(getScenesConfigPath(tmpRoot), "utf-8"),
			"主文件基线快照必须与磁盘 team 层内容逐字节一致",
		);
		assert.strictEqual(isContentMatchingLastSaved(lastSaved), true, "匹配相同内容必须返回 true");
		assert.strictEqual(isContentMatchingLastSaved("different content"), false, "不同内容必须返回 false");

		// 10. 持久化异常防御：写入只读或非法路径时触发安全错误弹窗
		saveScenesConfig("\0invalid-null-byte-path", { scenes: {} });
		assert.ok(
			vscode.window.messages.some((m) => m.level === "error"),
			"写入非法路径时必须向用户弹出友好错误提示",
		);
	} finally {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}

	// 11. 【v1.2.0 INV-032】分层语义：local 覆盖 team、来源溯源表、显式分层回写与 .gitignore 引导
		const layerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-layer-test-"));
		try {
			fs.mkdirSync(path.dirname(getScenesConfigPath(layerRoot)), { recursive: true });
			const teamScene = [{ file: "auth.ts", line: 10, type: "line" }];
			const localOverride = [{ file: "auth.ts", line: 99, type: "line", desc: "个人调试覆写" }];
			fs.writeFileSync(
				getScenesConfigPath(layerRoot),
				JSON.stringify({ scenes: { auth: teamScene, shared: teamScene }, activeScenes: ["auth"] }, null, 2),
				"utf-8",
			);
			fs.writeFileSync(
				getLocalScenesConfigPath(layerRoot),
				JSON.stringify({ scenes: { auth: localOverride, "temp-bug": teamScene } }, null, 2),
				"utf-8",
			);

			// (1) 合并加载：local 同名覆盖 team，team 独有场景保留
			const merged = loadMergedScenesConfig(layerRoot);
			assert.strictEqual(merged.config.scenes.auth[0].line, 99, "同名场景必须 local 覆盖 team (就近覆盖语义)");
			assert.strictEqual(merged.config.scenes.shared.length, 1, "team 独有场景必须保留");
			assert.strictEqual(merged.config.scenes["temp-bug"].length, 1, "local 独有场景必须进入合并视图");
			assert.deepStrictEqual(merged.config.activeScenes, ["auth"], "activeScenes 激活态必须仅随 team 主文件承载");
			// (2) 来源溯源表
			assert.strictEqual(merged.originByScene.auth, "local", "被覆盖场景的生效来源必须标记为 local");
			assert.strictEqual(merged.originByScene.shared, "team", "team 独有场景来源必须为 team");
			assert.strictEqual(merged.originByScene["temp-bug"], "local", "local 独有场景来源必须为 local");

			// (3) 显式分层回写：team 场景落主文件，local 场景落私有文件；local 为空时不创建私有文件
			const noLocalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-nolocal-test-"));
			try {
				fs.mkdirSync(path.dirname(getScenesConfigPath(noLocalRoot)), { recursive: true });
				saveScenesLayers(noLocalRoot, { scenes: { teamOnly: teamScene }, activeScenes: ["teamOnly"] }, { teamOnly: "team" });
				assert.strictEqual(
					JSON.parse(fs.readFileSync(getScenesConfigPath(noLocalRoot), "utf-8")).scenes.teamOnly.length,
					1,
					"team 来源场景必须落主文件",
				);
				assert.strictEqual(
					fs.existsSync(getLocalScenesConfigPath(noLocalRoot)),
					false,
					"local 层为空时严禁创建私有文件（避免无谓文件噪音）",
				);
				// local 来源场景回写
				saveScenesLayers(noLocalRoot, { scenes: { teamOnly: teamScene, mine: teamScene } }, { teamOnly: "team", mine: "local" });
				const localDisk = JSON.parse(fs.readFileSync(getLocalScenesConfigPath(noLocalRoot), "utf-8"));
				assert.deepStrictEqual(Object.keys(localDisk.scenes), ["mine"], "local 来源场景必须且仅落私有文件");
				assert.strictEqual(
					JSON.parse(fs.readFileSync(getScenesConfigPath(noLocalRoot), "utf-8")).scenes.mine,
					undefined,
					"local 来源场景严禁污染 team 主文件",
				);
			} finally {
				fs.rmSync(noLocalRoot, { recursive: true, force: true });
			}

			// (4) .gitignore 幂等引导
			assert.strictEqual(ensureLocalScenesGitignore(layerRoot), true, "缺失条目时必须追加写入并返回 true");
			const gitignoreContent = fs.readFileSync(path.join(layerRoot, ".gitignore"), "utf-8");
			assert.ok(gitignoreContent.includes(".vscode/debug-scenes.local.json"), ".gitignore 必须包含私有层文件名");
			assert.strictEqual(ensureLocalScenesGitignore(layerRoot), false, "条目已存在时必须幂等跳过并返回 false");
			const doubled = fs.readFileSync(path.join(layerRoot, ".gitignore"), "utf-8");
			assert.strictEqual(
				doubled.split("debug-scenes.local.json").length - 1,
				1,
				"幂等调用严禁重复追加条目",
			);

			// (5) 分层键控回环基线：local 层写盘后主文件基线不受干扰
			saveScenesLayers(layerRoot, merged.config.scenes.auth ? { scenes: merged.config.scenes, activeScenes: ["auth"] } : { scenes: {} }, merged.originByScene);
			assert.strictEqual(
				echoLoopGuard.isContentMatchingLastSavedForKey(getLocalScenesConfigPath(layerRoot), fs.readFileSync(getLocalScenesConfigPath(layerRoot), "utf-8")),
				true,
				"local 层写盘后必须以私有文件键记录独立基线",
			);
		} finally {
			fs.rmSync(layerRoot, { recursive: true, force: true });
		}

		console.log("  ✅ [Scene Repository] jsonFileSceneRepository 单元测试全部通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runSceneRepositoryTests();
}

