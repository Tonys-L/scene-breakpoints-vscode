import * as path from "node:path";
import type {
	FunctionSceneBreakpoint,
	SceneBreakpoint,
	ScenesConfig,
	SourceSceneBreakpoint,
} from "../core/types";

/**
 * 将断点按唯一性契约（文件+行号或函数名）合并更新至指定场景中
 */
export function upsertBreakpointToScene(
	config: ScenesConfig,
	sceneName: string,
	newEntry: SceneBreakpoint,
): void {
	if (!config.scenes) {
		config.scenes = {};
	}
	const list = config.scenes[sceneName] || [];

	if (newEntry.type === "function") {
		const funcEntry = newEntry as FunctionSceneBreakpoint;
		const existIdx = list.findIndex(
			(it) => it.type === "function" && (it as FunctionSceneBreakpoint).functionName === funcEntry.functionName,
		);
		if (existIdx >= 0) {
			list[existIdx] = funcEntry;
		} else {
			list.push(funcEntry);
		}
	} else {
		const srcEntry = newEntry as SourceSceneBreakpoint;
		const normFile = srcEntry.file ? srcEntry.file.replace(/\\/g, "/") : "";
		const existIdx = list.findIndex(
			(it) => it.type !== "function" &&
				(it as SourceSceneBreakpoint).file.replace(/\\/g, "/") === normFile &&
				(it as SourceSceneBreakpoint).line === srcEntry.line,
		);
		if (existIdx >= 0) {
			list[existIdx] = srcEntry;
		} else {
			list.push(srcEntry);
		}
	}

	config.scenes[sceneName] = list;
}

export function removeBreakpointFromConfig(
	config: ScenesConfig,
	sceneName: string,
	index: number,
): boolean {
	const list = config.scenes[sceneName];
	if (!list || index < 0 || index >= list.length) {
		return false;
	}
	list.splice(index, 1);
	return true;
}

export function renameSceneInConfig(
	config: ScenesConfig,
	oldName: string,
	newName: string,
): boolean {
	if (!config.scenes[oldName] || config.scenes[newName]) {
		return false;
	}
	config.scenes[newName] = config.scenes[oldName];
	delete config.scenes[oldName];

	if (config.bindings) {
		for (const [bk, bv] of Object.entries(config.bindings)) {
			if (typeof bv === "string" && bv === oldName) {
				config.bindings[bk] = newName;
			} else if (Array.isArray(bv)) {
				config.bindings[bk] = bv.map((it) => (it === oldName ? newName : it));
			}
		}
	}
	return true;
}

export function deleteSceneFromConfig(
	config: ScenesConfig,
	sceneName: string,
): boolean {
	if (!config.scenes[sceneName]) {
		return false;
	}
	delete config.scenes[sceneName];

	if (config.bindings) {
		for (const [bk, bv] of Object.entries(config.bindings)) {
			if (typeof bv === "string" && bv === sceneName) {
				delete config.bindings[bk];
			} else if (Array.isArray(bv)) {
				const filtered = bv.filter((it) => it !== sceneName);
				if (filtered.length === 0) {
					delete config.bindings[bk];
				} else {
					config.bindings[bk] = filtered;
				}
			}
		}
	}
	return true;
}

export function toggleBreakpointEnabledInConfig(
	config: ScenesConfig,
	sceneName: string,
	index: number,
): boolean {
	const list = config.scenes[sceneName];
	if (!list || index < 0 || index >= list.length) {
		return false;
	}
	const item = list[index];
	item.enabled = !(item.enabled ?? true);
	return true;
}

/**
 * 批量设置指定场景内所有断点的启用/禁用状态
 */
export function setAllBreakpointsEnabledInScene(
	config: ScenesConfig,
	sceneName: string,
	targetEnabled: boolean,
): boolean {
	const list = config.scenes[sceneName];
	if (!list || list.length === 0) return false;
	let changed = false;
	for (const item of list) {
		if ((item.enabled ?? true) !== targetEnabled) {
			item.enabled = targetEnabled;
			changed = true;
		}
	}
	return changed;
}

/**
 * 克隆/复制场景副本
 */
export function duplicateSceneInConfig(
	config: ScenesConfig,
	sourceSceneName: string,
	targetSceneName: string,
): boolean {
	const srcList = config.scenes[sourceSceneName];
	if (!srcList || config.scenes[targetSceneName]) {
		return false;
	}
	// 深拷贝场景内所有断点实体
	config.scenes[targetSceneName] = JSON.parse(JSON.stringify(srcList));
	return true;
}

