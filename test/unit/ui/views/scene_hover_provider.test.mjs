import assert from "node:assert";
import * as vscode from "vscode";
import {
	SceneHoverProvider,
	SceneEvaluatableExpressionProvider,
	findAssignmentEqualIndex,
	isNonEvaluatableLinePosition,
	extractEvaluatableChain,
} from "#src/ui/views/sceneHoverProvider.ts";
import { sceneStateManager } from "#src/application/sceneStateManager.ts";
import { activeBreakpointIndex } from "#src/application/activeBreakpointIndex.ts";
import { setLatestWatchResults, clearLatestWatchResults } from "#src/application/debugPauseContext.ts";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";

export async function runSceneHoverProviderTests() {
	console.log("  ▶ [Hover Provider] 运行 SceneHoverProvider 全行悬停测试套件（直连生产源码）...");

	const wsRoot = "d:/mock-hover-ws";

	function createMockDoc(filePath, lines = [], scheme = "file") {
		return {
			uri: {
				scheme,
				fsPath: filePath,
				path: filePath,
			},
			lineCount: lines.length,
			lineAt: (lineIndex) => ({
				text: lines[lineIndex] || "",
			}),
		};
	}

	// 1. 非 file scheme 文档返回 undefined
	{
		__resetMockVscodeState();
		const provider = new SceneHoverProvider();
		const doc = createMockDoc("output:extension-output", ["some text"], "output");
		const hover = provider.provideHover(doc, new vscode.Position(0, 0), {});
		assert.strictEqual(hover, undefined, "非 file scheme 绝不产生 Hover");
	}

	// 2. 无激活场景返回 undefined
	{
		sceneStateManager.setActiveScenes([], 1);
		const provider = new SceneHoverProvider();
		const doc = createMockDoc("d:/mock-hover-ws/src/app.ts", ["const a = 1;"]);
		const hover = provider.provideHover(doc, new vscode.Position(0, 0), {});
		assert.strictEqual(hover, undefined, "无激活场景时不产生 Hover");
	}

	// 3. 命中断点行：返回覆盖整行的 Hover，且包含步骤与描述
	{
		sceneStateManager.setActiveScenes(["checkout-scene"], 1);
		activeBreakpointIndex.sync(
			wsRoot,
			{
				"checkout-scene": [
					{
						type: "line",
						file: "src/checkout.ts",
						line: 10,
						desc: "订单金额计算",
						watch: ["amount", "user.token"],
					},
				],
			},
			["checkout-scene"],
		);

		const provider = new SceneHoverProvider();
		const doc = createMockDoc("d:/mock-hover-ws/src/checkout.ts", [
			"// 1",
			"// 2",
			"// 3",
			"// 4",
			"// 5",
			"// 6",
			"// 7",
			"// 8",
			"// 9",
			"const total = calculateTotal();", // 10
		]);

		// 未命中断点行（如第 1 行）返回 undefined
		const nonHitHover = provider.provideHover(doc, new vscode.Position(0, 0), {});
		assert.strictEqual(nonHitHover, undefined, "未命中断点物理行必须返回 undefined");

		// 命中断点行（第 10 行，0-based 为 9）在行首悬停 (col: 0)
		const hitHoverAtStart = provider.provideHover(doc, new vscode.Position(9, 0), {});
		assert.ok(hitHoverAtStart, "行首悬停必须稳定触发场景断点 Hover");
		assert.strictEqual(hitHoverAtStart.range.start.line, 9);
		assert.strictEqual(hitHoverAtStart.range.start.character, 0);
		assert.strictEqual(hitHoverAtStart.range.end.character, "const total = calculateTotal();".length, "Hover 范围必须覆盖整行代码");

		// 检查未求值时包含圆点列表
		const mdStr = hitHoverAtStart.contents.value;
		assert.ok(mdStr.includes("### 💡 Scene Breakpoint: checkout-scene"));
		assert.ok(mdStr.includes("订单金额计算"));
		assert.ok(mdStr.includes("- `amount`"));
		assert.ok(mdStr.includes("- `user.token`"));
	}

	// 4. 包含变量监视且有求值报错时：正确渲染表格与详细错误提示
	{
		clearLatestWatchResults();
		setLatestWatchResults("d:/mock-hover-ws/src/checkout.ts", 10, [
			{ expression: "amount", value: "99.5", isMatched: true },
			{
				expression: "user.token",
				value: "<error>",
				error: "ReferenceError: user is not defined\n    at eval (eval at <anonymous>)",
			},
		]);

		const provider = new SceneHoverProvider();
		const doc = createMockDoc("d:/mock-hover-ws/src/checkout.ts", [
			"// 1", "// 2", "// 3", "// 4", "// 5", "// 6", "// 7", "// 8", "// 9",
			"const total = calculateTotal();",
		]);

		const hover = provider.provideHover(doc, new vscode.Position(9, 15), {});
		assert.ok(hover, "行中悬停必须命中 Hover");
		const md = hover.contents.value;
		assert.ok(md.includes("| Expression | Value | Expected | Status |"), "必须渲染 Markdown 表格头部");
		assert.ok(md.includes("`amount` | `99.5` | - | ✅"), "正常求值项展示真实值与状态");
		assert.ok(
			md.includes("`user.token` | `<error: ReferenceError: user is not defined>` | - | ⚠️ Error"),
			"报错项必须在表格中展开具体首行错误信息，拒绝黑盒",
		);

		clearLatestWatchResults();
	}

	// 5. SceneEvaluatableExpressionProvider：阻断行首空白、关键字、声明左值与已监视变量的原生 undefined 抢焦
	{
		sceneStateManager.setActiveScenes(["checkout-scene"], 1);
		activeBreakpointIndex.sync(
			wsRoot,
			{
				"checkout-scene": [
					{
						type: "line",
						file: "src/agent-loop.ts",
						line: 2,
						desc: "初始化循环上下文",
						watch: ["watchedVar"],
					},
				],
			},
			["checkout-scene"],
		);

		const evalProvider = new SceneEvaluatableExpressionProvider();
		const doc = createMockDoc("d:/mock-hover-ws/src/agent-loop.ts", [
			"import { foo } from './foo';",
			"  let currentContext: AgentContext = initialContext.clone(watchedVar); // comment",
			"  let uninitializedOnly: SomeType | undefined;",
		]);

		// A. 非 file scheme 返回 undefined
		const nonFileDoc = createMockDoc("output:test", ["let a = 1;"], "output");
		assert.strictEqual(
			evalProvider.provideEvaluatableExpression(nonFileDoc, new vscode.Position(0, 4), {}),
			undefined,
		);

		// B. import / type 声明行返回 undefined
		assert.strictEqual(
			evalProvider.provideEvaluatableExpression(doc, new vscode.Position(0, 9), {}),
			undefined,
			"import 语句行不应触发调试求值",
		);

		// C. 断点行行首缩进空白 (col: 0, 1) 返回 undefined（使 VS Code 回退展示 SceneHoverProvider）
		assert.strictEqual(
			evalProvider.provideEvaluatableExpression(doc, new vscode.Position(1, 0), {}),
			undefined,
			"行首缩进空白必须返回 undefined 以阻断 column 1 弹出原生 undefined 浮窗",
		);

		// D. 断点行行首关键字 `let` (col: 2..4) 返回 undefined
		assert.strictEqual(
			evalProvider.provideEvaluatableExpression(doc, new vscode.Position(1, 3), {}),
			undefined,
			"let 关键字必须返回 undefined",
		);

		// E. 断点行赋值等号左侧尚未执行的声明变量 `currentContext` (col: 8) 与类型注解 `AgentContext` (col: 24) 返回 undefined
		assert.strictEqual(
			evalProvider.provideEvaluatableExpression(doc, new vscode.Position(1, 8), {}),
			undefined,
			"本行尚未执行的声明左值 currentContext 必须返回 undefined",
		);
		assert.strictEqual(
			evalProvider.provideEvaluatableExpression(doc, new vscode.Position(1, 24), {}),
			undefined,
			"TS 类型注解必须返回 undefined",
		);

		// F. 无初始化器的声明行 `let uninitializedOnly: SomeType | undefined;` 整行返回 undefined
		assert.strictEqual(
			evalProvider.provideEvaluatableExpression(doc, new vscode.Position(2, 8), {}),
			undefined,
		);

		// G. 断点行上的函数调用名 `clone`（后接 `(`）返回 undefined，回退展示场景断点卡片
		const cloneCol = doc.lineAt(1).text.indexOf("clone") + 1;
		assert.strictEqual(
			evalProvider.provideEvaluatableExpression(doc, new vscode.Position(1, cloneCol), {}),
			undefined,
			"断点行上的函数调用名应回退展示场景断点卡片",
		);

		// H. 已在断点 watch 列表中的变量 `watchedVar` 返回 undefined，由 SceneHoverProvider 表格统一呈现
		const watchedCol = doc.lineAt(1).text.indexOf("watchedVar") + 2;
		assert.strictEqual(
			evalProvider.provideEvaluatableExpression(doc, new vscode.Position(1, watchedCol), {}),
			undefined,
			"已在 Watch 列表中的变量应回退展示包含 Watch 表格的场景断点卡片",
		);

		// I. 断点行等号右侧未在 watch 列表中的普通已赋值对象 `initialContext`：正常返回 EvaluatableExpression
		const rhsCol = doc.lineAt(1).text.indexOf("initialContext") + 2;
		const rhsEval = evalProvider.provideEvaluatableExpression(doc, new vscode.Position(1, rhsCol), {});
		assert.ok(rhsEval, "等号右侧正常变量应返回 EvaluatableExpression");
		assert.strictEqual(rhsEval.expression, "initialContext");

		// J. 行尾注释区域返回 undefined
		const commentCol = doc.lineAt(1).text.indexOf("comment") + 1;
		assert.strictEqual(
			evalProvider.provideEvaluatableExpression(doc, new vscode.Position(1, commentCol), {}),
			undefined,
			"注释区域必须返回 undefined",
		);

		// K. 纯函数边界测试
		assert.strictEqual(findAssignmentEqualIndex("a == b && c !== d && e => f"), -1);
		assert.strictEqual(findAssignmentEqualIndex("let a = 1"), 6);
		assert.strictEqual(isNonEvaluatableLinePosition("type Foo = string;", 5), true);
		assert.strictEqual(extractEvaluatableChain("  return a?.b.c;", -1), undefined);
		assert.strictEqual(extractEvaluatableChain("  return a?.b.c;", 99), undefined);
		assert.strictEqual(extractEvaluatableChain("  return a?.b.c;", 3), undefined);
		assert.strictEqual(extractEvaluatableChain("  typeof.bar;", 9), undefined);
		assert.deepStrictEqual(extractEvaluatableChain("  ?.b.c;", 6), {
			text: "b.c",
			start: 4,
			end: 7,
		});
		assert.deepStrictEqual(extractEvaluatableChain("  return a?.b.c;", 14), {
			text: "a.b.c",
			start: 9,
			end: 15,
		});
	}

	console.log("  ✅ [Hover Provider] SceneHoverProvider 全行悬停测试全部通过！");
}

if (process.argv[1]?.endsWith("scene_hover_provider.test.mjs")) {
	runSceneHoverProviderTests();
}
