import * as path from "node:path";
import * as vscode from "vscode";
import { sceneStateManager } from "#src/application/sceneStateManager";
import type { FunctionSceneBreakpoint, SceneBreakpoint, SourceSceneBreakpoint } from "#src/domain/types";
import { isSameFsPath, isFilePathMatch } from "#src/shared/utils/pathUtils";

export type SceneTreeItem = SceneNode | BreakpointNode | SceneRefTreeItem | PlaceholderNode;

/**
 * 侧边栏树视图展开/折叠状态管理器 (Presentation State)
 * 职责：负责记录与维持用户在 UI 交互中展开或折叠的场景集合
 */
export class TreeViewState {
	public readonly expandedScenes = new Set<string>();

	public markExpanded(sceneName: string): void {
		this.expandedScenes.add(sceneName);
	}

	public markCollapsed(sceneName: string): void {
		this.expandedScenes.delete(sceneName);
	}

	public isExpanded(sceneName: string): boolean {
		return this.expandedScenes.has(sceneName);
	}

	public clearExpanded(): void {
		this.expandedScenes.clear();
	}
}

export const treeViewState = new TreeViewState();

/**
 * 场景节点 (SceneNode)：代表一组场景断点集合的折叠容器
 */
export class SceneNode extends vscode.TreeItem {
	public static get expandedScenes(): Set<string> {
		return treeViewState.expandedScenes;
	}

	public static isExpanded(sceneName: string): boolean {
		return treeViewState.isExpanded(sceneName);
	}

	public static markExpanded(sceneName: string): void {
		treeViewState.markExpanded(sceneName);
	}

	public static markCollapsed(sceneName: string): void {
		treeViewState.markCollapsed(sceneName);
	}

	public static clearExpanded(): void {
		treeViewState.clearExpanded();
	}

