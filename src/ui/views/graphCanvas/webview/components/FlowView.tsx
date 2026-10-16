import { useEffect, useRef, useState, useMemo } from "preact/hooks";
import type { GraphSnapshot, GraphNode, GraphLane } from "#src/application/sceneGraphProjection";
import type { CanvasLabels, TooltipState, VsCodeApi } from "#src/ui/views/graphCanvas/webview/types";
import { renderCardHtml, renderSceneCardHtml } from "./cardHtml";

export interface FlowViewProps {
	snapshot: GraphSnapshot;
	labels: CanvasLabels;
	pulseNodeId: string | null;
	vscode: VsCodeApi;
	onTooltipChange: (tooltip: TooltipState | null | ((prev: TooltipState | null) => TooltipState | null)) => void;
}

/** 递归调用层级项（断点或子场景） */
interface HierarchyItem {
	id: string;
	isRef: boolean;
	name: string;
	desc?: string;
	depth: number;
	breadcrumb?: string;
	count: number;
	bpNode?: GraphNode;
	children: HierarchyItem[];
}

/** 从泳道节点列表构建多层时序调用树 */
function buildHierarchyTree(lane: GraphLane): HierarchyItem[] {
	const rootItems: HierarchyItem[] = [];
	const refMap = new Map<string, HierarchyItem>();

	for (const node of lane.nodes) {
		const chain = (node.refPath || []).slice(1); // 剥离根场景，获得嵌套子场景链

		if (chain.length === 0) {
			// 顶层直接断点
			rootItems.push({
				id: node.id,
				isRef: false,
				name: node.file || node.functionName || node.id,
				desc: node.desc,
				depth: 0,
				count: 1,
				bpNode: node,
				children: [],
			});
		} else {
			// 属于嵌套子场景 [sub_0, sub_1, ..., sub_k]
			let parentChildren = rootItems;
			let pathAcc = `ref:${lane.id}`;
			const breadcrumbParts: string[] = [];

			for (let d = 0; d < chain.length; d++) {
				const subName = chain[d];
				pathAcc += `::${subName}`;
				breadcrumbParts.push(subName);

				let refItem = refMap.get(pathAcc);
				if (!refItem) {
					refItem = {
						id: pathAcc,
						isRef: true,
						name: subName,
						desc: node.ownerScene === subName ? node.desc : undefined,
						depth: d,
						breadcrumb: d > 0 ? breadcrumbParts.slice(0, -1).join(" › ") : undefined,
						count: 0,
						children: [],
					};
					refMap.set(pathAcc, refItem);
					parentChildren.push(refItem);
				}
				if (!refItem.desc && node.desc && node.ownerScene === subName) {
					refItem.desc = node.desc;
				}
				refItem.count++;
				parentChildren = refItem.children;
			}

			// 将具体断点挂入叶子子场景 children 中
			parentChildren.push({
				id: node.id,
				isRef: false,
				name: node.file || node.functionName || node.id,
				desc: node.desc,
				depth: chain.length,
				count: 1,
				bpNode: node,
				children: [],
			});
		}
	}

	return rootItems;
}

