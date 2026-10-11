import { useState, useRef, useEffect } from "preact/hooks";
import type { GraphSnapshot } from "#src/application/sceneGraphProjection";
import type { CanvasLabels, VsCodeApi } from "#src/ui/views/graphCanvas/webview/types";

export interface SceneSelectorProps {
	snapshot: GraphSnapshot;
	labels?: CanvasLabels;
	vscode: VsCodeApi;
}

export function SceneSelector({ snapshot, labels, vscode }: SceneSelectorProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const rootRef = useRef<HTMLDivElement>(null);

	const available = snapshot.availableScenes || [];
	const visibleLanes = snapshot.lanes || [];
	const currentScene = visibleLanes[0]?.sceneName || "";
	const activeSet = new Set(snapshot.activeScenes || []);

	// 点击外部区域自动关闭
	useEffect(() => {
		const handleOutsideClick = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		if (isOpen) {
			document.addEventListener("mousedown", handleOutsideClick);
		}
		return () => {
			document.removeEventListener("mousedown", handleOutsideClick);
		};
	}, [isOpen]);

	if (available.length === 0) {
		return null;
	}

	const filtered = available.filter((sc) =>
		sc.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
	);

	const activeScenes = filtered.filter((sc) => activeSet.has(sc.name));
	const inactiveScenes = filtered.filter((sc) => !activeSet.has(sc.name));

	// 单选切换场景
	const handleSelectScene = (sceneName: string) => {
		vscode.postMessage({ type: "set-scope", scenes: [sceneName] });
		setIsOpen(false);
	};

	const triggerStatus = activeSet.has(currentScene)
		? (labels?.statusActive || "● Active")
		: (labels?.statusPreview || "○ Preview");

	const localBadge = labels?.localLayerBadge || "Local";
	const localTitle = labels?.localLayerTitle || "Local private scene (.vscode/debug-scenes.local.json)";
	const scenePrefix = labels?.scenePrefix || "Scene:";
	const selectPrompt = labels?.selectScenePrompt || "Select Scene";

	return (
		<div className="scene-selector-container" ref={rootRef}>
			<button
				type="button"
				className={`scene-selector-trigger ${isOpen ? "open" : ""}`}
				onClick={() => setIsOpen(!isOpen)}
				title={labels?.sceneSelectTooltip || "Click to switch active debug scene"}
			>
				<span className="scene-trigger-icon">
					<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
						<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" />
						<circle cx="8" cy="8" r="2.5" />
					</svg>
				</span>
				<span className="scene-trigger-label" title={currentScene}>
					{scenePrefix} {currentScene || selectPrompt}
				</span>
				<span className={`scene-trigger-status ${activeSet.has(currentScene) ? "active" : "inactive"}`}>
					{triggerStatus}
				</span>
				<span className="scene-trigger-arrow">▼</span>
			</button>

			{isOpen && (
				<div className="scene-popover">
					<div className="scene-popover-search">
						<input
							type="text"
							placeholder={labels?.searchScenePlaceholder || "Search scene name..."}
							value={searchQuery}
							onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
							autoFocus
						/>
					</div>

					<div className="scene-popover-list">
						{activeScenes.length > 0 && (
							<div className="scene-group">
								<div className="scene-group-title">
									<span className="status-dot active">●</span> {labels?.activeScenesGroup || "Active Scenes"}
								</div>
								{activeScenes.map((sc) => {
									const isCurrent = sc.name === currentScene;
									const switchTooltip = labels?.switchToSceneTooltip
										? labels.switchToSceneTooltip.replace("{0}", sc.name)
										: `Switch to scene: ${sc.name}`;
									return (
										<div
											key={sc.name}
											className={`scene-item ${isCurrent ? "current-selected" : ""}`}
											onClick={() => handleSelectScene(sc.name)}
											title={switchTooltip}
										>
											<span className="scene-select-check">
												{isCurrent ? "✓" : ""}
											</span>
											<span className="scene-item-name">{sc.name}</span>
											{sc.layer === "local" && (
												<span className="scene-item-layer local" title={localTitle}>
													{localBadge}
												</span>
											)}
										</div>
									);
								})}
							</div>
						)}

						{inactiveScenes.length > 0 && (
							<div className="scene-group">
								<div className="scene-group-title">
									<span className="status-dot inactive">○</span> {labels?.inactiveScenesGroup || "Pending / Preview Scenes"}
								</div>
								{inactiveScenes.map((sc) => {
									const isCurrent = sc.name === currentScene;
									const switchTooltip = labels?.switchToSceneTooltip
										? labels.switchToSceneTooltip.replace("{0}", sc.name)
										: `Switch to scene: ${sc.name}`;
									return (
										<div
											key={sc.name}
											className={`scene-item ${isCurrent ? "current-selected" : ""}`}
											onClick={() => handleSelectScene(sc.name)}
											title={switchTooltip}
										>
											<span className="scene-select-check">
												{isCurrent ? "✓" : ""}
											</span>
											<span className="scene-item-name">{sc.name}</span>
											{sc.layer === "local" && (
												<span className="scene-item-layer local" title={localTitle}>
													{localBadge}
												</span>
											)}
										</div>
									);
								})}
							</div>
						)}

						{filtered.length === 0 && (
							<div className="scene-empty-search">
								{labels?.noScenesFound || "No matching scenes found"}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
