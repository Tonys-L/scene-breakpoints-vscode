import assert from "node:assert/strict";
import { buildGraphWebviewDocument } from "#src/ui/views/graphCanvas/graphWebviewDocument";

export async function runGraphWebviewDocumentTests() {
	console.log("  ▶ [GraphWebviewDocument] 运行画布 HTML 文档生成器单元测试套件...");

	const LABELS = {
		panelTitle: "Graph",
		tabFlow: "Flow",
		tabTrace: "Trace",
		exportButton: "Export Mermaid",
		flowEmpty: "No active scenes.",
		traceEmpty: "No trace records.",
		scopeLabel: "Scene Scope",
		sceneInactive: "Not Active",
		laneCircular: "Circular scene reference",
	};

	function createBaseInput(overrides = {}) {
		return {
			cspSource: "vscode-webview://test-webview",
			libUri: "vscode-webview://test-webview/media/graph/cytoscape-bundle.js",
			runtimeUri: "vscode-webview://test-webview/media/graph/graphWebview.js",
			stylesUri: "vscode-webview://test-webview/media/graph/graphWebview.css",
			nonce: "abcdef0123456789",
			snapshot: { workspaceRoot: "/ws", activeScenes: [], lanes: [], warnings: [] },
			records: [],
			initialTab: "flow",
			labels: LABELS,
			...overrides,
		};
	}

	// 1. CSP 头：default-src 'none' + nonce 脚本 + 本地资源源，零外链 (GR-012)
	{
		const html = buildGraphWebviewDocument(createBaseInput());
		assert.match(html, /Content-Security-Policy/);
		assert.match(html, /default-src 'none'/);
		assert.match(html, /script-src vscode-webview:\/\/test-webview 'nonce-abcdef0123456789'/);
		assert.match(html, /style-src vscode-webview:\/\/test-webview 'unsafe-inline'/);
		assert.match(html, /img-src vscode-webview:\/\/test-webview data:/);
		// 零外链硬约束 (GR-012)：不得出现 http(s):// 形态的外部资源引用
		assert.ok(!/src="https?:\/\//.test(html), "脚本资源必须全本地，禁止外链");
	}

	// 2. 本地样式表与脚本引用：外部 CSS link + 图形库与运行时均带 nonce 注入
	{
		const html = buildGraphWebviewDocument(createBaseInput());
		assert.match(html, /<link rel="stylesheet" href="[^"]*graphWebview\.css">/);
		assert.match(html, /<script nonce="abcdef0123456789" src="[^"]*cytoscape-bundle\.js"><\/script>/);
		assert.match(html, /<script nonce="abcdef0123456789" src="[^"]*graphWebview\.js"><\/script>/);
	}

	// 3. payload 序列化：快照与轨迹进 sb-payload JSON，恶意内容转义防 script 逃逸
	{
		const malicious = '</script><script>alert(1)</script>';
		const html = buildGraphWebviewDocument(
			createBaseInput({
				snapshot: {
					workspaceRoot: "/ws",
					activeScenes: [malicious],
					lanes: [],
					warnings: [],
				},
				records: [{ seq: 1, nodeId: null, file: "a.ts", line: 1, ts: 0 }],
			}),
		);
		assert.match(html, /id="sb-payload"/);
		assert.ok(!html.includes("</script><script>alert"), "payload 必须转义 < 防逃逸");
		assert.ok(html.includes("\\u003c/script>"), "< 必须转义为 unicode 序列");
	}

	// 4. 行分隔符转义：U+2028/U+2029 不得以裸字符出现
	{
		const html = buildGraphWebviewDocument(
			createBaseInput({
				snapshot: {
					workspaceRoot: "/ws\u2028\u2029",
					activeScenes: [],
					lanes: [],
					warnings: [],
				},
			}),
		);
		assert.ok(!/\u2028|\u2029/.test(html), "行分隔符必须转义");
		assert.ok(html.includes("\\u2028\\u2029"));
	}

	// 5. 挂载节点与数据契约：包含 Preact 挂载容器 #app
	{
		const html = buildGraphWebviewDocument(createBaseInput());
		assert.match(html, /<div id="app"><\/div>/);
	}

	// 6. Scope Selector 与运行时标签进 payload
	{
		const html = buildGraphWebviewDocument(createBaseInput());
		assert.match(html, /id="sb-payload"/);
		const payloadMatch = html.match(/<script type="application\/json" id="sb-payload">([\s\S]*?)<\/script>/);
		assert.ok(payloadMatch, "payload script 必须存在");
		const payload = JSON.parse(payloadMatch[1].replace(/\\u003c/g, "<").replace(/\\u2028/g, "\u2028").replace(/\\u2029/g, "\u2029"));
		assert.strictEqual(payload.labels.sceneInactive, "Not Active");
		assert.strictEqual(payload.labels.laneCircular, "Circular scene reference");
		assert.strictEqual(payload.labels.traceEmpty, "No trace records.");
		assert.strictEqual(payload.labels.flowEmpty, "No active scenes.");
		assert.strictEqual(payload.labels.tabFlow, "Flow");
		assert.strictEqual(payload.labels.tabTrace, "Trace");
		assert.strictEqual(payload.labels.exportButton, "Export Mermaid");
		assert.strictEqual(payload.labels.scopeLabel, "Scene Scope");
	}

	// 7. 外部自定义模板注入测试
	{
		const customTemplate = `<html><body><div id="app"></div><script id="sb-payload">{{payload}}</script><link href="{{stylesUri}}"><script src="{{libUri}}"></script><script src="{{runtimeUri}}"></script></body></html>`;
		const html = buildGraphWebviewDocument(createBaseInput({ templateHtml: customTemplate }));
		assert.ok(html.includes('href="vscode-webview://test-webview/media/graph/graphWebview.css"'));
		assert.ok(html.includes('src="vscode-webview://test-webview/media/graph/cytoscape-bundle.js"'));
	}

	console.log("  ✅ [GraphWebviewDocument] 画布 HTML 文档生成器测试全部通过！");
}
