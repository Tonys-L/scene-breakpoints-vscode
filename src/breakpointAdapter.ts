import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { extractContextSnippet, resolveHealedLine } from "./healingAdapter";
import { sceneStateManager } from "./sceneStateManager";
import type { ContextSnippet, FunctionSceneBreakpoint, SceneBreakpoint, SourceSceneBreakpoint } from "./types";

export interface ApplySceneResult {
	loadedCount: number;
	healedCount: number;
	healedBreakpoints?: SceneBreakpoint[];
}

export async function applySceneBreakpoints(
	workspaceRoot: string,
	targetScene: string,
	bpsToLoad: SceneBreakpoint[],
): Promise<ApplySceneResult> {
	sceneStateManager.setApplyingState(true);
	try {
		const currentBreakpoints = vscode.debug.breakpoints;

		if (!bpsToLoad || bpsToLoad.length === 0) {
			if (currentBreakpoints.length > 0) {
				await vscode.debug.removeBreakpoints(currentBreakpoints);
			}
			return { loadedCount: 0, healedCount: 0 };
		}

		const targetBreakpoints: vscode.Breakpoint[] = [];
		let healedCount = 0;
		// 模糊寻道短期路径缓存：避免同一文件在循环中反复进行全盘 findFiles
		const pathCache = new Map<string, vscode.Uri | null>();
		// 源码行解析短期缓存：避免同一大文件在自愈时反复进行全量读盘与 split 切行
		const fileLinesCache = new Map<string, string[]>();
		const unmatchedBreakpoints: SourceSceneBreakpoint[] = [];

		for (const item of bpsToLoad) {
			if (!item || typeof item !== "object") continue;
			const isEnabled = item.enabled ?? true;

			if (item.type === "function") {
				const funcItem = item as FunctionSceneBreakpoint;
				if (typeof funcItem.functionName === "string" && funcItem.functionName.trim()) {
					const fbp = new vscode.FunctionBreakpoint(
						funcItem.functionName.trim(),
						isEnabled,
						funcItem.condition,
						funcItem.hitCondition,
					);
					targetBreakpoints.push(fbp);
				}
				continue;
			}

			const srcItem = item as SourceSceneBreakpoint;
			if (!srcItem.file || typeof srcItem.file !== "string") continue;
			if (typeof srcItem.line !== "number" || isNaN(srcItem.line) || srcItem.line <= 0) continue;

			let targetUri: vscode.Uri | undefined | null;
			const cacheKey = srcItem.file;
			if (pathCache.has(cacheKey)) {
				targetUri = pathCache.get(cacheKey);
			} else {
				const fullPath = path.isAbsolute(srcItem.file) ? srcItem.file : path.join(workspaceRoot, srcItem.file);
				if (fs.existsSync(fullPath)) {
					targetUri = vscode.Uri.file(fullPath);
				} else {
					const found = await vscode.workspace.findFiles(`**/${path.basename(srcItem.file)}`, "**/node_modules/**", 1);
					targetUri = found.length > 0 ? found[0] : null;
				}
				pathCache.set(cacheKey, targetUri);
			}

			if (!targetUri) continue;

			// 行号自愈探测 (带文件行内存缓存复用)
			let effectiveLine = srcItem.line;
			const healResult = await resolveHealedLine(workspaceRoot, srcItem, fileLinesCache);
			if (healResult.isHealed) {
				effectiveLine = healResult.healedLine;
				srcItem.line = effectiveLine;
				healedCount++;
			} else if (healResult.status === "unmatched") {
				unmatchedBreakpoints.push(srcItem);
			}

			const pos = new vscode.Position(Math.max(0, effectiveLine - 1), 0);
			const location = new vscode.Location(targetUri, pos);

			let bp: vscode.SourceBreakpoint;
			switch (srcItem.type) {
				case "condition":
					bp = new vscode.SourceBreakpoint(location, isEnabled, srcItem.condition);
					break;
				case "hitCount":
					bp = new vscode.SourceBreakpoint(location, isEnabled, undefined, srcItem.hitCondition);
					break;
				case "logpoint":
					bp = new vscode.SourceBreakpoint(location, isEnabled, undefined, undefined, srcItem.logMessage);
					break;
				case "line":
				default:
					bp = new vscode.SourceBreakpoint(location, isEnabled);
					break;
			}

			targetBreakpoints.push(bp);
		}

		// 核心增量 Diff 算法：找出完全重叠的共有断点原地保留，仅增删差量断点
		const matchedCurrentIndices = new Set<number>();
		const matchedTargetIndices = new Set<number>();

		for (let cIdx = 0; cIdx < currentBreakpoints.length; cIdx++) {
			const curr = currentBreakpoints[cIdx];
			for (let tIdx = 0; tIdx < targetBreakpoints.length; tIdx++) {
				if (matchedTargetIndices.has(tIdx)) continue;
				const target = targetBreakpoints[tIdx];

				if (curr instanceof vscode.FunctionBreakpoint && target instanceof vscode.FunctionBreakpoint) {
					if (
						curr.functionName === target.functionName &&
						curr.enabled === target.enabled &&
						curr.condition === target.condition &&
						curr.hitCondition === target.hitCondition
					) {
						matchedCurrentIndices.add(cIdx);
						matchedTargetIndices.add(tIdx);
						break;
					}
				} else if (curr instanceof vscode.SourceBreakpoint && target instanceof vscode.SourceBreakpoint) {
					const currPath = path.normalize(curr.location.uri.fsPath).toLowerCase();
					const targetPath = path.normalize(target.location.uri.fsPath).toLowerCase();
					if (
						currPath === targetPath &&
						curr.location.range.start.line === target.location.range.start.line &&
						curr.enabled === target.enabled &&
						curr.condition === target.condition &&
						curr.hitCondition === target.hitCondition &&
						curr.logMessage === target.logMessage
					) {
						matchedCurrentIndices.add(cIdx);
						matchedTargetIndices.add(tIdx);
						break;
					}
				}
			}
		}

		const toRemove = currentBreakpoints.filter((_, idx) => !matchedCurrentIndices.has(idx));
		const toAdd = targetBreakpoints.filter((_, idx) => !matchedTargetIndices.has(idx));

		if (toRemove.length > 0) {
			await vscode.debug.removeBreakpoints(toRemove);
		}
		if (toAdd.length > 0) {
			await vscode.debug.addBreakpoints(toAdd);
		}

		// 将脱靶失联的断点同步到状态机中，驱动侧边栏与交互提示
		const unmatchedKeys = unmatchedBreakpoints.map(
			(bp) => `${bp.file.replace(/\\/g, "/")}:${bp.line}`,
		);
		sceneStateManager.setUnmatchedBreakpoints(unmatchedKeys);

		// 成功装配至 DAP 后，固化当时实际下发的断点核心拓扑快照 Hash (用于防冗余重刷 Diff)
		setLastAppliedTopologyHash(computeBreakpointsTopologyHash(bpsToLoad));

		return {
			loadedCount: targetBreakpoints.length,
			healedCount,
			healedBreakpoints: healedCount > 0 ? bpsToLoad : undefined,
			unmatchedBreakpoints,
		};
	} finally {
		setTimeout(() => {
			sceneStateManager.setApplyingState(false);
		}, 150);
	}
}

