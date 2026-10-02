import assert from "node:assert/strict";
import { SerialQueue } from "#src/application/serialQueue.ts";

export async function runSerialQueueTests() {
	console.log("  ▶ [SerialQueue] 运行 SerialQueue 单写者串行排队锁单元测试（真实源码）...");

	// 1. 基本实例化与单任务执行及返回值透传
	{
		const queue = new SerialQueue();
		let executed = false;
		const result = await queue.enqueue(async () => {
			executed = true;
			return "success-result";
		});

		assert.strictEqual(executed, true, "任务应当被执行");
		assert.strictEqual(result, "success-result", "返回值必须原样透传给调用方");
	}

	// 2. 严格串行化时序验证（前慢后快任务防交错）
	{
		const queue = new SerialQueue();
		const timeline = [];

		const p1 = queue.enqueue(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
			timeline.push("task-1-done");
			return 1;
		});

		const p2 = queue.enqueue(async () => {
			// task-2 执行很快，但必须等待 task-1 完成
			timeline.push("task-2-done");
			return 2;
		});

		const p3 = queue.enqueue(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			timeline.push("task-3-done");
			return 3;
		});

		const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

		assert.deepStrictEqual(
			timeline,
			["task-1-done", "task-2-done", "task-3-done"],
			"任务必须严格按照入队顺序串行执行，前慢任务必须阻塞后快任务"
		);
		assert.strictEqual(r1, 1);
		assert.strictEqual(r2, 2);
		assert.strictEqual(r3, 3);
	}

	// 3. 任务异常抛出、调用方捕获与队列自我恢复（非阻塞）
	{
		const queue = new SerialQueue();
		const timeline = [];

		const p1 = queue.enqueue(async () => {
			timeline.push("task-1-start");
			throw new Error("Task 1 failed intentionally");
		});

		const p2 = queue.enqueue(async () => {
			timeline.push("task-2-start");
			return "task-2-ok";
		});

		// p1 应当被拒绝，并抛出原始错误
		await assert.rejects(
			async () => await p1,
			(err) => {
				assert.strictEqual(err.message, "Task 1 failed intentionally");
				return true;
			},
			"调用方必须能准确捕获 task-1 抛出的原始错误"
		);

		// p2 必须正常执行，不能被前一个异常阻塞死锁
		const r2 = await p2;
		assert.strictEqual(r2, "task-2-ok", "前置任务失败后，后续排队任务必须依然正常执行");
		assert.deepStrictEqual(timeline, ["task-1-start", "task-2-start"]);
	}

	// 4. 连续多任务异常混合流水线
	{
		const queue = new SerialQueue();
		const log = [];

		const p1 = queue.enqueue(async () => {
			log.push("p1");
			throw new Error("err-1");
		});

		const p2 = queue.enqueue(async () => {
			log.push("p2");
			throw new Error("err-2");
		});

		const p3 = queue.enqueue(async () => {
			log.push("p3");
			return "p3-val";
		});

		await assert.rejects(() => p1, /err-1/);
		await assert.rejects(() => p2, /err-2/);
		const r3 = await p3;

		assert.strictEqual(r3, "p3-val");
		assert.deepStrictEqual(log, ["p1", "p2", "p3"], "连续失败后队列仍能恢复并保证顺序");
	}

	// 5. 突发高并发入队顺序保真度压力测试 (20 连击)
	{
		const queue = new SerialQueue();
		const results = [];
		const promises = [];

		for (let i = 0; i < 20; i++) {
			promises.push(
				queue.enqueue(async () => {
					// 随机微小扰动
					if (i % 3 === 0) {
						await new Promise((r) => setTimeout(r, 2));
					}
					results.push(i);
					return i * 10;
				})
			);
		}

		const resolvedValues = await Promise.all(promises);

		const expectedOrder = Array.from({ length: 20 }, (_, i) => i);
		assert.deepStrictEqual(results, expectedOrder, "20 个突发并发任务必须保持 100% 串行时序保真度");
		assert.deepStrictEqual(
			resolvedValues,
			expectedOrder.map((i) => i * 10),
			"20 个任务返回值必须 1:1 精准对应"
		);
	}

	// 6. 空解析微任务与直接返回值
	{
		const queue = new SerialQueue();
		const res = await queue.enqueue(async () => undefined);
		assert.strictEqual(res, undefined, "当任务返回 undefined 时，应当能正常解析");
	}

	console.log("  ✅ [SerialQueue] SerialQueue 单元测试全部通过！\n");
}

if (process.argv[1]?.endsWith("serial_queue.test.mjs")) {
	runSerialQueueTests().catch((err) => {
		console.error("❌ SerialQueue 单元测试失败:", err);
		process.exit(1);
	});
}
