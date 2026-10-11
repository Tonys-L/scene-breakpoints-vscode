import assert from "node:assert/strict";
import {
	collapseTraceRecords,
	recordLocationKey,
} from "#src/ui/views/graphCanvas/timelineCollapse";

function makeRec(seq, file, line, nodeId = null, ts = 0) {
	return { seq, file, line, nodeId, ts };
}

export function runTimelineCollapseTests() {
	console.log("  ▶ [TimelineCollapse] 运行命中轨迹时间线循环节折叠算法单测套件...");

	// 1. 空数组与单记录
	{
		assert.deepStrictEqual(collapseTraceRecords([]), []);

		const single = [makeRec(1, "a.ts", 10, "nodeA")];
		const res = collapseTraceRecords(single);
		assert.strictEqual(res.length, 1);
		assert.strictEqual(res[0].kind, "single");
		assert.strictEqual(res[0].isLatest, true);
	}

	// 2. 无重复线性执行
	{
		const records = [
			makeRec(1, "a.ts", 10, "nodeA"),
			makeRec(2, "b.ts", 20, "nodeB"),
			makeRec(3, "c.ts", 30, "nodeC"),
		];
		const res = collapseTraceRecords(records);
		assert.strictEqual(res.length, 3);
		assert.strictEqual(res.every((item) => item.kind === "single"), true);
		assert.strictEqual(res[0].isLatest, false);
		assert.strictEqual(res[1].isLatest, false);
		assert.strictEqual(res[2].isLatest, true);
	}

	// 3. 单节点连续重复折叠
	{
		const records = [
			makeRec(1, "main.ts", 1, "start"),
			makeRec(2, "loop.ts", 10, "stepA"),
			makeRec(3, "loop.ts", 10, "stepA"),
			makeRec(4, "loop.ts", 10, "stepA"),
			makeRec(5, "loop.ts", 10, "stepA"),
			makeRec(6, "end.ts", 99, "finish"),
		];
		const res = collapseTraceRecords(records);
		assert.strictEqual(res.length, 3);
		assert.strictEqual(res[0].kind, "single");
		assert.strictEqual(res[1].kind, "loop");
		assert.strictEqual(res[1].iterations, 4);
		assert.strictEqual(res[1].records.length, 4);
		assert.deepStrictEqual(res[1].patternKeys, ["stepA"]);
		assert.strictEqual(res[1].containsLatest, false);
		assert.strictEqual(res[2].kind, "single");
		assert.strictEqual(res[2].isLatest, true);
	}

	// 4. 双节点交替循环折叠 (A -> B -> A -> B -> A -> B)
	{
		const records = [
			makeRec(1, "a.ts", 10, "A"),
			makeRec(2, "b.ts", 20, "B"),
			makeRec(3, "a.ts", 10, "A"),
			makeRec(4, "b.ts", 20, "B"),
			makeRec(5, "a.ts", 10, "A"),
			makeRec(6, "b.ts", 20, "B"),
		];
		const res = collapseTraceRecords(records);
		assert.strictEqual(res.length, 1);
		assert.strictEqual(res[0].kind, "loop");
		assert.strictEqual(res[0].iterations, 3);
		assert.deepStrictEqual(res[0].patternKeys, ["A", "B"]);
		assert.strictEqual(res[0].containsLatest, true);
	}

	// 5. 三节点交替循环折叠与尾部未完成周期 (X -> [A, B, C] * 2 -> A)
	{
		const records = [
			makeRec(1, "init.ts", 1, "init"),
			makeRec(2, "a.ts", 10, "A"),
			makeRec(3, "b.ts", 20, "B"),
			makeRec(4, "c.ts", 30, "C"),
			makeRec(5, "a.ts", 10, "A"),
			makeRec(6, "b.ts", 20, "B"),
			makeRec(7, "c.ts", 30, "C"),
			makeRec(8, "a.ts", 10, "A"), // 最新停留在 A
		];
		const res = collapseTraceRecords(records);
		assert.strictEqual(res.length, 3);
		assert.strictEqual(res[0].kind, "single");
		assert.strictEqual(res[0].record.seq, 1);

		assert.strictEqual(res[1].kind, "loop");
		assert.strictEqual(res[1].iterations, 2);
		assert.deepStrictEqual(res[1].patternKeys, ["A", "B", "C"]);
		assert.strictEqual(res[1].containsLatest, false);

		assert.strictEqual(res[2].kind, "single");
		assert.strictEqual(res[2].record.seq, 8);
		assert.strictEqual(res[2].isLatest, true);
	}

	// 6. recordLocationKey 回退
	{
		assert.strictEqual(recordLocationKey(makeRec(1, "foo.ts", 42, "node1")), "node1");
		assert.strictEqual(recordLocationKey(makeRec(2, "bar.ts", 88, null)), "bar.ts:88");
	}

	console.log("  ✅ [TimelineCollapse] 命中轨迹时间线循环节折叠算法单测全部通过！");
}
