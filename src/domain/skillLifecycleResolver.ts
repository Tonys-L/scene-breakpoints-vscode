import * as crypto from "node:crypto";

/**
 * 插件当前内置的最新 Skill 规则版本号 (默认与 package.json 对齐)
 */
export const LATEST_SKILL_VERSION = "1.0.5";

/**
 * 官方历史核心正文指纹映射表 (Hash 作为 Key，O(1) 极速秒查版本)
 * 核心正文剥离了各平台胶水头部 Frontmatter，无论装在 Cursor、Windsurf 还是 Antigravity，
 * 只要官方正文未改动，Hash 全世界唯一。
 */
export const OFFICIAL_SKILL_HISTORY: Record<string, string> = {
	// 从 1.0.3 开始建立官方核心正文指纹基线 (后续版本演进时向此字典追加)
	"f026e091703950315e7b7ca2e55a3650af729c2a9512e49bd82e5e695be5ffea": "1.0.3",
};

/**
 * 剥离开头的 YAML / MDC Frontmatter 元数据头，返回纯 Markdown 规则正文
 */
export function stripSkillFrontmatter(content: string): string {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, "");
}

/**
 * 跨操作系统归一化文本（消除 CRLF/LF 与行末空格干扰，严格保障指纹一致性）
 */
export function normalizeSkillContent(content: string): string {
	const body = stripSkillFrontmatter(content);
	return body
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

/**
 * 计算规范化核心正文的 SHA-256 唯一指纹
 */
export function computeSkillFingerprint(content: string): string {
	const normalized = normalizeSkillContent(content);
	return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

export type SkillStatus = "UpToDate" | "CleanOutdated" | "CustomModified";

export interface SkillLifecycleResult {
	status: SkillStatus;
	detectedVersion?: string;
	localHash: string;
	latestHash: string;
}

/**
 * 纯领域函数：基于统一指纹快速判定本地 Skill 文件的生命周期状态
 *
 * @param localContent 本地工作区文件实际文本
 * @param latestTemplateContent 插件当前内置的最新官方模板文本
 * @param latestVersion 可选，动态传入的插件最新版本号（默认使用 LATEST_SKILL_VERSION）
 */
export function resolveSkillLifecycleState(
	localContent: string,
	latestTemplateContent: string,
	latestVersion: string = LATEST_SKILL_VERSION,
): SkillLifecycleResult {
	const localHash = computeSkillFingerprint(localContent);
	const latestHash = computeSkillFingerprint(latestTemplateContent);

	// 1. 命中最新官方指纹
	if (localHash === latestHash) {
		return {
			status: "UpToDate",
			detectedVersion: latestVersion,
			localHash,
			latestHash,
		};
	}

	// 2. 命中已知官方历史版本清单 (O(1) 秒查)
	const historicalVersion = OFFICIAL_SKILL_HISTORY[localHash];
	if (historicalVersion) {
		return {
			status: "CleanOutdated",
			detectedVersion: historicalVersion,
			localHash,
			latestHash,
		};
	}

	// 3. 未命中任何已知官方指纹 -> 100% 说明用户进行过个性化修改
	return {
		status: "CustomModified",
		localHash,
		latestHash,
	};
}
