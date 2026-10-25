import { useEffect, useState } from "preact/hooks";
import type { GraphViewTab } from "#src/ui/views/graphCanvas/graphMessageProtocol";
import type { CanvasPayload, TooltipState, VsCodeApi } from "#src/ui/views/graphCanvas/webview/types";
import { TabBar } from "./TabBar";
import { FlowView } from "./FlowView";
import { TraceView } from "./TraceView";
import { Tooltip } from "./Tooltip";

export interface AppProps {
	payload: CanvasPayload;
	vscode: VsCodeApi;
}

export function App({ payload, vscode }: AppProps) {
	const [snapshot, setSnapshot] = useState(payload.snapshot);
	const [records, setRecords] = useState(payload.records || []);
	const [currentTab, setCurrentTab] = useState<GraphViewTab>(payload.initialTab || "flow");
	const [pulseNodeId, setPulseNodeId] = useState<string | null>(null);
	const [debugStatus, setDebugStatus] = useState<"paused" | "running" | "terminated">("terminated");
	const [tooltip, setTooltip] = useState<TooltipState | null>(null);

	const labels = payload.labels || {};

	// 监听宿主 postMessage 消息驱动状态更新
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const msg = event.data;
			if (!msg || typeof msg !== "object") return;

			switch (msg.type) {
				case "render":
					if (msg.snapshot) setSnapshot(msg.snapshot);
					break;
				case "view":
					if (msg.tab === "flow" || msg.tab === "trace") {
						setCurrentTab(msg.tab);
					}
					break;
				case "live-pulse":
					setPulseNodeId(msg.nodeId || null);
					break;
				case "live-clear":
					setPulseNodeId(null);
					break;
				case "trace-append":
					if (msg.record) {
						setRecords((prev) => [...prev, msg.record]);
					}
					break;
				case "trace-records":
					if (Array.isArray(msg.records)) {
						setRecords(msg.records);
					}
					break;
				case "trace-clear":
					setRecords([]);
					break;
				case "debug-status":
					if (msg.status) {
						setDebugStatus(msg.status);
					}
					break;
			}
		};

		window.addEventListener("message", handleMessage);

		// 发送就绪信号给宿主
		vscode.postMessage({ type: "ready" });

		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, []);

	const handleTabChange = (tab: GraphViewTab) => {
		setCurrentTab(tab);
		vscode.postMessage({ type: "switch-tab", tab });
	};

	return (
		<>
			<TabBar
				currentTab={currentTab}
				snapshot={snapshot}
				labels={labels}
				vscode={vscode}
				onTabChange={handleTabChange}
			/>

			{currentTab === "flow" ? (
				<FlowView
					snapshot={snapshot}
					labels={labels}
					pulseNodeId={pulseNodeId}
					vscode={vscode}
					onTooltipChange={setTooltip}
				/>
			) : (
				<TraceView
					snapshot={snapshot}
					records={records}
					debugStatus={debugStatus}
					labels={labels}
					vscode={vscode}
				/>
			)}

			<Tooltip tooltip={tooltip} labels={labels} />
		</>
	);
}
