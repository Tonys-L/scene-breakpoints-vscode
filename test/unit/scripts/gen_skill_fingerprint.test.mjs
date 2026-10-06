import assert from "node:assert";
import { OFFICIAL_SKILL_HISTORY, LATEST_SKILL_VERSION } from "#src/domain/models/agentRuleAsset.ts";
import { getOfficialSkillFingerprint } from "../../../scripts/gen-skill-fingerprint.mjs";

/**
 * 官方技能指纹工具守卫 (gen-skill-fingerprint.mjs)
 * 锚定不变量 (§6.1 铁律)：指纹必须经领域管线 (AgentRuleAsset.computeFingerprint) 生成，
 * 且当前官方 SKILL.md 正文指纹必须已登记入 OFFICIAL_SKILL_HISTORY 并对齐版本 SSOT。
 * 任何人改动 SKILL.md 而未执行发版仪式（重新登记史表），此守卫立即红灯。
 */
export function runGenSkillFingerprintTests() {
	console.log("\n--- 官方技能指纹工具守卫 (gen-skill-fingerprint) ---");

	// G1: 脚本经领域管线生成的指纹必须命中史表（严禁 node:crypto 直算混用，否则 CleanOutdated 永不命中）
	const fingerprint = getOfficialSkillFingerprint();
	assert.ok(
		typeof fingerprint === "string" && /^[0-9a-f]{64}$/.test(fingerprint),
		`指纹必须为 64 位十六进制，实际: ${fingerprint}`,
	);
	const registeredVersion = OFFICIAL_SKILL_HISTORY[fingerprint];
	assert.ok(
		registeredVersion,
		`当前 SKILL.md 指纹 ${fingerprint} 未登记入 OFFICIAL_SKILL_HISTORY——发版仪式遗漏，请运行 node --experimental-transform-types scripts/gen-skill-fingerprint.mjs 重新登记`,
	);

	// G2: 史表登记版本必须等于最新版本号（指纹登记与版本 SSOT 不得脱钩）
	assert.strictEqual(
		registeredVersion,
		LATEST_SKILL_VERSION,
		`史表登记版本 ${registeredVersion} 与 LATEST_SKILL_VERSION ${LATEST_SKILL_VERSION} 不一致，版本联动遗漏`,
	);

	console.log("  ✔ G1 指纹经领域管线生成且已登记史表（发版仪式闭环）");
	console.log("  ✔ G2 史表登记版本与 LATEST_SKILL_VERSION 对齐");
}
