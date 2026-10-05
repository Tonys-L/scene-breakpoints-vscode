import * as path from "node:path";
import * as vscode from "vscode";
import { LATEST_SKILL_VERSION } from "#src/domain/models/agentRuleAsset";
import { runWithWorkspace } from "#src/ui/utils/commandRunner";
import { sceneStateManager } from "#src/application/sceneStateManager";
import {
	agentSkillService,
	type InspectedSkillTarget,
	type SkillTargetConfig,
} from "#src/application/agentSkillService";
import {
	backupSkillFile,
	readOfficialTemplate,
	writeSkillToTarget,
	showSkillDiff,
} from "#src/ui/utils/agentRuleManager";

type DiagnosticItem = vscode.QuickPickItem & { action?: () => Promise<void> };

function createPermissionDiagnostic(
	config: vscode.WorkspaceConfiguration,
	allowAiActivation: boolean,
): DiagnosticItem {
	return {
		label: allowAiActivation
			? `$(pass) ${vscode.l10n.t("AI File Activation: Enabled")}`
			: `$(warning) ${vscode.l10n.t("AI File Activation: Disabled (Click to Enable)")}`,
		description: allowAiActivation
			? vscode.l10n.t("AI Agent can declaratively activate scenes via activeScenes")
			: vscode.l10n.t("External activeScenes modifications are currently ignored"),
		action: async () => {
			if (!allowAiActivation) {
				await config.update("allowAiFileActivation", true, vscode.ConfigurationTarget.Workspace);
				void vscode.window.showInformationMessage(
					vscode.l10n.t("AI File Activation has been enabled for this workspace."),
				);
			}
		},
	};
}

function createActiveScenesDiagnostic(activeScenes: string[]): DiagnosticItem {
	return {
		label: `$(symbol-event) ${vscode.l10n.t("Active Scenes: [{0}]", activeScenes.length > 0 ? activeScenes.join(", ") : "None")}`,
		description: vscode.l10n.t("Current effective breakpoint scenes"),
	};
}

async function handleCustomModifiedAction(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	target: SkillTargetConfig,
	fullPath: string,
	rawOfficialTemplate: string,
): Promise<void> {
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
		await showSkillDiff(target, fullPath, rawOfficialTemplate, LATEST_SKILL_VERSION);
	} else if (choice?.value === "backup") {
		const backupPath = backupSkillFile(fullPath);
		await writeSkillToTarget(context, workspaceRoot, target);
		void vscode.window.showInformationMessage(
			vscode.l10n.t(
				"Skill updated to v{0}. Original backed up to: {1}",
				LATEST_SKILL_VERSION,
				path.basename(backupPath),
			),
		);
	}
}

function createTargetItemDiagnostic(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	item: InspectedSkillTarget,
	rawOfficialTemplate: string,
	currentVersion: string,
): DiagnosticItem {
	const { target, fullPath, status } = item;

	if (status === "NotInstalled") {
		return {
			label: `$(add) ${target.label} (${vscode.l10n.t("Not Installed - Click to Install")})`,
			description: target.description,
			detail: vscode.l10n.t("Click to deploy v{0} Skill", currentVersion),
			action: async () => {
				const success = await writeSkillToTarget(context, workspaceRoot, target);
				if (success) {
					void vscode.window.showInformationMessage(
						vscode.l10n.t("Skill installed to {0}", target.label),
					);
				}
			},
		};
	}

	if (status === "UpToDate") {
		return {
			label: `$(pass) ${target.label} (${vscode.l10n.t("Up to Date: v{0}", currentVersion)})`,
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
					void vscode.window.showInformationMessage(
						vscode.l10n.t("Skill reinstalled to {0}", target.label),
					);
				}
			},
		};
	}

	if (status === "CleanOutdated") {
		return {
			label: `$(sync) ${target.label} (${vscode.l10n.t("Updatable: v{0} -> v{1}", item.detectedVersion || "1.0.x", currentVersion)})`,
			description: target.description,
			detail: vscode.l10n.t("Official template outdated. Click to update smoothly."),
			action: async () => {
				const success = await writeSkillToTarget(context, workspaceRoot, target);
				if (success) {
					void vscode.window.showInformationMessage(
						vscode.l10n.t("Skill successfully updated to v{0} ({1})", currentVersion, target.label),
					);
				}
			},
		};
	}

	return {
		label: `$(diff) ${target.label} (${vscode.l10n.t("Customized (Click to Diff / Update)")})`,
		description: target.description,
		detail: vscode.l10n.t("Modified locally. Click to view diff or backup & update."),
		action: () => handleCustomModifiedAction(context, workspaceRoot, target, fullPath, rawOfficialTemplate),
	};
}

/**
 * AI 集成状态全维诊断命令 (sceneBreakpoints.diagnoseAiIntegration)
 * 检查当前工作区的 allowAiFileActivation、激活场景，以及在各 AI 宿主平台中的规则/技能安装与生命周期状态
 */
export async function diagnoseAiIntegrationCommand(context: vscode.ExtensionContext): Promise<void> {
	await runWithWorkspace(async (workspaceRoot) => {
		const config = vscode.workspace.getConfiguration("sceneBreakpoints");
		const allowAiActivation = config.get<boolean>("allowAiFileActivation", false);
		const activeScenes = sceneStateManager.getActiveScenes();
		const currentVersion = context.extension?.packageJSON?.version || LATEST_SKILL_VERSION;
		const rawOfficialTemplate = await readOfficialTemplate(context);

		const diagnostics: DiagnosticItem[] = [
			createPermissionDiagnostic(config, allowAiActivation),
			createActiveScenesDiagnostic(activeScenes),
			{
				label: vscode.l10n.t("Skill Deployment & Version Status across Platforms:"),
				kind: vscode.QuickPickItemKind.Separator,
			},
		];

		const sortedTargetItems = agentSkillService.inspectSkillTargets(
			workspaceRoot,
			rawOfficialTemplate,
			currentVersion,
			vscode.env.appName,
		);
		for (const item of sortedTargetItems) {
			diagnostics.push(
				createTargetItemDiagnostic(context, workspaceRoot, item, rawOfficialTemplate, currentVersion),
			);
		}

		const selected = await vscode.window.showQuickPick(diagnostics, {
			placeHolder: vscode.l10n.t("Scene Breakpoints AI Integration Diagnostics"),
		});

		if (selected?.action) {
			await selected.action();
		}
	});
}
