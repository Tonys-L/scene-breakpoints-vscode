import * as vscode from "vscode";

export interface LineProvider {
	lineAt(line: number): { text: string };
}

/**
 * 场景断点 JSON 文本与光标物理定位器中枢 (Scene JSON Locator)
 * 职责：专职负责 debug-scenes.json 物理行号逆向检索、断点定位与活动编辑器光标场景感知推导
 */

/**
 * 专职服务于 VS Code 侧边栏树视图 (TreeView) 的 JSON 物理行号定位器
 * 职责：在 debug-scenes.json 格式化文本中解析并检索指定场景或断点所在的行号 (1-indexed)
 */
export function findBreakpointLineInJson(
	jsonContent: string,
	sceneName: string,
	bp: { type: string; functionName?: string; file?: string; line?: number },
): number {
	const lines = jsonContent.split(/\r?\n/);
	let inTargetScene = false;
	let sceneLine = 1;
	let bracketDepth = 0;

	const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	for (let i = 0; i < lines.length; i++) {
		const lineText = lines[i];
		if (!inTargetScene) {
			const scenePattern = new RegExp(`"${escapeRegExp(sceneName)}"\\s*:`);
			if (scenePattern.test(lineText)) {
				inTargetScene = true;
				sceneLine = i + 1;
				bracketDepth = (lineText.match(/\[/g) || []).length - (lineText.match(/\]/g) || []).length;
			}
			continue;
		}

		bracketDepth += (lineText.match(/\[/g) || []).length - (lineText.match(/\]/g) || []).length;
		if (bracketDepth < 0 || (bracketDepth === 0 && lineText.includes("]"))) {
			break;
		}

		if (bp.type === "function") {
			if (bp.functionName && lineText.includes(`"${bp.functionName}"`)) {
				return i + 1;
			}
		} else {
			const targetFile = (bp.file || "").replace(/\\/g, "/");
			const baseName = targetFile.split("/").pop() || targetFile;
			if (
				(lineText.includes(`"${targetFile}"`) || lineText.includes(`"${baseName}"`)) ||
				(lineText.includes(`"line"`) && lineText.includes(String(bp.line)))
			) {
				return i + 1;
			}
		}
	}

	return sceneLine;
}

/**
 * 专职服务于活动编辑器光标感知的场景名推导定位器
 * 职责：在用户当前处于 debug-scenes.json 编辑器时，通过光标物理行向上检索推导所在的外层场景名
 */
export function findEnclosingSceneName(
	lines: string[] | LineProvider,
	cursorLineIndex: number,
	candidateSceneNames: string[],
): string | undefined {
	const getLineText: (idx: number) => string = Array.isArray(lines)
		? (idx: number) => lines[idx] ?? ""
		: (idx: number) => lines.lineAt(idx)?.text ?? "";

	for (let i = cursorLineIndex; i >= 0; i--) {
		const lineText = getLineText(i);
		for (const sName of candidateSceneNames) {
			if (lineText.includes(`"${sName}"`) && lineText.includes(":")) {
				return sName;
			}
		}
	}
	return undefined;
}

/**
 * 智能感知：从当前活动的 VS Code 编辑器中推导光标所在的场景名
 */
export function detectSceneFromActiveEditor(
	candidateSceneNames: string[],
	activeEditor?: vscode.TextEditor,
): string | undefined {
	const editor = activeEditor ?? vscode.window.activeTextEditor;
	if (!editor || !editor.document.fileName.endsWith("debug-scenes.json")) {
		return undefined;
	}
	const currentLine = editor.selection.active.line;
	return findEnclosingSceneName(editor.document, currentLine, candidateSceneNames);
}
