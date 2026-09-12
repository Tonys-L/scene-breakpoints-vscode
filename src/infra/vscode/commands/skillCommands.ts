import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
	LATEST_SKILL_VERSION,
	resolveSkillLifecycleState,
	SkillStatus,
} from "../../../domain/skillLifecycleResolver";
import { getWorkspaceRoot, loadScenesConfig } from "../../storage/jsonFileSceneRepository";
import { templateContentProvider } from "../templateContentProvider";
import { sceneStateManager } from "../../../domain/sceneStateManager";

export interface SkillTargetItem extends vscode.QuickPickItem {
	dir: string;
	file: string;
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
function backupSkillFile(targetFilePath: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupPath = `${targetFilePath}.${timestamp}.bak`;
	fs.copyFileSync(targetFilePath, backupPath);
	return backupPath;
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
		"scene-breakpoints",
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
		vscode.window.showInformationMessage(
			vscode.l10n.t("No target AI environments selected. Installation cancelled."),
		);
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

	// 读取官方最新模板
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
		// 容错降级
	}

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

	// 3. 各平台 Skill 存在性与版本生命周期状态诊断
	diagnostics.push({
		label: vscode.l10n.t("Skill Deployment & Version Status across Platforms:"),
		kind: vscode.QuickPickItemKind.Separator,
	});

	for (const target of targetItems) {
		const fullPath = path.join(workspaceRoot, target.dir, target.file);
		const exists = fs.existsSync(fullPath);

		if (!exists) {
			diagnostics.push({
				label: `$(add) ${target.label} (${vscode.l10n.t("Not Installed - Click to Install")})`,
				description: target.description,
				detail: vscode.l10n.t("Click to deploy v{0} Skill", LATEST_SKILL_VERSION),
				action: async () => {
					const success = await writeSkillToTarget(context, workspaceRoot, target);
					if (success) {
						vscode.window.showInformationMessage(
							vscode.l10n.t("Skill installed to {0}", target.label),
						);
					}
				},
			});
			continue;
		}

		// 本地已安装：执行三态指纹判定
		const localContent = fs.readFileSync(fullPath, "utf-8");
		const lifecycle = resolveSkillLifecycleState(localContent, rawOfficialTemplate);

		if (lifecycle.status === "UpToDate") {
			diagnostics.push({
				label: `$(pass) ${target.label} (${vscode.l10n.t("Up to Date: v{0}", LATEST_SKILL_VERSION)})`,
				description: target.description,
				detail: vscode.l10n.t("Installed: {0}", fullPath),
				action: async () => {
					const reInstall = await vscode.window.showQuickPick(
						[
							{ label: vscode.l10n.t("Reinstall / Overwrite with latest template"), value: true },
							{ label: vscode.l10n.t("Cancel"), value: false },
						],
						{ placeHolder: vscode.l10n.t("Already up to date. Do you want to reinstall?") },
					);
					if (reInstall?.value) {
						await writeSkillToTarget(context, workspaceRoot, target);
						vscode.window.showInformationMessage(
							vscode.l10n.t("Skill reinstalled to {0}", target.label),
						);
					}
				},
			});
		} else if (lifecycle.status === "CleanOutdated") {
			diagnostics.push({
				label: `$(sync) ${target.label} (${vscode.l10n.t("Updatable: v{0} -> v{1}", lifecycle.detectedVersion || "1.0.x", LATEST_SKILL_VERSION)})`,
				description: target.description,
				detail: vscode.l10n.t("Official template outdated. Click to update smoothly."),
				action: async () => {
					const success = await writeSkillToTarget(context, workspaceRoot, target);
					if (success) {
						vscode.window.showInformationMessage(
							vscode.l10n.t("Skill successfully updated to v{0} ({1})", LATEST_SKILL_VERSION, target.label),
						);
					}
				},
			});
		} else {
			// CustomModified
			diagnostics.push({
				label: `$(diff) ${target.label} (${vscode.l10n.t("Customized (Click to Diff / Update)")})`,
				description: target.description,
				detail: vscode.l10n.t("Modified locally. Click to view diff or backup & update."),
				action: async () => {
					const choice = await vscode.window.showQuickPick(
						[
							{
								label: `$(diff) ${vscode.l10n.t("View Side-by-Side Diff with Latest Official Version")}`,
								value: "diff",
							},
							{
								label: `$(save) ${vscode.l10n.t("Backup & Overwrite with Latest Version")}`,
								value: "backup",
							},
							{
								label: `$(close) ${vscode.l10n.t("Keep Current Changes")}`,
								value: "cancel",
							},
						],
						{
							placeHolder: vscode.l10n.t("Local modifications detected in {0}. Choose action:", target.file),
						},
					);

					if (choice?.value === "diff") {
						// 准备虚拟模板内容
						const expectedBytes = formatSkillContent(Buffer.from(rawOfficialTemplate, "utf-8"), target);
						const expectedStr = Buffer.from(expectedBytes).toString("utf-8");
						templateContentProvider.setTemplateContent(target.file, expectedStr);

						const localUri = vscode.Uri.file(fullPath);
						const virtualUri = vscode.Uri.parse(`scene-breakpoints-template://template/${target.file}`);

						await vscode.commands.executeCommand(
							"vscode.diff",
							localUri,
							virtualUri,
							`${target.label} (${vscode.l10n.t("Local vs Official v{0}", LATEST_SKILL_VERSION)})`,
						);
					} else if (choice?.value === "backup") {
						const backupPath = backupSkillFile(fullPath);
						await writeSkillToTarget(context, workspaceRoot, target);
						vscode.window.showInformationMessage(
							vscode.l10n.t(
								"Skill updated to v{0}. Original backed up to: {1}",
								LATEST_SKILL_VERSION,
								path.basename(backupPath),
							),
						);
					}
				},
			});
		}
	}

