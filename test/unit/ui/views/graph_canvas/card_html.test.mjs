import assert from "node:assert/strict";
import { renderCardHtml } from "#src/ui/views/graphCanvas/webview/components/cardHtml";

export async function runCardHtmlTests() {
	console.log("  ▶ [CardHtml] 运行卡片 HTML 渲染器单元测试套件...");

	const labels = {
		flowEmpty: "无断点",
		sceneInactive: "未激活",
		conditionExprTooltip: "条件表达式: ",
		codeDriftWarning: "代码脱靶",
		notActiveTooltip: "未激活",
		refPrefix: "引用: ",
		refScenePrefix: "引用: ",
	};

	// 1. 基础行断点卡片渲染
	{
		const node = {
			id: "sceneA#0",
			kind: "breakpoint",
			ownerScene: "sceneA",
			refPath: ["sceneA"],
			file: "src/main.ts",
			line: 42,
			desc: "入口断点",
			bpType: "line",
			enabled: true,
			registered: true,
			status: "idle",
		};
		const html = renderCardHtml(node, { labels, isSelected: false, isPulsing: false });
		assert.match(html, /class="bp-card bp-type-line"/);
		assert.match(html, /main\.ts:42/);
		assert.match(html, /入口断点/);
		assert.match(html, /bp-card-jump/);
	}

	// 2. 选中态与代码切片渲染
	{
		const node = {
			id: "sceneA#1",
			kind: "breakpoint",
			ownerScene: "sceneA",
			refPath: ["sceneA"],
			file: "src/service.ts",
			line: 100,
			desc: "业务处理",
			bpType: "condition",
			condition: "x > 10",
			contextSnippet: "  prevLine();\n> currentLine();\n  nextLine();",
			enabled: true,
			registered: true,
			status: "idle",
		};
		const html = renderCardHtml(node, { labels, isSelected: true, isPulsing: true });
		assert.match(html, /selected/);
		assert.match(html, /pulse/);
		assert.match(html, /条件表达式: x &gt; 10/);
	}

	// 3. 脱靶断点渲染
	{
		const node = {
			id: "sceneB#0",
			kind: "breakpoint",
			ownerScene: "sceneB",
			refPath: ["sceneB"],
			file: "src/lost.ts",
			line: 999,
			bpType: "line",
			enabled: false,
			registered: true,
			status: "unmatched",
		};
		const html = renderCardHtml(node, { labels, isSelected: false, isPulsing: false });
		assert.match(html, /bp-disabled/);
		assert.match(html, /bp-unmatched/);
		assert.match(html, /代码脱靶/);
	}

	// 4. 未激活断点渲染
	{
		const node = {
			id: "sceneB#1",
			kind: "breakpoint",
			ownerScene: "sceneB",
			refPath: ["sceneB"],
			file: "src/inactive.ts",
			line: 10,
			bpType: "line",
			enabled: true,
			registered: false,
			status: "idle",
		};
		const html = renderCardHtml(node, { labels, isSelected: false, isPulsing: false });
		assert.match(html, /bp-inactive/);
		assert.match(html, /未激活/);
	}

	// 4. 函数断点与引用占位节点渲染
	{
		const funcNode = {
			id: "sceneC#0",
			kind: "breakpoint",
			ownerScene: "sceneC",
			refPath: ["sceneC"],
			functionName: "myFunction",
			bpType: "function",
			enabled: true,
			registered: true,
			status: "idle",
		};
		const funcHtml = renderCardHtml(funcNode, { labels, isSelected: false, isPulsing: false });
		assert.match(funcHtml, /bp-type-function/);
		assert.match(funcHtml, /myFunction/);

		const refNode = {
			id: "sceneC#ref1",
			kind: "scene-ref",
			ownerScene: "sceneC",
			refPath: ["sceneC", "subScene"],
			refName: "subScene",
			enabled: true,
			registered: true,
			status: "idle",
		};
		const refHtml = renderCardHtml(refNode, { labels, isSelected: false, isPulsing: false });
		assert.match(refHtml, /bp-type-ref/);
		assert.match(refHtml, /引用: subScene/);
	}

	// 5. 国际化 Fallback（未传入 labels 时保真英文回退，零汉字残留）
	{
		const node = {
			id: "sceneD#0",
			kind: "breakpoint",
			ownerScene: "sceneD",
			refPath: ["sceneD"],
			file: "src/fallback.ts",
			line: 1,
			desc: "Test fallback",
			bpType: "condition",
			condition: "x > 0",
			enabled: true,
			registered: true,
			status: "unmatched",
		};
		const fallbackHtml = renderCardHtml(node, { labels: undefined, isSelected: false, isPulsing: false });
		assert.match(fallbackHtml, /Condition: x &gt; 0/);
		assert.match(fallbackHtml, /Code drift exceeds safety threshold/);
	}

	// 5.1 命中计数断点与日志断点 Meta Pill 及缺省描述回退渲染
	{
		// 命中计数断点
		const hitNode = {
			id: "sceneD#1",
			kind: "breakpoint",
			ownerScene: "sceneD",
			refPath: ["sceneD"],
			file: "src/counter.ts",
			line: 15,
			bpType: "hitCount",
			hitCondition: "10",
			enabled: true,
			registered: true,
			status: "idle",
		};
		const hitHtml = renderCardHtml(hitNode, {
			labels: { hitCountTooltip: "命中次数: {0}" },
			isSelected: false,
			isPulsing: false,
		});
		assert.match(hitHtml, /bp-type-hitCount/);
		assert.match(hitHtml, /命中次数: 10/);
		// 无 desc 时应自动降级为 file:line
		assert.match(hitHtml, /counter\.ts:15/);

		// 日志断点
		const logNode = {
			id: "sceneD#2",
			kind: "breakpoint",
			ownerScene: "sceneD",
			refPath: ["sceneD"],
			file: "src/logger.ts",
			line: 88,
			bpType: "logpoint",
			logMessage: "User {id} logged in",
			enabled: true,
			registered: true,
			status: "idle",
		};
		const logHtml = renderCardHtml(logNode, {
			labels: { logMessageTooltip: "日志消息: {0}" },
			isSelected: false,
			isPulsing: false,
		});
		assert.match(logHtml, /bp-type-logpoint/);
		assert.match(logHtml, /日志消息: User \{id\} logged in/);

		// 引用节点无 desc 缺省描述回退
		const refNoDesc = {
			id: "sceneD#refNoDesc",
			kind: "scene-ref",
			ownerScene: "sceneD",
			refPath: ["sceneD", "child"],
			refName: "child",
			enabled: true,
			registered: true,
			status: "idle",
		};
		const refNoDescHtml = renderCardHtml(refNoDesc, {
			labels: { refScenePrefix: "引用的场景: " },
			isSelected: false,
			isPulsing: false,
		});
		assert.match(refNoDescHtml, /引用的场景: child/);

		// 极简节点无 file/desc 降级为 id
		const minimalNode = {
			id: "minimal#99",
			kind: "breakpoint",
			ownerScene: "minimal",
			refPath: ["minimal"],
			bpType: "line",
			enabled: true,
			registered: true,
			status: "idle",
		};
		const minHtml = renderCardHtml(minimalNode, { labels: undefined, isSelected: false, isPulsing: false });
		assert.match(minHtml, /minimal#99/);
	}

	// 6. 场景卡片与子场景引用卡片渲染 (renderSceneCardHtml)
	{
		const { renderSceneCardHtml } = await import("#src/ui/views/graphCanvas/webview/components/cardHtml");
		const rootHtml = renderSceneCardHtml({
			id: "root:lane1",
			title: "pi-main",
			count: 10,
			isCollapsed: false,
			isRoot: true,
		});
		assert.match(rootHtml, /sc-root-card/);
		assert.match(rootHtml, /pi-main/);
		assert.match(rootHtml, />10</);

		const subHtml = renderSceneCardHtml({
			id: "ref:lane1::sub",
			title: "sub-flow",
			count: 3,
			desc: "子流程说明",
			isCollapsed: true,
			isRoot: false,
		});
		assert.match(subHtml, /sc-ref-card/);
		assert.match(subHtml, /sc-collapsed/);
		assert.match(subHtml, /sub-flow/);
		assert.match(subHtml, /子流程说明/);
		assert.match(subHtml, /sc-arrow-icon/);

		const deepHtml = renderSceneCardHtml({
			id: "ref:lane1::sub::deep",
			title: "deep-loop",
			count: 5,
			depth: 2,
			breadcrumb: "sub-flow",
			isCollapsed: false,
			isRoot: false,
		});
		assert.match(deepHtml, /sc-deep-ref/);
		assert.match(deepHtml, /sc-breadcrumb/);
		assert.match(deepHtml, /sub-flow/);
		assert.match(deepHtml, /deep-loop/);
	}

	// 7. 断点卡片 Watch 观测胶囊 (bp-pill-watch) 渲染
	{
		const staticWatchNode = {
			id: "sceneW#0",
			kind: "breakpoint",
			ownerScene: "sceneW",
			refPath: ["sceneW"],
			file: "src/watch.ts",
			line: 20,
			bpType: "line",
			enabled: true,
			registered: true,
			status: "idle",
			watch: ["order.id", "order.status"],
		};
		const staticHtml = renderCardHtml(staticWatchNode, { labels, isSelected: false, isPulsing: false });
		assert.match(staticHtml, /bp-pill-watch/);
		assert.match(staticHtml, /Watch Anchors: order\.id, order\.status/);
	}

	console.log("  ✅ [CardHtml] 卡片 HTML 渲染器测试全部通过！\n");
}

if (process.argv[1]?.endsWith("card_html.test.mjs")) {
	runCardHtmlTests();
}

