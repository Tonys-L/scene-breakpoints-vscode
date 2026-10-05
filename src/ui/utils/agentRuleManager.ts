import * as vscode from "vscode";
import { templateContentProvider } from "#src/ui/views/templateContentProvider";
import {
	type SkillTargetConfig,
	type InspectedSkillTarget,
	agentSkillService,
	formatSkillContent,
	backupSkillFile,
	getSupportedSkillTargets,
} from "#src/application/agentSkillService";

export {
	formatSkillContent,
	backupSkillFile,
	getSupportedSkillTargets,
	type SkillTargetConfig,
	type InspectedSkillTarget,
};

export interface SkillTargetItem extends vscode.QuickPickItem, SkillTargetConfig {}

/**
 * 读取官方内置 Skill 模版文本
 */
export async function readOfficialTemplate(context: vscode.ExtensionContext): Promise<string> {
	const skillSourceUri = vscode.Uri.joinPath(
		context.extensionUri,
		"skills",
		"scene-breakpoints",
		"SKILL.md",
	);
	try {
		const rawBytes = await vscode.workspace.fs.readFile(skillSourceUri);
		return Buffer.from(rawBytes).toString("utf-8");
	} catch {
		return "";
	}
}

/**
 * 将内置 Skill 模板安全格式化并写入指定 Agent 目录
 */
export async function writeSkillToTarget(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	target: SkillTargetConfig,
): Promise<boolean> {
	const templateStr = await readOfficialTemplate(context);
	if (!templateStr) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t("Failed to read built-in Skill template: {0}", "Template file not found or empty"),
		);
		return false;
	}

	const success = await agentSkillService.deploySkillToTarget(workspaceRoot, target, templateStr);
	if (!success) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t("Failed to write Skill file: {0}", target.file),
		);
	}
	return success;
}

/**
 * 弹出虚拟文档并排比对窗口 (Local vs Official Template)
 */
export async function showSkillDiff(
	target: Pick<SkillTargetConfig, "file" | "label" | "customHeader">,
	fullPath: string,
	rawOfficialTemplate: string,
	currentVersion: string,
): Promise<void> {
	const expectedBytes = formatSkillContent(rawOfficialTemplate, target);
	templateContentProvider.setTemplateContent(target.file, Buffer.from(expectedBytes).toString("utf-8"));
	await vscode.commands.executeCommand(
		"vscode.diff",
		vscode.Uri.file(fullPath),
		vscode.Uri.parse(`scene-breakpoints-template://template/${target.file}`),
		`${target.label} (${vscode.l10n.t("Local vs Official v{0}", currentVersion)})`,
	);
}

/**
 * Agent 规则文件与模板管道协调器
 */
export const agentRuleManager = {
	getSupportedSkillTargets,
	formatSkillContent,
	backupSkillFile,
	readOfficialTemplate,
	writeSkillToTarget,
	showSkillDiff,
};
