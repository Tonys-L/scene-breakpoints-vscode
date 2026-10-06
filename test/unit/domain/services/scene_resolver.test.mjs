import assert from "node:assert/strict";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";
import {
	CircularReferenceError,
	expandScene,
	expandScenes,
} from "#src/domain/services/sceneResolver";

/** 快捷构造：从场景字典 DTO 构建目录聚合根 */
function makeCatalog(scenesDict) {
	return SceneCatalog.fromConfig({ scenes: scenesDict });
}

export function runSceneResolverTests() {
	console.log("  ▶ [Scene Resolver] 运行场景引用展开解析器 (expandScene/expandScenes/环检测/降级容错) 测试套件...");

	// ----------------------------------------------------
	// U1. 无引用场景：输出 = 原断点流，零警告，顺序一致 + 实体引用语义（非克隆）
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			root: [
				{ type: "line", file: "src\\a.ts", line: 1 },
				{ type: "function", functionName: "fnA" },
				{ type: "line", file: "src/b.ts", line: 2, enabled: false },
			],
		});
		const res = expandScene(catalog, "root");

		assert.strictEqual(res.steps.length, 3, "无引用场景必须逐条直出");
		assert.strictEqual(res.warnings.length, 0, "无引用场景零警告");

		// 严格声明序
		assert.strictEqual(res.steps[0].breakpoint.file, "src/a.ts");
		assert.strictEqual(res.steps[0].breakpoint.line, 1);
		assert.strictEqual(res.steps[1].breakpoint.type, "function");
		assert.strictEqual(res.steps[1].breakpoint.functionName, "fnA");
		assert.strictEqual(res.steps[2].breakpoint.file, "src/b.ts");
		assert.strictEqual(res.steps[2].breakpoint.enabled, false, "禁用断点不被 resolver 过滤（物理层职责）");

		// 溯源信息：ownerScene = 根场景，refPath = [根场景]
		assert.strictEqual(res.steps[0].ownerScene, "root");
		assert.deepStrictEqual(res.steps[0].refPath, ["root"]);

		// 实体引用语义：breakpoint 是源场景实体引用（非克隆）
		const srcStep = catalog.getScene("root").getSteps()[0];
		assert.strictEqual(res.steps[0].breakpoint, srcStep, "快路径输出必须为源实体引用");
	}

	// ----------------------------------------------------
	// U2. 单层引用：引用位置替换为子场景断点，时序穿插正确（设计 §1.1 样例）
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			"auth-core": [
				{ type: "line", file: "src/auth.ts", line: 12 },
				{ type: "line", file: "src/session.ts", line: 45 },
			],
			"payment-debug": [
				{ type: "scene", name: "auth-core" },
				{ type: "line", file: "src/payment.ts", line: 40 },
				{ type: "condition", file: "src/payment.ts", line: 88, condition: "amount > 1000" },
			],
		});
		const res = expandScene(catalog, "payment-debug");

		const flat = res.steps.map((s) => `${s.breakpoint.file}:${s.breakpoint.line}`);
		assert.deepStrictEqual(
			flat,
			["src/auth.ts:12", "src/session.ts:45", "src/payment.ts:40", "src/payment.ts:88"],
			"引用必须按声明位置原位展开，穿插顺序即执行顺序",
		);
		assert.strictEqual(res.warnings.length, 0);

		// 溯源：auth-core 断点 ownerScene=auth-core、refPath 含引用链；payment 自有断点 ownerScene=payment-debug
		assert.strictEqual(res.steps[0].ownerScene, "auth-core");
		assert.deepStrictEqual(res.steps[0].refPath, ["payment-debug", "auth-core"]);
		assert.strictEqual(res.steps[2].ownerScene, "payment-debug");
		assert.deepStrictEqual(res.steps[2].refPath, ["payment-debug"]);

		// 实体引用语义（dfs 路径同样非克隆）
		const srcStep = catalog.getScene("auth-core").getSteps()[0];
		assert.strictEqual(res.steps[0].breakpoint, srcStep, "dfs 展开输出必须为源实体引用");
	}

	// ----------------------------------------------------
	// U3. 嵌套引用 A→B→C：深度优先展开，refPath 逐层累积
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			A: [{ type: "scene", name: "B" }, { type: "line", file: "a.ts", line: 1 }],
			B: [{ type: "scene", name: "C" }],
			C: [{ type: "line", file: "c.ts", line: 3 }],
		});
		const res = expandScene(catalog, "A");

		assert.deepStrictEqual(
			res.steps.map((s) => s.breakpoint.file),
			["c.ts", "a.ts"],
			"深度优先：先展开引用子树，再继续本场景后续断点",
		);
		assert.deepStrictEqual(res.steps[0].refPath, ["A", "B", "C"], "refPath 逐层累积");
		assert.strictEqual(res.steps[0].ownerScene, "C", "ownerScene 为断点定义所在场景");
		assert.deepStrictEqual(res.steps[1].refPath, ["A"]);
		assert.strictEqual(res.warnings.length, 0);
	}

	// ----------------------------------------------------
	// U4. 自引用 A→A：CircularReferenceError，cyclePath = ["A","A"]
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({ A: [{ type: "scene", name: "A" }] });

		assert.throws(() => expandScene(catalog, "A"), (err) => {
			assert.ok(err instanceof CircularReferenceError, "必须抛出 CircularReferenceError");
			assert.deepStrictEqual(err.cyclePath, ["A", "A"]);
			assert.ok(String(err.message).includes("A"), "错误消息应包含环路径");
			return true;
		});
	}

	// ----------------------------------------------------
	// U5. 互引 A→B→A：cyclePath = ["A","B","A"]（从环入口截取，无前缀噪声）
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			A: [{ type: "scene", name: "B" }],
			B: [{ type: "scene", name: "A" }],
		});

		assert.throws(() => expandScene(catalog, "A"), (err) => {
			assert.ok(err instanceof CircularReferenceError);
			assert.deepStrictEqual(err.cyclePath, ["A", "B", "A"]);
			return true;
		});
	}

	// ----------------------------------------------------
	// U6. 长环 A→B→C→A：cyclePath 完整呈现
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			A: [{ type: "scene", name: "B" }],
			B: [{ type: "scene", name: "C" }],
			C: [{ type: "scene", name: "A" }],
		});

		assert.throws(() => expandScene(catalog, "A"), (err) => {
			assert.ok(err instanceof CircularReferenceError);
			assert.deepStrictEqual(err.cyclePath, ["A", "B", "C", "A"]);
			return true;
		});
	}

	// ----------------------------------------------------
	// U7. 悬空 A→X（X 不存在）：警告 dangling-ref，X 跳过，其余断点正常输出
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			A: [
				{ type: "line", file: "a1.ts", line: 1 },
				{ type: "scene", name: "X" },
				{ type: "line", file: "a2.ts", line: 2 },
			],
		});
		const res = expandScene(catalog, "A");

		assert.deepStrictEqual(res.warnings, [
			{ code: "dangling-ref", refName: "X", refPath: ["A"] },
		]);
		assert.deepStrictEqual(
			res.steps.map((s) => s.breakpoint.file),
			["a1.ts", "a2.ts"],
			"悬空引用降级不阻断，其余断点正常下发",
		);
	}

	// ----------------------------------------------------
	// U8. 禁用引用 A→(B, enabled:false)：B 整棵子树跳过（含 B 自身的引用子树）
	// U13. disabled 优先于 dangling：B 内部悬空引用不产生 warning
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			A: [{ type: "scene", name: "B", enabled: false }, { type: "line", file: "a.ts", line: 1 }],
			B: [{ type: "line", file: "b.ts", line: 2 }, { type: "scene", name: "X" }],
		});
		const res = expandScene(catalog, "A");

		assert.deepStrictEqual(res.warnings, [
			{ code: "disabled-ref", refName: "B", refPath: ["A"] },
		], "禁用引用仅产生信息级 disabled-ref，且内部悬空 X 不被报告（子树未进入）");
		assert.deepStrictEqual(
			res.steps.map((s) => s.breakpoint.file),
			["a.ts"],
			"禁用引用整棵子树（含下游）全部跳过",
		);
	}

	// ----------------------------------------------------
	// U9. 菱形 DAG A→B,C；B,C→D：INV-011 先到先得，D 仅展开 1 次
	// （以 §3.2 参考实现 + 语义规则表为准：seen 全程持久；§3.4 "D 展开 2 次"为 1.0 遗留表述）
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			A: [{ type: "scene", name: "B" }, { type: "scene", name: "C" }],
			B: [{ type: "scene", name: "D" }],
			C: [{ type: "scene", name: "D" }],
			D: [{ type: "line", file: "d.ts", line: 4 }],
		});
		const res = expandScene(catalog, "A");

		assert.strictEqual(res.steps.length, 1, "菱形共享子场景按 INV-011 先到先得仅展开 1 次");
		assert.deepStrictEqual(res.steps[0].refPath, ["A", "B", "D"], "保留首个到达路径的溯源链");
		assert.strictEqual(res.steps[0].ownerScene, "D");
		assert.strictEqual(res.warnings.length, 0);
	}

	// ----------------------------------------------------
	// U10. 跨场景先到先得：expandScenes 多根同位置断点仅首个保留（INV-011）
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			s1: [
				{ type: "line", file: "shared.ts", line: 10 },
				{ type: "line", file: "s1.ts", line: 1 },
			],
			s2: [
				{ type: "line", file: "shared.ts", line: 10 },
				{ type: "line", file: "s2.ts", line: 2 },
			],
		});
		const res = expandScenes(catalog, ["s1", "s2"]);

		assert.strictEqual(res.steps.length, 3, "跨根同位置断点仅保留首个");
		assert.deepStrictEqual(
			res.steps.map((s) => s.breakpoint.file),
			["shared.ts", "s1.ts", "s2.ts"],
		);
		assert.strictEqual(res.steps[0].ownerScene, "s1");
		assert.strictEqual(res.warnings.length, 0);
	}

	// ----------------------------------------------------
	// U11. 深度链 32 层不抛 / 33 层触发深度上限 CircularReferenceError
	// ----------------------------------------------------
	{
		function buildChain(depth) {
			const scenes = {};
			for (let i = 1; i < depth; i++) {
				scenes[`L${i}`] = [{ type: "scene", name: `L${i + 1}` }];
			}
			scenes[`L${depth}`] = [{ type: "line", file: "deep.ts", line: 1 }];
			return scenes;
		}

		const ok = expandScene(makeCatalog(buildChain(32)), "L1");
		assert.strictEqual(ok.steps.length, 1, "32 层深度链在上限内必须正常展开");
		assert.strictEqual(ok.steps[0].refPath.length, 32);
		assert.strictEqual(ok.warnings.length, 0);

		assert.throws(() => expandScene(makeCatalog(buildChain(33)), "L1"), (err) => {
			assert.ok(err instanceof CircularReferenceError, "超限必须以成环错误显式失败");
			assert.strictEqual(err.cyclePath.length, 33, "cyclePath 携带完整链路");
			return true;
		});
	}

	// ----------------------------------------------------
	// U12. 多根共享子场景：跨根共享 seen，B 断点仅展开 1 次（与现 merge 语义一致）
	// （§3.4 "每棵独立展开"为 1.0 遗留表述，以 §3.2 实现级修正记录为准）
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			scene1: [{ type: "scene", name: "B" }],
			scene2: [{ type: "scene", name: "B" }],
			B: [{ type: "line", file: "b.ts", line: 1 }],
		});
		const res = expandScenes(catalog, ["scene1", "scene2"]);

		assert.strictEqual(res.steps.length, 1, "跨根共享子场景按先到先得仅展开 1 次");
		assert.strictEqual(res.steps[0].ownerScene, "B");
		assert.deepStrictEqual(res.steps[0].refPath, ["scene1", "B"], "保留首根的溯源链");
	}

	// ----------------------------------------------------
	// U14. 环与悬空并存：环优先抛错（DFS 先到达环则直接失败）
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			A: [{ type: "scene", name: "B" }, { type: "scene", name: "X" }],
			B: [{ type: "scene", name: "A" }],
		});

		assert.throws(() => expandScene(catalog, "A"), (err) => {
			assert.ok(err instanceof CircularReferenceError, "环必须优先显式失败");
			assert.deepStrictEqual(err.cyclePath, ["A", "B", "A"]);
			return true;
		});
	}

	// ----------------------------------------------------
	// 边界：expandScene 根场景缺失 → dangling-ref 警告 + 空输出（防御性兜底）
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({ A: [{ type: "line", file: "a.ts", line: 1 }] });
		const res = expandScene(catalog, "ghost");

		assert.deepStrictEqual(res.steps, []);
		assert.deepStrictEqual(res.warnings, [{ code: "dangling-ref", refName: "ghost", refPath: [] }]);
	}

	// ----------------------------------------------------
	// 边界：expandScenes 幽灵根静默跳过（catalog.activate 已过滤，防御性兜底）
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			s1: [{ type: "line", file: "s1.ts", line: 1 }],
		});
		const res = expandScenes(catalog, ["s1", "ghost"]);

		assert.strictEqual(res.steps.length, 1);
		assert.strictEqual(res.steps[0].ownerScene, "s1");
		assert.strictEqual(res.warnings.length, 0, "幽灵根不产生警告（上游 INV-009 已过滤）");
	}

	// ----------------------------------------------------
	// 边界：大小写容错（INV-009）——声明名与目录键大小写不一致仍可解析
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			"Auth-Core": [{ type: "line", file: "auth.ts", line: 1 }],
			entry: [{ type: "scene", name: "auth-core" }, { type: "line", file: "e.ts", line: 2 }],
		});
		const res = expandScene(catalog, "ENTRY");

		assert.strictEqual(res.steps.length, 2);
		assert.strictEqual(res.steps[0].breakpoint.file, "auth.ts");
		assert.strictEqual(res.warnings.length, 0);
	}

	// ----------------------------------------------------
	// 边界：空场景与空多根输入
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({ empty: [] });
		const res1 = expandScene(catalog, "empty");
		assert.deepStrictEqual(res1.steps, []);
		assert.strictEqual(res1.warnings.length, 0);

		const res2 = expandScenes(catalog, []);
		assert.deepStrictEqual(res2.steps, []);
		assert.strictEqual(res2.warnings.length, 0);
	}

	// ----------------------------------------------------
	// 语义锚定：breakpointKey 与 Breakpoint.matches 判据一致
	// （function 断点按 functionName 判等；源断点按归一化 file + line 判等）
	// ----------------------------------------------------
	{
		const catalog = makeCatalog({
			s1: [{ type: "function", functionName: "handleSubmit" }],
			s2: [{ type: "function", functionName: "handleSubmit" }],
		});
		const res = expandScenes(catalog, ["s1", "s2"]);
		assert.strictEqual(res.steps.length, 1, "function 断点跨根按 functionName 先到先得");
		assert.strictEqual(res.steps[0].breakpoint.functionName, "handleSubmit");

		const catalog2 = makeCatalog({
			s1: [{ type: "line", file: "src\\X.ts", line: 5 }],
			s2: [{ type: "line", file: "src/x.ts", line: 5 }],
		});
		const res2 = expandScenes(catalog2, ["s1", "s2"]);
		assert.strictEqual(res2.steps.length, 1, "源断点跨根按归一化 file+line 先到先得（大小写/斜杠不敏感）");
	}

	console.log("  ✓ [Scene Resolver] 场景引用展开解析器全矩阵测试通过");
}

if (process.argv[1] && process.argv[1].endsWith("scene_resolver.test.mjs")) {
	runSceneResolverTests();
}
