import * as fs from "node:fs";
import * as path from "node:path";
import {
	AgentRuleAsset,
	LATEST_SKILL_VERSION,
	type SkillStatus,
} from "#src/domain/models/agentRuleAsset";

export interface SkillTargetConfig {
	id: string;
	label: string;
	description?: string;
	dir: string;
	file: string;
	hostKeywords?: string[];
	customHeader?: string;
}

export interface InspectedSkillTarget {
	target: SkillTargetConfig;
	fullPath: string;
	exists: boolean;
	status: SkillStatus | "NotInstalled";
	detectedVersion?: string;
	localContent?: string;
	isCurrentHost?: boolean;
}

/**
 * 依据目标平台的 Frontmatter 规范对官方内置 Skill 内容进行定制格式化
 */
export function formatSkillContent(
	baseContent: Uint8Array | string,
	target: Pick<SkillTargetConfig, "customHeader">,
): Uint8Array {
	const rawBytes = typeof baseContent === "string" ? Buffer.from(baseContent, "utf-8") : baseContent;
	if (target.customHeader) {
		let baseStr = Buffer.from(rawBytes).toString("utf-8");
		// 若已存在 Frontmatter，剥离后替换为平台的 customHeader
		baseStr = baseStr.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, "");
		return Buffer.from(target.customHeader + baseStr, "utf-8");
	}
	return rawBytes;
}

/**
 * 备份目标文件为带时间戳的物理文件副本
 */
export function backupSkillFile(targetFilePath: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupPath = `${targetFilePath}.${timestamp}.bak`;
	fs.copyFileSync(targetFilePath, backupPath);
	return backupPath;
}

/**
 * 获取当前受支持的所有主流 AI Agent 规则目标平台及配置规范
 */
export function getSupportedSkillTargets(): SkillTargetConfig[] {
	return [
		// 1. Antigravity 工作区 Skill 体系 (默认置顶，保证首屏直达)
		{
			id: "antigravity",
			label: "Antigravity",
			description: ".agents/skills/scene-breakpoints/SKILL.md",
			dir: ".agents/skills/scene-breakpoints",
			file: "SKILL.md",
			hostKeywords: ["antigravity"],
		},
		// 2. Trae IDE 技能体系
		{
			id: "trae",
			label: "Trae IDE",
			description: ".trae/skills/scene-breakpoints/SKILL.md",
			dir: ".trae/skills/scene-breakpoints",
			file: "SKILL.md",
			hostKeywords: ["trae"],
		},
		// 3. Cursor IDE 专属 MDC 规则体系
		{
			id: "cursor",
			label: "Cursor",
			description: ".cursor/rules/scene-breakpoints.mdc",
			dir: ".cursor/rules",
			file: "scene-breakpoints.mdc",
			hostKeywords: ["cursor"],
			customHeader: `---\ndescription: Orchestrate and declare breakpoint scenes in .vscode/debug-scenes.json for debugging workflows and code reading\nglobs: **\n---\n\n`,
		},
		// 4. VS Code / GitHub Copilot 官方 Skills 体系
		{
			id: "copilot",
			label: "VS Code / GitHub Copilot",
			description: ".github/skills/scene-breakpoints/SKILL.md",
			dir: ".github/skills/scene-breakpoints",
			file: "SKILL.md",
			hostKeywords: ["visual studio code", "vscode", "code"],
		},
		// 5. Windsurf (Codeium) 级联规则体系
		{
			id: "windsurf",
			label: "Windsurf",
			description: ".windsurf/rules/scene-breakpoints.md",
			dir: ".windsurf/rules",
			file: "scene-breakpoints.md",
			hostKeywords: ["windsurf", "codeium"],
		},
		// 6. Cline (Claude Dev) 自主 Agent 规则体系
		{
			id: "cline",
			label: "Cline",
			description: ".clinerules/scene-breakpoints.md",
			dir: ".clinerules",
			file: "scene-breakpoints.md",
			hostKeywords: ["cline"],
		},
		// 7. Roo Code (Roo Cline) 规则体系
		{
			id: "roo",
			label: "Roo Code",
			description: ".roorules/scene-breakpoints.md",
			dir: ".roorules",
			file: "scene-breakpoints.md",
			hostKeywords: ["roo"],
		},
		// 8. Continue.dev 开源 Agent 提示词体系
		{
			id: "continue",
			label: "Continue",
			description: ".continue/prompts/scene-breakpoints.prompt",
			dir: ".continue/prompts",
			file: "scene-breakpoints.prompt",
			hostKeywords: ["continue"],
		},
	];
}

