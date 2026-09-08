import assert from "node:assert";

class MockSceneStateManager {
	constructor() {
		this.currentActiveScenes = [];
		this.isDirty = false;
		this.isApplying = false;
		this.baselineBreakpointCount = 0;
		this.events = [];
	}

	getActiveScenes() {
		return [...this.currentActiveScenes];
	}

	isSceneActive(name) {
		return this.currentActiveScenes.includes(name);
	}

	getActiveScene() {
		return this.currentActiveScenes[0];
	}

	getIsDirty() {
		return this.isDirty;
	}

	setActiveScenes(sceneNames, initialBpCount = 0) {
		this.currentActiveScenes = Array.from(new Set(sceneNames.map((s) => s.trim()).filter(Boolean))).sort();
		this.baselineBreakpointCount = initialBpCount;
		this.isDirty = false;
		this.events.push({
			type: "change",
			activeScenes: this.currentActiveScenes,
			activeScene: this.getActiveScene(),
			isDirty: this.isDirty,
		});
	}

	setActiveScene(sceneName, initialBpCount = 0) {
		this.setActiveScenes(sceneName ? [sceneName] : [], initialBpCount);
	}

	toggleScene(sceneName) {
		const target = (sceneName || "").trim();
		if (!target) return this.getActiveScenes();
		if (this.currentActiveScenes.includes(target)) {
			return this.currentActiveScenes.filter((s) => s !== target);
		}
		return [...this.currentActiveScenes, target];
	}

	setDirty(dirty) {
		if (this.isDirty !== dirty && this.currentActiveScenes.length > 0) {
			this.isDirty = dirty;
			this.events.push({
				type: "dirtyChange",
				activeScenes: this.currentActiveScenes,
				activeScene: this.getActiveScene(),
				isDirty: this.isDirty,
			});
		}
	}

	checkDirtyWithCount(currentCount) {
		if (this.currentActiveScenes.length === 0 || this.isApplying) return;
		const dirty = currentCount !== this.baselineBreakpointCount;
		this.setDirty(dirty);
	}

	setApplyingState(applying) {
		this.isApplying = applying;
	}
}

export function runStateTests() {
	console.log("  ▶ [State] 运行状态机 SSOT 与脏状态全维边界测试套件 (包含多场景集合)...");

	// 1. 初始状态为 None 且 Clean
	const sm = new MockSceneStateManager();
	assert.deepStrictEqual(sm.getActiveScenes(), []);
	assert.strictEqual(sm.getActiveScene(), undefined);
	assert.strictEqual(sm.getIsDirty(), false);

	// 2. 无激活场景时增删断点绝不触发 Dirty (无基线场景)
	sm.checkDirtyWithCount(5);
	assert.strictEqual(sm.getIsDirty(), false, "无激活场景时不可标记为 Dirty");

	// 3. 单场景激活 SceneA 并下发 3 个断点，此时为 Clean 状态
	sm.setActiveScene("SceneA", 3);
	assert.deepStrictEqual(sm.getActiveScenes(), ["SceneA"]);
	assert.strictEqual(sm.isSceneActive("SceneA"), true);
	assert.strictEqual(sm.isSceneActive("SceneB"), false);
	assert.strictEqual(sm.getIsDirty(), false);

	// 4. 多场景复合激活 (SceneA + SceneB)，聚合断点数为 7
	sm.setActiveScenes(["SceneB", "SceneA"], 7);
	assert.deepStrictEqual(sm.getActiveScenes(), ["SceneA", "SceneB"], "必须去重并升序规范化存储");
	assert.strictEqual(sm.isSceneActive("SceneA"), true);
	assert.strictEqual(sm.isSceneActive("SceneB"), true);
	assert.strictEqual(sm.getIsDirty(), false);

	// 5. 用户在编辑器中打了一个临时断点，数量变为 8 (触发 Dirty)
	sm.checkDirtyWithCount(8);
	assert.strictEqual(sm.getIsDirty(), true, "断点数增加应触发 isDirty=true");

	// 6. 单场景独立 Toggle: 从 [SceneA, SceneB] 剔除 SceneA
	const afterRemoveA = sm.toggleScene("SceneA");
	assert.deepStrictEqual(afterRemoveA, ["SceneB"]);

	// 7. 单场景独立 Toggle: 向 [SceneB] 追加 SceneC
	sm.setActiveScenes(afterRemoveA, 4);
	const afterAddC = sm.toggleScene("SceneC");
	assert.deepStrictEqual(afterAddC, ["SceneB", "SceneC"]);

	// 8. 用户撤销操作，数量精准恢复为基线 4 (自动复位 Clean)
	sm.checkDirtyWithCount(4);
	assert.strictEqual(sm.getIsDirty(), false, "断点数精准恢复基线应自动复位 isDirty=false");

	// 9. 在装载进行中（isApplying = true），原子锁免受外部事件打扰
	sm.setApplyingState(true);
	sm.checkDirtyWithCount(0);
	assert.strictEqual(sm.getIsDirty(), false, "装载中原子锁生效，不得误触脏标记");
	sm.setApplyingState(false);

	// 10. 用户清空所有断点，完全复位为 None
	sm.setActiveScenes([], 0);
	assert.deepStrictEqual(sm.getActiveScenes(), []);
	assert.strictEqual(sm.getActiveScene(), undefined);
	// 11. 状态栏标签自适应拼接格式化测试 (formatScenesLabel)
	{
		function formatScenesLabel(scenes) {
			if (scenes.length === 0) return "(None)";
			if (scenes.length === 1) return `[${scenes[0]}]`;

			const fullLabel = `[${scenes.join(" + ")}]`;
			if (fullLabel.length <= 28) {
				return fullLabel;
			}

			if (scenes.length > 2) {
				const prefixTwo = `[${scenes[0]} + ${scenes[1]}, +${scenes.length - 2}]`;
				if (prefixTwo.length <= 28) {
					return prefixTwo;
				}
			}

			return `[${scenes[0]}, +${scenes.length - 1}]`;
		}

		// (1) 空场景
		assert.strictEqual(formatScenesLabel([]), "(None)");
		// (2) 单场景
		assert.strictEqual(formatScenesLabel(["auth"]), "[auth]");
		// (3) 双场景短名称 (<= 28 字符，完整展示)
		assert.strictEqual(formatScenesLabel(["auth", "order"]), "[auth + order]");
		// (4) 三场景短名称 (<= 28 字符，完整展示)
		assert.strictEqual(formatScenesLabel(["auth", "order", "pay"]), "[auth + order + pay]");
		// (5) 三场景长名称 (超长，优雅折叠)
		assert.strictEqual(
			formatScenesLabel(["user-auth-service", "order-query-service", "pay-callback"]),
			"[user-auth-service, +2]",
		);
	}

	console.log("  ✅ [State] 状态机 SSOT 与脏状态全维边界套件（11 大多场景核心场景）全部通过！");
}
