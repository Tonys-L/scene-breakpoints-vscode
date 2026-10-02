import * as path from "node:path";
import * as vscode from "vscode";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { ActiveScenesDiffResolver } from "#src/domain/services/activeScenesDiffResolver";
import type {
	FunctionSceneBreakpoint,
	SceneBreakpoint,
	SourceSceneBreakpoint,
} from "#src/domain/types";
import type { ApplySceneResult } from "#src/domain/ports/breakpointBridge";
import {
	createFunctionBreakpoint,
	createSourceBreakpoint,
	resolveFileUri,
	withApplyingLock,
} from "./dapHelpers";

/**
 * 将目标场景的断点批量装配至 VS Code 调试器 DAP
 * 采用增量 Diff 算法：找出完全重叠的共有断点原地保留，仅增删差量断点，达到 0 闪烁
 */
export async function applySceneBreakpoints(
	workspaceRoot: string,
	_targetScene: string,
	bpsToLoad: SceneBreakpoint[],
): Promise<ApplySceneResult> {
	return withApplyingLock(async () => {
		const currentBreakpoints = vscode.debug.breakpoints;

		if (!bpsToLoad?.length) {
			if (currentBreakpoints.length > 0) {
				await vscode.debug.removeBreakpoints(currentBreakpoints);
			}
			sceneStateManager.setLastAppliedTopologyHash(ActiveScenesDiffResolver.computeTopologyHash([]));
			return { loadedCount: 0, healedCount: 0 };
		}

		// 1. 将场景断点 DTO 映射构建为 VS Code 原生 DAP 断点对象
		const targetBreakpoints = await buildDapBreakpoints(workspaceRoot, bpsToLoad);

		// 2. 原地 0 闪烁增量 Diff 下发
		const { toRemove, toAdd } = computeDapDiff(currentBreakpoints, targetBreakpoints);
		if (toRemove.length > 0) await vscode.debug.removeBreakpoints(toRemove);
		if (toAdd.length > 0) await vscode.debug.addBreakpoints(toAdd);

		// 3. 记录已装配拓扑 Hash
		sceneStateManager.setLastAppliedTopologyHash(ActiveScenesDiffResolver.computeTopologyHash(bpsToLoad));

		return {
			loadedCount: targetBreakpoints.length,
			healedCount: 0,
		};
	});
}

/**
 * 批量构建 VS Code 原生 DAP 断点对象列表
 */
async function buildDapBreakpoints(
	workspaceRoot: string,
	bpsToLoad: SceneBreakpoint[],
): Promise<vscode.Breakpoint[]> {
	const pathCache = new Map<string, vscode.Uri | null>();
	const targetBreakpoints: vscode.Breakpoint[] = [];

	for (const item of bpsToLoad) {
		if (!item || typeof item !== "object") continue;

		if (item.type === "function") {
			const funcItem = item as FunctionSceneBreakpoint;
			if (funcItem.functionName?.trim()) {
				targetBreakpoints.push(createFunctionBreakpoint(funcItem));
			}
			continue;
		}

		const srcItem = item as SourceSceneBreakpoint;
		if (!srcItem.file || typeof srcItem.line !== "number" || isNaN(srcItem.line) || srcItem.line <= 0) {
			continue;
		}

		const targetUri = await resolveFileUri(workspaceRoot, srcItem.file, pathCache);
		if (!targetUri) continue;

		const pos = new vscode.Position(Math.max(0, srcItem.line - 1), 0);
		targetBreakpoints.push(createSourceBreakpoint(new vscode.Location(targetUri, pos), srcItem));
	}

	return targetBreakpoints;
}

/**
 * 核心增量 Diff 算法：找出完全重叠的共有断点原地保留，仅增删差量断点
 */
export function computeDapDiff(
	currentBreakpoints: readonly vscode.Breakpoint[],
	targetBreakpoints: readonly vscode.Breakpoint[],
): { toRemove: vscode.Breakpoint[]; toAdd: vscode.Breakpoint[] } {
	const matchedCurrentIndices = new Set<number>();
	const matchedTargetIndices = new Set<number>();

	for (let cIdx = 0; cIdx < currentBreakpoints.length; cIdx++) {
		const curr = currentBreakpoints[cIdx];
		for (let tIdx = 0; tIdx < targetBreakpoints.length; tIdx++) {
			if (matchedTargetIndices.has(tIdx)) continue;
			const target = targetBreakpoints[tIdx];

			if (isSameDapBreakpoint(curr, target)) {
				matchedCurrentIndices.add(cIdx);
				matchedTargetIndices.add(tIdx);
				break;
			}
		}
	}

	return {
		toRemove: currentBreakpoints.filter((_, idx) => !matchedCurrentIndices.has(idx)),
		toAdd: targetBreakpoints.filter((_, idx) => !matchedTargetIndices.has(idx)),
	};
}

function isSameDapBreakpoint(a: vscode.Breakpoint, b: vscode.Breakpoint): boolean {
	if (a instanceof vscode.FunctionBreakpoint && b instanceof vscode.FunctionBreakpoint) {
		return (
			a.functionName === b.functionName &&
			a.enabled === b.enabled &&
			a.condition === b.condition &&
			a.hitCondition === b.hitCondition
		);
	}
	if (a instanceof vscode.SourceBreakpoint && b instanceof vscode.SourceBreakpoint) {
		return (
			path.normalize(a.location.uri.fsPath).toLowerCase() === path.normalize(b.location.uri.fsPath).toLowerCase() &&
			a.location.range.start.line === b.location.range.start.line &&
			a.enabled === b.enabled &&
			a.condition === b.condition &&
			a.hitCondition === b.hitCondition &&
			a.logMessage === b.logMessage
		);
	}
	return false;
}
