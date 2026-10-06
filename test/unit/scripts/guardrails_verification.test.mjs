import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { verifyAllGuardrails, verifySceneMapGuard, verifySchemaContractGuard } from "#scripts/verify-guardrails.mjs";

export function runGuardrailsVerificationTests() {
	console.log("  ▶ [Guardrails] 运行约束代码级硬门禁验证套件...");

	// 1. 真实仓库全量守卫回归（含 GR-006/GR-007 引用适配后的自检）
	{
		const result = verifyAllGuardrails();
		assert.strictEqual(
			result.errors.length,
			0,
			`约束检查发现未通过项：\n${result.errors.map((e) => `  - ${e}`).join("\n")}`
		);
		assert.ok(result.successes.length >= 8, "必须成功校验至少 8 项核心工程与架构约束");
		assert.ok(
			result.successes.some((s) => s.includes("场景引用分支")),
			"GR-007 必须输出场景引用分支契约同步成功项（INV-030 适配）"
		);
	}

	// 2. GR-006 fixture：含引用条目的混合地图必须跳过物理校验（引用无 file/line 是合法形态）
	{
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-gr006-"));
		fs.mkdirSync(path.join(tmp, ".vscode"), { recursive: true });
		const srcFile = path.join(tmp, "real.ts");
		fs.writeFileSync(srcFile, ["line0", "line1", "line2"].join("\n"), "utf-8");
		fs.writeFileSync(
			path.join(tmp, ".vscode", "debug-scenes.json"),
			JSON.stringify({
				scenes: {
					mixed: [
						{ type: "line", file: "real.ts", line: 2 },
						{ type: "scene", name: "auth-core" },
						{ type: "scene", name: "ghost", enabled: false },
					],
				},
			}),
			"utf-8",
		);

		const result = verifySceneMapGuard(tmp);
		assert.strictEqual(result.errors.length, 0, `引用条目不得触发物理校验错误：${result.errors.join("; ")}`);
		assert.ok(
			result.successes.some((s) => s.includes("1 个断点")),
			"健康度统计口径必须只计断点条目（引用不计入断点数）"
		);
		fs.rmSync(tmp, { recursive: true, force: true });
	}

	// 3. GR-006 fixture：缺 name 的引用条目必须显式报错；断点越界仍被捕获
	{
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-gr006-bad-"));
		fs.mkdirSync(path.join(tmp, ".vscode"), { recursive: true });
		const srcFile = path.join(tmp, "real.ts");
		fs.writeFileSync(srcFile, ["only"].join("\n"), "utf-8");
		fs.writeFileSync(
			path.join(tmp, ".vscode", "debug-scenes.json"),
			JSON.stringify({
				scenes: {
					bad: [
						{ type: "scene" },
						{ type: "line", file: "real.ts", line: 99 },
					],
				},
			}),
			"utf-8",
		);

		const result = verifySceneMapGuard(tmp);
		assert.strictEqual(result.errors.length, 2, "缺 name 引用与越界断点必须各报 1 错");
		assert.ok(result.errors.some((e) => e.includes("缺少有效 name")), "空引用名必须被 GR-006 拦截");
		assert.ok(result.errors.some((e) => e.includes("越界")), "断点越界检查语义必须保留");
		fs.rmSync(tmp, { recursive: true, force: true });
	}

	// 4. GR-007 fixture：真实 schema oneOf 契约自检 + 非法契约变体必须被拦截
	{
		// 4a. 引用分支声明缺失 -> 报错
		const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-gr007-a-"));
		fs.writeFileSync(
			path.join(tmpA, "schema.json"),
			JSON.stringify({
				$schema: "http://json-schema.org/draft-07/schema#",
				properties: {
					scenes: {
						additionalProperties: {
							items: {
								oneOf: [
									{ type: "object", properties: { type: { const: "scene" }, name: { type: "string", minLength: 1 } }, required: ["type", "name"], additionalProperties: false },
									{ type: "object", properties: {} },
								],
							},
						},
					},
				},
			}),
			"utf-8",
		);
		const rA = verifySchemaContractGuard(tmpA);
		assert.ok(
			rA.errors.some((e) => e.includes("断点条目分支")),
			"缺断点分支的 schema 必须被 GR-007 拦截"
		);
		fs.rmSync(tmpA, { recursive: true, force: true });

		// 4b. 引用分支缺 additionalProperties:false（允许 file/line 混入）-> 报错
		const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), "sb-gr007-b-"));
		fs.writeFileSync(
			path.join(tmpB, "schema.json"),
			JSON.stringify({
				$schema: "http://json-schema.org/draft-07/schema#",
				properties: {
					scenes: {
						additionalProperties: {
							items: {
								oneOf: [
									{ type: "object", properties: { type: { const: "scene" }, name: { type: "string", minLength: 1 }, desc: {}, enabled: {} }, required: ["type", "name"] },
									{ type: "object", properties: { type: {}, file: {}, line: {} } },
								],
							},
						},
					},
				},
			}),
			"utf-8",
		);
		const rB = verifySchemaContractGuard(tmpB);
		assert.ok(
			rB.errors.some((e) => e.includes("additionalProperties")),
			"引用分支未开严格白名单必须被 GR-007 拦截"
		);
		fs.rmSync(tmpB, { recursive: true, force: true });

		// 4c. 真实 schema 的非法引用样例拒绝能力（契约声明层等价验证）
		const repoSchema = JSON.parse(fs.readFileSync(path.join(process.cwd(), "schema.json"), "utf-8"));
		const refBranch = repoSchema.properties.scenes.additionalProperties.items.oneOf.find(
			(b) => b.properties?.type?.const === "scene"
		);
		assert.ok(refBranch, "真实 schema 必须含场景引用分支");
		assert.deepStrictEqual(refBranch.required, ["type", "name"], '{"type":"scene"}（缺 name）必须被 required 拒绝');
		assert.strictEqual(refBranch.properties.name.minLength, 1, '{"name":""}（空引用名）必须被 minLength 拒绝');
		assert.strictEqual(
			refBranch.additionalProperties,
			false,
			'引用条目携带 file/line 必须被 additionalProperties:false 拒绝'
		);
	}

	console.log("  ✅ [Guardrails] 全项约束代码级硬门禁验证全部通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runGuardrailsVerificationTests();
}
