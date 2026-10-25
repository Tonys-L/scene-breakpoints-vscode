import type { GraphNode } from "#src/application/sceneGraphProjection";
import type { CanvasLabels } from "#src/ui/views/graphCanvas/webview/types";

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function fileBasename(filePath?: string): string {
	if (!filePath) return "";
	const parts = filePath.split(/[/\\]/);
	return parts[parts.length - 1] || filePath;
}

const TYPE_NAMES: Record<string, string> = {
	line: "Line",
	condition: "Cond",
	logpoint: "Log",
	hitCount: "Hit",
	function: "Func",
	ref: "Scene",
};

const TYPE_TITLES: Record<string, string> = {
	line: "Line Breakpoint",
	condition: "Conditional Breakpoint",
	logpoint: "Logpoint",
	hitCount: "Hit Count Breakpoint",
	function: "Function Breakpoint",
	ref: "Scene Reference",
};

export const TYPE_ICONS: Record<string, string> = {
	line: `<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" /></svg>`,
	condition: `<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 2H4.5L2 8l2.5 6h7l2.5-6-2.5-6z" /></svg>`,
	logpoint: `<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm-1 3.5h2v5H7V5zm0 6h2v2H7v-2z" /></svg>`,
	hitCount: `<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M3 13V8h2v5H3zm4 0V3h2v10H7zm4 0V6h2v7h-2z" /></svg>`,
	function: `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 14V8a3 3 0 0 1 3-3h3M3 8h6" /></svg>`,
	ref: `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.1-2.1a3 3 0 0 0-4.2-4.2l-1.1 1.1M9.5 6.5a3 3 0 0 0-4.2 0l-2.1 2.1a3 3 0 0 0 4.2 4.2l1.1-1.1" /></svg>`,
};

export const FILE_ICON = `<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1.5A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6L9 1.5H4zm5 1.25L12.25 6H9V2.75zM3.5 3a.5.5 0 0 1 .5-.5H8v4h4v6.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3z"/></svg>`;
export const ZAP_ICON = `<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8.5 1.5L2.5 9h5l-1 5.5L13.5 7h-5l1-5.5z" /></svg>`;
export const WARN_ICON = `<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5L1 14h14L8 1.5zM7.2 6h1.6v4H7.2V6zm0 5h1.6v1.6H7.2V11z" /></svg>`;
const JUMP_ICON = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4H3V4h4M9 2h5v5M7 9l7-7" /></svg>`;

export interface CardHtmlOptions {
	labels: CanvasLabels;
	isSelected: boolean;
	isPulsing: boolean;
	width?: number;
}

function resolveLocation(node: GraphNode, labels?: CanvasLabels): { text: string; title: string } {
	if (node.file !== undefined && node.line !== undefined) {
		return {
			text: `${fileBasename(node.file)}:${node.line}`,
			title: `${node.file}:${node.line}`,
		};
	}
	if (node.functionName) {
		return { text: node.functionName, title: node.functionName };
	}
	if (node.refName) {
		const prefix = formatWithParam(labels?.refPrefix, node.refName, `Ref: ${node.refName}`);
		return { text: node.refName, title: prefix };
	}
	return { text: "", title: "" };
}

function formatWithParam(template: string | undefined, param: string, fallback: string): string {
	if (!template) return fallback;
	return template.includes("{0}") ? template.replace("{0}", param) : `${template}${param}`;
}

function resolveDescription(node: GraphNode, labels?: CanvasLabels): string {
	if (node.desc) return node.desc;
	if (node.functionName) return node.functionName;
	if (node.file) return `${node.file}:${node.line}`;
	if (node.refName) {
		return formatWithParam(labels?.refScenePrefix, node.refName, `Referenced Scene: ${node.refName}`);
	}
	return node.id;
}

function buildMetaPills(node: GraphNode, labels?: CanvasLabels): string[] {
	const pills: string[] = [];
	if (node.condition) {
		const condTitle = formatWithParam(labels?.conditionExprTooltip, node.condition, `Condition: ${node.condition}`);
		pills.push(`<span class="bp-pill" title="${escapeHtml(condTitle)}">${ZAP_ICON}<span>${escapeHtml(node.condition)}</span></span>`);
	} else if (node.hitCondition) {
		const hitTitle = formatWithParam(labels?.hitCountTooltip, node.hitCondition, `Hit Count: ${node.hitCondition}`);
		pills.push(`<span class="bp-pill" title="${escapeHtml(hitTitle)}">${TYPE_ICONS.hitCount}<span>${escapeHtml(node.hitCondition)}</span></span>`);
	} else if (node.logMessage) {
		const logTitle = formatWithParam(labels?.logMessageTooltip, node.logMessage, `Log: ${node.logMessage}`);
		pills.push(`<span class="bp-pill" title="${escapeHtml(logTitle)}">${TYPE_ICONS.logpoint}<span>${escapeHtml(node.logMessage)}</span></span>`);
	}

	if (Array.isArray(node.watch) && node.watch.length > 0) {
		const watchTitle = `Watch Anchors: ${node.watch.join(", ")}`;
		pills.push(`<span class="bp-pill bp-pill-watch" title="${escapeHtml(watchTitle)}">👁️ <span>${node.watch.length}</span></span>`);
	}

	if (node.status === "unmatched") {
		const unmatchedText = labels?.unmatchedBadge || "Unmatched";
		const warnTitle = labels?.codeDriftWarning || "Code drift exceeds safety threshold";
		pills.push(`<span class="bp-pill" title="${escapeHtml(warnTitle)}">${WARN_ICON}<span>${escapeHtml(unmatchedText)}</span></span>`);
	} else if (node.registered === false) {
		const inactiveText = labels?.sceneInactive || "Not Active";
		const inactiveTitle = labels?.notActiveTooltip || "Current scene is not active in debugger";
		pills.push(`<span class="bp-pill" title="${escapeHtml(inactiveTitle)}"><span>${escapeHtml(inactiveText)}</span></span>`);
	}
	return pills;
}

