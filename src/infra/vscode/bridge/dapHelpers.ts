import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { sceneStateManager } from "#src/application/sceneStateManager";
import type {
	FunctionSceneBreakpoint,
	SceneBreakpoint,
	SourceSceneBreakpoint,
} from "#src/domain/types";

/**
 * 统一执行带原子锁保护的 DAP 动作
 */
export async function withApplyingLock<T>(action: () => Promise<T>): Promise<T> {
	sceneStateManager.setApplyingState(true);
	try {
		return await action();
	} finally {
		setTimeout(() => sceneStateManager.setApplyingState(false), 150);
	}
}

/**
 * 解析并定位目标文件的 VS Code Uri（支持相对路径与模糊降级寻道）
 */
export async function resolveFileUri(
	workspaceRoot: string,
	filePath: string,
	cache?: Map<string, vscode.Uri | null>,
): Promise<vscode.Uri | undefined> {
	if (!filePath) return undefined;
	if (cache?.has(filePath)) {
		return cache.get(filePath) || undefined;
	}

	const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
	let targetUri: vscode.Uri | undefined | null;

	if (fs.existsSync(fullPath)) {
		targetUri = vscode.Uri.file(fullPath);
	} else {
		const found = await vscode.workspace.findFiles(`**/${path.basename(filePath)}`, "**/node_modules/**", 1);
		targetUri = found.length > 0 ? found[0] : null;
	}

	cache?.set(filePath, targetUri);
	return targetUri || undefined;
}

/**
 * 构建 VS Code 原生 SourceBreakpoint
 */
export function createSourceBreakpoint(
	location: vscode.Location,
	item: SourceSceneBreakpoint,
	isEnabled = item.enabled ?? true,
): vscode.SourceBreakpoint {
	switch (item.type) {
		case "condition":
			return new vscode.SourceBreakpoint(location, isEnabled, item.condition);
		case "hitCount":
			return new vscode.SourceBreakpoint(location, isEnabled, undefined, item.hitCondition);
		case "logpoint":
			return new vscode.SourceBreakpoint(location, isEnabled, undefined, undefined, item.logMessage);
		case "line":
		default:
			return new vscode.SourceBreakpoint(location, isEnabled);
	}
}

/**
 * 构建 VS Code 原生 FunctionBreakpoint
 */
export function createFunctionBreakpoint(
	item: FunctionSceneBreakpoint,
	isEnabled = item.enabled ?? true,
): vscode.FunctionBreakpoint {
	return new vscode.FunctionBreakpoint(
		item.functionName.trim(),
		isEnabled,
		item.condition,
		item.hitCondition,
	);
}

/**
 * 在当前 DAP 活跃断点中查找与场景断点物理匹配的宿主断点
 */
export function findMatchingDapBreakpoint(
	currentBreakpoints: readonly vscode.Breakpoint[],
	sceneBp: SceneBreakpoint,
	targetUri?: vscode.Uri,
): vscode.Breakpoint | undefined {
	if (sceneBp.type === "function") {
		const funcItem = sceneBp as FunctionSceneBreakpoint;
		return currentBreakpoints.find(
			(bp): bp is vscode.FunctionBreakpoint =>
				bp instanceof vscode.FunctionBreakpoint && bp.functionName === funcItem.functionName,
		);
	}

	if (!targetUri) return undefined;
	const srcItem = sceneBp as SourceSceneBreakpoint;
	const normFullPath = path.normalize(targetUri.fsPath).toLowerCase();
	const targetLineZeroBased = Math.max(0, srcItem.line - 1);

	return currentBreakpoints.find((bp): bp is vscode.SourceBreakpoint => {
		if (!(bp instanceof vscode.SourceBreakpoint)) return false;
		return (
			path.normalize(bp.location.uri.fsPath).toLowerCase() === normFullPath &&
			bp.location.range.start.line === targetLineZeroBased
		);
	});
}

/**
 * 克隆宿主断点并更新其启用/禁用状态
 */
export function cloneDapBreakpointWithEnabled(
	bp: vscode.Breakpoint,
	enabled: boolean,
): vscode.Breakpoint {
	if (bp instanceof vscode.FunctionBreakpoint) {
		return new vscode.FunctionBreakpoint(bp.functionName, enabled, bp.condition, bp.hitCondition);
	}
	const srcBp = bp as vscode.SourceBreakpoint;
	return new vscode.SourceBreakpoint(
		srcBp.location,
		enabled,
		srcBp.condition,
		srcBp.hitCondition,
		srcBp.logMessage,
	);
}