export function syncEditorBreakpointChangesToConfig(
	config: ScenesConfig,
	activeScenes: string[],
	changedBreakpoints: readonly any[],
	workspaceRoot?: string,
): boolean {
	if (!config.scenes || activeScenes.length === 0 || changedBreakpoints.length === 0) {
		return false;
	}

	let hasUpdates = false;

	for (const bp of changedBreakpoints) {
		const targetEnabled = bp.enabled ?? true;

		if (bp.functionName) {
			const targetFuncName = bp.functionName;
			for (const sceneName of activeScenes) {
				const list = config.scenes[sceneName] || [];
				for (const item of list) {
					if (item.type === "function") {
						const funcItem = item as FunctionSceneBreakpoint;
						if (funcItem.functionName === targetFuncName) {
							if ((funcItem.enabled ?? true) !== targetEnabled) {
								funcItem.enabled = targetEnabled;
								hasUpdates = true;
							}
						}
					}
				}
			}
			continue;
		}

		let bpFsPath = "";
		let bpLine = 0;
		if (bp.location) {
			bpFsPath = bp.location.uri.fsPath;
			bpLine = bp.location.range.start.line + 1;
		} else if (bp.file && typeof bp.line === "number") {
			bpFsPath = bp.file;
			bpLine = bp.line;
		}

		if (!bpFsPath || bpLine <= 0) continue;

		const normBpPath = path.normalize(bpFsPath).toLowerCase();

		for (const sceneName of activeScenes) {
			const list = config.scenes[sceneName] || [];
			for (const item of list) {
				if (item.type !== "function") {
					const srcItem = item as SourceSceneBreakpoint;
					if (srcItem.line === bpLine) {
						let itemFullPath = srcItem.file;
						if (workspaceRoot && !path.isAbsolute(itemFullPath)) {
							itemFullPath = path.join(workspaceRoot, itemFullPath);
						}
						const normItemPath = path.normalize(itemFullPath).toLowerCase();
						if (normItemPath === normBpPath) {
							if ((srcItem.enabled ?? true) !== targetEnabled) {
								srcItem.enabled = targetEnabled;
								hasUpdates = true;
							}
						}
					}
				}
			}
		}
	}

	return hasUpdates;
}

export function mergeScenesBreakpoints(
	config: ScenesConfig,
	sceneNames: string[],
): SceneBreakpoint[] {
	const merged: SceneBreakpoint[] = [];

	for (const sceneName of sceneNames) {
		const list = config.scenes[sceneName] || [];
		for (const bp of list) {
			if (bp.type === "function") {
				const funcBp = bp as FunctionSceneBreakpoint;
				const exists = merged.some(
					(it) => it.type === "function" && (it as FunctionSceneBreakpoint).functionName === funcBp.functionName,
				);
				if (!exists) merged.push(funcBp);
			} else {
				const srcBp = bp as SourceSceneBreakpoint;
				const normFile = srcBp.file ? srcBp.file.replace(/\\/g, "/") : "";
				const exists = merged.some(
					(it) =>
						it.type !== "function" &&
						(it as SourceSceneBreakpoint).file.replace(/\\/g, "/") === normFile &&
						(it as SourceSceneBreakpoint).line === srcBp.line,
				);
				if (!exists) merged.push(srcBp);
			}
		}
	}

	return merged;
}

/**
 * 在指定场景中调整断点的排列次序（上移/下移）
 */
export function moveBreakpointInScene(
	config: ScenesConfig,
	sceneName: string,
	index: number,
	direction: "up" | "down",
): boolean {
	const list = config.scenes?.[sceneName];
	if (!Array.isArray(list) || index < 0 || index >= list.length) {
		return false;
	}

	const targetIndex = direction === "up" ? index - 1 : index + 1;
	if (targetIndex < 0 || targetIndex >= list.length) {
		return false;
	}

	const temp = list[index];
	list[index] = list[targetIndex];
	list[targetIndex] = temp;
	return true;
}

/**
 * 在 JSON 源码文本中快速检索定位指定场景中断点所在的物理行号 (1-indexed)
 */
export function findBreakpointLineInJson(
	jsonContent: string,
	sceneName: string,
	bp: SceneBreakpoint,
): number {
	const lines = jsonContent.split(/\r?\n/);
	let inTargetScene = false;
	let sceneLine = 1;
	let bracketDepth = 0;

	for (let i = 0; i < lines.length; i++) {
		const lineText = lines[i];
		// 寻找目标场景键名，例如 "my-scene": [
		if (!inTargetScene) {
			const scenePattern = new RegExp(`"${escapeRegExp(sceneName)}"\\s*:`);
			if (scenePattern.test(lineText)) {
				inTargetScene = true;
				sceneLine = i + 1;
				bracketDepth = (lineText.match(/\[/g) || []).length - (lineText.match(/\]/g) || []).length;
			}
			continue;
		}

		// 处于目标场景的数组块内
		bracketDepth += (lineText.match(/\[/g) || []).length - (lineText.match(/\]/g) || []).length;
		if (bracketDepth < 0 || (bracketDepth === 0 && lineText.includes("]"))) {
			// 退出目标场景数组
			break;
		}

		// 函数断点匹配
		if (bp.type === "function") {
			const fn = bp as FunctionSceneBreakpoint;
			if (fn.functionName && lineText.includes(`"${fn.functionName}"`)) {
				return i + 1;
			}
		} else {
			// 文件行断点匹配
			const src = bp as SourceSceneBreakpoint;
			const targetFile = (src.file || "").replace(/\\/g, "/");
			const baseName = path.basename(targetFile);
			if (
				(lineText.includes(`"${targetFile}"`) || lineText.includes(`"${baseName}"`)) ||
				(lineText.includes(`"line"`) && lineText.includes(String(src.line)))
			) {
				return i + 1;
			}
		}
	}

	return sceneLine;
}

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
