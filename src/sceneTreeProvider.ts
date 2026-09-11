import * as path from "node:path";
import * as vscode from "vscode";
import { getWorkspaceRoot, loadScenesConfig } from "./configManager";
import { sceneStateManager } from "./sceneStateManager";
import type { FunctionSceneBreakpoint, SceneBreakpoint, SourceSceneBreakpoint } from "./types";

export type SceneTreeItem = SceneNode | BreakpointNode | PlaceholderNode;

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

export class BreakpointNode extends vscode.TreeItem {
	constructor(
		public readonly sceneName: string,
		public readonly index: number,
		public readonly breakpoint: SceneBreakpoint,
		workspaceRoot: string,
		private readonly extensionPath: string,
	) {
		const isFunc = breakpoint.type === "function";
		const label = isFunc
			? `ƒ ${(breakpoint as FunctionSceneBreakpoint).functionName}()`
			: `${path.basename((breakpoint as SourceSceneBreakpoint).file || "")}:${(breakpoint as SourceSceneBreakpoint).line}`;

		// 必须在访问 this 之前首先调用 super() 初始化基类！
		super(label, vscode.TreeItemCollapsibleState.None);

		// 声明稳定唯一的 TreeItem.id，告知宿主新旧节点属于同一实体，点击勾选时实现 0 闪烁就地属性更新
		const bpIdentifier = isFunc
			? (breakpoint as FunctionSceneBreakpoint).functionName
			: `${(breakpoint as SourceSceneBreakpoint).file}:${(breakpoint as SourceSceneBreakpoint).line}`;
		this.id = `bp:${sceneName}:${index}:${bpIdentifier}`;

		this.updateAppearance();

		if (isFunc) {
			const funcBp = breakpoint as FunctionSceneBreakpoint;
			this.description = funcBp.desc || funcBp.condition || funcBp.hitCondition;
			this.tooltip = vscode.l10n.t("Function Breakpoint: {0}", funcBp.functionName);
		} else {
			const srcBp = breakpoint as SourceSceneBreakpoint;
			const isUnmatched =
				sceneStateManager.isSceneActive(sceneName) &&
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
			this.description = extra;

			let tip = `${srcBp.file}:${srcBp.line}${srcBp.desc ? `\n${srcBp.desc}` : ""}`;
			if (isUnmatched) {
				tip = `[${vscode.l10n.t("Unmatched")}] ${vscode.l10n.t("Could not match current code (fell back to original line)")}\n${tip}`;
			}
			this.tooltip = tip;

			// 单击直接打开源码并高亮选中断点行！
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
	}

	public updateAppearance(): void {
		const isEnabled = this.breakpoint.enabled ?? true;
		this.checkboxState = isEnabled
			? vscode.TreeItemCheckboxState.Checked
			: vscode.TreeItemCheckboxState.Unchecked;

		const isUnmatched =
			this.breakpoint.type !== "function" &&
			sceneStateManager.isSceneActive(this.sceneName) &&
			sceneStateManager.isBreakpointUnmatched(
				(this.breakpoint as SourceSceneBreakpoint).file,
				(this.breakpoint as SourceSceneBreakpoint).line,
			);

		if (isUnmatched) {
			const iconFileName = isEnabled ? "bp-unmatched-enabled.svg" : "bp-unmatched-disabled.svg";
			this.iconPath = vscode.Uri.file(path.join(this.extensionPath, "media", "icons", iconFileName));
			this.contextValue = isEnabled ? "breakpointItemEnabled" : "breakpointItemDisabled";
			return;
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
				case "line":
				default:
					iconBase = "bp-line";
					break;
			}
		}
		const iconFileName = `${iconBase}-${isEnabled ? "enabled" : "disabled"}.svg`;
		this.iconPath = vscode.Uri.file(path.join(this.extensionPath, "media", "icons", iconFileName));
		this.contextValue = isEnabled ? "breakpointItemEnabled" : "breakpointItemDisabled";
	}
}

export class PlaceholderNode extends vscode.TreeItem {
	constructor(message: string, icon = "info") {
		super(message, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon(icon);
		this.contextValue = "placeholderItem";
	}
}

export class SceneTreeDataProvider implements vscode.TreeDataProvider<SceneTreeItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<SceneTreeItem | undefined | void>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly extensionPath: string = "") {}

	public refresh(element?: SceneTreeItem): void {
		this._onDidChangeTreeData.fire(element);
	}

	public getTreeItem(element: SceneTreeItem): vscode.TreeItem {
		if (element instanceof BreakpointNode) {
			element.updateAppearance();
		}
		return element;
	}

	public async getChildren(element?: SceneTreeItem): Promise<SceneTreeItem[]> {
		const workspaceRoot = getWorkspaceRoot(false);
		if (!workspaceRoot) {
			return [new PlaceholderNode(vscode.l10n.t("Open a workspace folder to view scenes"))];
		}

		// 根节点：返回场景列表
		if (!element) {
			const config = loadScenesConfig(workspaceRoot);
			const sceneNames = Object.keys(config.scenes || {});
			if (sceneNames.length === 0) {
				return [
					new PlaceholderNode(
						vscode.l10n.t("No scenes yet. Click + to create or export breakpoints"),
						"add",
					),
				];
			}

			const activeScenes = sceneStateManager.getActiveScenes();
			const isDirty = sceneStateManager.getIsDirty();

			return sceneNames.map((name) => {
				const bps = config.scenes[name] || [];
				const isActive = activeScenes.includes(name);
				return new SceneNode(name, bps.length, isActive, isDirty && isActive);
			});

		}

		// 子节点：返回指定场景内的断点列表
		if (element instanceof SceneNode) {
			const config = loadScenesConfig(workspaceRoot);
			const list = config.scenes[element.sceneName] || [];
			if (list.length === 0) {
				return [new PlaceholderNode(vscode.l10n.t("No breakpoints in this scene"))];
			}
			return list.map((bp, idx) => new BreakpointNode(element.sceneName, idx, bp, workspaceRoot, this.extensionPath));
		}

		return [];
	}
}
