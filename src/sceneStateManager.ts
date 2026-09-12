import * as vscode from "vscode";

export interface SceneState {
	activeScenes: string[];
	isDirty: boolean;
}

class SceneStateManager {
	private currentActiveScenes: string[] = [];
	private isDirty = false;
	private isApplying = false;
	private baselineBreakpointCount = 0;
	private unmatchedBreakpointsKeySet = new Set<string>();

	private readonly _onDidChangeState = new vscode.EventEmitter<SceneState>();
	public readonly onDidChangeState = this._onDidChangeState.event;

	public getActiveScenes(): string[] {
		return [...this.currentActiveScenes];
	}

	public getActiveScene(): string | undefined {
		return this.currentActiveScenes[0];
	}

	public isSceneActive(sceneName: string): boolean {
		return this.currentActiveScenes.includes(sceneName);
	}

	public getIsDirty(): boolean {
		return this.isDirty;
	}

	public setUnmatchedBreakpoints(keys: string[]): void {
		this.unmatchedBreakpointsKeySet = new Set(
			keys.map((k) => k.replace(/\\/g, "/").toLowerCase()),
		);
	}

	public isBreakpointUnmatched(file?: string, line?: number): boolean {
		if (!file || !line) return false;
		const norm = `${file.trim().replace(/\\/g, "/")}:${line}`.toLowerCase();
		return this.unmatchedBreakpointsKeySet.has(norm);
	}

	public setActiveScenes(sceneNames: string[], initialBpCount = 0): void {
		const uniqueSorted = Array.from(new Set(sceneNames.map((s) => s.trim()).filter(Boolean))).sort();
		this.currentActiveScenes = uniqueSorted;
		this.baselineBreakpointCount = initialBpCount;
		this.isDirty = false;

		this._onDidChangeState.fire({
			activeScenes: this.currentActiveScenes,
			isDirty: this.isDirty,
		});
	}

	public setActiveScene(sceneName: string | undefined, initialBpCount = 0): void {
		this.setActiveScenes(sceneName ? [sceneName] : [], initialBpCount);
	}

	public toggleScene(sceneName: string): string[] {
		const target = sceneName.trim();
		if (!target) return this.getActiveScenes();

		let updated: string[];
		if (this.currentActiveScenes.includes(target)) {
			updated = this.currentActiveScenes.filter((s) => s !== target);
		} else {
			updated = [...this.currentActiveScenes, target];
		}
		return updated;
	}

	public setDirty(dirty: boolean): void {
		if (this.isDirty !== dirty && this.currentActiveScenes.length > 0) {
			this.isDirty = dirty;
			this._onDidChangeState.fire({
				activeScenes: this.currentActiveScenes,
				isDirty: this.isDirty,
			});
		}
	}

	public checkDirtyWithCount(currentCount: number): void {
		if (this.currentActiveScenes.length === 0 || this.isApplying) return;
		const dirty = currentCount !== this.baselineBreakpointCount;
		this.setDirty(dirty);
	}

	public isApplyingScene(): boolean {
		return this.isApplying;
	}

	public setApplyingState(applying: boolean): void {
		this.isApplying = applying;
	}

	private lastAppliedTopologyHash = "";
	private pendingTopologyUpdate = false;

	public getLastAppliedTopologyHash(): string {
		return this.lastAppliedTopologyHash;
	}

	public setLastAppliedTopologyHash(hash: string): void {
		this.lastAppliedTopologyHash = hash;
	}

	public clearLastAppliedTopologyHash(): void {
		this.lastAppliedTopologyHash = "";
	}

	public isPendingTopologyUpdate(): boolean {
		return this.pendingTopologyUpdate;
	}

	public setPendingTopologyUpdate(pending: boolean): void {
		this.pendingTopologyUpdate = pending;
	}

	public dispose(): void {
		this.clearLastAppliedTopologyHash();
		this.pendingTopologyUpdate = false;
		this._onDidChangeState.dispose();
	}
}

export const sceneStateManager = new SceneStateManager();


