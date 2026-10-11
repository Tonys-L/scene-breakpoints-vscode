import type { GraphSnapshot } from "#src/application/sceneGraphProjection";
import type { TraceRecord } from "#src/application/debugTraceBuffer";

/**
 * 画布 Webview postMessage 双向协议 (v1.3.0)
 * 纯类型契约：宿主 → webview 全量渲染/增量脉冲；webview → 宿主交互回传。
 * webview 侧脚本零业务逻辑，所有状态由宿主推送。
 */

export type GraphViewTab = "flow" | "trace";

/** 宿主 → webview */
export type HostToWebviewMessage =
	| { type: "render"; snapshot: GraphSnapshot }
	| { type: "view"; tab: GraphViewTab }
	| { type: "live-pulse"; nodeId: string }
	| { type: "live-clear" }
	| { type: "trace-append"; record: TraceRecord }
	| { type: "trace-clear" }
	| { type: "debug-status"; status: "paused" | "running" | "terminated" };

/** webview → 宿主 */
export type WebviewToHostMessage =
	| { type: "open-source"; nodeId?: string; file?: string; line?: number }
	| { type: "switch-tab"; tab: GraphViewTab }
	| { type: "export-mermaid" }
	| { type: "set-scope"; scenes: readonly string[] }
	| { type: "activate-scene"; sceneName: string }
	| { type: "clear-trace" }
	| { type: "focus-node"; nodeId: string }
	| { type: "ready" };

/** webview 消息运行时类型守卫（宿主侧 onDidReceiveMessage 入口校验） */
export function isWebviewToHostMessage(msg: unknown): msg is WebviewToHostMessage {
	if (!msg || typeof msg !== "object") return false;
	const type = (msg as { type?: unknown }).type;
	if (type === "set-scope") {
		const scenes = (msg as { scenes?: unknown }).scenes;
		return Array.isArray(scenes) && scenes.every((scene) => typeof scene === "string");
	}
	if (type === "activate-scene") {
		return typeof (msg as { sceneName?: unknown }).sceneName === "string";
	}
	if (type === "focus-node") {
		return typeof (msg as { nodeId?: unknown }).nodeId === "string";
	}
	return (
		type === "open-source" ||
		type === "switch-tab" ||
		type === "export-mermaid" ||
		type === "clear-trace" ||
		type === "ready"
	);
}

/** tab 值运行时类型守卫（协议消息字段校验） */
export function isGraphViewTab(tab: unknown): tab is GraphViewTab {
	return tab === "flow" || tab === "trace";
}
