import assert from "node:assert";
import { describe, it } from "node:test";
import { sceneManager, SceneManager } from "#src/application/sceneManager";
import { breakpointManager, BreakpointManager } from "#src/application/breakpointManager";

export async function runCoordinatorsTests() {
	console.log("\n  ▶ [Managers] 运行应用层专职管理器 (SceneManager & BreakpointManager) 单元测试套件...");

	const memoryDb = {
		scenes: {
			testScene: [
				{ file: "src/main.ts", line: 10, enabled: true },
				{ type: "function", functionName: "authCheck", enabled: false },
			],
		},
		activeScenes: ["testScene"],
	};

	let savedConfig = null;
	let markedInternalSaving = false;

	const mockRepo = {
		loadScenesConfig: () => JSON.parse(JSON.stringify(savedConfig || memoryDb)),
		saveScenesConfig: (_root, cfg) => {
			savedConfig = JSON.parse(JSON.stringify(cfg));
		},
	};

	const mockLoopGuard = {
		markInternalSaving: () => {
			markedInternalSaving = true;
		},
	};

	const testOpts = {
		sceneRepository: mockRepo,
		loopGuard: mockLoopGuard,
	};

	// 1. SceneManager 测试
	{
		// 创建新场景
		const created = await sceneManager.createScene("/project", "new-feature", testOpts);
		assert.strictEqual(created, true);
		assert.ok(savedConfig.scenes["new-feature"]);

		// 重复创建失败
		const duplicateCreate = await sceneManager.createScene("/project", "new-feature", testOpts);
		assert.strictEqual(duplicateCreate, false);

		// 重命名场景
		const renamed = await sceneManager.renameScene("/project", "new-feature", "renamed-feature", testOpts);
		assert.strictEqual(renamed, true);
		assert.ok(!savedConfig.scenes["new-feature"]);
		assert.ok(savedConfig.scenes["renamed-feature"]);

		// 克隆场景
		const cloned = await sceneManager.duplicateScene("/project", "renamed-feature", "cloned-feature", testOpts);
		assert.strictEqual(cloned, true);
		assert.ok(savedConfig.scenes["cloned-feature"]);

		// 导入场景
		const imported = await sceneManager.importScene("/project", "imported-scene", [{ file: "src/app.ts", line: 20 }], "overwrite", testOpts);
		assert.strictEqual(imported, true);
		assert.strictEqual(savedConfig.scenes["imported-scene"].length, 1);

		// 删除场景
		const deleted = await sceneManager.deleteScene("/project", "cloned-feature", testOpts);
		assert.strictEqual(deleted, true);
		assert.ok(!savedConfig.scenes["cloned-feature"]);
	}

	// 2. BreakpointManager 测试
	{
		// 切换断点启用状态
		const toggleRes = await breakpointManager.toggleBreakpoint("/project", "testScene", 0, false, testOpts);
		assert.strictEqual(toggleRes.success, true);
		assert.strictEqual(toggleRes.newEnabled, false);
		assert.strictEqual(savedConfig.scenes.testScene[0].enabled, false);

		// 批量启用
		const allEnabled = await breakpointManager.setAllEnabled("/project", "testScene", true, testOpts);
		assert.strictEqual(allEnabled, true);
		assert.strictEqual(savedConfig.scenes.testScene[0].enabled, true);
		assert.strictEqual(savedConfig.scenes.testScene[1].enabled, true);

		// 编辑器断点变更同步
		const syncChanged = await breakpointManager.syncBreakpointChanges("/project", [{ file: "src/main.ts", line: 10, enabled: false }], ["testScene"], testOpts);
		assert.strictEqual(syncChanged, true);
		assert.strictEqual(savedConfig.scenes.testScene[0].enabled, false);

		// 移除断点
		const removed = await breakpointManager.removeBreakpoint("/project", "testScene", 0, testOpts);
		assert.strictEqual(removed, true);
		assert.strictEqual(savedConfig.scenes.testScene.length, 1);
	}

	console.log("  ✅ [Managers] 专职管理器单元测试全部通过！");
}
