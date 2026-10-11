import { useEffect, useRef, useState } from "preact/hooks";
import type { CanvasLabels } from "../types";

export interface MinimapProps {
	cy: any;
	labels?: CanvasLabels;
}

const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 120;
const PADDING = 24;

export function Minimap({ cy, labels }: MinimapProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [isCollapsed, setIsCollapsed] = useState(false);
	const isDraggingRef = useRef(false);
	const animFrameIdRef = useRef<number | null>(null);

	// 坐标映射辅助计算引用
	const transformRef = useRef<{
		minX: number;
		minY: number;
		scale: number;
		offsetX: number;
		offsetY: number;
	}>({ minX: 0, minY: 0, scale: 1, offsetX: 0, offsetY: 0 });

	const renderMinimap = () => {
		const canvas = canvasRef.current;
		if (!canvas || !cy || isCollapsed) return;

		const dpr = window.devicePixelRatio || 1;
		if (canvas.width !== MINIMAP_WIDTH * dpr || canvas.height !== MINIMAP_HEIGHT * dpr) {
			canvas.width = MINIMAP_WIDTH * dpr;
			canvas.height = MINIMAP_HEIGHT * dpr;
		}

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.save();
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

		const elements = cy.elements();
		if (elements.length === 0) {
			ctx.restore();
			return;
		}

		const bb = elements.boundingBox();
		const minX = bb.x1 - PADDING;
		const minY = bb.y1 - PADDING;
		const totalW = Math.max(1, bb.w + PADDING * 2);
		const totalH = Math.max(1, bb.h + PADDING * 2);

		const scale = Math.min(MINIMAP_WIDTH / totalW, MINIMAP_HEIGHT / totalH);
		const offsetX = (MINIMAP_WIDTH - totalW * scale) / 2;
		const offsetY = (MINIMAP_HEIGHT - totalH * scale) / 2;

		transformRef.current = { minX, minY, scale, offsetX, offsetY };

		// 1. 绘制泳道背景微缩
		ctx.fillStyle = "rgba(110, 118, 129, 0.12)";
		ctx.strokeStyle = "rgba(110, 118, 129, 0.3)";
		ctx.lineWidth = 1;

		cy.nodes(".lane").forEach((laneNode: any) => {
			const pos = laneNode.position();
			const w = laneNode.width();
			const h = laneNode.height();
			const lx = offsetX + (pos.x - w / 2 - minX) * scale;
			const ly = offsetY + (pos.y - h / 2 - minY) * scale;
			const lw = w * scale;
			const lh = h * scale;
			ctx.fillRect(lx, ly, lw, lh);
			ctx.strokeRect(lx, ly, lw, lh);
		});

		// 2. 绘制断点卡片微缩块
		ctx.fillStyle = "rgba(59, 130, 246, 0.75)";
		cy.nodes(".bp-placeholder").forEach((bpNode: any) => {
			const pos = bpNode.position();
			const bx = offsetX + (pos.x - 110 - minX) * scale;
			const by = offsetY + (pos.y - 28 - minY) * scale;
			const bw = Math.max(3, 220 * scale);
			const bh = Math.max(2, 56 * scale);
			ctx.fillRect(bx, by, bw, bh);
		});

		// 3. 绘制当前视口矩形 (Viewfinder)
		const ext = cy.extent();
		const vx = offsetX + (ext.x1 - minX) * scale;
		const vy = offsetY + (ext.y1 - minY) * scale;
		const vw = (ext.x2 - ext.x1) * scale;
		const vh = (ext.y2 - ext.y1) * scale;

		// 视口半透明高亮与边缘强调
		ctx.fillStyle = "rgba(59, 130, 246, 0.18)";
		ctx.fillRect(vx, vy, vw, vh);

		ctx.strokeStyle = "rgba(96, 165, 250, 0.9)";
		ctx.lineWidth = 1.5;
		ctx.strokeRect(vx, vy, vw, vh);

		ctx.restore();
	};

	const scheduleRender = () => {
		if (animFrameIdRef.current) return;
		animFrameIdRef.current = requestAnimationFrame(() => {
			animFrameIdRef.current = null;
			renderMinimap();
		});
	};

	useEffect(() => {
		if (!cy) return;

		scheduleRender();

		const events = "render pan zoom position layoutstop";
		cy.on(events, scheduleRender);

		return () => {
			cy.removeListener(events, scheduleRender);
			if (animFrameIdRef.current) {
				cancelAnimationFrame(animFrameIdRef.current);
				animFrameIdRef.current = null;
			}
		};
	}, [cy, isCollapsed]);

	// 点击或拖拽定位主视口
	const handleMinimapPan = (clientX: number, clientY: number) => {
		if (!cy || !canvasRef.current) return;
		const rect = canvasRef.current.getBoundingClientRect();
		const mx = clientX - rect.left;
		const my = clientY - rect.top;

		const { minX, minY, scale, offsetX, offsetY } = transformRef.current;
		if (scale <= 0) return;

		const targetX = minX + (mx - offsetX) / scale;
		const targetY = minY + (my - offsetY) / scale;

		// 计算目标视口中心对齐的物理 pan 坐标
		const zoom = cy.zoom();
		const newPanX = cy.width() / 2 - targetX * zoom;
		const newPanY = cy.height() / 2 - targetY * zoom;

		cy.pan({ x: newPanX, y: newPanY });
	};

	const handlePointerDown = (e: PointerEvent) => {
		isDraggingRef.current = true;
		try {
			(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		} catch {}
		handleMinimapPan(e.clientX, e.clientY);
	};

	const handlePointerMove = (e: PointerEvent) => {
		if (!isDraggingRef.current) return;
		handleMinimapPan(e.clientX, e.clientY);
	};

	const handlePointerUp = (e: PointerEvent) => {
		isDraggingRef.current = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		} catch {}
	};

	useEffect(() => {
		const onGlobalPointerUp = () => {
			isDraggingRef.current = false;
		};
		window.addEventListener("pointerup", onGlobalPointerUp);
		return () => window.removeEventListener("pointerup", onGlobalPointerUp);
	}, []);

	if (isCollapsed) {
		return (
			<button
				type="button"
				className="minimap-toggle-btn collapsed"
				onClick={() => setIsCollapsed(false)}
				title={labels?.expandMinimap || "Expand Minimap"}
			>
				<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
					<path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-11zM2.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-11zM4 4h8v2H4V4zm0 3h5v2H4V7zm0 3h8v2H4v-2z" />
				</svg>
				<span>{labels?.minimap || "Minimap"}</span>
			</button>
		);
	}

	return (
		<div className="minimap-container">
			<div className="minimap-header">
				<span className="minimap-title">{labels?.minimapNav || "Minimap Navigation"}</span>
				<button
					type="button"
					className="minimap-collapse-btn"
					onClick={() => setIsCollapsed(true)}
					title={labels?.collapseMinimap || "Collapse Minimap"}
				>
					✕
				</button>
			</div>
			<canvas
				ref={canvasRef}
				className="minimap-canvas"
				style={{ width: `${MINIMAP_WIDTH}px`, height: `${MINIMAP_HEIGHT}px` }}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
			/>
		</div>
	);
}
