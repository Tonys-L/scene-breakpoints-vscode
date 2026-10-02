import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
	LATEST_SKILL_VERSION,
	AgentRuleAsset,
	type SkillStatus,
} from "#src/domain/models/agentRuleAsset";
import { runWithWorkspace } from "#src/ui/utils/commandRunner";
import { templateContentProvider } from "#src/ui/views/templateContentProvider";



export interface SkillTargetItem extends vscode.QuickPickItem {
	dir: string;
	file: string;
	hostKeywords?: string[];
	customHeader?: string;
}

export function formatSkillContent(baseContent: Uint8Array, target: SkillTargetItem): Uint8Array {
	if (target.customHeader) {
		let baseStr = Buffer.from(baseContent).toString("utf-8");
		// 若已存在 Frontmatter，剥离后替换为平台的 customHeader
		baseStr = baseStr.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, "");
		return Buffer.from(target.customHeader + baseStr, "utf-8");
	}
	return baseContent;
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
 * 将内置 Skill 模板安全格式化并写入指定 Agent 目录
 */
export async function writeSkillToTarget(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	target: SkillTargetItem,
): Promise<boolean> {
	const skillSourceUri = vscode.Uri.joinPath(
		context.extensionUri,
		"skills",
		"scene-breakpoints",
		"SKILL.md",
	);

	let content: Uint8Array;
	try {
		content = await vscode.workspace.fs.readFile(skillSourceUri);
	} catch (error) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t("Failed to read built-in Skill template: {0}", String(error)),
		);
		return false;
	}

	const targetDirUri = vscode.Uri.file(path.join(workspaceRoot, target.dir));
	const targetFileUri = vscode.Uri.file(path.join(workspaceRoot, target.dir, target.file));
	const targetContent = formatSkillContent(content, target);

	try {
		await vscode.workspace.fs.createDirectory(targetDirUri);
		await vscode.workspace.fs.writeFile(targetFileUri, targetContent);
		return true;
	} catch (error) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t("Failed to write Skill file: {0}", String(error)),
		);
		return false;
	}
}

/**
 * 分发安装 Skill 到指定 Agent 目录命令 (sceneBreakpoints.installSkill)
 */
export async function installSkillCommand(context: vscode.ExtensionContext): Promise<void> {
	await runWithWorkspace(async (workspaceRoot) => {
		const targets = await pickSkillTargets(workspaceRoot);
		if (!targets || targets.length === 0) {
			void vscode.window.showInformationMessage(
				vscode.l10n.t("No target AI environments selected. Installation cancelled."),
			);
			return;
		}

		for (const target of targets) {
			const success = await writeSkillToTarget(context, workspaceRoot, target);
			if (!success) return;
		}

		void vscode.window.showInformationMessage(
			vscode.l10n.t("Scene Breakpoints Skill successfully deployed to target directory."),
		);
	});
}

/**
 * 扩展启动或版本升级时的轻量巡检：发现过期纯净版本或用户本地定制改动时给出非阻塞提示
 */
export async function checkAndPromptSkillUpdates(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
): Promise<void> {
	const currentVersion = context.extension?.packageJSON?.version || LATEST_SKILL_VERSION;
	const lastNotifiedVer = context.workspaceState.get<string>("lastNotifiedSkillVersion");
	if (lastNotifiedVer === currentVersion) {
		return;
	}

	const skillSourceUri = vscode.Uri.joinPath(
		context.extensionUri,
		"skills",
		"scene-breakpoints",
		"SKILL.md",
	);
	let rawOfficialTemplate = "";
	try {
		const rawBytes = await vscode.workspace.fs.readFile(skillSourceUri);
		rawOfficialTemplate = Buffer.from(rawBytes).toString("utf-8");
	} catch {
		return;
	}

	const outdatedTargets = findOutdatedSkillTargets(workspaceRoot, rawOfficialTemplate, currentVersion);
	if (outdatedTargets.length === 0) return;

	await context.workspaceState.update("lastNotifiedSkillVersion", currentVersion);
	await promptAndHandleSkillUpdates(context, workspaceRoot, outdatedTargets, rawOfficialTemplate, currentVersion);
}

function findOutdatedSkillTargets(
	workspaceRoot: string,
	rawOfficialTemplate: string,
	currentVersion: string,
): { target: SkillTargetItem; status: SkillStatus; fullPath: string }[] {
	const outdated: { target: SkillTargetItem; status: SkillStatus; fullPath: string }[] = [];
	for (const target of getSupportedSkillTargets()) {
		const fullPath = path.join(workspaceRoot, target.dir, target.file);
		if (fs.existsSync(fullPath)) {
			try {
				const localContent = fs.readFileSync(fullPath, "utf-8");
				const res = new AgentRuleAsset("local", localContent).evaluateLifecycle(rawOfficialTemplate, currentVersion);
				if (res.status === "CleanOutdated" || res.status === "CustomModified") {
					outdated.push({ target, status: res.status, fullPath });
				}
			} catch {
				// 忽略单文件读取异常
			}
		}
	}
	return outdated;
}

