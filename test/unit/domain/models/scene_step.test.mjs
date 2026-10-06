import assert from "node:assert/strict";
import { Scene } from "#src/domain/models/scene";
import { Breakpoint } from "#src/domain/models/breakpoint";
import { SceneRef } from "#src/domain/models/sceneRef";

export function runSceneStepTests() {
	console.log("  ▶ [Scene Step] 运行场景步骤多态模型 (SceneStep/SceneRef/Scene 步骤化) 测试套件...");

	// ----------------------------------------------------
	// 1. SceneRef 实体协议行为 (matches / toggle / toJSON / from)
	// ----------------------------------------------------
	{
		const ref = new SceneRef("child-scene", "子场景引用", true);

		// kind 标识
		assert.strictEqual(ref.kind, "scene-ref");

		// matches：仅同名引用判等
		assert.strictEqual(ref.matches(new SceneRef("child-scene")), true, "同名引用必须判等");
		assert.strictEqual(ref.matches(new SceneRef("other-scene")), false, "异名引用不可判等");
		assert.strictEqual(
			ref.matches(new Breakpoint({ file: "a.ts", line: 1 })),
			false,
			"引用与断点永不判等",
		);

		// toggle：翻转 enabled
		assert.strictEqual(ref.enabled, true);
		ref.toggle();
		assert.strictEqual(ref.enabled, false, "toggle 必须翻转引用启闭状态");
		ref.toggle();
		assert.strictEqual(ref.enabled, true);
	}

	// ----------------------------------------------------
	// 2. SceneRef.toJSON 落盘最小形状 (缺省键不落盘)
	// ----------------------------------------------------
	{
		const def = new SceneRef("s1").toJSON();
		assert.deepStrictEqual(def, { type: "scene", name: "s1" }, "enabled=true 与 desc 缺省不得落盘");

		const full = new SceneRef("s2", "描述", false).toJSON();
		assert.deepStrictEqual(
			full,
			{ type: "scene", name: "s2", desc: "描述", enabled: false },
			"非缺省 desc/enabled 必须落盘",
		);
		assert.strictEqual(
			SceneRef.from({ type: "scene", name: "s3", desc: "  x  " }).desc,
			"x",
			"from 工厂必须修剪 desc 空白",
		);
	}

	// ----------------------------------------------------
	// 3. SceneRef.from 工厂校验 (name 非空 + 规范化)
	// ----------------------------------------------------
	{
		assert.strictEqual(SceneRef.from({ type: "scene", name: "  " }), undefined, "空 name 必须拒绝");
		assert.strictEqual(SceneRef.from({ type: "scene" }), undefined, "缺 name 必须拒绝");
		assert.strictEqual(SceneRef.from(undefined), undefined, "非法入参必须拒绝");

		const ok = SceneRef.from({ type: "scene", name: " s ", enabled: false });
		assert.ok(ok instanceof SceneRef);
		assert.strictEqual(ok.name, "s", "name 必须修剪空白");
		assert.strictEqual(ok.enabled, false);
		assert.strictEqual(ok.desc, undefined);

		const normalized = SceneRef.from({ type: "scene", name: "t", enabled: true });
		assert.strictEqual(normalized.enabled, true, "enabled 非 false 一律规范化为 true");
	}

	// ----------------------------------------------------
	// 4. Scene 构造多态适配 (实体直存 / DTO 适配 / 非法项丢弃)
	// ----------------------------------------------------
	{
		const bpEntity = new Breakpoint({ file: "a.ts", line: 1 });
		const scene = new Scene("mixed", [
			bpEntity,
			{ type: "line", file: "b.ts", line: 2 },
			{ type: "scene", name: "child-a" },
			{ type: "scene", name: "   " },
			null,
		]);

		const steps = scene.getSteps();
		assert.strictEqual(steps.length, 3, "非法引用与 null 项必须被丢弃");
		assert.strictEqual(steps[0], bpEntity, "Breakpoint 实例必须原样直存");
		assert.strictEqual(steps[0].kind, "breakpoint");
		assert.ok(steps[1] instanceof Breakpoint, "裸断点 DTO 必须适配为 Breakpoint 实体");
		assert.strictEqual(steps[1].kind, "breakpoint");
		assert.ok(steps[2] instanceof SceneRef, "引用 DTO 必须适配为 SceneRef 实体");
		assert.strictEqual(steps[2].kind, "scene-ref");

		assert.strictEqual(scene.hasSceneRefs(), true, "含引用场景必须被识别");
		assert.strictEqual(new Scene("pure", [bpEntity]).hasSceneRefs(), false, "纯断点场景不含引用");
	}

	// ----------------------------------------------------
	// 5. upsertStep INV-001 同位置查重覆盖 (先到先得位置保持)
	// ----------------------------------------------------
	{
		const scene = new Scene("inv001", [
			{ type: "line", file: "a.ts", line: 1 },
			{ type: "scene", name: "child-x" },
		]);

		// 新断点追加
		const bp = new Breakpoint({ file: "c.ts", line: 3 });
		assert.strictEqual(scene.upsertStep(bp), true, "新断点必须追加并返回 true");

		// 同位置断点覆盖 (顺序保持)
		const dupBp = new Breakpoint({ file: "A.ts", line: 1 });
		assert.strictEqual(scene.upsertStep(dupBp), false, "命中断点必须覆盖并返回 false");
		let steps = scene.getSteps();
		assert.strictEqual(steps[0], dupBp, "覆盖后必须保持原索引位置");
		assert.strictEqual(steps.length, 3, "覆盖不得增加步骤数");

		// 同名引用覆盖
		const dupRef = new SceneRef("child-x");
		assert.strictEqual(scene.upsertStep(dupRef), false, "同名引用必须覆盖并返回 false");
		steps = scene.getSteps();
		assert.strictEqual(steps[1], dupRef, "引用覆盖必须保持原索引位置");

		// 断点与引用互不查重
		assert.strictEqual(scene.upsertStep(new SceneRef("c.ts")), true, "引用不得与同名断点判等");
		assert.strictEqual(
			scene.upsertStep(new Breakpoint({ file: "child-x", line: 9 })),
			true,
			"断点不得与同名引用判等",
		);
	}

	// ----------------------------------------------------
	// 6. toggleStep / setAllStepsEnabled 混合步骤多态启闭
	// ----------------------------------------------------
	{
		const scene = new Scene("toggle", [
			{ type: "line", file: "a.ts", line: 1 },
			{ type: "scene", name: "child-a" },
			{ type: "line", file: "b.ts", line: 2, enabled: false },
		]);

		assert.strictEqual(scene.toggleStep(0), true, "断点步骤 toggle 必须成功");
		assert.strictEqual(scene.getSteps()[0].enabled, false);
		assert.strictEqual(scene.toggleStep(1), true, "引用步骤 toggle 必须成功");
		assert.strictEqual(scene.getSteps()[1].enabled, false);
		assert.strictEqual(scene.toggleStep(99), false, "越界 toggle 必须返回 false");

		// 批量全开
		assert.strictEqual(scene.setAllStepsEnabled(true), true, "存在未启用步骤时必须返回 true");
		let steps = scene.getSteps();
		assert.strictEqual(steps[0].enabled, true);
		assert.strictEqual(steps[1].enabled, true);
		assert.strictEqual(steps[2].enabled, true, "禁用断点必须被批量启用");

		// 批量全关后幂等
		assert.strictEqual(scene.setAllStepsEnabled(false), true);
		assert.strictEqual(scene.setAllStepsEnabled(false), false, "状态已一致时必须返回 false (幂等)");
		steps = scene.getSteps();
		assert.ok(steps.every((s) => s.enabled === false), "混合步骤必须全部禁用");
	}

	// ----------------------------------------------------
	// 7. toJSON 混合步骤保真往返 (JSON → Scene → JSON 恒等)
	// ----------------------------------------------------
	{
		const original = [
			{ type: "line", file: "a.ts", line: 1, enabled: true },
			{ type: "scene", name: "child-a", desc: "d1" },
			{ type: "function", functionName: "fn1", enabled: false },
			{ type: "scene", name: "child-b", enabled: false },
		];
		const scene = new Scene("roundtrip", original);
		const exported = scene.toJSON();

		assert.strictEqual(exported.length, 4, "混合步骤必须全量导出");
		assert.deepStrictEqual(exported[0], original[0], "断点项必须保真");
		assert.deepStrictEqual(exported[1], { type: "scene", name: "child-a", desc: "d1" }, "引用项必须保真");
		assert.deepStrictEqual(exported[2], original[2], "函数断点必须保真");
		assert.deepStrictEqual(exported[3], original[3], "禁用引用必须保真 enabled=false");

		// 二次往返恒等
		const secondPass = new Scene("roundtrip2", exported).toJSON();
		assert.deepStrictEqual(secondPass, exported, "往返必须幂等恒等");
	}

	// ----------------------------------------------------
	// 8. merge 仅吸收具象断点 (引用不参与合并，防止声明污染)
	// ----------------------------------------------------
	{
		const sceneA = new Scene("a", [
			{ type: "line", file: "a.ts", line: 1 },
			{ type: "scene", name: "shared" },
		]);
		const sceneB = new Scene("b", [
			{ type: "line", file: "b.ts", line: 2 },
			{ type: "scene", name: "shared" },
		]);

		const merged = Scene.merge([sceneA, sceneB]);
		assert.strictEqual(merged.hasSceneRefs(), false, "合并结果必须是纯断点视图场景");
		const steps = merged.getSteps();
		assert.strictEqual(steps.length, 2, "引用不得参与合并");
		assert.ok(steps.every((s) => s.kind === "breakpoint"));
	}

	// ----------------------------------------------------
	// 9. clone 引用重建与 backfillHealed 引用隔离
	// ----------------------------------------------------
	{
		const scene = new Scene("origin", [
			{ type: "line", file: "a.ts", line: 1, contextSnippet: { current: "const a = 1;" } },
			{ type: "scene", name: "child" },
		]);

		const cloned = scene.clone("copy");
		assert.strictEqual(cloned.name, "copy");
		const clonedSteps = cloned.getSteps();
		assert.strictEqual(clonedSteps.length, 2);
		assert.ok(clonedSteps[0] instanceof Breakpoint);
		assert.ok(clonedSteps[0] !== scene.getSteps()[0], "断点必须深拷贝");
		assert.ok(clonedSteps[1] instanceof SceneRef);
		assert.ok(clonedSteps[1] !== scene.getSteps()[1], "引用必须重建实例");
		assert.strictEqual(clonedSteps[1].name, "child", "引用语义必须保持");

		// 自愈回填跳过引用 (引用无物理身份，仅具象断点经指纹匹配回填)
		const healed = new Breakpoint({
			file: "a.ts",
			line: 5,
			contextSnippet: { current: "const a = 1;" },
		});
		assert.strictEqual(scene.backfillHealed([healed]), true, "指纹命中的具象断点必须回填");
		assert.strictEqual(scene.getSteps()[0].line, 5, "回填后行号必须校准");
		const refStep = scene.getSteps()[1];
		assert.ok(refStep instanceof SceneRef);
		assert.strictEqual(refStep.enabled, true, "回填不得影响引用步骤启闭状态");
	}

	console.log("  ✅ [Scene Step] 场景步骤多态模型测试全部通过！");
}

// 直跑守卫：node test/unit/domain/models/scene_step.test.mjs
if (process.argv[1] && process.argv[1].endsWith("scene_step.test.mjs")) {
	runSceneStepTests();
}
