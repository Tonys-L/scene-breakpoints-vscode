import * as path from "node:path";
import * as vscode from "vscode";
import { sceneStateManager } from "#src/application/sceneStateManager";
import type { FunctionSceneBreakpoint, SceneBreakpoint, SourceSceneBreakpoint } from "#src/domain/types";

export type SceneTreeItem = SceneNode | BreakpointNode | PlaceholderNode;

/**
 * 场景节点 (SceneNode)：代表一组场景断点集合的折叠容器
 */
export class SceneNode extends vscode.TreeItem {
	public static readonly expandedScenes = new Set<string>();

	constructor(
		public readonly sceneName: string,
		public readonly breakpointCount: number,
		public readonly isActive: boolean,
		public readonly isDirty: boolean,
	) {
		const isExpanded = SceneNode.expandedScenes.has(sceneName) || isActive;
		super(
			sceneName,
			isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
		);

		let desc = vscode.l10n.t("{0} breakpoint(s)", breakpointCount);
		if (isActive) {
			desc = isDirty
				? `${desc}  •  ${vscode.l10n.t("(Active - Unsaved*)")}`
				: `${desc}  •  ${vscode.l10n.t("(Active)")}`;
		}
		this.description = desc;

		if (isActive) {
			this.iconPath = new vscode.ThemeIcon("debug-alt", new vscode.ThemeColor("charts.green"));
			this.contextValue = "activeSceneItem";
		} else {
			this.iconPath = new vscode.ThemeIcon("symbol-event");
			this.contextValue = "sceneItem";
		}

		// 声明稳定唯一的 TreeItem.id，启用 VS Code 原生 DOM Diff 就地更新机制，彻底杜绝整树重绘闪烁
		this.id = `scene:${sceneName}`;

		this.tooltip = vscode.l10n.t("Scene: [{0}] ({1} breakpoints)", sceneName, breakpointCount);
	}
}

/**
 * 断点节点 (BreakpointNode)：代表具体的一处代码行断点或函数断点
 */
export class BreakpointNode extends vscode.TreeItem {
	constructor(
		public readonly sceneName: string,
		public readonly index: number,
		public readonly breakpoint: SceneBreakpoint,
		private readonly workspaceRoot: string,
		private readonly extensionPath: string,
		private pausedLocation: { file: string; line: number } | null = null,
	) {
		const isFunc = breakpoint.type === "function";
		const label = isFunc
			? `ƒ ${(breakpoint as FunctionSceneBreakpoint).functionName}()`
			: `${path.basename((breakpoint as SourceSceneBreakpoint).file || "")}:${(breakpoint as SourceSceneBreakpoint).line}`;

		// 必须在访问 this 之前首先调用 super() 初始化基类
		super(label, vscode.TreeItemCollapsibleState.None);

		// 声明稳定唯一的 TreeItem.id，告知宿主新旧节点属于同一实体，点击勾选时实现 0 闪烁就地属性更新
		const bpIdentifier = isFunc
			? (breakpoint as FunctionSceneBreakpoint).functionName
			: `${(breakpoint as SourceSceneBreakpoint).file}:${(breakpoint as SourceSceneBreakpoint).line}`;
		this.id = `bp:${sceneName}:${index}:${bpIdentifier}`;

		if (!isFunc) {
			const srcBp = breakpoint as SourceSceneBreakpoint;
			const fullFilePath = path.isAbsolute(srcBp.file) ? srcBp.file : path.join(workspaceRoot, srcBp.file);
			const targetLine = Math.max(0, srcBp.line - 1);
			this.command = {
				command: "vscode.open",
				title: vscode.l10n.t("Open File"),
				arguments: [
					vscode.Uri.file(fullFilePath),
					{
						selection: new vscode.Range(targetLine, 0, targetLine, 0),
						preview: true,
					},
				],
			};
		}

		this.updateAppearance();
	}

	public setPausedLocation(loc: { file: string; line: number } | null): void {
		this.pausedLocation = loc;
		this.updateAppearance();
	}

	public isPausedAtBreakpoint(): boolean {
		if (!this.pausedLocation || this.breakpoint.type === "function") {
			return false;
		}
		const srcBp = this.breakpoint as SourceSceneBreakpoint;
		if (Number(srcBp.line) !== Number(this.pausedLocation.line)) {
			return false;
		}
		const fullFilePath = path.isAbsolute(srcBp.file) ? srcBp.file : path.join(this.workspaceRoot, srcBp.file);
		if (isSamePath(fullFilePath, this.pausedLocation.file)) {
			return true;
		}
		// 容错：尾部路径匹配（应对 monorepo/符号链接/路径前缀差异）
		const p1 = this.pausedLocation.file.replace(/\\/g, "/").toLowerCase();
		const p2 = srcBp.file.replace(/\\/g, "/").toLowerCase();
		return p1.endsWith("/" + p2) || p1.endsWith(p2);
	}

