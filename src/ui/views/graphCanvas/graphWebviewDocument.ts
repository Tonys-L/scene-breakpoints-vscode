import type { GraphSnapshot } from "#src/application/sceneGraphProjection";
import type { TraceRecord } from "#src/application/debugTraceBuffer";
import type { GraphViewTab } from "#src/ui/views/graphCanvas/graphMessageProtocol";

/**
 * 画布 Webview HTML 文档生成器 (v1.3.0)
 * 职责：纯函数，零 vscode 依赖，将资源 URI 与 snapshot payload 填入 HTML 模板。
 * 安全约束 (GR-012)：CSP 全本地资源、零外链；payload JSON 转义防 </script> 逃逸。
 */

export interface GraphWebviewLabels {
	readonly panelTitle: string;
	readonly tabFlow: string;
	readonly tabTrace: string;
	readonly exportButton: string;
	readonly flowEmpty: string;
	readonly traceEmpty: string;
	readonly scopeLabel: string;
	readonly sceneInactive: string;
	readonly laneCircular: string;
	readonly localLayerBadge?: string;
	readonly localLayerTitle?: string;
	readonly zoomIn?: string;
	readonly zoomOut?: string;
	readonly zoomFit?: string;
	readonly zoomReset?: string;
	readonly unmatchedBadge?: string;
	readonly conditionLabel?: string;
	readonly hitConditionLabel?: string;
	readonly logMessageLabel?: string;
	readonly bpTypeLabels?: Record<string, { name: string; title: string }>;

	// 场景选择器
	readonly sceneSelectTooltip?: string;
	readonly scenePrefix?: string;
	readonly selectScenePrompt?: string;
	readonly statusActive?: string;
	readonly statusPreview?: string;
	readonly searchScenePlaceholder?: string;
	readonly activeScenesGroup?: string;
	readonly inactiveScenesGroup?: string;
	readonly switchToSceneTooltip?: string;
	readonly noScenesFound?: string;

	// 卡片与气泡
	readonly openInEditorTooltip?: string;
	readonly refPrefix?: string;
	readonly refScenePrefix?: string;
	readonly conditionExprTooltip?: string;
	readonly hitCountTooltip?: string;
	readonly logMessageTooltip?: string;
	readonly codeDriftWarning?: string;
	readonly notActiveTooltip?: string;
	readonly expand?: string;
	readonly collapse?: string;
	readonly breakpointFallback?: string;

	// 顶栏与流转图
	readonly activateScene?: string;
	readonly activateSceneTooltip?: string;
	readonly exportMermaidTooltip?: string;
	readonly flowEmptyHint?: string;
	readonly pendingActiveScene?: string;

	// 命中轨迹
	readonly traceFilterPlaceholder?: string;
	readonly clearSearch?: string;
	readonly traceTotalSteps?: string;
	readonly traceTotalStepsTooltip?: string;
	readonly traceLoopCollapsed?: string;
	readonly traceLoopCollapsedTooltip?: string;
	readonly statusDebugPaused?: string;
	readonly statusSessionTerminated?: string;
	readonly statusRunning?: string;
	readonly clearTraceTooltip?: string;
	readonly traceLoopUnit?: string;
	readonly tracePausedInLoop?: string;
	readonly scrollToLatest?: string;
	readonly jumpToSourceTooltip?: string;
	readonly pausedHere?: string;
	readonly exitPoint?: string;
	readonly locateSource?: string;
	readonly expandMinimap?: string;
	readonly collapseMinimap?: string;
	readonly minimap?: string;
	readonly minimapNav?: string;
}

export interface GraphWebviewDocumentInput {
	readonly cspSource: string;
	/** g6-bundle.js 静态资源 URI */
	readonly libUri: string;
	/** graphWebview.js 静态资源 URI */
	readonly runtimeUri: string;
	/** graphWebview.css 静态资源 URI */
	readonly stylesUri: string;
	readonly nonce: string;
	readonly snapshot: GraphSnapshot;
	readonly records: readonly TraceRecord[];
	readonly initialTab: GraphViewTab;
	readonly labels: GraphWebviewLabels;
	/** 可选注入静态 HTML 模板；若未提供则使用纯净预设模板 */
	readonly templateHtml?: string;
}

const DEFAULT_SHELL_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src {{cspSource}} 'unsafe-inline'; script-src {{cspSource}} 'nonce-{{nonce}}'; img-src {{cspSource}} data:;">
	<link rel="stylesheet" href="{{stylesUri}}">
</head>
<body>
	<div id="app"></div>
	<script type="application/json" id="sb-payload">{{payload}}</script>
	<script nonce="{{nonce}}" src="{{libUri}}"></script>
	<script nonce="{{nonce}}" src="{{runtimeUri}}"></script>
</body>
</html>`;

/** payload JSON 序列化：转义 < 与行分隔符，杜绝 script 逃逸 */
export function serializePayload(payload: unknown): string {
	return JSON.stringify(payload)
		.replace(/</g, "\\u003c")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

/**
 * 组装画布 HTML：填充 CSP、资源 URI 和首屏 payload 至纯静态模板。
 */
export function buildGraphWebviewDocument(input: GraphWebviewDocumentInput): string {
	const { cspSource, libUri, runtimeUri, stylesUri, nonce, labels, initialTab, templateHtml } = input;
	const payload = serializePayload({
		snapshot: input.snapshot,
		records: input.records,
		initialTab,
		labels: {
			...labels,
		},
	});

	const template = templateHtml || DEFAULT_SHELL_TEMPLATE;
	return template
		.replace(/\{\{cspSource\}\}/g, cspSource)
		.replace(/\{\{nonce\}\}/g, nonce)
		.replace(/\{\{stylesUri\}\}/g, stylesUri)
		.replace(/\{\{libUri\}\}/g, libUri)
		.replace(/\{\{runtimeUri\}\}/g, runtimeUri)
		.replace(/\{\{payload\}\}/g, payload);
}
