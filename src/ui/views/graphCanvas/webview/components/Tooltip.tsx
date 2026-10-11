import type { CanvasLabels, TooltipState } from "#src/ui/views/graphCanvas/webview/types";
import { TYPE_ICONS, FILE_ICON, ZAP_ICON } from "./cardHtml";

export interface TooltipProps {
	tooltip: TooltipState | null;
	labels?: CanvasLabels;
}

const DEFAULT_TYPE_TITLES: Record<string, string> = {
	line: "Line Breakpoint",
	condition: "Conditional Breakpoint",
	logpoint: "Logpoint",
	hitCount: "Hit Count Breakpoint",
	function: "Function Breakpoint",
	ref: "Scene Reference",
};

function fileBasename(filePath?: string): string {
	if (!filePath) return "";
	const parts = filePath.split(/[/\\]/);
	return parts[parts.length - 1] || filePath;
}

export function Tooltip({ tooltip, labels }: TooltipProps) {
	if (!tooltip) return null;

	const { x, y, node } = tooltip;
	const typeKey = node.kind === "scene-ref" ? "ref" : (node.bpType || "line");
	const i18nType = labels?.bpTypeLabels?.[typeKey];
	const badgeTitle = i18nType?.title || DEFAULT_TYPE_TITLES[typeKey] || labels?.breakpointFallback || "Breakpoint";
	const typeIcon = TYPE_ICONS[typeKey] || TYPE_ICONS.line;

	// 标题展示节点核心定位或标识
	let titleText = "";
	if (node.file) {
		titleText = `${fileBasename(node.file)}${node.line !== undefined ? `:${node.line}` : ""}`;
	} else if (node.functionName) {
		titleText = node.functionName;
	} else if (node.refName) {
		titleText = node.refName;
	} else {
		titleText = node.id;
	}

	// 完整定位路径（如果与简要标题不同）
	let pathText = "";
	if (node.file) {
		pathText = `${node.file}${node.line !== undefined ? `:${node.line}` : ""}`;
	} else if (node.refName && node.kind === "scene-ref") {
		pathText = node.refName;
	}

	return (
		<div
			id="graph-tooltip"
			style={{
				display: "block",
				left: `${x}px`,
				top: `${y}px`,
			}}
		>
			<div className="tt-title">
				<span className="bp-badge">
					<span
						className="tt-icon"
						dangerouslySetInnerHTML={{ __html: typeIcon }}
					/>
					<span>{badgeTitle}</span>
				</span>
				<span>{titleText}</span>
			</div>

			{pathText && (
				<div className="tt-path">
					<span
						className="tt-icon"
						dangerouslySetInnerHTML={{ __html: node.kind === "scene-ref" ? TYPE_ICONS.ref : FILE_ICON }}
					/>
					<span>{pathText}</span>
				</div>
			)}

			{node.condition && (
				<div className="tt-desc tt-field" style={{ color: "#e3b341" }}>
					<span
						className="tt-icon"
						dangerouslySetInnerHTML={{ __html: ZAP_ICON }}
					/>
					<span className="tt-label">{labels?.conditionLabel || "Condition:"}</span>
					<code>{node.condition}</code>
				</div>
			)}
			{node.hitCondition && (
				<div className="tt-desc tt-field" style={{ color: "#39c5cf" }}>
					<span
						className="tt-icon"
						dangerouslySetInnerHTML={{ __html: TYPE_ICONS.hitCount }}
					/>
					<span className="tt-label">{labels?.hitConditionLabel || "Hit Count:"}</span>
					<code>{node.hitCondition}</code>
				</div>
			)}
			{node.logMessage && (
				<div className="tt-desc tt-field" style={{ color: "#58a6ff" }}>
					<span
						className="tt-icon"
						dangerouslySetInnerHTML={{ __html: TYPE_ICONS.logpoint }}
					/>
					<span className="tt-label">{labels?.logMessageLabel || "Log:"}</span>
					<code>{node.logMessage}</code>
				</div>
			)}
			{node.desc && <div className="tt-desc">{node.desc}</div>}
		</div>
	);
}