/**
 * 校验目标平台是否与当前宿主应用匹配
 */
export function isTargetHostMatch(target: SkillTargetConfig, hostAppName?: string): boolean {
	if (!hostAppName) return false;
	const lowerHost = hostAppName.toLowerCase();
	if (target.hostKeywords && target.hostKeywords.some((k) => lowerHost.includes(k.toLowerCase()))) {
		return true;
	}
	const baseName = target.label.split(/[\s/]/)[0].toLowerCase();
	return Boolean(baseName && lowerHost.includes(baseName));
}

/**
 * AI Agent 技能规则应用服务 (Deep Module)
 * 职责：负责 8 大主流 AI 平台技能文件的探测、生命周期评估、模板格式化与物理部署，完全屏蔽具体宿主视图。
 */
export class AgentSkillService {
	public getSupportedSkillTargets(): SkillTargetConfig[] {
		return getSupportedSkillTargets();
	}

	public formatSkillContent(
		baseContent: Uint8Array | string,
		target: Pick<SkillTargetConfig, "customHeader">,
	): Uint8Array {
		return formatSkillContent(baseContent, target);
	}

	public backupSkillFile(targetFilePath: string): string {
		return backupSkillFile(targetFilePath);
	}

	/**
	 * 全平台巡检：探测指定工作区中所有 AI 平台的规则部署与版本生命周期状态
	 */
	public inspectSkillTargets(
		workspaceRoot: string,
		officialTemplate?: string,
		currentVersion: string = LATEST_SKILL_VERSION,
		hostAppName?: string,
	): InspectedSkillTarget[] {
		const targets = this.getSupportedSkillTargets();
		const results: InspectedSkillTarget[] = [];

		for (const target of targets) {
			const fullPath = path.join(workspaceRoot, target.dir, target.file);
			const isCurrentHost = isTargetHostMatch(target, hostAppName);

			if (!fs.existsSync(fullPath)) {
				results.push({
					target,
					fullPath,
					exists: false,
					status: "NotInstalled",
					isCurrentHost,
				});
				continue;
			}

			results.push(this.inspectExistingTarget(target, fullPath, officialTemplate, currentVersion, isCurrentHost));
		}

		return this.sortInspectedTargets(results);
	}

	private inspectExistingTarget(
		target: SkillTargetConfig,
		fullPath: string,
		officialTemplate: string | undefined,
		currentVersion: string,
		isCurrentHost: boolean,
	): InspectedSkillTarget {
		try {
			const localContent = fs.readFileSync(fullPath, "utf-8");
			if (!officialTemplate) {
				return {
					target,
					fullPath,
					exists: true,
					status: "UpToDate",
					localContent,
					isCurrentHost,
				};
			}

			const lifecycle = new AgentRuleAsset("local", localContent).evaluateLifecycle(
				officialTemplate,
				currentVersion,
			);
			return {
				target,
				fullPath,
				exists: true,
				status: lifecycle.status,
				detectedVersion: lifecycle.detectedVersion,
				localContent,
				isCurrentHost,
			};
		} catch (error) {
			console.warn(`[AgentSkillService] Failed to read ${fullPath}:`, error);
			return {
				target,
				fullPath,
				exists: true,
				status: "CustomModified",
				isCurrentHost,
			};
		}
	}

	private sortInspectedTargets(items: InspectedSkillTarget[]): InspectedSkillTarget[] {
		return [...items].sort((a, b) => {
			if (a.exists && !b.exists) return -1;
			if (!a.exists && b.exists) return 1;

			if (a.isCurrentHost && !b.isCurrentHost) return -1;
			if (!a.isCurrentHost && b.isCurrentHost) return 1;

			return 0;
		});
	}

	/**
	 * 将技能模板安全格式化并写入到目标平台的指定路径
	 */
	public async deploySkillToTarget(
		workspaceRoot: string,
		target: SkillTargetConfig,
		officialTemplate: string,
	): Promise<boolean> {
		if (!officialTemplate) {
			return false;
		}

		try {
			const fullDir = path.join(workspaceRoot, target.dir);
			const fullFile = path.join(fullDir, target.file);
			const content = this.formatSkillContent(officialTemplate, target);

			await fs.promises.mkdir(fullDir, { recursive: true });
			await fs.promises.writeFile(fullFile, content);
			return true;
		} catch (error) {
			console.warn(`[AgentSkillService] Failed to deploy skill to ${target.file}:`, error);
			return false;
		}
	}
}

export const agentSkillService = new AgentSkillService();