	constructor(
		public readonly sceneName: string,
		public readonly breakpointCount: number,
		public readonly isActive: boolean,
		public readonly isDirty: boolean,
		isExpanded: boolean = treeViewState.isExpanded(sceneName) || isActive,
	) {
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

export interface BreakpointNodeOptions {
	isUnmatched?: boolean;
	/** 引用子树内的只读投影：不提供 checkbox 启停与编辑菜单（实体主权，防双写漂移） */
	readonly?: boolean;
}

/**
 * 纯函数：根据断点属性推导 SVG 矢量图标文件名
 */
export function resolveBreakpointIconFileName(
	breakpointType: string,
	isEnabled: boolean,
	isPaused: boolean,
	isUnmatched: boolean,
	sourceType?: string,
): string {
	if (isPaused) return "bp-paused.svg";

	if (isUnmatched) {
		return isEnabled ? "bp-unmatched-enabled.svg" : "bp-unmatched-disabled.svg";
	}

	let iconBase = "bp-line";
	if (breakpointType === "function") {
		iconBase = "bp-func";
	} else {
		switch (sourceType) {
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
		private readonly options?: BreakpointNodeOptions,
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

	public isReadonly(): boolean {
		return this.options?.readonly === true;
	}

	public isPausedAtBreakpoint(): boolean {
		if (!this.pausedLocation || this.breakpoint.type === "function") {
			return false;
		}
		const srcBp = this.breakpoint as SourceSceneBreakpoint;
		if (Number(srcBp.line) !== Number(this.pausedLocation.line)) {
			return false;
		}
		return isFilePathMatch(this.pausedLocation.file, srcBp.file, this.workspaceRoot);
	}

	public isUnmatched(): boolean {
		if (this.breakpoint.type === "function") return false;
		if (this.options?.isUnmatched !== undefined) {
			return this.options.isUnmatched;
		}
		const srcBp = this.breakpoint as SourceSceneBreakpoint;
		return (
			sceneStateManager.isSceneActive(this.sceneName) &&
			sceneStateManager.isBreakpointUnmatched(srcBp.file, srcBp.line)
		);
	}

	public updateAppearance(): void {
		const isEnabled = this.breakpoint.enabled ?? true;
		// 只读投影不提供 checkbox 启停，杜绝从引用视图直改源场景断点（实体主权）
		this.checkboxState = this.isReadonly() ? undefined : isEnabled
			? vscode.TreeItemCheckboxState.Checked
			: vscode.TreeItemCheckboxState.Unchecked;

		const isPaused = this.isPausedAtBreakpoint();
		const hintText = this.isReadonly()
			? vscode.l10n.t("Breakpoints inside a referenced scene are read-only. Edit them in the source scene.")
			: vscode.l10n.t("Tip: Drag to reorder, or use Alt+↑ / Alt+↓ to move");

		this.buildDescriptionAndTooltip(isPaused, hintText);

		const srcBp = this.breakpoint.type !== "function" ? (this.breakpoint as SourceSceneBreakpoint) : undefined;
		const iconFileName = resolveBreakpointIconFileName(
			this.breakpoint.type,
			isEnabled,
			isPaused,
			this.isUnmatched(),
			srcBp?.type,
		);
		this.iconPath = vscode.Uri.file(path.join(this.extensionPath, "media", "icons", iconFileName));
		this.contextValue = this.isReadonly()
			? "breakpointReadonly"
			: isEnabled
				? "breakpointItemEnabled"
				: "breakpointItemDisabled";
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
		const isUnmatched = this.isUnmatched();

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
}

/**
 * 路径比对标准化辅助函数 (向后兼容别名)
 */
export const isSamePath = isSameFsPath;

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

/**
 * 节点 id 编码声明路径（多层引用逐段累积），保证 DOM Diff 稳定与 e2e 可定位
 * 形如 scene:payment-debug / scene:payment-debug/ref:auth-core / .../ref:auth-core/bp:0
 */
export function buildNodeId(parts: string[]): string {
	return parts.join("/");
}

/**
 * 引用节点声明上下文：编码声明路径与多态操作定位所需的最小信息
 */
export interface RefNodeContext {
	/** 引用声明所在场景（toggle/remove/move 的路由目标） */
	sceneName: string;
	/** 被引用场景名 */
	refName: string;
	/** 声明路径段（含 scene:/ref: 前缀段），多层引用逐段累积 */
	path: string[];
	/** 在父 steps 中的声明索引 */
	index: number;
}

export interface SceneRefTreeItemOptions {
	desc?: string;
	enabled: boolean;
	/** 被引用源场景的步骤数（悬空时为 0） */
	childCount: number;
	/** 被引用场景不存在（悬空） */
	isDangling: boolean;
	extensionPath?: string;
}

/**
 * 场景引用节点 (SceneRefTreeItem)：声明世界中引用其他场景的一等树节点
 * 树渲染走声明态投影（不走 resolver，展示与激活关注点分离，§6.1）；
 * 整体启停（checkbox 多态 toggle）/移除/重排/跳转源场景，子树展示源场景声明态（只读）
 */
export class SceneRefTreeItem extends vscode.TreeItem {
	constructor(
		public readonly ctx: RefNodeContext,
		options: SceneRefTreeItemOptions,
	) {
		super(ctx.refName, vscode.TreeItemCollapsibleState.Collapsed);
		// ctx.path 即含自身 ref 段的完整声明路径（scene:X/ref:Y[@n]），id 直接派生保证全树唯一
		this.id = buildNodeId(ctx.path);
		this.description = options.isDangling
			? vscode.l10n.t('Dangling reference: scene "{0}" not found', ctx.refName)
			: (options.desc ?? vscode.l10n.t("{0} breakpoints", options.childCount));
		// 判定优先级（§6.3）：disabled > empty（悬空/空场景）> sceneRef
		this.contextValue = !options.enabled
			? "sceneRefDisabled"
			: options.isDangling || options.childCount === 0
				? "sceneRefEmpty"
				: "sceneRef";
		// 启停状态供 toggleSceneRef 命令推导翻转目标；不设 checkboxState——
		// 带 checkbox 的树节点单击 label 会被宿主消费为勾选切换（无法展开），且宿主事件兼容性不可靠
		this.isEnabled = options.enabled;
		if (options.isDangling) {
			this.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
		} else if (options.extensionPath) {
			const iconFileName = options.enabled ? "scene-ref-enabled.svg" : "scene-ref-disabled.svg";
			this.iconPath = vscode.Uri.file(path.join(options.extensionPath, "media", "icons", iconFileName));
		} else {
			this.iconPath = options.enabled
				? new vscode.ThemeIcon("references")
				: new vscode.ThemeIcon("circle-slash");
		}
		// 单击 = 展开/折叠（与顶层场景一致）；跳转源场景由 inline $(go-to-file) 图标与右键菜单承接
	}

	/** 引用当前启停状态（toggleSceneRef 的翻转基准） */
	public readonly isEnabled: boolean;

	/** 声明所在场景（toggle/remove/move 的路由目标） */
	public get sceneName(): string {
		return this.ctx.sceneName;
	}

	/** 被引用场景名 */
	public get refName(): string {
		return this.ctx.refName;
	}

	/** 在父 steps 中的声明索引（多态操作定位） */
	public get index(): number {
		return this.ctx.index;
	}
}