async function promptAndHandleSkillUpdates(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	outdatedTargets: { target: SkillTargetItem; status: SkillStatus; fullPath: string }[],
	rawOfficialTemplate: string,
	currentVersion: string,
): Promise<void> {
	const cleanOutdatedList = outdatedTargets.filter((t) => t.status === "CleanOutdated");
	const customModifiedList = outdatedTargets.filter((t) => t.status === "CustomModified");

	const actions: string[] = [];
	const updateAction = cleanOutdatedList.length > 0 ? vscode.l10n.t("Update Clean Skills") : undefined;
	const diffAction = customModifiedList.length === 1 ? vscode.l10n.t("View Diff") : undefined;
	const diagnoseAction = vscode.l10n.t("Open Diagnostics");
	const dismissAction = vscode.l10n.t("Later");

	if (updateAction) actions.push(updateAction);
	if (diffAction) actions.push(diffAction);
	actions.push(diagnoseAction, dismissAction);

	const promptMsg = customModifiedList.length > 0
		? vscode.l10n.t("Scene Breakpoints: Found {0} installed AI Skill(s) with local modifications or available updates (v{1}).", outdatedTargets.length, currentVersion)
		: vscode.l10n.t("Scene Breakpoints: Found {0} installed AI Skill(s) with available updates (v{1}).", outdatedTargets.length, currentVersion);

	const selected = await vscode.window.showInformationMessage(promptMsg, ...actions);

	if (selected === updateAction) {
		for (const { target } of cleanOutdatedList) {
			await writeSkillToTarget(context, workspaceRoot, target);
		}
		void vscode.window.showInformationMessage(vscode.l10n.t("Successfully updated {0} Skill(s) to v{1}.", cleanOutdatedList.length, currentVersion));
	} else if (selected === diffAction && customModifiedList.length === 1) {
		const { target, fullPath } = customModifiedList[0];
		const expectedBytes = formatSkillContent(Buffer.from(rawOfficialTemplate, "utf-8"), target);
		templateContentProvider.setTemplateContent(target.file, Buffer.from(expectedBytes).toString("utf-8"));
		await vscode.commands.executeCommand(
			"vscode.diff",
			vscode.Uri.file(fullPath),
			vscode.Uri.parse(`scene-breakpoints-template://template/${target.file}`),
			`${target.label} (${vscode.l10n.t("Local vs Official v{0}", currentVersion)})`,
		);
	} else if (selected === diagnoseAction) {
		await vscode.commands.executeCommand("sceneBreakpoints.diagnoseAiIntegration");
	}
}

export function getSupportedSkillTargets(): SkillTargetItem[] {
	return [
		// 1. Antigravity 工作区 Skill 体系 (默认置顶，保证首屏直达)
		{
			label: "Antigravity",
			description: ".agents/skills/scene-breakpoints/SKILL.md",
			dir: ".agents/skills/scene-breakpoints",
			file: "SKILL.md",
			hostKeywords: ["antigravity"],
		},
		// 2. Trae IDE 技能体系
		{
			label: "Trae IDE",
			description: ".trae/skills/scene-breakpoints/SKILL.md",
			dir: ".trae/skills/scene-breakpoints",
			file: "SKILL.md",
			hostKeywords: ["trae"],
		},
		// 3. Cursor IDE 专属 MDC 规则体系
		{
			label: "Cursor",
			description: ".cursor/rules/scene-breakpoints.mdc",
			dir: ".cursor/rules",
			file: "scene-breakpoints.mdc",
			hostKeywords: ["cursor"],
			customHeader: `---\ndescription: Orchestrate and declare breakpoint scenes in .vscode/debug-scenes.json for debugging workflows and code reading\nglobs: **\n---\n\n`,
		},
		// 4. VS Code / GitHub Copilot 官方 Skills 体系
		{
			label: "VS Code / GitHub Copilot",
			description: ".github/skills/scene-breakpoints/SKILL.md",
			dir: ".github/skills/scene-breakpoints",
			file: "SKILL.md",
			hostKeywords: ["visual studio code", "vscode", "code"],
		},
		// 5. Windsurf (Codeium) 级联规则体系
		{
			label: "Windsurf",
			description: ".windsurf/rules/scene-breakpoints.md",
			dir: ".windsurf/rules",
			file: "scene-breakpoints.md",
			hostKeywords: ["windsurf", "codeium"],
		},
		// 6. Cline (Claude Dev) 自主 Agent 规则体系
		{
			label: "Cline",
			description: ".clinerules/scene-breakpoints.md",
			dir: ".clinerules",
			file: "scene-breakpoints.md",
			hostKeywords: ["cline"],
		},
		// 7. Roo Code (Roo Cline) 规则体系
		{
			label: "Roo Code",
			description: ".roorules/scene-breakpoints.md",
			dir: ".roorules",
			file: "scene-breakpoints.md",
			hostKeywords: ["roo"],
		},
		// 8. Continue.dev 开源 Agent 提示词体系
		{
			label: "Continue",
			description: ".continue/prompts/scene-breakpoints.prompt",
			dir: ".continue/prompts",
			file: "scene-breakpoints.prompt",
			hostKeywords: ["continue"],
		},
	];
}

async function pickSkillTargets(workspaceRoot: string): Promise<SkillTargetItem[] | undefined> {
	const items = getSupportedSkillTargets();
	for (const item of items) {
		const fullPath = path.join(workspaceRoot, item.dir, item.file);
		if (fs.existsSync(fullPath)) {
			item.description = `${item.description} (${vscode.l10n.t("Installed")})`;
			item.picked = true;
		}
	}
	return await vscode.window.showQuickPick(items, {
		canPickMany: true,
		placeHolder: vscode.l10n.t("Select target AI Agent environments to install Skill"),
	});
}
