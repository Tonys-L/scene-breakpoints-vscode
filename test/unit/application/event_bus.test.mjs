import * as assert from "node:assert";
import { ApplicationEventBus, appEventBus } from "#src/application/eventBus";

export async function runEventBusTests() {
	console.log("  ▶ [ApplicationEventBus] 运行轻量应用事件总线单元测试...");

	const bus = new ApplicationEventBus();
	let sceneChangedCount = 0;
	let lastWorkspace = "";

	// 1. 订阅与触发广播
	const sub = bus.on("scenes:changed", (payload) => {
		sceneChangedCount++;
		lastWorkspace = payload.workspaceRoot;
	});

	bus.emit("scenes:changed", { workspaceRoot: "/workspace/a" });
	assert.strictEqual(sceneChangedCount, 1);
	assert.strictEqual(lastWorkspace, "/workspace/a");

	// 2. 验证 dispose 注销
	sub.dispose();
	bus.emit("scenes:changed", { workspaceRoot: "/workspace/b" });
	assert.strictEqual(sceneChangedCount, 1, "注销后不得再接收事件");

	// 3. 验证异常隔离保护（单个监听器抛异常不阻断其他监听器）
	let secondListenerReceived = false;
	bus.on("scenes:changed", () => {
		throw new Error("Broken listener");
	});
	bus.on("scenes:changed", () => {
		secondListenerReceived = true;
	});

	bus.emit("scenes:changed", { workspaceRoot: "/workspace/safe" });
	assert.strictEqual(secondListenerReceived, true, "异常隔离机制必须保护其他监听器正常执行");

	// 4. 单例可用性
	assert.ok(appEventBus instanceof ApplicationEventBus);

	console.log("  ✅ [ApplicationEventBus] 轻量应用事件总线单元测试全部通过！\n");
}

if (process.argv[1]?.endsWith("event_bus.test.mjs")) {
	runEventBusTests();
}
