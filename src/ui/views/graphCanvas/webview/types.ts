import type { GraphSnapshot, GraphNode } from "#src/application/sceneGraphProjection";
import type { TraceRecord } from "#src/application/debugTraceBuffer";
import type { GraphViewTab } from "#src/ui/views/graphCanvas/graphMessageProtocol";

export interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

export interface CanvasLabels {
	sceneInactive?: string;
	laneCircular?: string;
	tabFlow?: string;
	tabTrace?: string;
	exportButton?: string;
	flowEmpty?: string;
	traceEmpty?: string;
	scopeLabel?: string;
	localLayerBadge?: string;
	localLayerTitle?: string;
	zoomIn?: string;
	zoomOut?: string;
	zoomFit?: string;
	zoomReset?: string;
	unmatchedBadge?: string;
	conditionLabel?: string;
	hitConditionLabel?: string;
	logMessageLabel?: string;
	bpTypeLabels?: Record<string, { name: string; title: string }>;

	// 场景选择器
	sceneSelectTooltip?: string;
	scenePrefix?: string;
	selectScenePrompt?: string;
	statusActive?: string;
	statusPreview?: string;
	searchScenePlaceholder?: string;
	activeScenesGroup?: string;
	inactiveScenesGroup?: string;
	switchToSceneTooltip?: string;
	noScenesFound?: string;

	// 卡片与气泡
	openInEditorTooltip?: string;
	refPrefix?: string;
	refScenePrefix?: string;
	conditionExprTooltip?: string;
	hitCountTooltip?: string;
	logMessageTooltip?: string;
	codeDriftWarning?: string;
	notActiveTooltip?: string;
	expand?: string;
	collapse?: string;
	breakpointFallback?: string;

	// 顶栏与流转图
	activateScene?: string;
	activateSceneTooltip?: string;
	exportMermaidTooltip?: string;
	flowEmptyHint?: string;
	pendingActiveScene?: string;

	// 命中轨迹
	traceFilterPlaceholder?: string;
	clearSearch?: string;
	traceTotalSteps?: string;
	traceTotalStepsTooltip?: string;
	traceLoopCollapsed?: string;
	traceLoopCollapsedTooltip?: string;
	statusDebugPaused?: string;
	statusSessionTerminated?: string;
	statusRunning?: string;
	clearTraceTooltip?: string;
	traceLoopUnit?: string;
	tracePausedInLoop?: string;
	scrollToLatest?: string;
	jumpToSourceTooltip?: string;
	pausedHere?: string;
	exitPoint?: string;
	locateSource?: string;
	expandMinimap?: string;
	collapseMinimap?: string;
	minimap?: string;
	minimapNav?: string;
}

export interface CanvasPayload {
	snapshot: GraphSnapshot;
	records: readonly TraceRecord[];
	initialTab: GraphViewTab;
	labels: CanvasLabels;
}

export interface TooltipState {
	x: number;
	y: number;
	node: GraphNode;
}
