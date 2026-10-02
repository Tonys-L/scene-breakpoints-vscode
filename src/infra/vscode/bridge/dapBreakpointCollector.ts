import * as path from "node:path";
import * as vscode from "vscode";
import { extractContextSnippet } from "#src/domain/services/healingEngine";
import type {
	ContextSnippet,
	FunctionSceneBreakpoint,
	SceneBreakpoint,
	SourceSceneBreakpoint,
} from "#src/domain/types";

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
