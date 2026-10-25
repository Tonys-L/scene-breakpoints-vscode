import * as vscode from "vscode";
import type { SourceSceneBreakpoint } from "#src/domain/types";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { getLatestWatchResults } from "#src/application/debugPauseContext";

export interface BreakpointTooltipItem {
	sceneName: string;
	stepIndex: number;
	breakpoint: SourceSceneBreakpoint;
}

export function appendWatchTableMarkdown(
	md: vscode.MarkdownString,
	bp: SourceSceneBreakpoint,
	wsRoot?: string,
): void {
	if (!Array.isArray(bp.watch) || bp.watch.length === 0) return;

	md.appendMarkdown(`\n\n---\n**👁️ ${vscode.l10n.t("Watch Anchors")}**\n`);
	const latestResults = getLatestWatchResults(bp.file, bp.line, wsRoot);
	if (!latestResults || latestResults.length === 0) {
		for (const w of bp.watch) {
			const exp = bp.expected ? bp.expected[w] : undefined;
			const expStr = exp !== undefined ? ` *(expected: \`${JSON.stringify(exp)}\`)*` : "";
			md.appendMarkdown(`\n- \`${w}\`${expStr}`);
		}
		return;
	}

	md.appendMarkdown(`\n| ${vscode.l10n.t("Expression")} | ${vscode.l10n.t("Value")} | ${vscode.l10n.t("Expected")} | ${vscode.l10n.t("Status")} |`);
	md.appendMarkdown(`\n| :--- | :--- | :--- | :--- |`);
	for (const r of latestResults) {
		let statusText = "🟢 Observed";
		if (r.isMatched === true) statusText = "✅";
		else if (r.isMatched === false) statusText = "❌ Mismatch";
		else if (r.error) statusText = "⚠️ Error";

		let valDisplay = "-";
		if (r.error) {
			const firstLine = r.error.split("\n")[0].trim();
			valDisplay = `\`<error: ${firstLine.replace(/\|/g, "\\|")}>\``;
		} else if (r.value) {
			valDisplay = `\`${r.value.replace(/\|/g, "\\|")}\``;
		}
		const expDisplay = r.expected !== undefined ? `\`${JSON.stringify(r.expected)}\`` : "-";
		md.appendMarkdown(`\n| \`${r.expression}\` | ${valDisplay} | ${expDisplay} | ${statusText} |`);
	}
}

/**
 * 格式化场景断点富文本 Hover / Tooltip Markdown
 */
export function formatBreakpointTooltipMarkdown(
	stepItems: BreakpointTooltipItem[],
	wsRoot?: string,
): vscode.MarkdownString {
	const md = new vscode.MarkdownString("", true);
	md.isTrusted = true;

	for (let i = 0; i < stepItems.length; i++) {
		const item = stepItems[i];
		const bp = item.breakpoint;
		const isUnmatched = sceneStateManager.isBreakpointUnmatched(bp.file, bp.line);

		if (i > 0) {
			md.appendMarkdown("\n\n---\n\n");
		}

		md.appendMarkdown(`### 💡 ${vscode.l10n.t("Scene Breakpoint: {0}", item.sceneName)}\n\n`);
		md.appendMarkdown(`- **${vscode.l10n.t("Step")}**: #${item.stepIndex}\n`);
		md.appendMarkdown(`- **${vscode.l10n.t("Type")}**: \`${bp.type}\`\n`);

		if (bp.desc) md.appendMarkdown(`- **${vscode.l10n.t("Description")}**: ${bp.desc}\n`);
		if (bp.condition) md.appendMarkdown(`- **${vscode.l10n.t("Condition")}**: \`${bp.condition}\`\n`);
		if (bp.hitCondition) md.appendMarkdown(`- **${vscode.l10n.t("Hit Condition")}**: \`${bp.hitCondition}\`\n`);
		if (bp.logMessage) md.appendMarkdown(`- **${vscode.l10n.t("Log Message")}**: \`${bp.logMessage}\`\n`);
		if (isUnmatched) md.appendMarkdown(`- **${vscode.l10n.t("Status")}**: ⚠️ ${vscode.l10n.t("Unmatched (Code Drift Detected)")}\n`);

		appendWatchTableMarkdown(md, bp, wsRoot);
	}

	return md;
}
