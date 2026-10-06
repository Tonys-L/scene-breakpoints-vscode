// 指纹实证脚本（最小向量诊断）：对比源模板与两份已装副本的规范化指纹
import { readFileSync, statSync } from "node:fs";
import { AgentRuleAsset } from "#src/domain/models/agentRuleAsset.ts";

const files = [
	"skills/scene-breakpoints/SKILL.md",
	".trae/skills/scene-breakpoints/SKILL.md",
	".agents/skills/scene-breakpoints/SKILL.md",
];

for (const f of files) {
	const raw = readFileSync(f, "utf8");
	const asset = new AgentRuleAsset(f, raw);
	const fp = asset.computeFingerprint();
	const registered = (await import("../src/domain/models/agentRuleAsset.ts")).OFFICIAL_SKILL_HISTORY[fp];
	console.log(`${f}\n  mtime: ${statSync(f).mtime.toISOString()}\n  fingerprint: ${fp}\n  registeredVersion: ${registered ?? "(未登记 → CustomModified)"}\n`);
}
