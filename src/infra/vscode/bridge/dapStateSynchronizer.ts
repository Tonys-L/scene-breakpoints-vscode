import * as vscode from "vscode";
import { sceneStateManager } from "#src/application/sceneStateManager";
import type { SceneBreakpoint, SourceSceneBreakpoint } from "#src/domain/types";
import {
	cloneDapBreakpointWithEnabled,
	createFunctionBreakpoint,
	createSourceBreakpoint,
	findMatchingDapBreakpoint,
	resolveFileUri,
	withApplyingLock,
} from "./dapHelpers";

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

	return withApplyingLock(async () => {
		await vscode.debug.addBreakpoints([newBp]);
		return true;
	});
}

/**
 * 清空 VS Code 当前工作区所有断点
 */
export async function clearAllBreakpoints(): Promise<void> {
	sceneStateManager.clearLastAppliedTopologyHash();
	await vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
	void vscode.window.showInformationMessage(vscode.l10n.t("Cleared all breakpoints"));
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
	return withApplyingLock(async () => {
		await vscode.debug.removeBreakpoints([matched]);
		await vscode.debug.addBreakpoints([updated]);
		return true;
	});
}
