import assert from "node:assert/strict";
import { DebugTraceBuffer } from "#src/application/debugTraceBuffer";
import { appEventBus } from "#src/application/eventBus";

export async function runDebugTraceBufferTests() {
	console.log("  ▶ [DebugTraceBuffer] 运行会话级命中轨迹缓存单元测试套件...");

	function createInitializedBuffer(resolver = null) {
		const buffer = new DebugTraceBuffer(resolver);
		buffer.init();
		return buffer;
	}

	// 1. debug:paused 累积：seq 从 1 单调递增，首条 ts 为 0，nodeId 经解析器匹配
	{
		const buffer = createInitializedBuffer((file, line) =>
			file.endsWith("login.ts") && line === 10 ? "auth-flow#0" : null,
		);
		appEventBus.emit("debug:paused", { file: "/ws/src/auth/login.ts", line: 10 });
		appEventBus.emit("debug:paused", { file: "/ws/src/other.ts", line: 99 });

		const records = buffer.getRecords();
		assert.strictEqual(records.length, 2);
		assert.strictEqual(records[0].seq, 1, "seq 从 1 单调递增");
		assert.strictEqual(records[0].nodeId, "auth-flow#0");
		assert.strictEqual(records[1].seq, 2);
		assert.strictEqual(records[1].nodeId, null, "未命中物理位置时 nodeId 记 null");
		assert.strictEqual(records[0].ts, 0, "首条轨迹相对会话起点为 0");
		assert.ok(records[1].ts >= 0, "后续轨迹时间戳非负");
		assert.strictEqual(records[1].file, "/ws/src/other.ts");
		assert.strictEqual(records[1].line, 99);

		buffer.dispose();
	}

	// 2. debug:resumed 保留：轨迹跨多次暂停累积（buffer 不订阅 resumed）
	{
		const buffer = createInitializedBuffer();
		appEventBus.emit("debug:paused", { file: "/ws/src/a.ts", line: 1 });
		appEventBus.emit("debug:resumed", undefined);
		appEventBus.emit("debug:paused", { file: "/ws/src/b.ts", line: 2 });

		const records = buffer.getRecords();
		assert.strictEqual(records.length, 2, "resumed 不清空，轨迹持续累积");
		assert.deepStrictEqual(
			records.map((r) => r.seq),
			[1, 2],
		);

		buffer.dispose();
	}

	// 3. debug:terminated 保留轨迹供复盘，下一次会话首次命中 (debug:paused) 时才自动重置
	{
		const buffer = createInitializedBuffer();
		appEventBus.emit("debug:paused", { file: "/ws/src/a.ts", line: 1 });
		appEventBus.emit("debug:paused", { file: "/ws/src/b.ts", line: 2 });
		assert.strictEqual(buffer.getSize(), 2);

		appEventBus.emit("debug:terminated", undefined);
		assert.strictEqual(buffer.getSize(), 2, "会话终止必须保留轨迹供开发者复盘观察");

		appEventBus.emit("debug:paused", { file: "/ws/src/c.ts", line: 3 });
		const records = buffer.getRecords();
		assert.strictEqual(records.length, 1, "新会话首次命中断点自动重置上一轮");
		assert.strictEqual(records[0].seq, 1, "重置后 seq 重新从 1 起算");
		assert.strictEqual(records[0].ts, 0, "重置后 ts 基线重新起算");

		buffer.dispose();
	}

	// 4. 只读副本：外部变异返回值不影响内部状态
	{
		const buffer = createInitializedBuffer();
		appEventBus.emit("debug:paused", { file: "/ws/src/a.ts", line: 1 });

		const records = buffer.getRecords();
		records.push({ seq: 99, nodeId: "x", file: "hack.ts", line: 0, ts: 0 });
		const mutated = /** @type {any} */ (records[0]);
		mutated.seq = 999;
		mutated.file = "hacked.ts";

		const fresh = buffer.getRecords();
		assert.strictEqual(fresh.length, 1, "外部 push 不得污染内部状态");
		assert.strictEqual(fresh[0].seq, 1, "记录为字段级副本，外部变异零渗透");
		assert.strictEqual(fresh[0].file, "/ws/src/a.ts");

		buffer.dispose();
	}

	// 5. init 幂等与 dispose 退订：订阅成对创建/销毁，防全局总线泄漏
	{
		const buffer = createInitializedBuffer();
		buffer.init(); // 重复 init 必须幂等
		appEventBus.emit("debug:paused", { file: "/ws/src/a.ts", line: 1 });
		assert.strictEqual(buffer.getSize(), 1, "重复 init 不得重复追加");

		buffer.dispose();
		appEventBus.emit("debug:paused", { file: "/ws/src/b.ts", line: 2 });
		assert.strictEqual(buffer.getSize(), 0, "dispose 后必须退订且状态清空");

		appEventBus.emit("debug:terminated", undefined); // 清空后 terminated 不抛异常
	}

	// 6. 直接 clear：显式重置接口行为
	{
		const buffer = createInitializedBuffer();
		appEventBus.emit("debug:paused", { file: "/ws/src/a.ts", line: 1 });
		buffer.clear();
		assert.strictEqual(buffer.getSize(), 0);

		buffer.dispose();
	}

	// 7. 500ms 内同位置幂等防抖去重：防止同一次暂停被 DAP 与 编辑器光标双重上报
	{
		const buffer = createInitializedBuffer();
		appEventBus.emit("debug:paused", { file: "/ws/src/cli.ts", line: 27 });
		// 紧接着模拟 100ms 内因 editor/stackTrace 再次触发 debug:paused
		appEventBus.emit("debug:paused", { file: "/ws/src/cli.ts", line: 27 });

		const records = buffer.getRecords();
		assert.strictEqual(records.length, 1, "500ms 内相同文件与行号必须幂等去重，不可产生伪循环步骤");
		assert.strictEqual(records[0].file, "/ws/src/cli.ts");
		assert.strictEqual(records[0].line, 27);

		buffer.dispose();
	}

	// 8. debug:started 新会话启动立即清空旧轨迹
	{
		const buffer = createInitializedBuffer();
		appEventBus.emit("debug:paused", { file: "/ws/src/cli.ts", line: 27 });
		assert.strictEqual(buffer.getSize(), 1);

		appEventBus.emit("debug:started", undefined);
		assert.strictEqual(buffer.getSize(), 0, "新调试会话启动时必须即刻清空上一轮轨迹");

		buffer.dispose();
	}

	console.log("  ✅ [DebugTraceBuffer] 会话级命中轨迹缓存测试全部通过！");
}
