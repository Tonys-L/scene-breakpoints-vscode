import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { getWorkspaceRoot, loadScenesConfig } from "../configManager";
import { sceneStateManager } from "../sceneStateManager";

interface SkillTargetItem extends vscode.QuickPickItem {
	dir: string;
	file: string;
	customHeader?: string;
}

function formatSkillContent(baseContent: Uint8Array, target: SkillTargetItem): Uint8Array {
	if (target.customHeader) {
		const baseStr = Buffer.from(baseContent).toString("utf-8");
		return Buffer.from(target.customHeader + baseStr, "utf-8");
	}
	return baseContent;
}

/**
 * 将内置 Skill 模板安全格式化并写入指定 Agent 目录
 */
async function writeSkillToTarget(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	target: SkillTargetItem,
): Promise<boolean> {
	const skillSourceUri = vscode.Uri.joinPath(
		context.extensionUri,
		"skills",
		"manage-scenes",
		"SKILL.md",
	);

	let content: Uint8Array;
	try {
		content = await vscode.workspace.fs.readFile(skillSourceUri);
	} catch (error) {
		vscode.window.showErrorMessage(
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
		vscode.window.showErrorMessage(
			vscode.l10n.t("Failed to write Skill file: {0}", String(error)),
		);
		return false;
	}
}

/**
 * 分发安装 Skill 到指定 Agent 目录命令 (sceneBreakpoints.installSkill)
 */
export async function installSkillCommand(context: vscode.ExtensionContext): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(true);
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(vscode.l10n.t("Please open a workspace folder first."));
		return;
	}

	const targets = await pickSkillTargets(workspaceRoot);
	if (!targets || targets.length === 0) {
		return;
	}

	for (const target of targets) {
		const success = await writeSkillToTarget(context, workspaceRoot, target);
		if (!success) return;
	}

	vscode.window.showInformationMessage(
		vscode.l10n.t("Scene Breakpoints Skill successfully deployed to target directory."),
	);
}

/**
 * AI 集成状态全维诊断命令 (sceneBreakpoints.diagnoseAiIntegration)
 */
export async function diagnoseAiIntegrationCommand(context: vscode.ExtensionContext): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(true);
	if (!workspaceRoot) {
		vscode.window.showErrorMessage(vscode.l10n.t("Please open a workspace folder first."));
		return;
	}

	const config = vscode.workspace.getConfiguration("sceneBreakpoints");
	const allowAiActivation = config.get<boolean>("allowAiFileActivation", false);
	const activeScenes = sceneStateManager.getActiveScenes();

	const targetItems = getSupportedSkillTargets();
	const diagnostics: (vscode.QuickPickItem & { action?: () => Promise<void> })[] = [];

	// 1. 权限守卫诊断项
	diagnostics.push({
		label: allowAiActivation
			? `$(pass) ${vscode.l10n.t("AI File Activation: Enabled")}`
			: `$(warning) ${vscode.l10n.t("AI File Activation: Disabled (Click to Enable)")}`,
		description: allowAiActivation
			? vscode.l10n.t("AI Agent can declaratively activate scenes via activeScenes")
			: vscode.l10n.t("External activeScenes modifications are currently ignored"),
		action: async () => {
			if (!allowAiActivation) {
				await config.update("allowAiFileActivation", true, vscode.ConfigurationTarget.Workspace);
				vscode.window.showInformationMessage(
					vscode.l10n.t("AI File Activation has been enabled for this workspace."),
				);
			}
		},
	});

	// 2. 当前激活场景诊断项
	diagnostics.push({
		label: `$(symbol-event) ${vscode.l10n.t("Active Scenes: [{0}]", activeScenes.length > 0 ? activeScenes.join(", ") : "None")}`,
		description: vscode.l10n.t("Current effective breakpoint scenes"),
	});

	// 3. 各平台 Skill 存在性诊断与一键安装
	diagnostics.push({
		label: vscode.l10n.t("Skill Deployment Status across Platforms:"),
		kind: vscode.QuickPickItemKind.Separator,
	});

	for (const target of targetItems) {
		const fullPath = path.join(workspaceRoot, target.dir, target.file);
		const exists = fs.existsSync(fullPath);
		diagnostics.push({
			label: exists ? `$(check) ${target.label}` : `$(add) ${target.label} (${vscode.l10n.t("Click to Install")})`,
			description: target.description,
			detail: exists ? vscode.l10n.t("Installed: {0}", fullPath) : vscode.l10n.t("Not installed yet"),
			action: async () => {
				if (!exists) {
					const success = await writeSkillToTarget(context, workspaceRoot, target);
					if (success) {
						vscode.window.showInformationMessage(
							vscode.l10n.t("Skill installed to {0}", target.label),
						);
					}
				}
			},
		});
	}

	const selected = await vscode.window.showQuickPick(diagnostics, {
		placeHolder: vscode.l10n.t("Scene Breakpoints AI Integration Diagnostics"),
	});

	if (selected?.action) {
		await selected.action();
	}
}

function getSupportedSkillTargets(): SkillTargetItem[] {
	return [
		// 1. Cursor IDE 专属 MDC 规则体系
		{
			label: "Cursor",
			description: ".cursor/rules/manage-scenes.mdc",
			dir: ".cursor/rules",
			file: "manage-scenes.mdc",
			customHeader: `---\ndescription: Manage and declare breakpoint scenes for debugging\nglobs: **\n---\n\n`,
		},
		// 2. Windsurf (Codeium) 级联规则体系
		{
			label: "Windsurf",
			description: ".windsurf/rules/manage-scenes.md",
			dir: ".windsurf/rules",
			file: "manage-scenes.md",
		},
		// 3. Cline (Claude Dev) 自主 Agent 规则体系
		{
			label: "Cline",
			description: ".clinerules/manage-scenes.md",
			dir: ".clinerules",
			file: "manage-scenes.md",
		},
		// 4. Roo Code (Roo Cline) 规则体系
		{
			label: "Roo Code",
			description: ".roorules/manage-scenes.md",
			dir: ".roorules",
			file: "manage-scenes.md",
		},
		// 5. Continue.dev 开源 Agent 提示词体系
		{
			label: "Continue",
			description: ".continue/prompts/manage-scenes.prompt",
			dir: ".continue/prompts",
			file: "manage-scenes.prompt",
		},
		// 6. VS Code / GitHub Copilot 官方 Skills 体系
		// TODO(v1.0.4): VS Code Copilot Skill 路径待官方稳定后验证，当前为推测路径
		{
			label: "VS Code / GitHub Copilot",
			description: ".github/skills/manage-scenes/SKILL.md",
			dir: ".github/skills/manage-scenes",
			file: "SKILL.md",
		},
		// 7. Trae IDE 技能体系
		// TODO(v1.0.4): Trae 的 Skill 格式规范待官方文档明确，当前直接复用标准 SKILL.md
		{
			label: "Trae IDE",
			description: ".trae/skills/manage-scenes/SKILL.md",
			dir: ".trae/skills/manage-scenes",
			file: "SKILL.md",
		},
		// 8. Antigravity 工作区 Skill 体系
		{
			label: "Antigravity",
			description: ".agents/skills/manage-scenes/SKILL.md",
			dir: ".agents/skills/manage-scenes",
			file: "SKILL.md",
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
