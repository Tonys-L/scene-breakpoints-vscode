import assert from "node:assert/strict";
import { Scene } from "#src/domain/models/scene.ts";
import { SceneCatalog } from "#src/domain/models/sceneCatalog.ts";
import { Breakpoint } from "#src/domain/models/breakpoint.ts";
import { findBreakpointLineInJson } from "#src/ui/locators/sceneJsonLocator.ts";

export function runSceneAndCatalogTests() {
	console.log("  ▶ [Scene & Catalog] 运行场景实体与目录聚合根全维单元测试套件 (TDD)...");

	// ----------------------------------------------------
	// 1. Scene 实体：断点生命周期与查重覆盖 (INV-001)
	// ----------------------------------------------------
	{
		const scene = new Scene("auth-flow");
		assert.strictEqual(scene.name, "auth-flow");
		assert.strictEqual(scene.getBreakpoints().length, 0);

		// A. 基础添加断点
		const bp1 = new Breakpoint({ file: "src/auth.ts", line: 10, type: "line" });
		scene.upsertBreakpoint(bp1);
		assert.strictEqual(scene.getBreakpoints().length, 1);

		// B. 查重覆盖：同一文件同一行号，必须覆盖而非追加 (INV-001)
		const bp1Updated = new Breakpoint({
			file: "src/auth.ts",
			line: 10,
			type: "condition",
			condition: "token !== null",
		});
		scene.upsertBreakpoint(bp1Updated);
		assert.strictEqual(scene.getBreakpoints().length, 1, "同位置断点必须唯一覆盖");
		assert.strictEqual(scene.getBreakpoints()[0].condition, "token !== null", "覆盖后属性必须更新");

		// C. 添加第二个不同行断点
		const bp2 = new Breakpoint({ file: "src/auth.ts", line: 20 });
		scene.upsertBreakpoint(bp2);
		assert.strictEqual(scene.getBreakpoints().length, 2);

		// D. 排序微调：下移与上移
		scene.moveBreakpoint(0, "down");
		assert.strictEqual(scene.getBreakpoints()[0].line, 20);
		assert.strictEqual(scene.getBreakpoints()[1].line, 10);

		scene.moveBreakpoint(1, "up");
		assert.strictEqual(scene.getBreakpoints()[0].line, 10);
		assert.strictEqual(scene.getBreakpoints()[1].line, 20);

		// E. 置顶与置底
		scene.moveBreakpoint(1, "top");
		assert.strictEqual(scene.getBreakpoints()[0].line, 20);
		scene.moveBreakpoint(0, "bottom");
		assert.strictEqual(scene.getBreakpoints()[1].line, 20);

		// F. 批量控制：全部禁用与全部启用
		scene.setAllEnabled(false);
		assert.ok(scene.getBreakpoints().every((b) => b.enabled === false), "必须全部设为禁用");

		scene.setAllEnabled(true);
		assert.ok(scene.getBreakpoints().every((b) => b.enabled === true), "必须全部设为启用");

		// G. 场景克隆：深拷贝
		const cloned = scene.clone("auth-flow-copy");
		assert.strictEqual(cloned.name, "auth-flow-copy");
		assert.strictEqual(cloned.getBreakpoints().length, 2);
		cloned.removeBreakpoint(0);
		assert.strictEqual(cloned.getBreakpoints().length, 1);
		assert.strictEqual(scene.getBreakpoints().length, 2, "克隆修改绝不影响源场景");

		// H. Scene.merge 静态聚合能力（先到先得排重，INV-004/011）
		const scene1 = new Scene("s1", [
			new Breakpoint({ file: "src/a.ts", line: 10, enabled: true }),
			new Breakpoint({ file: "src/b.ts", line: 20 }),
		]);
		const scene2 = new Scene("s2", [
			new Breakpoint({ file: "src/a.ts", line: 10, enabled: false }), // 重复位置：先到先得保留 scene1
			new Breakpoint({ file: "src/c.ts", line: 30 }),
		]);
		const mergedScene = Scene.merge([scene1, scene2], "combined");
		assert.strictEqual(mergedScene.name, "combined");
		assert.strictEqual(mergedScene.getBreakpoints().length, 3);
		assert.strictEqual(mergedScene.getBreakpoints()[0].enabled, true, "先到先得保证首发断点生效");

		// I. scene.mergeFrom 实例吸收合并能力
		const targetScene = new Scene("target", [new Breakpoint({ file: "src/x.ts", line: 1 })]);
		targetScene.mergeFrom(scene1);
		assert.strictEqual(targetScene.getBreakpoints().length, 3);
		// 传入纯数组形式调用 mergeFrom
		targetScene.mergeFrom([new Breakpoint({ file: "src/new.ts", line: 99 })]);
		assert.strictEqual(targetScene.getBreakpoints().length, 4);

		// J. 【变异斩杀】Scene.merge 默认名称与 null/undefined 容错过滤
		const defaultMerged = Scene.merge([null, undefined, scene1]);
		assert.strictEqual(defaultMerged.name, "merged", "默认场景合并名称必须为 'merged'");
		assert.strictEqual(defaultMerged.getBreakpoints().length, 2);

		// K. 【变异斩杀】moveBreakpoint 极值与边界拦截
		assert.strictEqual(scene.moveBreakpoint(-1, "up"), false);
		assert.strictEqual(scene.moveBreakpoint(99, "down"), false);
		assert.strictEqual(scene.moveBreakpoint(0, "top"), false, "在第 0 位置顶必须返回 false");
		assert.strictEqual(scene.moveBreakpoint(scene.getBreakpoints().length - 1, "bottom"), false, "在末位置底必须返回 false");
		assert.strictEqual(scene.moveBreakpoint(0, "up"), false, "在第 0 位上移必须返回 false");
		assert.strictEqual(scene.moveBreakpoint(scene.getBreakpoints().length - 1, "down"), false, "在末位下移必须返回 false");

		// L. 【变异斩杀】reorderBreakpoint 极值与非法入参
		assert.strictEqual(scene.reorderBreakpoint(-1, 1), false);
		assert.strictEqual(scene.reorderBreakpoint(0, 99), false);
		assert.strictEqual(scene.reorderBreakpoint(0, -1), false);
		assert.strictEqual(scene.reorderBreakpoint(99, 1), false);
		assert.strictEqual(scene.reorderBreakpoint(0, 0), false, "源与目标相同位置应返回 false");
		assert.strictEqual(scene.reorderBreakpoint(0, 1), true, "合法拖拽重排返回 true");

		// M. 【变异斩杀】toggleBreakpoint 与 toggleBreakpointEnabled
		assert.strictEqual(scene.toggleBreakpoint(-1), false);
		assert.strictEqual(scene.toggleBreakpoint(99), false);
		const prevEnabled = scene.getBreakpoints()[0].enabled;
		assert.strictEqual(scene.toggleBreakpoint(0), true);
		assert.strictEqual(scene.getBreakpoints()[0].enabled, !prevEnabled);
		assert.strictEqual(scene.toggleBreakpointEnabled(0), true);
		assert.strictEqual(scene.getBreakpoints()[0].enabled, prevEnabled);

		// N. 【变异斩杀】setAllEnabled 状态变更布尔返回值
		assert.strictEqual(scene.setAllEnabled(prevEnabled), false, "断点全部已处于目标状态时返回 false");
		assert.strictEqual(scene.setAllEnabled(!prevEnabled), true, "有状态改变时返回 true");

		// O. 【变异斩杀】getBreakpoint / removeBreakpoint 越界与 clear / toJSON
		assert.strictEqual(scene.getBreakpoint(-1), undefined);
		assert.strictEqual(scene.getBreakpoint(99), undefined);
		assert.strictEqual(scene.removeBreakpoint(-1), false);
		assert.strictEqual(scene.removeBreakpoint(99), false);
		const jsonExport = scene.toJSON();
		assert.strictEqual(jsonExport.length, scene.getBreakpoints().length);
		assert.strictEqual(jsonExport[0].file, scene.getBreakpoints()[0].file);

		// P. 【变异斩杀】syncBreakpointEnabled 启闭双向同步（函数断点与多路径归一化匹配）
		const syncScene = new Scene("sync-demo", [
			new Breakpoint({ type: "function", functionName: "authHandler", enabled: true }),
			new Breakpoint({ file: "src\\api\\order.ts", line: 42, enabled: true }),
		]);
		// (1) 函数断点启闭同步
		assert.strictEqual(syncScene.syncBreakpointEnabled({ functionName: "authHandler", enabled: false }), true);
		assert.strictEqual(syncScene.getBreakpoints()[0].enabled, false);
		assert.strictEqual(syncScene.syncBreakpointEnabled({ functionName: "authHandler", enabled: false }), false, "状态无变化返回 false");
		assert.strictEqual(syncScene.syncBreakpointEnabled({ functionName: "nonExistentFunc", enabled: true }), false);

		// (2) 源码断点绝对路径 vs 相对路径匹配（endsWith 对齐）
		assert.strictEqual(
			syncScene.syncBreakpointEnabled({ file: "D:\\workspace\\src\\api\\order.ts", line: 42, enabled: false }),
			true,
			"外部绝对路径必须匹配内部相对路径",
		);
		assert.strictEqual(syncScene.getBreakpoints()[1].enabled, false);

		// (3) 源码断点反向相对路径匹配
		assert.strictEqual(
			syncScene.syncBreakpointEnabled({ file: "order.ts", line: 42, enabled: true }),
			true,
			"外部尾部相对路径必须匹配内部较长路径",
		);
		assert.strictEqual(syncScene.getBreakpoints()[1].enabled, true);

		// (4) 行号不匹配或文件不匹配
		assert.strictEqual(syncScene.syncBreakpointEnabled({ file: "src/api/order.ts", line: 999, enabled: false }), false);
		assert.strictEqual(syncScene.syncBreakpointEnabled({ file: "src/other.ts", line: 42, enabled: false }), false);

		// Q. 【变异斩杀】backfillHealed 自愈回填是否有实质变更布尔检测
		assert.strictEqual(syncScene.backfillHealed([]), false);
		assert.strictEqual(syncScene.backfillHealed(null), false);
		// 遇到函数断点自愈不处理，无匹配返回 false
		assert.strictEqual(syncScene.backfillHealed([new Breakpoint({ type: "function", functionName: "authHandler" })]), false);
		
		// 构造一个具有指纹特征的场景，用于测试代码漂移后的行号自愈回填
		const healableBp = new Breakpoint({
			file: "src/api/order.ts",
			line: 42,
			contextSnippet: { current: "const order = await getOrder();" },
		});
		const healScene = new Scene("heal-test", [healableBp]);
		const healedTarget = new Breakpoint({
			file: "src/api/order.ts",
			line: 50,
			contextSnippet: { current: "const order = await getOrder();" },
		});
		assert.strictEqual(healScene.backfillHealed([healedTarget]), true);
		assert.strictEqual(healScene.getBreakpoints()[0].line, 50);
		// 再次回填相同断点，无实质变更返回 false
		assert.strictEqual(healScene.backfillHealed([healedTarget]), false);

		// R. 【变异斩杀】Scene 构造函数 name trim 与空值保护
		const trimmedScene = new Scene("   padded-name   ");
		assert.strictEqual(trimmedScene.name, "padded-name");
		const nullNameScene = new Scene(null);
		assert.strictEqual(nullNameScene.name, "");

		// S. setBreakpoints / clearBreakpoints
		syncScene.clearBreakpoints();
		assert.strictEqual(syncScene.getBreakpoints().length, 0);
		syncScene.setBreakpoints([new Breakpoint({ file: "new.ts", line: 1 })]);
		assert.strictEqual(syncScene.getBreakpoints().length, 1);

		// T. 【变异斩杀】moveBreakpoint 极值越界与定向移动布尔返回值
		const moveScene = new Scene("move-test", [
			new Breakpoint({ file: "a.ts", line: 1 }),
			new Breakpoint({ file: "b.ts", line: 2 }),
			new Breakpoint({ file: "c.ts", line: 3 }),
		]);
		// 索引等于 length 时必须被拦截返回 false
		assert.strictEqual(moveScene.moveBreakpoint(3, "up"), false);
		assert.strictEqual(moveScene.moveBreakpoint(-1, "down"), false);
		// 移动到顶：中间元素移至首位
		assert.strictEqual(moveScene.moveBreakpoint(1, "top"), true);
		assert.strictEqual(moveScene.getBreakpoints()[0].file, "b.ts");
		// 移动到底：首位元素移至末尾
		assert.strictEqual(moveScene.moveBreakpoint(0, "bottom"), true);
		assert.strictEqual(moveScene.getBreakpoints()[2].file, "b.ts");
		// 相邻微移：up / down 返回 true 且调整顺序
		assert.strictEqual(moveScene.moveBreakpoint(2, "up"), true);
		assert.strictEqual(moveScene.getBreakpoints()[1].file, "b.ts");
		assert.strictEqual(moveScene.moveBreakpoint(1, "down"), true);
		assert.strictEqual(moveScene.getBreakpoints()[2].file, "b.ts");

		// U. 【变异斩杀】reorderBreakpoint 边界拦截与目标索引为 0 的正常插入
		// sourceIndex 越界
		assert.strictEqual(moveScene.reorderBreakpoint(3, 1), false);
		// targetIndex 越界
		assert.strictEqual(moveScene.reorderBreakpoint(1, 3), false);
		assert.strictEqual(moveScene.reorderBreakpoint(1, -1), false);
		// targetIndex 为 0 的合法拖拽：把末尾元素拖拽至最前面
		assert.strictEqual(moveScene.reorderBreakpoint(2, 0), true);
		assert.strictEqual(moveScene.getBreakpoints().length, 3, "拖拽后数组元素总数保持不变");
		assert.strictEqual(moveScene.getBreakpoints()[0].file, "b.ts");

		// V. 【变异斩杀】toggleBreakpoint 与 setAllEnabled 的 undefined 默认值测试
		const undefScene = new Scene("undef-test", [
			new Breakpoint({ file: "u1.ts", line: 10 }), // enabled is undefined
			new Breakpoint({ file: "u2.ts", line: 20, enabled: false }),
		]);
		// 未指定 enabled 默认为 true，toggle 后必须严格变为 false
		assert.strictEqual(undefScene.toggleBreakpoint(0), true);
		assert.strictEqual(undefScene.getBreakpoints()[0].enabled, false);
		// setAllEnabled 对 undefined 默认值的判定
		const undefScene2 = new Scene("undef-test-2", [
			new Breakpoint({ file: "u3.ts", line: 30 }), // enabled is undefined
		]);
		// 设为 true 时因为默认视为 true，所以无实质变更返回 false
		assert.strictEqual(undefScene2.setAllEnabled(true), false);
		// 设为 false 产生实质变更返回 true
		assert.strictEqual(undefScene2.setAllEnabled(false), true);
		assert.strictEqual(undefScene2.getBreakpoints()[0].enabled, false);

		// W. 【变异斩杀】syncBreakpointEnabled 缺字段与伪前缀（border.ts vs order.ts）拦截
		const pathSyncScene = new Scene("path-sync", [
			new Breakpoint({ file: "src/order.ts", line: 100, enabled: true }),
			new Breakpoint({ type: "function", functionName: "calcTotal", enabled: true }),
		]);
		// 只传 file 不传 line，或只传 line 不传 file：直接返回 false
		assert.strictEqual(pathSyncScene.syncBreakpointEnabled({ file: "src/order.ts", enabled: false }), false);
		assert.strictEqual(pathSyncScene.syncBreakpointEnabled({ line: 100, enabled: false }), false);
		// 伪子路径拦截：border.ts 绝不能匹配 order.ts（验证斜杠分隔符拼接）
		assert.strictEqual(pathSyncScene.syncBreakpointEnabled({ file: "src/border.ts", line: 100, enabled: false }), false);
		// 默认 target.enabled 未传时按 true 处理
		pathSyncScene.getBreakpoints()[0].enabled = false;
		assert.strictEqual(pathSyncScene.syncBreakpointEnabled({ file: "src/order.ts", line: 100 }), true);
		assert.strictEqual(pathSyncScene.getBreakpoints()[0].enabled, true);
		// 对包含函数断点的场景执行行断点同步，函数断点不被影响
		assert.strictEqual(pathSyncScene.getBreakpoints()[1].enabled, true);

		// X. 【变异斩杀】getUnfingerprintedBreakpoints 与 backfillHealed 对函数断点和空值的隔离
		const mixedScene = new Scene("mixed-test", [
			new Breakpoint({ type: "function", functionName: "logFn" }),
			new Breakpoint({ file: "foo.ts", line: 10 }), // 未提取指纹的行断点
		]);
		const unfp = mixedScene.getUnfingerprintedBreakpoints();
		assert.strictEqual(unfp.length, 1);
		assert.strictEqual(unfp[0].file, "foo.ts");
		// backfillHealed 对包含函数断点的场景，即使传入自愈数组也不会影响函数断点
		assert.strictEqual(mixedScene.backfillHealed([]), false);

		// Y. 【变异斩杀】mergeFrom 先到先得排重策略覆盖
		const mergeTarget = new Scene("merge-target", [
			new Breakpoint({ file: "common.ts", line: 1 }),
		]);
		const mergeSource = new Scene("merge-source", [
			new Breakpoint({ file: "common.ts", line: 1 }), // 重复断点，必须被过滤
			new Breakpoint({ file: "unique.ts", line: 2 }), // 新断点，必须被吸收
		]);
		mergeTarget.mergeFrom(mergeSource);
		assert.strictEqual(mergeTarget.getBreakpoints().length, 2);
		assert.strictEqual(mergeTarget.getBreakpoints()[1].file, "unique.ts");
		// 传入纯数组形式的 mergeFrom
		mergeTarget.mergeFrom([
			new Breakpoint({ file: "common.ts", line: 1 }),
			new Breakpoint({ file: "extra.ts", line: 3 }),
		]);
		assert.strictEqual(mergeTarget.getBreakpoints().length, 3);
		assert.strictEqual(mergeTarget.getBreakpoints()[2].file, "extra.ts");

		// Z. 【变异斩杀】getBreakpoint 边界斩杀、removeBreakpoint 极值与 setBreakpoints 默认值转换
		const boundaryScene = new Scene("boundary-test", [
			new Breakpoint({ file: "first.ts", line: 10 }),
			new Breakpoint({ file: "last.ts", line: 20 }),
		]);
		// getBreakpoint 越界与合法索引
		assert.strictEqual(boundaryScene.getBreakpoint(-1), undefined);
		assert.strictEqual(boundaryScene.getBreakpoint(2), undefined); // index === length
		assert.strictEqual(boundaryScene.getBreakpoint(3), undefined); // index > length
		assert.strictEqual(boundaryScene.getBreakpoint(0)?.file, "first.ts");
		assert.strictEqual(boundaryScene.getBreakpoint(1)?.file, "last.ts");

		// removeBreakpoint 边界与正常删除
		assert.strictEqual(boundaryScene.removeBreakpoint(2), false); // index === length
		assert.strictEqual(boundaryScene.removeBreakpoint(-1), false);
		assert.strictEqual(boundaryScene.removeBreakpoint(0), true);
		assert.strictEqual(boundaryScene.getBreakpoints().length, 1);
		assert.strictEqual(boundaryScene.getBreakpoints()[0].file, "last.ts");

		// toggleBreakpointEnabled 边界
		assert.strictEqual(boundaryScene.toggleBreakpoint(1), false); // 当前只有 1 个断点，index 1 越界

		// setBreakpoints 默认参数与纯 DTO 实例化
		boundaryScene.setBreakpoints([{ file: "raw-dto.ts", line: 99, type: "line" }]);
		assert.strictEqual(boundaryScene.getBreakpoints().length, 1);
		assert.ok(boundaryScene.getBreakpoints()[0] instanceof Breakpoint, "传入纯对象必须自动提升为 Breakpoint 充血实体");
		// 不传参时默认赋空数组
		boundaryScene.setBreakpoints();
		assert.strictEqual(boundaryScene.getBreakpoints().length, 0);

		// syncBreakpointEnabled 源码断点相同状态幂等返回 false
		const noopSyncScene = new Scene("noop-sync", [
			new Breakpoint({ file: "src/api.ts", line: 15, enabled: true }),
		]);
		assert.strictEqual(noopSyncScene.syncBreakpointEnabled({ file: "src/api.ts", line: 15, enabled: true }), false, "状态无改变必须返回 false");

		// AA. 【变异斩杀】getUnfingerprintedBreakpoints 对函数断点的绝对隔离
		const funcWithLineScene = new Scene("func-line-test", [
			new Breakpoint({ type: "function", functionName: "testFn", file: "foo.ts", line: 10 }),
		]);
		assert.strictEqual(
			funcWithLineScene.getUnfingerprintedBreakpoints().length,
			0,
			"函数断点即使携带 file 和 line 也绝不能被识别为待指纹化行断点",
		);

		// AB. 【变异斩杀】backfillHealed 忽略函数断点
		const funcHealScene = new Scene("func-heal", [
			new Breakpoint({ type: "function", functionName: "testFn", file: "foo.ts", line: 10 }),
		]);
		assert.strictEqual(
			funcHealScene.backfillHealed([new Breakpoint({ file: "foo.ts", line: 20 })]),
			false,
			"函数断点绝不能参与行断点自愈回填",
		);

		// AC. 【变异斩杀】syncBreakpointEnabled 假函数名与缺行号拦截
		const trickySyncScene = new Scene("tricky-sync", [
			new Breakpoint({ type: "line", file: "src/main.ts", line: 10, functionName: "submit", enabled: true }),
			new Breakpoint({ file: "src/dirty.ts", line: undefined, enabled: true }),
		]);
		// 行断点携带 functionName 时，严禁用函数断点匹配器将其误伤
		assert.strictEqual(
			trickySyncScene.syncBreakpointEnabled({ functionName: "submit", enabled: false }),
			false,
			"非函数断点即使包含 functionName 字段也绝不能被函数同步器匹配",
		);
		assert.strictEqual(trickySyncScene.getBreakpoints()[0].enabled, true);

		// target.line 为 undefined 或缺少 line 时，严禁穿透匹配
		assert.strictEqual(
			trickySyncScene.syncBreakpointEnabled({ file: "src/dirty.ts", line: undefined, enabled: false }),
			false,
			"缺少有效数字行号时严禁匹配脏断点",
		);

		// AD. 【变异斩杀】syncBreakpointEnabled Windows 反斜杠与伪前缀（path-order.ts vs order.ts）
		const pathSlashScene = new Scene("path-slash", [
			new Breakpoint({ file: "src\\utils\\date.ts", line: 5, enabled: true }),
			new Breakpoint({ file: "src/path-order.ts", line: 10, enabled: true }),
		]);
		// 反斜杠替换为正斜杠验证（击杀 replace(/\\/g, "") 突变体）
		assert.strictEqual(
			pathSlashScene.syncBreakpointEnabled({ file: "src/utils/date.ts", line: 5, enabled: false }),
			true,
			"正反斜杠归一化必须正常命中",
		);
		assert.strictEqual(pathSlashScene.getBreakpoints()[0].enabled, false);

		// 伪子串隔离：order.ts 绝不可匹配 path-order.ts（击杀 endsWith("" + normBp) 突变体）
		assert.strictEqual(
			pathSlashScene.syncBreakpointEnabled({ file: "order.ts", line: 10, enabled: false }),
			false,
			"无目录分隔符的短名绝不可部分匹配长文件名",
		);
		assert.strictEqual(
			pathSlashScene.syncBreakpointEnabled({ file: "d:/project/src/path-order.ts", line: 10, enabled: false }),
			true,
			"带斜杠前缀的合法父目录匹配成功",
		);
	}

	// ----------------------------------------------------
	// 2. SceneCatalog 聚合根：场景管理与全量生命周期
	// ----------------------------------------------------
	{
		const catalog = new SceneCatalog({
			scenes: {
				order: [
					{ file: "src/order.ts", line: 15, type: "line" },
				],
				pay: [
					{ file: "src/pay.ts", line: 30, type: "line" },
				],
			},
			activeScenes: ["order"],
			bindings: {
				"Launch Pay": "pay",
			},
		});

		assert.strictEqual(catalog.getSceneNames().length, 2);
		assert.ok(catalog.hasScene("order"));
		assert.ok(catalog.hasScene("ORDER"), "场景名查询必须大小写容错匹配");

		// A. 场景重命名：联动更新 bindings
		const renamed = catalog.renameScene("pay", "payment");
		assert.strictEqual(renamed, true);
		assert.ok(catalog.hasScene("payment"));
		assert.strictEqual(catalog.hasScene("pay"), false);
		assert.strictEqual(catalog.getBindings()["Launch Pay"], "payment", "bindings 必须联动重命名");

		// B. 场景删除：联动清理 bindings
		const deleted = catalog.deleteScene("payment");
		assert.strictEqual(deleted, true);
		assert.strictEqual(catalog.hasScene("payment"), false);
		assert.strictEqual(catalog.getBindings()["Launch Pay"], undefined, "bindings 必须联动清除");

		// C. 场景克隆与目标文件过滤 (INV-004)
		catalog.getOrCreateScene("source-scene").upsertBreakpoint(new Breakpoint({ file: "src/file1.ts", line: 10 }));
		catalog.getOrCreateScene("source-scene").upsertBreakpoint(new Breakpoint({ file: "src/file2.ts", line: 20 }));
		const dupAll = catalog.duplicateScene("source-scene", "dup-all");
		assert.strictEqual(dupAll, true);
		assert.strictEqual(catalog.getScene("dup-all").getBreakpoints().length, 2);

		const dupFiltered = catalog.duplicateScene("source-scene", "dup-filtered", "src/file1.ts");
		assert.strictEqual(dupFiltered, true);
		assert.strictEqual(catalog.getScene("dup-filtered").getBreakpoints().length, 1);
		assert.strictEqual(catalog.getScene("dup-filtered").getBreakpoints()[0].file, "src/file1.ts");
	}

	// ----------------------------------------------------
	// 3. SceneCatalog 聚合根：幽灵防御与先到先得合并 (INV-009, INV-004, INV-011)
	// ----------------------------------------------------
	{
		const catalog = new SceneCatalog({
			scenes: {
				sceneA: [
					{ file: "src/common.ts", line: 10, condition: "fromA" },
					{ file: "src/a.ts", line: 1 },
				],
				sceneB: [
					// 冲突断点：与 sceneA 的 common.ts:10 冲突
					{ file: "src/common.ts", line: 10, condition: "fromB" },
					{ file: "src/b.ts", line: 2 },
				],
			},
			activeScenes: [],
		});

		// 幽灵场景防御 (INV-009)
		const ghostResult = catalog.activate(["ghost-scene"]);
		assert.strictEqual(ghostResult.success, false, "幽灵场景必须拦截激活");
		assert.deepStrictEqual(ghostResult.missingScenes, ["ghost-scene"]);
		assert.strictEqual(catalog.getActiveScenes().length, 0, "拦截后 activeScenes 严禁被篡改");

		// 多场景叠加激活与先到先得合并策略 (INV-004, INV-011)
		const validResult = catalog.activate(["sceneA", "sceneB"]);
		assert.strictEqual(validResult.success, true);
		assert.deepStrictEqual(catalog.getActiveScenes(), ["sceneA", "sceneB"]);

		// 获取叠加合并后的全量断点 (通过 Scene.merge 组合)
		const activeScenes = catalog.getActiveScenes().map((n) => catalog.getScene(n));
		const mergedBreakpoints = Scene.merge(activeScenes).getBreakpoints();
		assert.strictEqual(mergedBreakpoints.length, 3, "共 3 处唯一物理断点");

		// 冲突断点必须先到先得保留前序 sceneA 的属性
		const commonBp = mergedBreakpoints.find((b) => b.file === "src/common.ts");
		assert.ok(commonBp);
		assert.strictEqual(commonBp.condition, "fromA", "冲突断点必须先到先得保留 sceneA 的属性");
	}

	// ----------------------------------------------------
	// 4. Scene 实体：多场景自愈回填闭环 (Backfill)
	// ----------------------------------------------------
	{
		const catalog = new SceneCatalog({
			scenes: {
				sceneA: [
					{
						file: "src/calc.ts",
						line: 10,
						contextSnippet: { current: "const healed = true;" },
					},
				],
				sceneB: [{ file: "src/utils.ts", line: 20 }],
			},
			activeScenes: ["sceneA", "sceneB"],
		});


		// 模拟 Bridge 返回了自愈修正后的断点与新指纹
		const healedBreakpoints = [
			new Breakpoint({
				file: "src/calc.ts",
				line: 12, // 漂移到了第 12 行
				contextSnippet: { current: "const healed = true;" },
			}),
		];

		let hasChanged = false;
		for (const sceneName of catalog.getActiveScenes()) {
			const scene = catalog.getScene(sceneName);
			if (scene && scene.backfillHealed(healedBreakpoints)) {
				hasChanged = true;
			}
		}
		assert.strictEqual(hasChanged, true, "回填发生了实质变动必须返回 true");

		// 验证 sceneA 内的原始断点是否被精准回填
		const sceneA = catalog.getScene("sceneA");
		assert.ok(sceneA);
		const bp = sceneA.getBreakpoints()[0];
		assert.strictEqual(bp.line, 12, "sceneA 内断点行号必须已自动同步回填");
		assert.strictEqual(bp.contextSnippet?.current, "const healed = true;");
	}

	// ----------------------------------------------------
	// 5. SceneCatalog 聚合根：全场景未激活静默加固 (Enrich All)
	// ----------------------------------------------------
	{
		const catalog = new SceneCatalog({
			scenes: {
				scene1: [{ file: "src/a.ts", line: 2 }], // 无指纹
				scene2: [{ file: "src/b.ts", line: 3 }], // 无指纹
			},
			activeScenes: [], // 全未激活
		});

		const mockFiles = {
			"src/a.ts": ["// comment", "export const A = 1;"],
			"src/b.ts": ["// comment", "// line 2", "export const B = 2;"],
		};

		const unfingerprinted = catalog.getAllScenes().flatMap((s) => s.getUnfingerprintedBreakpoints());
		assert.strictEqual(unfingerprinted.length, 2, "必须精准查询出两个未提取指纹的断点");

		for (const bp of unfingerprinted) {
			const lines = mockFiles[bp.file];
			if (lines) {
				bp.enrich(lines);
			}
		}

		assert.strictEqual(catalog.getScene("scene1").getBreakpoints()[0].contextSnippet?.current, "export const A = 1;");
		assert.strictEqual(catalog.getScene("scene2").getBreakpoints()[0].contextSnippet?.current, "export const B = 2;");

		// 再次查询未提取断点，必须为 0
		const remaining = catalog.getAllScenes().flatMap((s) => s.getUnfingerprintedBreakpoints());
		assert.strictEqual(remaining.length, 0, "再次查询未加固断点必须为 0");

		// ----------------------------------------------------
		// 8. 边缘分支防灾与覆盖率提升
		// ----------------------------------------------------
		const testScene = catalog.getScene("scene1");
		assert.strictEqual(testScene.moveBreakpoint(-1, "up"), false);
		assert.strictEqual(testScene.moveBreakpoint(99, "down"), false);
		assert.strictEqual(testScene.toggleBreakpoint(-1), false);
		assert.strictEqual(testScene.toggleBreakpoint(99), false);
		assert.strictEqual(testScene.toggleBreakpoint(0), true);

		// Scene.syncBreakpointEnabled 相对路径与后缀匹配
		const mockEpBps = [
			{ file: "/project/src/a.ts", line: 2, enabled: true },
		];
		const syncUpdated = testScene.syncBreakpointEnabled(mockEpBps[0]);
		assert.strictEqual(syncUpdated, true);

		// findBreakpointLineInJson 各分支
		const sampleJson = JSON.stringify({
			scenes: {
				scene1: [
					{ file: "src/a.ts", line: 2 },
					{ type: "function", functionName: "login" }
				]
			}
		}, null, 2);

		const line1 = findBreakpointLineInJson(sampleJson, "scene1", { type: "line", file: "src/a.ts", line: 2 });
		assert.ok(line1 > 1);

		const lineFn = findBreakpointLineInJson(sampleJson, "scene1", { type: "function", functionName: "login" });
		assert.ok(lineFn > 1);

		const notFoundLine = findBreakpointLineInJson(sampleJson, "scene1", { type: "line", file: "non-existent.ts", line: 999 });
		assert.ok(notFoundLine >= 1);
	}

	// ----------------------------------------------------
	// 6. SceneCatalog 聚合根：精准变异斩杀套件 (Stryker Killers)
	// ----------------------------------------------------
	{
		// A. 构造函数空载荷与纯净度
		const emptyCatalog = SceneCatalog.fromConfig();
		assert.strictEqual(emptyCatalog.getAllScenes().length, 0);
		assert.strictEqual(emptyCatalog.getSceneNames().length, 0);
		const emptyJson = emptyCatalog.toJSON();
		assert.deepStrictEqual(emptyJson.scenes, {});
		assert.strictEqual("$schema" in emptyJson, false);
		assert.strictEqual("activeScenes" in emptyJson, false);
		assert.strictEqual("bindings" in emptyJson, false);

		// 带 $schema 与显式空 activeScenes
		const explicitActiveCatalog = new SceneCatalog({
			$schema: "https://example.com/schema.json",
			activeScenes: [],
			scenes: {
				valid: [],
				// @ts-ignore 非数组断点列表应被防御跳过
				invalid: null,
			},
		});
		assert.strictEqual(explicitActiveCatalog.getSceneNames().length, 1);
		const explicitJson = explicitActiveCatalog.toJSON();
		assert.strictEqual(explicitJson.$schema, "https://example.com/schema.json");
		assert.deepStrictEqual(explicitJson.activeScenes, [], "显式传入 activeScenes 时 toJSON 必须导出空数组");

		// B. findExactSceneName、getScene 与 getOrCreateScene
		assert.strictEqual(explicitActiveCatalog.findExactSceneName(null), undefined);
		assert.strictEqual(explicitActiveCatalog.findExactSceneName(""), undefined);
		assert.strictEqual(explicitActiveCatalog.findExactSceneName("   "), undefined);
		assert.strictEqual(explicitActiveCatalog.getScene(""), undefined);
		assert.strictEqual(explicitActiveCatalog.getScene("nonExistent"), undefined);

		// getOrCreateScene trim 与缓存复用
		const createdScene = explicitActiveCatalog.getOrCreateScene("   newScene   ");
		assert.strictEqual(createdScene.name, "newScene");
		assert.strictEqual(explicitActiveCatalog.hasScene("newScene"), true);
		assert.strictEqual(explicitActiveCatalog.getOrCreateScene("newScene"), createdScene, "已存在时必须返回既有实例");

		// C. renameScene 极值与 bindings 级联深度验证
		const renameCatalog = new SceneCatalog({
			scenes: {
				alpha: [{ file: "a.ts", line: 1 }],
				beta: [{ file: "b.ts", line: 2 }],
				keepScene: [{ file: "k.ts", line: 3 }],
			},
			activeScenes: ["keepScene", "alpha"],
			bindings: {
				strBinding: "alpha",
				arrBinding: ["alpha", "beta"],
			},
		});
		// 旧场景不存在 / 新名称为空 / 新名称为非法类型 / 新名称已存在
		assert.strictEqual(renameCatalog.renameScene("nonExistent", "gamma"), false);
		assert.strictEqual(renameCatalog.renameScene("alpha", "   "), false);
		// @ts-ignore 非字符串 newName
		assert.strictEqual(renameCatalog.renameScene("alpha", null), false);
		assert.strictEqual(renameCatalog.renameScene("alpha", "beta"), false);
		// 正常重命名：只有 alpha 被替换，keepScene 保持不变（击杀 true ? trimmedNew : s 变异）
		assert.strictEqual(renameCatalog.renameScene("alpha", "  alphaRenamed  "), true);
		assert.strictEqual(renameCatalog.hasScene("alphaRenamed"), true);
		assert.strictEqual(renameCatalog.hasScene("alpha"), false);
		assert.deepStrictEqual(renameCatalog.getActiveScenes(), ["keepScene", "alphaRenamed"]);
		assert.strictEqual(renameCatalog.getBindings().strBinding, "alphaRenamed");
		assert.deepStrictEqual(renameCatalog.getBindings().arrBinding, ["alphaRenamed", "beta"]);

		// D. deleteScene 极值与 bindings 数组清空与非空保留
		assert.strictEqual(renameCatalog.deleteScene("nonExistent"), false);
		// 删除 beta：arrBinding 数组中还剩 alphaRenamed，因此保留键
		assert.strictEqual(renameCatalog.deleteScene("beta"), true);
		assert.deepStrictEqual(renameCatalog.getBindings().arrBinding, ["alphaRenamed"]);
		// 删除 alphaRenamed：strBinding 被删除，arrBinding 变为空数组也被彻底删除
		// activeScenes 中删除 alphaRenamed，keepScene 必须被保留（击杀 filter(() => undefined) 与 s === exactName 变异）
		assert.strictEqual(renameCatalog.deleteScene("alphaRenamed"), true);
		assert.strictEqual("strBinding" in renameCatalog.getBindings(), false);
		assert.strictEqual("arrBinding" in renameCatalog.getBindings(), false);
		assert.deepStrictEqual(renameCatalog.getActiveScenes(), ["keepScene"], "被删除场景移出激活列表，其余激活场景必须完好保留");

		// E. duplicateScene 伪路径前缀拦截、函数断点过滤与反斜杠容错
		const dupCatalog = new SceneCatalog({
			scenes: {
				orderScene: [
					{ type: "function", functionName: "auth" },
					{ file: "src/api/order.ts", line: 10 },
					{ file: "src/api/border.ts", line: 10 },
				],
			},
		});
		// 目标名为空 / 源场景不存在 / 目标场景已存在
		assert.strictEqual(dupCatalog.duplicateScene("orderScene", "   "), false);
		assert.strictEqual(dupCatalog.duplicateScene("ghost", "newScene"), false);
		assert.strictEqual(dupCatalog.duplicateScene("orderScene", "orderScene"), false);
		// @ts-ignore 非字符串目标名称
		assert.strictEqual(dupCatalog.duplicateScene("orderScene", null), false);

		// 携带目标文件过滤：反斜杠输入、函数断点过滤与伪路径 border.ts 对抗
		assert.strictEqual(dupCatalog.duplicateScene("orderScene", "dupFiltered", "src\\api\\order.ts"), true);
		const dupScene = dupCatalog.getScene("dupFiltered");
		assert.ok(dupScene);
		// 必须只包含 order.ts，绝不可包含 auth 函数断点与 border.ts 伪子路径
		assert.strictEqual(dupScene.getBreakpoints().length, 1);
		assert.strictEqual(dupScene.getBreakpoints()[0].file, "src/api/order.ts");

		// F. activate 与 clearActive 显式持久化标记
		const actCatalog = new SceneCatalog({
			scenes: {
				sc1: [],
				sc2: [],
			},
		});
		// 重复目标场景名激活自动排重
		const actResult = actCatalog.activate(["sc1", "sc1", "SC1"]);
		assert.strictEqual(actResult.success, true);
		assert.deepStrictEqual(actResult.validTargetScenes, ["sc1"], "激活列表必须排重");

		// 全幽灵场景激活：success: false，validTargetScenes 必须严格为空数组
		const allGhostResult = actCatalog.activate(["ghostA", "ghostB"]);
		assert.strictEqual(allGhostResult.success, false);
		assert.strictEqual(allGhostResult.validTargetScenes.length, 0);
		assert.deepStrictEqual(allGhostResult.missingScenes, ["ghostA", "ghostB"]);

		// clearActive 必须设置 hasExplicitActiveScenes = true，使 toJSON 包含 activeScenes: []
		actCatalog.clearActive();
		assert.strictEqual(actCatalog.getActiveScenes().length, 0);
		const clearedJson = actCatalog.toJSON();
		assert.ok("activeScenes" in clearedJson, "clearActive 后 toJSON 必须包含 activeScenes 键");
		assert.deepStrictEqual(clearedJson.activeScenes, []);

		// H. 【变异斩杀】SceneCatalog 构造函数非对象 scenes 保护与 findExactSceneName 边界
		// @ts-ignore
		const nonObjCatalog = new SceneCatalog({ scenes: "invalid" });
		assert.strictEqual(nonObjCatalog.getAllScenes().length, 0, "非对象 scenes 必须防御为空");

		// findExactSceneName 空白 trim、非字符串与类型安全（击杀 name.toLowerCase() 与 false 变异）
		assert.strictEqual(actCatalog.findExactSceneName("  sc1  "), "sc1", "必须支持两端空格 trim 容错");
		// @ts-ignore
		assert.strictEqual(actCatalog.findExactSceneName(12345), undefined);
		// @ts-ignore
		assert.strictEqual(actCatalog.findExactSceneName({}), undefined);
		// @ts-ignore
		assert.strictEqual(actCatalog.findExactSceneName(null), undefined);

		// I. 【变异斩杀】activate 后 toJSON 导出 activeScenes 数组元素忠实性（击杀 res.activeScenes = [] 变异）
		const activatedCatalog = new SceneCatalog({
			scenes: { mainFlow: [{ file: "main.ts", line: 1 }] },
		});
		assert.strictEqual(activatedCatalog.activate(["mainFlow"]).success, true);
		const activatedJson = activatedCatalog.toJSON();
		assert.strictEqual(activatedJson.activeScenes?.length, 1);
		assert.strictEqual(activatedJson.activeScenes?.[0], "mainFlow", "toJSON 必须忠实导出激活场景数组元素");

		// J. 【变异斩杀】duplicateScene 对 file 为 undefined 的断点防御
		const corruptCatalog = new SceneCatalog({
			scenes: {
				corruptScene: [
					// @ts-ignore
					{ line: 5 }, // file is undefined
					{ file: "valid.ts", line: 10 },
				],
			},
		});
		assert.strictEqual(corruptCatalog.duplicateScene("corruptScene", "clonedCorrupt", "valid.ts"), true);
		const clonedValid = corruptCatalog.getScene("clonedCorrupt");
		assert.strictEqual(clonedValid?.getBreakpoints().length, 1);
		assert.strictEqual(clonedValid?.getBreakpoints()[0].file, "valid.ts");
	}

	console.log("  ✅ [Scene & Catalog] 场景实体与目录聚合根全维单元测试全部通过！");
}

if (
	process.argv[1]?.endsWith("scene_catalog.test.mjs") ||
	import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`
) {
	runSceneAndCatalogTests();
}

