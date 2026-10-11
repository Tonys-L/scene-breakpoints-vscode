import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import type { GraphSnapshot, GraphNode } from "#src/application/sceneGraphProjection";
import type { TraceRecord } from "#src/application/debugTraceBuffer";
import type { CanvasLabels, VsCodeApi } from "#src/ui/views/graphCanvas/webview/types";
import {
	collapseTraceRecords,
	type TimelineItem,
	type TimelineSingleStep,
	type TimelineLoopChunk,
} from "#src/ui/views/graphCanvas/timelineCollapse";
import {
	SearchIcon,
	CloseIcon,
	LoopIcon,
	TrashIcon,
	FileIcon,
	ClockIcon,
	PinIcon,
	ArrowUpRightIcon,
	CheckIcon,
	PlayIcon,
} from "./icons";

export interface TraceViewProps {
	snapshot: GraphSnapshot;
	records: readonly TraceRecord[];
	debugStatus?: "paused" | "running" | "terminated";
	labels: CanvasLabels;
	vscode: VsCodeApi;
}

interface ResolvedNodeInfo {
	desc: string;
	file: string;
	line: number;
	sceneName?: string;
	nodeType?: string;
}

function resolveNodeInfo(
	snapshot: GraphSnapshot,
	nodeId: string | null,
	file: string,
	line: number,
): ResolvedNodeInfo {
	if (nodeId) {
		for (const lane of snapshot.lanes) {
			for (const node of lane.nodes) {
				if (node.id === nodeId) {
					return {
						desc: node.desc || node.functionName || (node.file ? `${node.file}:${node.line}` : node.id),
						file: node.file || file,
						line: node.line ?? line,
						sceneName: node.ownerScene,
						nodeType: node.bpType,
					};
				}
			}
		}
	}

	// 回退：尝试按 file 与 line 匹配
	for (const lane of snapshot.lanes) {
		for (const node of lane.nodes) {
			if (node.file === file && node.line === line) {
				return {
					desc: node.desc || node.functionName || `${file}:${line}`,
					file,
					line,
					sceneName: node.ownerScene,
					nodeType: node.bpType,
				};
			}
		}
	}

	return {
		desc: `${file}:${line}`,
		file,
		line,
	};
}

/** 格式化文件名与路径展示（保留简短路径与文件名） */
function formatShortPath(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	const parts = normalized.split("/");
	if (parts.length > 2) {
		return `.../${parts.slice(-2).join("/")}`;
	}
	return normalized;
}

/** 格式化绝对壁钟时间 */
function formatWallClockTime(wallTime?: number): string {
	if (!wallTime) return "";
	const d = new Date(wallTime);
	const hh = d.getHours().toString().padStart(2, "0");
	const mm = d.getMinutes().toString().padStart(2, "0");
	const ss = d.getSeconds().toString().padStart(2, "0");
	const ms = d.getMilliseconds().toString().padStart(3, "0");
	return `${hh}:${mm}:${ss}.${ms}`;
}

