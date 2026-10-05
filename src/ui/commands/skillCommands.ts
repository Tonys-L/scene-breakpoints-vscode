import * as vscode from "vscode";
import { LATEST_SKILL_VERSION } from "#src/domain/models/agentRuleAsset";
import {
	agentSkillService,
	type InspectedSkillTarget,
} from "#src/application/agentSkillService";
import { runWithWorkspace } from "#src/ui/utils/commandRunner";
import {
	type SkillTargetItem,
	readOfficialTemplate,
	writeSkillToTarget,
	showSkillDiff,
} from "#src/ui/utils/agentRuleManager";

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

	const rawOfficialTemplate = await readOfficialTemplate(context);
	if (!rawOfficialTemplate) {
		return;
	}

	const inspectedTargets = agentSkillService.inspectSkillTargets(
		workspaceRoot,
		rawOfficialTemplate,
		currentVersion,
	);
	const outdatedTargets = inspectedTargets.filter(
		(t) => t.status === "CleanOutdated" || t.status === "CustomModified",
	);
	if (outdatedTargets.length === 0) return;

	await context.workspaceState.update("lastNotifiedSkillVersion", currentVersion);
	await promptAndHandleSkillUpdates(context, workspaceRoot, outdatedTargets, rawOfficialTemplate, currentVersion);
}

async function promptAndHandleSkillUpdates(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	outdatedTargets: InspectedSkillTarget[],
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
		await showSkillDiff(target, fullPath, rawOfficialTemplate, currentVersion);
	} else if (selected === diagnoseAction) {
		await vscode.commands.executeCommand("sceneBreakpoints.diagnoseAiIntegration");
	}
}

async function pickSkillTargets(workspaceRoot: string): Promise<SkillTargetItem[] | undefined> {
	const inspected = agentSkillService.inspectSkillTargets(workspaceRoot);
	const items: SkillTargetItem[] = inspected.map((item) => ({
		...item.target,
		description: item.exists
			? `${item.target.description} (${vscode.l10n.t("Installed")})`
			: item.target.description,
		picked: item.exists,
	}));

	return await vscode.window.showQuickPick(items, {
		canPickMany: true,
		placeHolder: vscode.l10n.t("Select target AI Agent environments to install Skill"),
	});
}
