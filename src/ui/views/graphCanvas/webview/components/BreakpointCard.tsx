import type { JSX, CSSProperties } from "preact";
import type { GraphNode } from "#src/application/sceneGraphProjection";
import type { CanvasLabels } from "#src/ui/views/graphCanvas/webview/types";
import {
	LineIcon,
	ConditionIcon,
	LogpointIcon,
	HitCountIcon,
	FunctionIcon,
	RefIcon,
	WarningIcon,
	OpenExternalIcon,
	ZapIcon,
} from "./icons";

export interface BreakpointCardProps {
	node: GraphNode;
	labels: CanvasLabels;
	isPulsing: boolean;
	isSelected: boolean;
	style?: string | CSSProperties;
	onSelect(nodeId: string): void;
	onOpenSource(nodeId: string): void;
	onHover(e: MouseEvent, node: GraphNode): void;
	onMouseMove(e: MouseEvent): void;
	onLeave(): void;
}

function fileBasename(filePath?: string): string {
	if (!filePath) return "";
	const parts = filePath.split(/[/\\]/);
	return parts[parts.length - 1] || filePath;
}

function renderTypeIcon(typeKey: string): JSX.Element {
	switch (typeKey) {
		case "line":
			return <LineIcon size={10} />;
		case "condition":
			return <ConditionIcon size={11} />;
		case "logpoint":
			return <LogpointIcon size={11} />;
		case "hitCount":
			return <HitCountIcon size={11} />;
		case "function":
			return <FunctionIcon size={11} />;
		case "ref":
			return <RefIcon size={11} />;
		default:
			return <LineIcon size={10} />;
	}
}

const TYPE_NAMES: Record<string, string> = {
	line: "Line",
	condition: "Cond",
	logpoint: "Log",
	hitCount: "Hit",
	function: "Func",
	ref: "Ref",
};

export function BreakpointCard({
	node,
	labels,
	isPulsing,
	isSelected,
	style,
	onSelect,
	onOpenSource,
	onHover,
	onMouseMove,
	onLeave,
}: BreakpointCardProps) {
	const typeKey = node.kind === "scene-ref" ? "ref" : (node.bpType || "line");
	const i18nType = labels?.bpTypeLabels?.[typeKey];
	const typeName = i18nType?.name || TYPE_NAMES[typeKey] || "BP";
	const typeTitle = i18nType?.title || typeName;

	let locationText = "";
	let locationTitle = "";
	if (node.file !== undefined && node.line !== undefined) {
		locationText = `${fileBasename(node.file)}:${node.line}`;
		locationTitle = `${node.file}:${node.line}`;
	} else if (node.functionName) {
		locationText = node.functionName;
		locationTitle = node.functionName;
	} else if (node.refName) {
		locationText = node.refName;
		locationTitle = labels?.refPrefix ? labels.refPrefix.replace("{0}", node.refName) : `Ref: ${node.refName}`;
	}

	const refDesc = labels?.refScenePrefix ? labels.refScenePrefix.replace("{0}", node.refName || "") : `Referenced Scene: ${node.refName}`;
	const descText = node.desc
		|| node.functionName
		|| (node.file ? `${node.file}:${node.line}` : "")
		|| (node.refName ? refDesc : node.id);

	const cardClasses = [
		"bp-card",
		`bp-type-${typeKey}`,
		!node.enabled ? "bp-disabled" : "",
		node.registered === false ? "bp-inactive" : "",
		node.status === "unmatched" ? "bp-unmatched" : "",
		isSelected ? "selected" : "",
		isPulsing ? "pulse" : "",
	].filter(Boolean).join(" ");

	const footerPills: Array<{ icon?: JSX.Element; text: string; title?: string }> = [];
	if (node.condition) {
		const condTitle = labels?.conditionExprTooltip ? labels.conditionExprTooltip.replace("{0}", node.condition) : `Condition: ${node.condition}`;
		footerPills.push({
			icon: <ZapIcon size={10} />,
			text: node.condition,
			title: condTitle,
		});
	} else if (node.hitCondition) {
		const hitTitle = labels?.hitCountTooltip ? labels.hitCountTooltip.replace("{0}", node.hitCondition) : `Hit Count: ${node.hitCondition}`;
		footerPills.push({
			icon: <HitCountIcon size={10} />,
			text: node.hitCondition,
			title: hitTitle,
		});
	} else if (node.logMessage) {
		const logTitle = labels?.logMessageTooltip ? labels.logMessageTooltip.replace("{0}", node.logMessage) : `Log: ${node.logMessage}`;
		footerPills.push({
			icon: <LogpointIcon size={10} />,
			text: node.logMessage,
			title: logTitle,
		});
	}

	if (node.status === "unmatched") {
		footerPills.push({
			icon: <WarningIcon size={10} />,
			text: labels?.unmatchedBadge || "Unmatched",
			title: labels?.codeDriftWarning || "Code drift exceeds safety threshold",
		});
	} else if (node.registered === false) {
		footerPills.push({
			text: labels?.sceneInactive || "Not Active",
			title: labels?.notActiveTooltip || "Current scene is not active in debugger",
		});
	}

	const hasSourceTarget = Boolean(node.file && node.line && node.line > 0);
	const openTooltip = labels?.openInEditorTooltip || "Open in editor (or double-click card)";

	return (
		<div
			className={cardClasses}
			style={style}
			data-id={node.id}
			onClick={() => {
				onSelect(node.id);
				if (hasSourceTarget) {
					onOpenSource(node.id);
				}
			}}
			onDblClick={() => {
				if (hasSourceTarget) onOpenSource(node.id);
			}}
			onMouseEnter={(e) => onHover(e as unknown as MouseEvent, node)}
			onMouseMove={(e) => onMouseMove(e as unknown as MouseEvent)}
			onMouseLeave={onLeave}
		>
			<div className="bp-card-header">
				<span className="bp-card-type-badge" title={typeTitle}>
					{renderTypeIcon(typeKey)}
					<span className="bp-badge-text">{typeName}</span>
				</span>
				<span className="bp-card-loc" title={locationTitle}>
					{locationText}
				</span>
				{hasSourceTarget && (
					<button
						className="bp-card-jump"
						type="button"
						title={openTooltip}
						onClick={(e) => {
							e.stopPropagation();
							onOpenSource(node.id);
						}}
					>
						<OpenExternalIcon size={10} />
					</button>
				)}
			</div>

			<div className="bp-card-body" title={descText}>
				{descText}
			</div>

			{isSelected && node.contextSnippet && (
				<pre className="bp-card-snippet" title="Code Snippet Preview">
					<code>{node.contextSnippet}</code>
				</pre>
			)}

			{footerPills.length > 0 && (
				<div className="bp-card-meta">
					{footerPills.map((pill, idx) => (
						<span key={idx} className="bp-pill" title={pill.title}>
							{pill.icon}
							<span>{pill.text}</span>
						</span>
					))}
				</div>
			)}
		</div>
	);
}
