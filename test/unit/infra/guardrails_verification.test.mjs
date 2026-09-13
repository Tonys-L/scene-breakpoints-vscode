import assert from "node:assert/strict";
import { verifyAllGuardrails } from "../../../scripts/verify-guardrails.mjs";

export function runGuardrailsVerificationTests() {
	console.log("  ▶ [Guardrails] 运行约束代码级硬门禁验证套件...");

	const result = verifyAllGuardrails();
	assert.strictEqual(
		result.errors.length,
		0,
		`约束检查发现未通过项：\n${result.errors.map((e) => `  - ${e}`).join("\n")}`
	);
	assert.ok(result.successes.length >= 8, "必须成功校验至少 8 项核心工程与架构约束");

	console.log("  ✅ [Guardrails] 全项约束代码级硬门禁验证全部通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runGuardrailsVerificationTests();
}