	const selected = await vscode.window.showQuickPick(diagnostics, {
		placeHolder: vscode.l10n.t("Scene Breakpoints AI Integration Diagnostics"),
	});

	if (selected?.action) {
		await selected.action();
	}
}

/**
 * 扩展启动或版本升级时的轻量巡检：发现过期纯净版本时给出非阻塞提示
 */
export async function checkAndPromptSkillUpdates(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
): Promise<void> {
	const lastNotifiedVer = context.workspaceState.get<string>("lastNotifiedSkillVersion");
	if (lastNotifiedVer === LATEST_SKILL_VERSION) {
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

	const targetItems = getSupportedSkillTargets();
	const outdatedTargets: { target: SkillTargetItem; status: SkillStatus; fullPath: string }[] = [];

	for (const target of targetItems) {
		const fullPath = path.join(workspaceRoot, target.dir, target.file);
		if (fs.existsSync(fullPath)) {
			try {
				const localContent = fs.readFileSync(fullPath, "utf-8");
				const res = resolveSkillLifecycleState(localContent, rawOfficialTemplate);
				if (res.status === "CleanOutdated" || res.status === "CustomModified") {
					outdatedTargets.push({ target, status: res.status, fullPath });
				}
			} catch {
				// 忽略异常
			}
		}
	}

	if (outdatedTargets.length === 0) {
		return;
	}

	// 记录已检查标记，防止同一版本重复打扰
	await context.workspaceState.update("lastNotifiedSkillVersion", LATEST_SKILL_VERSION);

	const cleanOutdatedList = outdatedTargets.filter((t) => t.status === "CleanOutdated");
	const updateAction = cleanOutdatedList.length > 0 ? vscode.l10n.t("Update Clean Skills") : undefined;
	const diagnoseAction = vscode.l10n.t("Open Diagnostics");
	const dismissAction = vscode.l10n.t("Later");

	const actions = [diagnoseAction];
	if (updateAction) {
		actions.unshift(updateAction);
	}
	actions.push(dismissAction);

	const selected = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			"Scene Breakpoints: Found {0} installed AI Skill(s) with available updates (v{1}).",
			outdatedTargets.length,
			LATEST_SKILL_VERSION,
		),
		...actions,
	);

	if (selected === updateAction) {
		for (const { target } of cleanOutdatedList) {
			await writeSkillToTarget(context, workspaceRoot, target);
		}
		vscode.window.showInformationMessage(
			vscode.l10n.t("Successfully updated {0} Skill(s) to v{1}.", cleanOutdatedList.length, LATEST_SKILL_VERSION),
		);
	} else if (selected === diagnoseAction) {
		await diagnoseAiIntegrationCommand(context);
	}
}

function getSupportedSkillTargets(): SkillTargetItem[] {
	return [
		// 1. Cursor IDE 专属 MDC 规则体系
		{
			label: "Cursor",
			description: ".cursor/rules/scene-breakpoints.mdc",
			dir: ".cursor/rules",
			file: "scene-breakpoints.mdc",
			customHeader: `---\ndescription: Orchestrate and declare breakpoint scenes in .vscode/debug-scenes.json for debugging workflows and code reading\nglobs: **\n---\n\n`,
		},
		// 2. Windsurf (Codeium) 级联规则体系
		{
			label: "Windsurf",
			description: ".windsurf/rules/scene-breakpoints.md",
			dir: ".windsurf/rules",
			file: "scene-breakpoints.md",
		},
		// 3. Cline (Claude Dev) 自主 Agent 规则体系
		{
			label: "Cline",
			description: ".clinerules/scene-breakpoints.md",
			dir: ".clinerules",
			file: "scene-breakpoints.md",
		},
		// 4. Roo Code (Roo Cline) 规则体系
		{
			label: "Roo Code",
			description: ".roorules/scene-breakpoints.md",
			dir: ".roorules",
			file: "scene-breakpoints.md",
		},
		// 5. Continue.dev 开源 Agent 提示词体系
		{
			label: "Continue",
			description: ".continue/prompts/scene-breakpoints.prompt",
			dir: ".continue/prompts",
			file: "scene-breakpoints.prompt",
		},
		// 6. VS Code / GitHub Copilot 官方 Skills 体系
		{
			label: "VS Code / GitHub Copilot",
			description: ".github/skills/scene-breakpoints/SKILL.md",
			dir: ".github/skills/scene-breakpoints",
			file: "SKILL.md",
		},
		// 7. Trae IDE 技能体系
		{
			label: "Trae IDE",
			description: ".trae/skills/scene-breakpoints/SKILL.md",
			dir: ".trae/skills/scene-breakpoints",
			file: "SKILL.md",
		},
		// 8. Antigravity 工作区 Skill 体系
		{
			label: "Antigravity",
			description: ".agents/skills/scene-breakpoints/SKILL.md",
			dir: ".agents/skills/scene-breakpoints",
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
