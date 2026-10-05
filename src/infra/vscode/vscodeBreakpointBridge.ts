import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ApplySceneResult, IBreakpointBridge } from "#src/domain/ports/breakpointBridge";
import { extractContextSnippet } from "#src/domain/services/healingEngine";
import type {
	ContextSnippet,
	FunctionSceneBreakpoint,
	SceneBreakpoint,
	SourceSceneBreakpoint,
} from "#src/domain/types";
import { isSameFsPath } from "#src/shared/utils/pathUtils";
import { dapEchoGuard } from "./dapEchoGuard";

export type { ApplySceneResult };
export { dapEchoGuard };

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
	const targetLineZeroBased = Math.max(0, srcItem.line - 1);

	return currentBreakpoints.find((bp): bp is vscode.SourceBreakpoint => {
		if (!(bp instanceof vscode.SourceBreakpoint)) return false;
		return (
			isSameFsPath(bp.location.uri.fsPath, targetUri.fsPath) &&
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
			isSameFsPath(a.location.uri.fsPath, b.location.uri.fsPath) &&
			a.location.range.start.line === b.location.range.start.line &&
			a.enabled === b.enabled &&
			a.condition === b.condition &&
			a.hitCondition === b.hitCondition &&
			a.logMessage === b.logMessage
		);
	}
	return false;
}

/**
 * 核心增量 Diff 算法：找出完全重叠的共有断点原地保留，仅增删差量断点 (INV-002)
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
 * 将目标场景的断点批量装配至 VS Code 调试器 DAP (INV-002 / INV-005)
 */
export async function applySceneBreakpoints(
	workspaceRoot: string,
	_targetScene: string,
	bpsToLoad: SceneBreakpoint[],
): Promise<ApplySceneResult> {
	return dapEchoGuard.withApplyingLock(async () => {
		const currentBreakpoints = vscode.debug.breakpoints;

		if (!bpsToLoad?.length) {
			if (currentBreakpoints.length > 0) {
				await vscode.debug.removeBreakpoints(currentBreakpoints);
			}
			return { loadedCount: 0, healedCount: 0 };
		}

		const targetBreakpoints = await buildDapBreakpoints(workspaceRoot, bpsToLoad);
		const { toRemove, toAdd } = computeDapDiff(currentBreakpoints, targetBreakpoints);
		if (toRemove.length > 0) await vscode.debug.removeBreakpoints(toRemove);
		if (toAdd.length > 0) await vscode.debug.addBreakpoints(toAdd);

		return {
			loadedCount: targetBreakpoints.length,
			healedCount: 0,
		};
	});
}

/**
 * 从当前 VS Code 调试运行时中逆向收集所有活跃断点并序列化为领域模型
 */
export async function collectCurrentBreakpoints(workspaceRoot: string): Promise<SceneBreakpoint[]> {
	const currentBreakpoints = vscode.debug.breakpoints;
	const exportedBps: SceneBreakpoint[] = [];

	for (const bp of currentBreakpoints) {
		if (bp instanceof vscode.FunctionBreakpoint) {
			exportedBps.push({
				type: "function",
				functionName: bp.functionName,
				enabled: bp.enabled,
				condition: bp.condition?.trim() || undefined,
				hitCondition: bp.hitCondition?.trim() || undefined,
				desc: undefined,
			});
		} else if (bp instanceof vscode.SourceBreakpoint) {
			const fullPath = bp.location.uri.fsPath;
			const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, "/");
			const line = bp.location.range.start.line + 1;

			let bpType: SourceSceneBreakpoint["type"] = "line";
			if (bp.logMessage) {
				bpType = "logpoint";
			} else if (bp.hitCondition) {
				bpType = "hitCount";
			} else if (bp.condition) {
				bpType = "condition";
			}

			let contextSnippet: ContextSnippet | undefined;
			try {
				const doc = await vscode.workspace.openTextDocument(bp.location.uri);
				contextSnippet = extractContextSnippet(doc, bp.location.range.start.line);
			} catch {
				// 文件无法访问则安全跳过指纹抓取
			}

			exportedBps.push({
				type: bpType,
				file: relPath,
				line: line,
				enabled: bp.enabled,
				condition: bp.condition?.trim() || undefined,
				hitCondition: bp.hitCondition?.trim() || undefined,
				logMessage: bp.logMessage?.trim() || undefined,
				desc: undefined,
				contextSnippet,
			});
		}
	}

	return exportedBps;
}

/**
 * 将单个新断点即刻点亮注入到编辑器 DAP 运行时中 (用于添加断点到当前激活场景)
 */
export async function applySingleBreakpointToEditor(
	workspaceRoot: string,
	sceneBp: SceneBreakpoint,
): Promise<boolean> {
	if (!sceneBp) return false;
	const isFunction = sceneBp.type === "function";
	const uri = !isFunction
		? await resolveFileUri(workspaceRoot, (sceneBp as SourceSceneBreakpoint).file)
		: undefined;
	if (!isFunction && !uri) return false;

	if (findMatchingDapBreakpoint(vscode.debug.breakpoints, sceneBp, uri)) {
		return false;
	}

	const newBp = isFunction
		? createFunctionBreakpoint(sceneBp)
		: createSourceBreakpoint(
			new vscode.Location(uri!, new vscode.Position(Math.max(0, (sceneBp as SourceSceneBreakpoint).line - 1), 0)),
			sceneBp as SourceSceneBreakpoint,
		);

	return dapEchoGuard.withApplyingLock(async () => {
		await vscode.debug.addBreakpoints([newBp]);
		return true;
	});
}

/**
 * 清空 VS Code 当前工作区所有断点
 */
export async function clearAllBreakpoints(): Promise<void> {
	await vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
}

/**
 * 精准就地同步单个断点的启用/禁用状态到 VS Code 编辑器 DAP 运行时
 */
export async function syncBreakpointEnabledToEditor(
	workspaceRoot: string,
	sceneBp: SceneBreakpoint,
	targetEnabled: boolean,
): Promise<boolean> {
	if (!sceneBp) return false;
	const isFunction = sceneBp.type === "function";
	const uri = !isFunction
		? await resolveFileUri(workspaceRoot, (sceneBp as SourceSceneBreakpoint).file)
		: undefined;
	const matched = findMatchingDapBreakpoint(vscode.debug.breakpoints, sceneBp, uri);

	if (!matched || matched.enabled === targetEnabled) {
		return false;
	}

	const updated = cloneDapBreakpointWithEnabled(matched, targetEnabled);
	return dapEchoGuard.withApplyingLock(async () => {
		await vscode.debug.removeBreakpoints([matched]);
		await vscode.debug.addBreakpoints([updated]);
		return true;
	});
}

/**
 * VS Code DAP 调试断点适配器深度实现 (Deep Adapter)
 * 内聚 DiffApplier / Collector / Synchronizer，完整实现 IBreakpointBridge 领域端口契约
 */
export const vscodeBreakpointBridge: IBreakpointBridge = {
	applySceneBreakpoints,
	collectCurrentBreakpoints,
	clearAllBreakpoints,
	applySingleBreakpointToEditor,
	syncBreakpointEnabledToEditor,
};
