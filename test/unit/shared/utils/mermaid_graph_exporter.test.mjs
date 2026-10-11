import assert from "node:assert/strict";
import { exportGraphToMermaid } from "#src/shared/utils/mermaidGraphExporter";

export function runMermaidGraphExporterTests() {
	console.log("  ▶ [MermaidGraphExporter] 运行 Mermaid 图形导出器单元测试套件...");

	// 1. 基础导出：泳道 subgraph、引用链嵌套 subgraph、相邻声明序连线
	{
		const mermaid = exportGraphToMermaid({
			lanes: [
				{
					id: "scene:auth-flow",
					sceneName: "auth-flow",
					nodes: [
						{
							id: "auth-flow#0",
							kind: "breakpoint",
							refPath: ["auth-flow"],
							file: "src/auth/login.ts",
							line: 10,
							desc: "校验凭证",
							enabled: true,
							status: "idle",
						},
						{
							id: "auth-core#0",
							kind: "breakpoint",
							refPath: ["auth-flow", "auth-core"],
							file: "src/auth/token.ts",
							line: 20,
							enabled: true,
							status: "idle",
						},
						{
							id: "auth-core#1",
							kind: "breakpoint",
							refPath: ["auth-flow", "auth-core"],
							functionName: "handleAuthError",
							enabled: true,
							status: "idle",
						},
					],
				},
			],
		});

		const lines = mermaid.split("\n");
		assert.strictEqual(lines[0], "flowchart TD", "必须以 flowchart TD 开头");
		assert.ok(
			lines.some((l) => l.includes('subgraph s0["auth-flow"]')),
			"泳道必须渲染为 subgraph",
		);
		assert.ok(
			lines.some((l) => l.includes('subgraph s1["🔗 auth-core"]')),
			"引用链必须渲染为嵌套 subgraph 并带 🔗 前缀",
		);
		assert.ok(lines.some((l) => l.includes('["校验凭证"]')), "desc 优先作为节点标签");
		assert.ok(lines.some((l) => l.includes('["src/auth/token.ts:20"]')), "无 desc 时回退 file:line");
		assert.ok(lines.some((l) => l.includes("ƒ handleAuthError")), "函数断点标签带 ƒ 前缀");

		const edges = lines.filter((l) => l.includes("-->"));
		assert.strictEqual(edges.length, 2, "相邻声明序节点两两连线");
		assert.ok(edges[0].includes("-->") && edges[0].split("-->")[0].trim().length > 0);
		assert.ok(lines.some((l) => l.trim() === "end"), "subgraph 必须闭合");
	}

	// 2. 状态标注：unmatched 加 ⚠、禁用加 ⛔、场景引用占位带 🔗
	{
		const mermaid = exportGraphToMermaid({
			lanes: [
				{
					id: "scene:demo",
					sceneName: "demo",
					nodes: [
						{
							id: "demo#0",
							kind: "breakpoint",
							refPath: ["demo"],
							file: "a.ts",
							line: 1,
							enabled: true,
							status: "unmatched",
						},
						{
							id: "demo#1",
							kind: "breakpoint",
							refPath: ["demo"],
							file: "b.ts",
							line: 2,
							enabled: false,
							status: "idle",
						},
						{
							id: "demo#ref-ghost",
							kind: "scene-ref",
							refPath: ["demo"],
							refName: "ghost",
							enabled: true,
							status: "idle",
						},
						{
							id: "demo#ref-off",
							kind: "scene-ref",
							refPath: ["demo"],
							refName: "off",
							enabled: false,
							status: "idle",
						},
					],
				},
			],
		});

		assert.ok(mermaid.includes('["⚠ a.ts:1"]'), "unmatched 节点必须带 ⚠ 前缀");
		assert.ok(mermaid.includes('["⛔ b.ts:2"]'), "禁用节点必须带 ⛔ 前缀");
		assert.ok(mermaid.includes('["🔗 ghost"]'), "引用占位标签带 🔗 与引用名");
		assert.ok(mermaid.includes('["⛔ 🔗 off"]'), "禁用引用占位叠加 ⛔ 前缀");
	}

	// 3. 非法字符清洗：引号转义为单引号、换行折叠为空格
	{
		const mermaid = exportGraphToMermaid({
			lanes: [
				{
					id: "scene:x",
					sceneName: 'weird "scene" name',
					nodes: [
						{
							id: "x#0",
							kind: "breakpoint",
							refPath: ["x"],
							file: "a.ts",
							line: 1,
							desc: 'say "hi"\n  second line',
							enabled: true,
							status: "idle",
						},
					],
				},
			],
		});

		assert.ok(mermaid.includes('subgraph s0["weird \'scene\' name"]'), "泳道名引号必须转义");
		assert.ok(
			mermaid.includes('["say \'hi\' second line"]'),
			"标签引号转义且换行折叠为单空格",
		);
		assert.ok(!mermaid.includes("\n  second"), "标签内不得残留原始换行");
	}

	// 4. 空快照兜底：bare flowchart TD
	{
		assert.strictEqual(exportGraphToMermaid({ lanes: [] }), "flowchart TD");
		assert.strictEqual(exportGraphToMermaid({ lanes: [{ id: "scene:e", sceneName: "e", nodes: [] }] }).split("\n").length, 3, "空泳道仅输出 subgraph 壳");
	}

	// 5. 多泳道独立连线：节点 id 全局唯一
	{
		const mermaid = exportGraphToMermaid({
			lanes: [
				{
					id: "scene:a",
					sceneName: "a",
					nodes: [
						{ id: "a#0", kind: "breakpoint", refPath: ["a"], file: "a.ts", line: 1, enabled: true, status: "idle" },
					],
				},
				{
					id: "scene:b",
					sceneName: "b",
					nodes: [
						{ id: "b#0", kind: "breakpoint", refPath: ["b"], file: "b.ts", line: 1, enabled: true, status: "idle" },
					],
				},
			],
		});

		const edges = mermaid.split("\n").filter((l) => l.includes("-->"));
		assert.strictEqual(edges.length, 0, "单节点泳道无连线");
		assert.ok(mermaid.includes('subgraph s0["a"]'));
		assert.ok(mermaid.includes('subgraph s1["b"]'), "多泳道 subgraph id 必须全局唯一");
	}

	console.log("  ✅ [MermaidGraphExporter] Mermaid 图形导出器测试全部通过！");
}