	public updateAppearance(): void {
		const isEnabled = this.breakpoint.enabled ?? true;
		this.checkboxState = isEnabled
			? vscode.TreeItemCheckboxState.Checked
			: vscode.TreeItemCheckboxState.Unchecked;

		const isPaused = this.isPausedAtBreakpoint();
		const hintText = vscode.l10n.t("Tip: Drag to reorder, or use Alt+↑ / Alt+↓ to move");

		this.buildDescriptionAndTooltip(isPaused, hintText);

		const iconFileName = this.resolveIconFileName(isEnabled, isPaused);
		this.iconPath = vscode.Uri.file(path.join(this.extensionPath, "media", "icons", iconFileName));
		this.contextValue = isEnabled ? "breakpointItemEnabled" : "breakpointItemDisabled";
	}

	private buildDescriptionAndTooltip(isPaused: boolean, hintText: string): void {
		if (this.breakpoint.type === "function") {
			const funcBp = this.breakpoint as FunctionSceneBreakpoint;
			this.description = funcBp.desc || funcBp.condition || funcBp.hitCondition;
			const md = new vscode.MarkdownString();
			md.appendMarkdown(`**${vscode.l10n.t("Function Breakpoint: {0}", funcBp.functionName)}**`);
			if (funcBp.desc) md.appendMarkdown(`\n\n${funcBp.desc}`);
			md.appendMarkdown(`\n\n---\n*💡 ${hintText}*`);
			this.tooltip = md;
			return;
		}

		const srcBp = this.breakpoint as SourceSceneBreakpoint;
		const isUnmatched =
			sceneStateManager.isSceneActive(this.sceneName) &&
			sceneStateManager.isBreakpointUnmatched(srcBp.file, srcBp.line);

		let extra = srcBp.desc;
		if (!extra) {
			if (srcBp.type === "condition") extra = `? ${srcBp.condition}`;
			else if (srcBp.type === "hitCount") extra = `# ${srcBp.hitCondition}`;
			else if (srcBp.type === "logpoint") extra = `log: "${srcBp.logMessage}"`;
		}
		if (isUnmatched) {
			const unmatchTag = `[${vscode.l10n.t("Unmatched")}]`;
			extra = extra ? `${unmatchTag}  •  ${extra}` : unmatchTag;
		}
		if (isPaused) {
			const pausedTag = `▶ ${vscode.l10n.t("[PAUSED]")}`;
			extra = extra ? `${pausedTag}  •  ${extra}` : pausedTag;
		}
		this.description = extra;

		const md = new vscode.MarkdownString();
		if (isPaused) {
			md.appendMarkdown(`▶ **[${vscode.l10n.t("Currently Paused Here")}]**\n\n`);
		}
		if (isUnmatched) {
			md.appendMarkdown(`⚠️ **[${vscode.l10n.t("Unmatched")}]** ${vscode.l10n.t("Could not match current code (fell back to original line)")}\n\n`);
		}
		md.appendMarkdown(`\`${srcBp.file}:${srcBp.line}\``);
		if (srcBp.desc) md.appendMarkdown(`\n\n${srcBp.desc}`);
		md.appendMarkdown(`\n\n---\n*💡 ${hintText}*`);
		this.tooltip = md;
	}

	private resolveIconFileName(isEnabled: boolean, isPaused: boolean): string {
		if (isPaused) return "bp-paused.svg";

		const isUnmatched =
			this.breakpoint.type !== "function" &&
			sceneStateManager.isSceneActive(this.sceneName) &&
			sceneStateManager.isBreakpointUnmatched(
				(this.breakpoint as SourceSceneBreakpoint).file,
				(this.breakpoint as SourceSceneBreakpoint).line,
			);
		if (isUnmatched) {
			return isEnabled ? "bp-unmatched-enabled.svg" : "bp-unmatched-disabled.svg";
		}

		let iconBase = "bp-line";
		if (this.breakpoint.type === "function") {
			iconBase = "bp-func";
		} else {
			const srcBp = this.breakpoint as SourceSceneBreakpoint;
			switch (srcBp.type) {
				case "condition":
					iconBase = "bp-cond";
					break;
				case "hitCount":
					iconBase = "bp-hit";
					break;
				case "logpoint":
					iconBase = "bp-log";
					break;
				default:
					iconBase = "bp-line";
					break;
			}
		}
		return `${iconBase}-${isEnabled ? "enabled" : "disabled"}.svg`;
	}
}

/**
 * 路径比对标准化辅助函数
 */
export function isSamePath(p1: string, p2: string): boolean {
	const n1 = path.normalize(p1).toLowerCase();
	const n2 = path.normalize(p2).toLowerCase();
	return n1 === n2;
}

/**
 * 空态占位节点 (PlaceholderNode)：用于展示空列表引导与提示
 */
export class PlaceholderNode extends vscode.TreeItem {
	constructor(message: string, icon = "info") {
		super(message, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon(icon);
		this.contextValue = "placeholderItem";
	}
}
