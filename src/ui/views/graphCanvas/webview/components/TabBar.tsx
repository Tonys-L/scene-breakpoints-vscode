import type { GraphViewTab } from "#src/ui/views/graphCanvas/graphMessageProtocol";
import type { GraphSnapshot } from "#src/application/sceneGraphProjection";
import type { CanvasLabels, VsCodeApi } from "#src/ui/views/graphCanvas/webview/types";
import { SceneSelector } from "./SceneSelector";
import { ZapIcon } from "./icons";

export interface TabBarProps {
	currentTab: GraphViewTab;
	snapshot: GraphSnapshot;
	labels: CanvasLabels;
	vscode: VsCodeApi;
	onTabChange(tab: GraphViewTab): void;
}

export function TabBar({
	currentTab,
	snapshot,
	labels,
	vscode,
	onTabChange,
}: TabBarProps) {
	const handleExport = () => {
		vscode.postMessage({ type: "export-mermaid" });
	};

	const lanes = snapshot.lanes || [];
	const activeSet = new Set(snapshot.activeScenes || []);

	// 当前可见单场景且未激活时，展示激活按钮
	const isSingleVisible = lanes.length === 1;
	const currentVisibleName = isSingleVisible ? lanes[0].sceneName : null;
	const isCurrentActive = currentVisibleName ? activeSet.has(currentVisibleName) : false;

	const handleActivateCurrent = () => {
		if (currentVisibleName) {
			vscode.postMessage({ type: "activate-scene", sceneName: currentVisibleName });
		}
	};

	return (
		<div className="tabbar">
			<div className="tab-buttons">
				<button
					id="tab-flow"
					className={currentTab === "flow" ? "active" : ""}
					onClick={() => onTabChange("flow")}
				>
					{labels.tabFlow || "Flow"}
				</button>
				<button
					id="tab-trace"
					className={currentTab === "trace" ? "active" : ""}
					onClick={() => onTabChange("trace")}
				>
					{labels.tabTrace || "Hit Trace"}
				</button>
			</div>

			<div className="tabbar-divider" />

			<SceneSelector snapshot={snapshot} labels={labels} vscode={vscode} />

			<span className="spacer" />

			{currentVisibleName && !isCurrentActive && (
				<button
					className="btn-activate-scene"
					onClick={handleActivateCurrent}
					title={labels.activateSceneTooltip
						? labels.activateSceneTooltip.replace("{0}", currentVisibleName)
						: `Activate [${currentVisibleName}] and register breakpoints immediately`}
				>
					<ZapIcon size={12} />
					<span>{labels.activateScene || "Activate Scene"}</span>
				</button>
			)}

			<button
				id="btn-export"
				onClick={handleExport}
				title={labels.exportMermaidTooltip || "Export Mermaid Flowchart"}
			>
				{labels.exportButton || "Export Mermaid"}
			</button>
		</div>
	);
}
