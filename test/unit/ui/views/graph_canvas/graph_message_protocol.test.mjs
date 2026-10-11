import assert from "node:assert/strict";
import {
	isWebviewToHostMessage,
	isGraphViewTab,
} from "#src/ui/views/graphCanvas/graphMessageProtocol";

export function runGraphMessageProtocolTests() {
	console.log("  ▶ [GraphMessageProtocol] 运行画布 postMessage 协议类型守卫单元测试套件...");

	// 1. webview → 宿主 消息守卫：四类合法消息全部放行
	{
		assert.strictEqual(isWebviewToHostMessage({ type: "open-source", nodeId: "a#0" }), true);
		assert.strictEqual(isWebviewToHostMessage({ type: "open-source", file: "foo.ts", line: 42 }), true);
		assert.strictEqual(isWebviewToHostMessage({ type: "switch-tab", tab: "trace" }), true);
		assert.strictEqual(isWebviewToHostMessage({ type: "export-mermaid" }), true);
		assert.strictEqual(isWebviewToHostMessage({ type: "set-scope", scenes: ["a", "b"] }), true);
		assert.strictEqual(isWebviewToHostMessage({ type: "set-scope", scenes: [] }), true);
		assert.strictEqual(isWebviewToHostMessage({ type: "clear-trace" }), true);
		assert.strictEqual(isWebviewToHostMessage({ type: "focus-node", nodeId: "a#0" }), true);
		assert.strictEqual(isWebviewToHostMessage({ type: "ready" }), true);
	}

	// 2. 非法消息防御：宿主 → webview 类型反向渗透、空值与非对象全部拦截
	{
		assert.strictEqual(isWebviewToHostMessage(null), false);
		assert.strictEqual(isWebviewToHostMessage(undefined), false);
		assert.strictEqual(isWebviewToHostMessage(42), false);
		assert.strictEqual(isWebviewToHostMessage("ready"), false);
		assert.strictEqual(isWebviewToHostMessage({}), false);
		assert.strictEqual(
			isWebviewToHostMessage({ type: "render", snapshot: {} }),
			false,
			"宿主下行类型不得被 webview 上行守卫放行",
		);
		assert.strictEqual(isWebviewToHostMessage({ type: "live-pulse", nodeId: "a#0" }), false);
	}

	// 3. set-scope 字段校验：scenes 缺失/非数组/含非字符串项全部拦截
	{
		assert.strictEqual(isWebviewToHostMessage({ type: "set-scope" }), false, "缺 scenes 不得放行");
		assert.strictEqual(isWebviewToHostMessage({ type: "set-scope", scenes: "bogus" }), false);
		assert.strictEqual(isWebviewToHostMessage({ type: "set-scope", scenes: [1, 2] }), false);
		assert.strictEqual(isWebviewToHostMessage({ type: "set-scope", scenes: ["a", null] }), false);
		assert.strictEqual(isWebviewToHostMessage({ type: "activate-scene" }), false);
		assert.strictEqual(isWebviewToHostMessage({ type: "activate-scene", sceneName: 123 }), false);
	}

	// 4. tab 值守卫：仅 flow / trace 合法
	{
		assert.strictEqual(isGraphViewTab("flow"), true);
		assert.strictEqual(isGraphViewTab("trace"), true);
		assert.strictEqual(isGraphViewTab("reference"), false, "引用图后置扩展点，当前非法");
		assert.strictEqual(isGraphViewTab(""), false);
		assert.strictEqual(isGraphViewTab(null), false);
		assert.strictEqual(isGraphViewTab(undefined), false);
		assert.strictEqual(isGraphViewTab(1), false);
	}

	console.log("  ✅ [GraphMessageProtocol] 画布 postMessage 协议测试全部通过！");
}