/**
 * 将单个新断点即刻点亮注入到编辑器 DAP 运行时中 (用于添加断点到当前激活场景)
 */
export async function applySingleBreakpointToEditor(
	workspaceRoot: string,
	sceneBp: SceneBreakpoint,
): Promise<boolean> {
	if (!sceneBp) return false;
	const currentBreakpoints = vscode.debug.breakpoints;
	const isEnabled = sceneBp.enabled ?? true;

	if (sceneBp.type === "function") {
		const funcItem = sceneBp as FunctionSceneBreakpoint;
		const alreadyExists = currentBreakpoints.some(
			(bp): bp is vscode.FunctionBreakpoint =>
				bp instanceof vscode.FunctionBreakpoint && bp.functionName === funcItem.functionName,
		);
		if (!alreadyExists) {
			const fbp = new vscode.FunctionBreakpoint(
				funcItem.functionName.trim(),
				isEnabled,
				funcItem.condition,
				funcItem.hitCondition,
			);
			sceneStateManager.setApplyingState(true);
			try {
				await vscode.debug.addBreakpoints([fbp]);
				return true;
			} finally {
				setTimeout(() => sceneStateManager.setApplyingState(false), 150);
			}
		}
		return false;
	}

	const srcItem = sceneBp as SourceSceneBreakpoint;
	const fullPath = path.isAbsolute(srcItem.file) ? srcItem.file : path.join(workspaceRoot, srcItem.file);
	let targetUri: vscode.Uri | undefined;
	if (fs.existsSync(fullPath)) {
		targetUri = vscode.Uri.file(fullPath);
	} else {
		const found = await vscode.workspace.findFiles(`**/${path.basename(srcItem.file)}`, "**/node_modules/**", 1);
		if (found.length > 0) targetUri = found[0];
	}
	if (!targetUri) return false;

	const targetLineZeroBased = Math.max(0, srcItem.line - 1);
	const normFullPath = path.normalize(targetUri.fsPath).toLowerCase();

	const alreadyExists = currentBreakpoints.some((bp): bp is vscode.SourceBreakpoint => {
		if (!(bp instanceof vscode.SourceBreakpoint)) return false;
		return (
			path.normalize(bp.location.uri.fsPath).toLowerCase() === normFullPath &&
			bp.location.range.start.line === targetLineZeroBased
		);
	});

	if (!alreadyExists) {
		const location = new vscode.Location(targetUri, new vscode.Position(targetLineZeroBased, 0));
		let bp: vscode.SourceBreakpoint;
		switch (srcItem.type) {
			case "condition":
				bp = new vscode.SourceBreakpoint(location, isEnabled, srcItem.condition);
				break;
			case "hitCount":
				bp = new vscode.SourceBreakpoint(location, isEnabled, undefined, srcItem.hitCondition);
				break;
			case "logpoint":
				bp = new vscode.SourceBreakpoint(location, isEnabled, undefined, undefined, srcItem.logMessage);
				break;
			case "line":
			default:
				bp = new vscode.SourceBreakpoint(location, isEnabled);
				break;
		}
		sceneStateManager.setApplyingState(true);
		try {
			await vscode.debug.addBreakpoints([bp]);
			return true;
		} finally {
			setTimeout(() => sceneStateManager.setApplyingState(false), 150);
		}
	}
	return false;
}

