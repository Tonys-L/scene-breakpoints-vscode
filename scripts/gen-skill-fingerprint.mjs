/**
 * 官方技能指纹生成器 (发版仪式配套计算工具)
 *
 * 用途：发布新版本时生成 SKILL.md 规范化正文的唯一指纹，登记入
 *       OFFICIAL_SKILL_HISTORY (src/domain/models/agentRuleAsset.ts)，
 *       保障存量用户本地纯正版可被识别为 CleanOutdated 并平滑升级。
 *
 * 铁律 (lessons/guardrails-and-ecosystem-gotchas.md §6.1)：
 *   指纹必须经领域实体管线 AgentRuleAsset.computeFingerprint() 生成——
 *   指纹 = 规范化核心正文（剥 Frontmatter + 跨平台归一化）的标准 SHA-256 (FIPS 180-4)，
 *   严禁对原始文件字节直接哈希：归一化语义（而非哈希算法）才是指纹一致性的根本契约，
 *   绕过归一化直算会导致 CleanOutdated 永不命中。
 *   本脚本存在的意义：把"计算必须工具化执行并留档可复跑"固化为工程资产，杜绝临时 node -e 与人工心算。
 *
 * 用法：
 *   node --experimental-transform-types scripts/gen-skill-fingerprint.mjs [可选:自定义md路径]
 * 输出：
 *   { "file": "<SKILL.md路径>", "fingerprint": "<64位指纹>" }
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AgentRuleAsset } from "#src/domain/models/agentRuleAsset.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultSkillPath = path.join(repoRoot, "skills", "scene-breakpoints", "SKILL.md");

/**
 * 经领域管线计算官方技能资产指纹（与运行时 evaluateLifecycle 同一实现，保证零偏差）
 *
 * @param {string} [skillPath] 自定义 markdown 资产路径，默认官方 SKILL.md
 * @returns {string} 规范化正文 64 位指纹
 */
export function getOfficialSkillFingerprint(skillPath = defaultSkillPath) {
	const rawContent = fs.readFileSync(skillPath, "utf-8");
	return new AgentRuleAsset(skillPath, rawContent).computeFingerprint();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultSkillPath;
	const fingerprint = getOfficialSkillFingerprint(targetPath);
	console.log(JSON.stringify({ file: targetPath, fingerprint }, null, 2));
}