export function FlowView({
	snapshot,
	labels,
	pulseNodeId,
	vscode,
	onTooltipChange,
}: FlowViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const g6Ref = useRef<any>(null);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [collapsedCombos, setCollapsedCombos] = useState<Record<string, boolean>>({});
	const [renderKey, setRenderKey] = useState<number>(0);

	const hasLanes = snapshot.lanes.length > 0;

	// 扁平化全量断点节点字典
	const nodeMap = useMemo(() => {
		const map = new Map<string, GraphNode>();
		for (const lane of snapshot.lanes) {
			for (const node of lane.nodes) {
				map.set(node.id, node);
			}
		}
		return map;
	}, [snapshot]);

	// 构建 G6 多级向右递归展开图数据
	const buildG6Data = () => {
		const nodes: any[] = [];
		const edges: any[] = [];

		const CARD_WIDTH = 240;
		const X_GAP = 70; // 列间距
		const Y_GAP = 28; // 卡片行间距
		const mainX = 140; // 主干中心 X 坐标

		/**
		 * 递归排布子树
		 * @param items 当前层级待排布列表
		 * @param depth 当前层深度 (0=主干, 1=第1级展开, 2=第2级展开...)
		 * @param startY 当前列起始 Y 坐标
		 * @returns 子树占用的总高度与第一个节点 ID
		 */
		const layoutSubtree = (
			items: HierarchyItem[],
			depth: number,
			startY: number,
		): { totalHeight: number; firstNodeId?: string } => {
			let currentY = startY;
			let prevItemId: string | null = null;
			let firstNodeId: string | undefined = undefined;

			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				const colX = mainX + depth * (CARD_WIDTH + X_GAP);
				if (!firstNodeId) firstNodeId = item.id;

				if (item.isRef) {
					// 场景引用节点：默认折叠，按需展开
					const isCollapsed = collapsedCombos[item.id] !== undefined
						? !!collapsedCombos[item.id]
						: true;

					const cardH = item.breadcrumb
						? (item.desc ? 80 : 60)
						: (item.desc ? 66 : 46);
					const cardCenterY = currentY + Math.round(cardH / 2);

					nodes.push({
						id: item.id,
						data: {
							label: item.name,
							isRef: true,
							count: item.count,
						},
						style: {
							x: colX,
							y: cardCenterY,
							size: [CARD_WIDTH, cardH],
							dx: -Math.round(CARD_WIDTH / 2),
							dy: -Math.round(cardH / 2),
							innerHTML: renderSceneCardHtml({
								id: item.id,
								title: item.name,
								count: item.count,
								desc: item.desc,
								isCollapsed,
								isRoot: false,
								depth: item.depth + 1,
								breadcrumb: item.breadcrumb,
								labels,
								width: CARD_WIDTH,
							}),
						},
					});

					// 同一列内部兄弟节点按时序自上而下串联
					if (prevItemId) {
						edges.push({
							id: `e:${prevItemId}=>${item.id}`,
							source: prevItemId,
							target: item.id,
						});
					}
					prevItemId = item.id;

					let itemOccupiedHeight = cardH;

					if (!isCollapsed && item.children.length > 0) {
						// 展开态：向右侧更深一列 (depth + 1) 递归排布子分支
						const branchResult = layoutSubtree(
							item.children,
							depth + 1,
							currentY,
						);

						// 从当前父卡片向右引出一条水平折线接入子分支首节点
						if (branchResult.firstNodeId) {
							edges.push({
								id: `branch:${item.id}=>${branchResult.firstNodeId}`,
								source: item.id,
								target: branchResult.firstNodeId,
							});
						}

						// 该步骤占用的总高度为父卡片与子树分支高度的较大值
						itemOccupiedHeight = Math.max(cardH, branchResult.totalHeight);
					}

					currentY += itemOccupiedHeight + Y_GAP;
				} else {
					// 具体的断点节点
					const bpNode = item.bpNode!;
					const isSelected = selectedNodeId === bpNode.id;
					const isPulsing = pulseNodeId === bpNode.id;
					const bpH = 64;
					const bpCenterY = currentY + Math.round(bpH / 2);

					nodes.push({
						id: bpNode.id,
						data: { ...bpNode },
						style: {
							x: colX,
							y: bpCenterY,
							size: [CARD_WIDTH, bpH],
							dx: -Math.round(CARD_WIDTH / 2),
							dy: -Math.round(bpH / 2),
							innerHTML: renderCardHtml(bpNode, {
								labels,
								isSelected,
								isPulsing,
								width: CARD_WIDTH,
							}),
						},
					});

					if (prevItemId) {
						edges.push({
							id: `e:${prevItemId}=>${bpNode.id}`,
							source: prevItemId,
							target: bpNode.id,
						});
					}
					prevItemId = bpNode.id;

					currentY += bpH + Y_GAP;
				}
			}

			const totalOccupied = Math.max(0, currentY - startY - Y_GAP);
			return { totalHeight: totalOccupied, firstNodeId };
		};

		let globalY = 40;
		for (const lane of snapshot.lanes) {
			const rootId = `root:${lane.id}`;
			const rootCardH = 46;
			const rootCenterY = globalY + Math.round(rootCardH / 2);

			// 1. 渲染该场景的根卡片 (金色左边框，Codicon 场景图标)
			nodes.push({
				id: rootId,
				data: {
					label: lane.sceneName,
					isRoot: true,
					count: lane.nodes.length,
				},
				style: {
					x: mainX,
					y: rootCenterY,
					size: [CARD_WIDTH, rootCardH],
					dx: -Math.round(CARD_WIDTH / 2),
					dy: -Math.round(rootCardH / 2),
					innerHTML: renderSceneCardHtml({
						id: rootId,
						title: lane.sceneName,
						count: lane.nodes.length,
						desc: lane.registered ? undefined : (labels.pendingActiveScene || labels.sceneInactive || "Pending Active Scene"),
						isCollapsed: false,
						isRoot: true,
						labels,
						width: CARD_WIDTH,
					}),
				},
			});

			globalY += rootCardH + Y_GAP;

			// 2. 递归排布该场景内部的调用步骤树
			const treeRoots = buildHierarchyTree(lane);
			if (treeRoots.length > 0) {
				const laneResult = layoutSubtree(treeRoots, 0, globalY);

				// 从根场景卡片引出连线连接到该场景的第 1 个步骤
				if (laneResult.firstNodeId) {
					edges.push({
						id: `root-flow:${rootId}=>${laneResult.firstNodeId}`,
						source: rootId,
						target: laneResult.firstNodeId,
					});
				}

				globalY += laneResult.totalHeight + 56; // 泳道之间留出清晰的视觉间隔
			} else {
				globalY += 56;
			}
		}

		return { nodes, edges };
	};

	// G6 图实例初始化与生命周期管理
	useEffect(() => {
		if (!containerRef.current || !hasLanes) return;

		const G6 = (window as any).G6;
		if (!G6 || !G6.Graph) {
			console.warn("[FlowView] G6 engine is not available on window.G6");
			return;
		}

		if (g6Ref.current) {
			try {
				g6Ref.current.destroy?.();
			} catch {}
			g6Ref.current = null;
		}
		if (containerRef.current) {
			containerRef.current.innerHTML = "";
		}

		const bodyStyle = window.getComputedStyle(document.body);
		const edgeColor = bodyStyle.getPropertyValue("--vscode-editorLineNumber-foreground").trim() || "#8b949e";

		const data = buildG6Data();

		const containerW = containerRef.current.clientWidth || window.innerWidth;
		const containerH = containerRef.current.clientHeight || (window.innerHeight - 41);

		try {
			const graph = new G6.Graph({
				container: containerRef.current,
				width: containerW,
				height: containerH,
				autoResize: true,
				data,
				autoFit: "view",
				behaviors: ["drag-canvas", "zoom-canvas"],
				plugins: [
					{
						type: "minimap",
						size: [180, 110],
						position: "right-bottom",
						className: "g6-minimap",
					},
				],
				node: {
					type: "html",
				},
				edge: {
					type: "polyline",
					style: {
						stroke: edgeColor,
						lineWidth: 1.5,
						endArrow: true,
						radius: 8,
					},
				},
			});

			g6Ref.current = graph;

			void graph.render().then(() => {
				try {
					graph.fitView?.(36);
				} catch {}
			});

			return () => {
				if (g6Ref.current) {
					try {
						g6Ref.current.destroy?.();
					} catch {}
					g6Ref.current = null;
				}
			};
		} catch (err) {
			console.error("[FlowView] G6 graph initialization failed:", err);
		}
	}, [snapshot, collapsedCombos, renderKey]);

	// 监听视口尺寸变化（副侧边栏拖拽、窗口缩放、分屏变动），自动同步画布尺寸与对齐刷新行为
	useEffect(() => {
		let resizeTimer: any = null;
		let lastW = containerRef.current?.clientWidth || 0;
		let lastH = containerRef.current?.clientHeight || 0;

		const handleResize = () => {
			const container = containerRef.current;
			if (!container) return;
			const w = container.clientWidth || window.innerWidth;
			const h = container.clientHeight || (window.innerHeight - 41);
			if (w <= 0 || h <= 0) return;

			// 1. 即时调用 G6 的 resize(w, h)，让底层 Canvas 视口实时扩大，防止拖拽过程中卡片被遮挡
			if (g6Ref.current && typeof g6Ref.current.resize === "function") {
				try {
					g6Ref.current.resize(w, h);
				} catch {}
			}

			// 2. 检查是否有尺寸变动，并在用户拖动停止后（防抖 150ms）对齐点击“刷新”按钮的彻底重绘逻辑
			if (w !== lastW || h !== lastH) {
				lastW = w;
				lastH = h;
				if (resizeTimer) clearTimeout(resizeTimer);
				resizeTimer = setTimeout(() => {
					setRenderKey((k) => k + 1);
				}, 150);
			}
		};

		// 监听原生窗口 resize 事件（VS Code 面板/侧边栏宽度变动时绝对触发）
		window.addEventListener("resize", handleResize);

		// 同时挂载 ResizeObserver 作为双保险
		let ro: ResizeObserver | null = null;
		if (typeof ResizeObserver !== "undefined") {
			ro = new ResizeObserver(() => {
				handleResize();
			});
			if (containerRef.current) {
				ro.observe(containerRef.current);
			}
			if (document.body) {
				ro.observe(document.body);
			}
		}

		return () => {
			window.removeEventListener("resize", handleResize);
			if (ro) ro.disconnect();
			if (resizeTimer) clearTimeout(resizeTimer);
		};
	}, []);

	// 命中脉冲定位联动
	useEffect(() => {
		if (pulseNodeId && g6Ref.current) {
			try {
				g6Ref.current.focusElement?.(pulseNodeId, { animation: { duration: 250 } });
			} catch {
				// 安全兜底
			}
		}
	}, [pulseNodeId]);

	// 原生事件委托：单击卡片伴随源码定位，点击场景卡片切换折叠/展开
	const handleContainerClick = (e: MouseEvent) => {
		const target = e.target as HTMLElement;

		// 1. 点击子场景卡片（或折叠小箭头）：切换分支折叠/展开
		const sceneCard = target.closest<HTMLElement>(".sc-scene-card");
		if (sceneCard) {
			const id = sceneCard.getAttribute("data-id");
			if (id) {
				setCollapsedCombos((prev) => {
					const willExpand = prev[id] !== undefined ? !prev[id] : false;
					// 若为展开操作，稍后平滑聚焦该节点以确保右侧新分支处于视野中央
					if (willExpand && g6Ref.current) {
						setTimeout(() => {
							try {
								g6Ref.current?.focusElement?.(id, { animation: { duration: 250 } });
							} catch {}
						}, 50);
					}
					return {
						...prev,
						[id]: willExpand,
					};
				});
			}
			return;
		}

		// 2. 点击断点卡片：触发源码打开与高亮，局部更新 DOM 选中类名 (绝对零抖动)
		const card = target.closest<HTMLElement>(".bp-card");
		if (!card) return;
		const id = card.getAttribute("data-id");
		if (!id) return;
		const isJump = Boolean(target.closest(".bp-card-jump"));

		if (containerRef.current) {
			containerRef.current.querySelectorAll(".bp-card.selected").forEach((el) => {
				el.classList.remove("selected");
			});
			card.classList.add("selected");
		}

		setSelectedNodeId(id);
		vscode.postMessage({ type: "open-source", nodeId: id, preserveFocus: !isJump });
	};

	// 原生事件委托：双击卡片直达编辑
	const handleContainerDblClick = (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		const card = target.closest<HTMLElement>(".bp-card");
		if (!card) return;
		const id = card.getAttribute("data-id");
		if (!id) return;
		vscode.postMessage({ type: "open-source", nodeId: id, preserveFocus: false });
	};

	// 原生事件委托：悬停 Tooltip 呈现
	const handleContainerMouseMove = (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		const card = target.closest<HTMLElement>(".bp-card");
		if (!card) {
			onTooltipChange(null);
			return;
		}
		const id = card.getAttribute("data-id");
		if (!id) {
			onTooltipChange(null);
			return;
		}
		const node = nodeMap.get(id);
		if (!node) {
			onTooltipChange(null);
			return;
		}
		let x = e.clientX + 14;
		let y = e.clientY + 14;
		if (x + 340 > window.innerWidth) x = Math.max(10, e.clientX - 350);
		if (y + 120 > window.innerHeight) y = Math.max(10, e.clientY - 130);
		onTooltipChange({ x, y, node });
	};

	const handleContainerMouseLeave = () => {
		onTooltipChange(null);
	};

	// 滚轮缩放事件桥接：当鼠标悬停在断点卡片或子场景卡片（HTML DOM 元素）上时，
	// 阻止卡片拦截并以鼠标当前位置为原点平滑驱动 G6 缩放
	const handleContainerWheel = (e: WheelEvent) => {
		const target = e.target as HTMLElement;
		const card = target.closest<HTMLElement>(".bp-card, .sc-scene-card");
		if (card && g6Ref.current) {
			e.preventDefault();
			const delta = e.deltaY;
			if (delta === 0) return;
			const factor = delta < 0 ? 1.15 : 1 / 1.15;
			const rect = containerRef.current?.getBoundingClientRect();
			const origin = rect ? [e.clientX - rect.left, e.clientY - rect.top] : undefined;
			try {
				g6Ref.current.zoomBy?.(factor, { duration: 80 }, origin);
			} catch {
				try {
					g6Ref.current.zoomBy?.(factor);
				} catch {}
			}
		}
	};

	const handleZoomIn = () => {
		if (!g6Ref.current) return;
		try {
			g6Ref.current.zoomBy?.(1.3);
		} catch {}
	};

	const handleZoomOut = () => {
		if (!g6Ref.current) return;
		try {
			g6Ref.current.zoomBy?.(1 / 1.3);
		} catch {}
	};

	const handleFitView = () => {
		if (!g6Ref.current) return;
		try {
			g6Ref.current.fitView?.(32);
		} catch {}
	};

	const handleResetZoom = () => {
		if (!g6Ref.current) return;
		try {
			g6Ref.current.zoomTo?.(1);
		} catch {}
	};

	if (!hasLanes) {
		return (
			<div className="empty-state">
				<div className="empty-state-icon">
					<svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor">
						<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.4" />
						<circle cx="8" cy="8" r="3" opacity="0.6" />
					</svg>
				</div>
				<p>{labels.flowEmpty || "Canvas is empty. Select scenes in the scope bar above, or activate a scene."}</p>
				{labels.flowEmptyHint && <span className="empty-hint">{labels.flowEmptyHint}</span>}
			</div>
		);
	}

	return (
		<div
			id="flow-view"
			onClick={handleContainerClick}
			onDblClick={handleContainerDblClick}
			onMouseMove={handleContainerMouseMove}
			onMouseLeave={handleContainerMouseLeave}
			onWheel={handleContainerWheel}
		>
			<div
				id="g6-canvas"
				ref={containerRef}
				style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
			/>

			{/* 悬浮控制栏（视口缩放与适应） */}
			<div className="flow-zoom-controls">
				<button type="button" onClick={handleZoomIn} title={labels.zoomIn || "Zoom In"}>
					<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
						<path d="M8 2.5v11M2.5 8h11" />
					</svg>
				</button>
				<button type="button" onClick={handleZoomOut} title={labels.zoomOut || "Zoom Out"}>
					<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
						<path d="M2.5 8h11" />
					</svg>
				</button>
				<button type="button" onClick={handleFitView} className="btn-fit-view" title={labels.zoomFit || "Fit View"}>
					<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
						<path d="M2 3a1 1 0 0 1 1-1h3v1.5H3.5v2.5H2V3zm11-1a1 1 0 0 1 1 1v3h-1.5V3.5H10V2h3zM2 13a1 1 0 0 0 1 1h3v-1.5H3.5V10H2v3zm12 0a1 1 0 0 1-1 1h-3v-1.5h2.5V10H14v3z"/>
					</svg>
					<span>{labels.zoomFit || "Fit"}</span>
				</button>
				<button type="button" onClick={handleResetZoom} title={labels.zoomReset || "Reset Zoom (1:1)"}>
					1:1
				</button>
			</div>
		</div>
	);
}