export async function clearAllBreakpoints(): Promise<void> {
	sceneStateManager.clearLastAppliedTopologyHash();
	await vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
	vscode.window.showInformationMessage(vscode.l10n.t("Cleared all breakpoints"));
}

/**
 * 从当前 VS Code 调试运行时中逆向收集所有活跃断点并序列化为领域模型
 */
export async function collectCurrentBreakpoints(workspaceRoot: string): Promise<SceneBreakpoint[]> {
	const currentBreakpoints = vscode.debug.breakpoints;
	const exportedBps: SceneBreakpoint[] = [];

	for (const bp of currentBreakpoints) {
		if (bp instanceof vscode.FunctionBreakpoint) {
			const funcBp: FunctionSceneBreakpoint = {
				type: "function",
				functionName: bp.functionName,
				enabled: bp.enabled,
				condition: bp.condition?.trim() || undefined,
				hitCondition: bp.hitCondition?.trim() || undefined,
				desc: undefined,
			};
			exportedBps.push(funcBp);
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

			const srcBp: SourceSceneBreakpoint = {
				type: bpType,
				file: relPath,
				line: line,
				enabled: bp.enabled,
				condition: bp.condition?.trim() || undefined,
				hitCondition: bp.hitCondition?.trim() || undefined,
				logMessage: bp.logMessage?.trim() || undefined,
				desc: undefined,
				contextSnippet,
			};
			exportedBps.push(srcBp);
		}
	}

	return exportedBps;
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
	const currentBreakpoints = vscode.debug.breakpoints;

	if (sceneBp.type === "function") {
		const funcItem = sceneBp as FunctionSceneBreakpoint;
		const matched = currentBreakpoints.find(
			(bp): bp is vscode.FunctionBreakpoint =>
				bp instanceof vscode.FunctionBreakpoint && bp.functionName === funcItem.functionName,
		);
		if (matched && matched.enabled !== targetEnabled) {
			const updated = new vscode.FunctionBreakpoint(
				matched.functionName,
				targetEnabled,
				matched.condition,
				matched.hitCondition,
			);
			sceneStateManager.setApplyingState(true);
			try {
				await vscode.debug.removeBreakpoints([matched]);
				await vscode.debug.addBreakpoints([updated]);
				return true;
			} finally {
				setTimeout(() => {
					sceneStateManager.setApplyingState(false);
				}, 150);
			}
		}
		return false;
	}

	const srcItem = sceneBp as SourceSceneBreakpoint;
	if (!srcItem.file || typeof srcItem.line !== "number") return false;

	const targetFullPath = path.isAbsolute(srcItem.file)
		? path.normalize(srcItem.file).toLowerCase()
		: path.normalize(path.join(workspaceRoot, srcItem.file)).toLowerCase();

	const matched = currentBreakpoints.find((bp): bp is vscode.SourceBreakpoint => {
		if (!(bp instanceof vscode.SourceBreakpoint)) return false;
		const bpPath = path.normalize(bp.location.uri.fsPath).toLowerCase();
		const bpLine = bp.location.range.start.line + 1;
		return bpPath === targetFullPath && bpLine === srcItem.line;
	});

	if (matched && matched.enabled !== targetEnabled) {
		const updated = new vscode.SourceBreakpoint(
			matched.location,
			targetEnabled,
			matched.condition,
			matched.hitCondition,
			matched.logMessage,
		);
		sceneStateManager.setApplyingState(true);
		try {
			await vscode.debug.removeBreakpoints([matched]);
			await vscode.debug.addBreakpoints([updated]);
			return true;
		} finally {
			setTimeout(() => {
				sceneStateManager.setApplyingState(false);
			}, 150);
		}
	}

	return false;
}