export function renderCardHtml(node: GraphNode, options: CardHtmlOptions): string {
	const typeKey = node.kind === "scene-ref" ? "ref" : (node.bpType || "line");
	const i18nType = options.labels?.bpTypeLabels?.[typeKey];
	const typeName = i18nType?.name || TYPE_NAMES[typeKey] || "BP";
	const typeTitle = i18nType?.title || TYPE_TITLES[typeKey] || typeName;
	const typeIcon = TYPE_ICONS[typeKey] || TYPE_ICONS.line;
	const { text: locationText, title: locationTitle } = resolveLocation(node, options.labels);
	const descText = resolveDescription(node, options.labels);

	const cardClasses = [
		"bp-card",
		`bp-type-${typeKey}`,
		!node.enabled ? "bp-disabled" : "",
		node.registered === false ? "bp-inactive" : "",
		node.status === "unmatched" ? "bp-unmatched" : "",
		options.isSelected ? "selected" : "",
		options.isPulsing ? "pulse" : "",
	].filter(Boolean).join(" ");

	const hasSourceTarget = Boolean(node.file && node.line && node.line > 0);
	const openTooltip = options.labels?.openInEditorTooltip || "Open in editor (or double-click card)";
	const jumpBtn = hasSourceTarget
		? `<button class="bp-card-jump" type="button" title="${escapeHtml(openTooltip)}">${JUMP_ICON}</button>`
		: "";

	const pills = buildMetaPills(node, options.labels);
	const metaHtml = pills.length > 0
		? `<div class="bp-card-meta">${pills.join("")}</div>`
		: "";
	const cardWidth = options.width ?? 240;

	return `<div class="${cardClasses}" data-id="${escapeHtml(node.id)}" style="width:${cardWidth}px;box-sizing:border-box;">`
		+ `<div class="bp-card-header">`
		+ `<span class="bp-card-type-badge" title="${escapeHtml(typeTitle)}">${typeIcon}<span class="bp-badge-text">${typeName}</span></span>`
		+ `<span class="bp-card-loc" title="${escapeHtml(locationTitle)}">${escapeHtml(locationText)}</span>`
		+ jumpBtn
		+ `</div>`
		+ `<div class="bp-card-body" title="${escapeHtml(descText)}">${escapeHtml(descText)}</div>`
		+ metaHtml
		+ `</div>`;
}

export interface SceneCardHtmlOptions {
	id: string;
	title: string;
	count: number;
	desc?: string;
	isCollapsed: boolean;
	isRoot?: boolean;
	depth?: number;
	breadcrumb?: string;
	labels?: CanvasLabels;
	width?: number;
}

export function renderSceneCardHtml(options: SceneCardHtmlOptions): string {
	const arrowIcon = options.isCollapsed
		? `<svg class="sc-arrow-icon" width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5l5 4.5-5 4.5V3.5z"/></svg>`
		: `<svg class="sc-arrow-icon expanded" width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 6l4.5 5 4.5-5H3.5z"/></svg>`;

	const iconSvg = options.isRoot
		? `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="8" r="3"/></svg>`
		: TYPE_ICONS.ref;

	const descHtml = options.desc
		? `<div class="sc-card-desc" title="${escapeHtml(options.desc)}">${escapeHtml(options.desc)}</div>`
		: "";

	const breadcrumbHtml = options.breadcrumb
		? `<div class="sc-breadcrumb" title="${escapeHtml(options.breadcrumb)}">${escapeHtml(options.breadcrumb)}</div>`
		: "";

	const expandText = options.labels?.expand || "Expand";
	const collapseText = options.labels?.collapse || "Collapse";
	const toggleBtn = !options.isRoot
		? `<button class="sc-toggle-btn" type="button" title="${options.isCollapsed ? escapeHtml(expandText) : escapeHtml(collapseText)}">${arrowIcon}</button>`
		: "";

	const isDeep = Boolean(options.depth && options.depth > 1);
	const cardClass = [
		"sc-scene-card",
		options.isRoot ? "sc-root-card" : "sc-ref-card",
		isDeep ? "sc-deep-ref" : "",
		options.isCollapsed ? "sc-collapsed" : "sc-expanded",
	].filter(Boolean).join(" ");
	const cardWidth = options.width ?? 240;

	return `<div class="${cardClass}" data-id="${escapeHtml(options.id)}" style="width:${cardWidth}px;box-sizing:border-box;">`
		+ breadcrumbHtml
		+ `<div class="sc-card-header">`
		+ `<div class="sc-card-title-wrap">`
		+ `<span class="sc-card-icon">${iconSvg}</span>`
		+ `<span class="sc-card-title" title="${escapeHtml(options.title)}">${escapeHtml(options.title)}</span>`
		+ `<span class="sc-count-badge">${options.count}</span>`
		+ `</div>`
		+ toggleBtn
		+ `</div>`
		+ descHtml
		+ `</div>`;
}

