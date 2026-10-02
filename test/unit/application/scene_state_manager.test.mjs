import assert from "node:assert";
import { SceneStateManager, sceneStateManager } from "#src/application/sceneStateManager.ts";
import { formatScenesLabel } from "#src/ui/views/statusBarView.ts";

export function runStateTests() {
	console.log("  ▶ [State] 运行状态机 SSOT 与脏状态全维边界测试套件 (包含多场景集合·真实源码)...");

	// 1. 初始状态为 None 且 Clean
	const sm = new SceneStateManager();
	assert.deepStrictEqual(sm.getActiveScenes(), []);
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

	// 11. 状态栏标签自适应拼接格式化测试 (formatScenesLabel·真实源码)
	{

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

	// 12. 【变异斩杀】状态变更事件订阅、载荷校验与 Listener Dispose
	{
		const testSm = new SceneStateManager();
		const events = [];
		const subscription = testSm.onDidChangeState((e) => {
			events.push({ ...e });
		});

		testSm.setActiveScenes(["SceneX"], 2);
		assert.strictEqual(events.length, 1);
		assert.deepStrictEqual(events[0], { activeScenes: ["SceneX"], isDirty: false });

		testSm.setDirty(true);
		assert.strictEqual(events.length, 2);
		assert.deepStrictEqual(events[1], { activeScenes: ["SceneX"], isDirty: true });

		// 相同 dirty 状态不重复触发
		testSm.setDirty(true);
		assert.strictEqual(events.length, 2);

		// 退订监听
		subscription.dispose();
		testSm.setDirty(false);
		assert.strictEqual(events.length, 2, "退订后不应再收到事件");

		// 无激活场景时调用 setDirty(true) 坚决不应触发事件且不改变 isDirty
		const emptySm = new SceneStateManager();
		let emptyEventFired = false;
		emptySm.onDidChangeState(() => {
			emptyEventFired = true;
		});
		emptySm.setDirty(true);
		assert.strictEqual(emptySm.getIsDirty(), false);
		assert.strictEqual(emptyEventFired, false, "无激活场景时 setDirty 不得广播事件");
	}

	// 13. 【变异斩杀】脱靶断点（Unmatched）键集存储与大小写/反斜杠归一化
	{
		const testSm = new SceneStateManager();
		testSm.setUnmatchedBreakpoints(["src\\utils\\Math.ts:42", "src/auth.ts:10"]);

		// 正常匹配 (支持首尾空格与反斜杠)
		assert.strictEqual(testSm.isBreakpointUnmatched("src/utils/math.ts", 42), true);
		assert.strictEqual(testSm.isBreakpointUnmatched("  src/utils/math.ts  ", 42), true, "文件路径带空格必须安全 trim 匹配");
		assert.strictEqual(testSm.isBreakpointUnmatched("src\\UTILS\\MATH.ts", 42), true);
		assert.strictEqual(testSm.isBreakpointUnmatched("src/auth.ts", 10), true);

		// 不匹配
		assert.strictEqual(testSm.isBreakpointUnmatched("src/other.ts", 10), false);
		assert.strictEqual(testSm.isBreakpointUnmatched("src/auth.ts", 99), false);

		// 空参防御
		assert.strictEqual(testSm.isBreakpointUnmatched(undefined, 10), false);
		assert.strictEqual(testSm.isBreakpointUnmatched("src/auth.ts", undefined), false);
		assert.strictEqual(testSm.isBreakpointUnmatched("", 10), false);
		assert.strictEqual(testSm.isBreakpointUnmatched("src/auth.ts", 0), false);
	}

	// 14. 【变异斩杀】基线断点计数器与增量调整
	{
		const testSm = new SceneStateManager();
		assert.strictEqual(testSm.getBaselineBreakpointCount(), 0);
		testSm.setBaselineBreakpointCount(10);
		assert.strictEqual(testSm.getBaselineBreakpointCount(), 10);
		testSm.incrementActiveBaseline();
		assert.strictEqual(testSm.getBaselineBreakpointCount(), 11, "基线断点数自增必须为 +1");
	}

	// 15. 【变异斩杀】拓扑 Hash 与挂起更新状态生命周期
	{
		const testSm = new SceneStateManager();
		assert.strictEqual(testSm.getLastAppliedTopologyHash(), "");
		assert.strictEqual(testSm.isPendingTopologyUpdate(), false);

		testSm.setLastAppliedTopologyHash("hash-abc-123");
		assert.strictEqual(testSm.getLastAppliedTopologyHash(), "hash-abc-123");

		testSm.setPendingTopologyUpdate(true);
		assert.strictEqual(testSm.isPendingTopologyUpdate(), true);

		testSm.clearLastAppliedTopologyHash();
		assert.strictEqual(testSm.getLastAppliedTopologyHash(), "");

		// 级联销毁 (斩杀 _onDidChangeState.dispose 与 listeners.clear 突变体)
		let disposedListenerFired = false;
		testSm.onDidChangeState(() => {
			disposedListenerFired = true;
		});
		testSm.setLastAppliedTopologyHash("hash-xyz");
		testSm.setPendingTopologyUpdate(true);
		testSm.dispose();
		assert.strictEqual(testSm.getLastAppliedTopologyHash(), "");
		assert.strictEqual(testSm.isPendingTopologyUpdate(), false);

		// dispose 后再次触发状态流转，原监听器已被 clear，不可再收到广播
		testSm.setActiveScenes(["postDisposeScene"], 1);
		assert.strictEqual(disposedListenerFired, false, "状态机 dispose 后监听器已被清空，不得收到广播");
	}

	// 16. 【变异斩杀】场景名边界清洗、空值回退与单例实例
	{
		const testSm = new SceneStateManager();
		// 传入包含首尾空格、纯空白、空字符串的场景列表
		testSm.setActiveScenes(["  sceneA  ", "", "   ", "sceneA", "sceneB"], 5);
		assert.deepStrictEqual(testSm.getActiveScenes(), ["sceneA", "sceneB"]);
		assert.strictEqual(testSm.getActiveScene(), "sceneA");

		// setActiveScene(undefined) 清空场景
		testSm.setActiveScene(undefined);
		assert.deepStrictEqual(testSm.getActiveScenes(), []);
		assert.strictEqual(testSm.getActiveScene(), undefined);

		// toggleScene 纯空白不变更
		testSm.setActiveScenes(["scene1"]);
		assert.deepStrictEqual(testSm.toggleScene("   "), ["scene1"]);

		// isApplyingScene 查询
		assert.strictEqual(testSm.isApplyingScene(), false);
		testSm.setApplyingState(true);
		assert.strictEqual(testSm.isApplyingScene(), true);

		// 单例实例可用性断言
		assert.ok(sceneStateManager instanceof SceneStateManager);
	}

	console.log("  ✅ [State] 状态机 SSOT 与脏状态全维边界套件（16 大多场景核心场景）全部通过！");
}

if (process.argv[1]?.endsWith("scene_state_manager.test.mjs")) {
	runStateTests();
}