export function TraceView({
	snapshot,
	records,
	debugStatus = "terminated",
	labels,
	vscode,
}: TraceViewProps) {
	const [filterText, setFilterText] = useState("");
	const [expandedLoops, setExpandedLoops] = useState<Record<string, boolean>>({});
	const [isAtBottom, setIsAtBottom] = useState(true);
	const [hasScrollableContent, setHasScrollableContent] = useState(false);
	const isCurrentlyPaused = debugStatus === "paused";
	const isSessionTerminated = debugStatus === "terminated";
	const [selectedSeq, setSelectedSeq] = useState<number | null>(null);

	const scrollContainerRef = useRef<HTMLDivElement>(null);

	// 1. 纯算法：折叠循环序列
	const timelineItems = useMemo(() => {
		return collapseTraceRecords(records);
	}, [records]);

	// 2. 统计信息
	const stats = useMemo(() => {
		let loopCount = 0;
		let collapsedSteps = 0;
		for (const item of timelineItems) {
			if (item.kind === "loop") {
				loopCount++;
				collapsedSteps += item.records.length;
			}
		}
		return { total: records.length, loopCount, collapsedSteps };
	}, [records, timelineItems]);

	// 检测滚动容器物理高度状态
	const updateScrollMetrics = () => {
		const el = scrollContainerRef.current;
		if (!el) return;
		const canScroll = el.scrollHeight > el.clientHeight + 16;
		const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		setHasScrollableContent(canScroll);
		setIsAtBottom(!canScroll || distanceToBottom < 36);
	};

	const prevRecordsLengthRef = useRef(records.length);

	// 3. 自动贴底滚动机制（仅在新断点到达且会话处于活跃状态且此前处于底部时跟随，终止态与普通点击绝不乱跳）
	useEffect(() => {
		const el = scrollContainerRef.current;
		if (el) {
			const hasNewRecord = records.length > prevRecordsLengthRef.current;
			prevRecordsLengthRef.current = records.length;
			updateScrollMetrics();
			if (hasNewRecord && isCurrentlyPaused && isAtBottom && records.length > 0) {
				el.scrollTop = el.scrollHeight;
			}
		}
	}, [records.length, isCurrentlyPaused, isAtBottom]);

	const handleScroll = () => {
		updateScrollMetrics();
	};

	const scrollToLatest = () => {
		const el = scrollContainerRef.current;
		if (!el) return;
		el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
		setIsAtBottom(true);
		if (records.length > 0) {
			setSelectedSeq(records[records.length - 1].seq);
		}
	};

	const toggleLoop = (e: MouseEvent, loopId: string) => {
		e.stopPropagation();
		setExpandedLoops((prev) => ({
			...prev,
			[loopId]: !prev[loopId],
		}));
		// DOM 变更后重新校准滚动高度
		requestAnimationFrame(updateScrollMetrics);
	};

	const handleStepClick = (e: MouseEvent, seq: number, file: string, line: number, nodeId: string | null) => {
		e.stopPropagation();
		setSelectedSeq(seq);

		// 携带物理文件与行号，强保 100% 能够定位打开
		vscode.postMessage({
			type: "open-source",
			nodeId: nodeId || undefined,
			file,
			line,
		});
	};

	const handleClearTrace = () => {
		vscode.postMessage({ type: "clear-trace" });
	};

	// 4. 搜索过滤
	const normalizedFilter = filterText.trim().toLowerCase();
	const matchesFilter = (record: TraceRecord, info: ResolvedNodeInfo): boolean => {
		if (!normalizedFilter) return true;
		const targetStr = `${record.seq} ${info.desc} ${info.file} ${info.line} ${info.sceneName || ""}`.toLowerCase();
		return targetStr.includes(normalizedFilter);
	};

	if (!records.length) {
		return (
			<div id="trace-view" className="trace-view-container">
				<div id="trace-empty" className="empty">
					<div className="trace-empty-icon">
						<PinIcon size={28} />
					</div>
					<div className="trace-empty-text">
						{labels.traceEmpty || "No hit records in this debug session yet."}
					</div>
				</div>
			</div>
		);
	}

	const totalStepsTooltip = labels.traceTotalStepsTooltip
		? labels.traceTotalStepsTooltip.replace("{0}", String(stats.total))
		: `${stats.total} execution hits recorded`;
	const totalStepsText = labels.traceTotalSteps
		? labels.traceTotalSteps.replace("{0}", String(stats.total))
		: `Total ${stats.total} steps`;

	const loopCollapsedTooltip = labels.traceLoopCollapsedTooltip
		? labels.traceLoopCollapsedTooltip.replace("{0}", String(stats.collapsedSteps)).replace("{1}", String(stats.loopCount))
		: `Automatically collapsed ${stats.collapsedSteps} hits into ${stats.loopCount} loops`;
	const loopCollapsedText = labels.traceLoopCollapsed
		? labels.traceLoopCollapsed.replace("{0}", String(stats.loopCount))
		: `Collapsed ${stats.loopCount} loop groups`;

	return (
		<div id="trace-view" className="trace-view-container">
			{/* 顶部工具栏 */}
			<div className="trace-toolbar">
				<div className="trace-filter-box">
					<span className="trace-filter-icon">
						<SearchIcon size={12} />
					</span>
					<input
						type="text"
						className="trace-filter-input"
						placeholder={labels.traceFilterPlaceholder || "Filter description, file path, or step..."}
						value={filterText}
						onInput={(e) => setFilterText((e.target as HTMLInputElement).value)}
					/>
					{filterText && (
						<button
							className="trace-filter-clear-btn"
							title={labels.clearSearch || "Clear Search"}
							onClick={() => setFilterText("")}
						>
							<CloseIcon size={10} />
						</button>
					)}
				</div>

				<div className="trace-toolbar-meta">
					<span className="trace-stats-badge" title={totalStepsTooltip}>
						{totalStepsText}
					</span>
					{stats.loopCount > 0 && (
						<span
							className="trace-loops-badge"
							title={loopCollapsedTooltip}
						>
							<LoopIcon size={12} /> {loopCollapsedText}
						</span>
					)}
					<span
						className={`trace-status-pill ${
							isCurrentlyPaused ? "paused" : isSessionTerminated ? "terminated" : "running"
						}`}
						title={`Debugger Status: ${debugStatus}`}
					>
						{isCurrentlyPaused ? (
							<>
								<span className="trace-status-dot-paused" /> {labels.statusDebugPaused || "Debugger Paused"}
							</>
						) : isSessionTerminated ? (
							<>
								<CheckIcon size={12} /> {labels.statusSessionTerminated || "Session Terminated"}
							</>
						) : (
							<>
								<PlayIcon size={12} /> {labels.statusRunning || "Running"}
							</>
						)}
					</span>
					<button
						className="trace-clear-btn"
						title={labels.clearTraceTooltip || "Clear Current Hit Trace"}
						onClick={handleClearTrace}
					>
						<TrashIcon size={12} /> {labels.clearSearch || "Clear"}
					</button>
				</div>
			</div>

			{/* 垂直时间轴主体 */}
			<div
				className="trace-timeline-scroll-area"
				ref={scrollContainerRef}
				onScroll={handleScroll}
			>
				<div className="trace-timeline-rail">
					{timelineItems.map((item) => {
						if (item.kind === "single") {
							const rec = item.record;
							const info = resolveNodeInfo(snapshot, rec.nodeId, rec.file, rec.line);
							if (!matchesFilter(rec, info)) return null;

							return (
								<SingleStepCard
									key={`step-${rec.seq}`}
									record={rec}
									info={info}
									isLatest={item.isLatest}
									debugStatus={debugStatus}
									isSelected={rec.seq === selectedSeq}
									labels={labels}
									onClick={(e) => handleStepClick(e, rec.seq, rec.file, rec.line, rec.nodeId)}
								/>
							);
						}

						// 循环块渲染
						const loop = item as TimelineLoopChunk;
						const isExpanded = expandedLoops[loop.id] ?? (loop.containsLatest || !!normalizedFilter);
						const patternNames = loop.patternKeys.map((k) => {
							const sample = loop.records.find((r) => (r.nodeId || `${r.file}:${r.line}`) === k);
							if (!sample) return k;
							const inf = resolveNodeInfo(snapshot, sample.nodeId, sample.file, sample.line);
							return inf.desc.split("：")[0].slice(0, 14);
						});

						const patternSummary = patternNames.join(" → ");

						// 检查过滤命中
						const filteredRecords = loop.records.filter((r) => {
							const inf = resolveNodeInfo(snapshot, r.nodeId, r.file, r.line);
							return matchesFilter(r, inf);
						});
						if (normalizedFilter && filteredRecords.length === 0) return null;

						const renderRecords = normalizedFilter ? filteredRecords : loop.records;

						return (
							<div key={loop.id} className={`trace-loop-block ${isExpanded ? "expanded" : "collapsed"}`}>
								<div
									className={`trace-loop-header ${loop.containsLatest && isCurrentlyPaused ? "has-latest" : ""}`}
									onClick={(e) => toggleLoop(e, loop.id)}
									title={isExpanded ? (labels.collapse || "Collapse") : (labels.expand || "Expand")}
								>
									<div className="trace-loop-header-left">
										<span className="trace-loop-icon">
											<LoopIcon size={13} />
										</span>
										<span className="trace-loop-pattern" title={patternSummary}>
											[{patternSummary}]
										</span>
										<span className="trace-loop-iterations-pill">
											{labels.traceLoopUnit
												? labels.traceLoopUnit.replace("{0}", String(loop.iterations)).replace("{1}", String(loop.records.length))
												: `Loop ${loop.iterations} times (${loop.records.length} steps)`}
										</span>
										{loop.containsLatest && isCurrentlyPaused && (
											<span className="trace-latest-pill pulse">
												<span className="trace-status-dot-paused" /> {labels.tracePausedInLoop || "Currently paused inside loop"}
											</span>
										)}
									</div>
									<div className="trace-loop-header-right">
										<span className="trace-loop-toggle-hint">
											{isExpanded ? (labels.collapse || "Collapse") : (labels.expand || "Expand")}
										</span>
									</div>
								</div>

								{isExpanded && (
									<div className="trace-loop-inner-list">
										{renderRecords.map((r) => {
											const inf = resolveNodeInfo(snapshot, r.nodeId, r.file, r.line);
											const isLatest = r.seq === records[records.length - 1]?.seq;
											return (
												<SingleStepCard
													key={`loop-step-${r.seq}`}
													record={r}
													info={inf}
													isLatest={isLatest}
													debugStatus={debugStatus}
													isSelected={r.seq === selectedSeq}
													subStepLabel={`#${r.seq}`}
													labels={labels}
													onClick={(e) => handleStepClick(e, r.seq, r.file, r.line, r.nodeId)}
												/>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>

			{/* 悬浮贴底胶囊按钮（仅在调试真实处于暂停态且内容超出一屏且未滚到底部时显示） */}
			{isCurrentlyPaused && hasScrollableContent && !isAtBottom && records.length > 0 && (
				<button className="trace-scroll-bottom-pill" onClick={scrollToLatest}>
					<span className="trace-status-dot-paused" /> {labels.scrollToLatest || "Jump to latest step ↓"}
				</button>
			)}
		</div>
	);
}

interface SingleStepCardProps {
	record: TraceRecord;
	info: ResolvedNodeInfo;
	isLatest: boolean;
	debugStatus: "paused" | "running" | "terminated";
	isSelected: boolean;
	subStepLabel?: string;
	labels?: CanvasLabels;
	onClick: (e: MouseEvent) => void;
}

function SingleStepCard({
	record,
	info,
	isLatest,
	debugStatus,
	isSelected,
	subStepLabel,
	labels,
	onClick,
}: SingleStepCardProps) {
	const stepSeq = subStepLabel || `#${record.seq.toString().padStart(2, "0")}`;
	const wallTimeStr = formatWallClockTime(record.wallTime);

	// 仅在真实暂停且为最新步时启用呼吸红光
	const isPausedDot = isLatest && debugStatus === "paused";
	const isTerminatedDot = isLatest && debugStatus === "terminated";

	return (
		<div
			className={`trace-step-item ${isPausedDot ? "is-latest" : ""} ${isSelected ? "is-selected" : ""}`}
			onClick={onClick}
			title={labels?.jumpToSourceTooltip || "Click to jump and locate source line"}
		>
			{/* 左侧节点轨道锚点（垂直居中对齐） */}
			<div className="trace-rail-node">
				<div
					className={`trace-node-dot ${
						isPausedDot
							? "latest-dot pulse"
							: isTerminatedDot
							? "terminated-dot"
							: "normal-dot"
					}`}
				/>
			</div>

			{/* 两行结构化卡片 */}
			<div className="trace-step-card">
				{/* 首行：步骤序号 + 业务描述 + 状态徽标 */}
				<div className="trace-card-header">
					<div className="trace-card-header-left">
						<span className="trace-step-seq">{stepSeq}</span>
						<span className="trace-step-desc" title={info.desc}>
							{info.desc}
						</span>
					</div>
					<div className="trace-card-header-right">
						{isPausedDot && (
							<span className="trace-paused-badge">
								<span className="trace-status-dot-paused" /> {labels?.pausedHere || "Paused here"}
							</span>
						)}
						{isTerminatedDot && (
							<span className="trace-terminated-badge">
								<CheckIcon size={11} /> {labels?.exitPoint || "Exit point"}
							</span>
						)}
						{info.sceneName && <span className="trace-scene-tag">{info.sceneName}</span>}
					</div>
				</div>

				{/* 次行：文件路径:行号 + 绝对壁钟时间 */}
				<div className="trace-card-meta">
					<span className="trace-file-pill" title={`${info.file}:${info.line}`}>
						<FileIcon size={11} /> {formatShortPath(info.file)}:{info.line}
					</span>
					{wallTimeStr && (
						<span className="trace-wall-time" title={wallTimeStr}>
							<ClockIcon size={11} /> {wallTimeStr}
						</span>
					)}
					<span className="trace-jump-hint">
						{labels?.locateSource || "Locate Source"} <ArrowUpRightIcon size={11} />
					</span>
				</div>
			</div>
		</div>
	);
}
