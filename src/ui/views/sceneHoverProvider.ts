import * as vscode from "vscode";
import { activeBreakpointIndex } from "#src/application/activeBreakpointIndex";
import { sceneStateManager } from "#src/application/sceneStateManager";
import type { SourceSceneBreakpoint } from "#src/domain/types";
import { getWorkspaceRoot } from "#src/ui/utils/commandRunner";
import { formatBreakpointTooltipMarkdown } from "./breakpointTooltipFormatter";

/**
 * 调试悬停不可求值关键字集合
 * 当鼠标位于这些关键字上时，拒绝触发原生 DebugHoverWidget 求值（防止弹出 undefined 遮挡场景断点卡片）
 */
const NON_EVALUATABLE_KEYWORDS = new Set([
	"let", "const", "var", "function", "return", "async", "await", "yield",
	"if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue",
	"try", "catch", "finally", "throw", "new", "typeof", "instanceof", "void", "delete",
	"in", "of", "class", "extends", "implements", "interface", "type", "enum", "namespace",
	"import", "export", "from", "as", "public", "private", "protected", "readonly", "static",
	"true", "false", "null", "undefined", "NaN", "Infinity", "super",
]);

const IDENTIFIER_CHAR_RE = /[a-zA-Z0-9_$]/;
const CHAIN_CHAR_RE = /[a-zA-Z0-9_$.?]/;
const DECLARATION_LINE_RE = /^\s*(?:export\s+)?(?:let|const|var)\b/;
const NON_RUNTIME_LINE_RE = /^\s*(?:export\s+)?(?:type|interface|import)\b/;

/**
 * 查找单行代码中首个赋值等号 `=` 的索引（排除 `==`、`!=`、`<=`、`>=`、`=>`）
 */
export function findAssignmentEqualIndex(lineText: string): number {
	for (let i = 0; i < lineText.length; i++) {
		if (lineText[i] !== "=") continue;
		const prev = i > 0 ? lineText[i - 1] : "";
		const next = i + 1 < lineText.length ? lineText[i + 1] : "";
		if (prev !== "=" && prev !== "!" && prev !== "<" && prev !== ">" && next !== "=" && next !== ">") {
			return i;
		}
	}
	return -1;
}

/**
 * 判断光标是否位于注释、纯类型声明行或变量声明语句等号左侧（含未执行 TDZ 左值及 TS 类型注解）
 */
export function isNonEvaluatableLinePosition(lineText: string, charIndex: number): boolean {
	const commentIdx = lineText.indexOf("//");
	if (commentIdx !== -1 && charIndex >= commentIdx) return true;
	if (NON_RUNTIME_LINE_RE.test(lineText)) return true;

	if (DECLARATION_LINE_RE.test(lineText)) {
		const eqIdx = findAssignmentEqualIndex(lineText);
		if (eqIdx === -1 || charIndex <= eqIdx) return true;
	}
	return false;
}

/**
 * 提取光标所在位置的合法变量或属性访问链（如 `initialContext` 或 `config.model.id`）
 * 若光标在空白、标点或语言关键字上，严格返回 undefined
 */
export function extractEvaluatableChain(
	lineText: string,
	charIndex: number,
): { text: string; start: number; end: number } | undefined {
	if (charIndex < 0 || charIndex >= lineText.length || !IDENTIFIER_CHAR_RE.test(lineText[charIndex])) {
		return undefined;
	}

	let wordStart = charIndex;
	while (wordStart > 0 && IDENTIFIER_CHAR_RE.test(lineText[wordStart - 1])) {
		wordStart--;
	}
	let end = charIndex + 1;
	while (end < lineText.length && IDENTIFIER_CHAR_RE.test(lineText[end])) {
		end++;
	}

	const hoveredWord = lineText.slice(wordStart, end);
	if (NON_EVALUATABLE_KEYWORDS.has(hoveredWord)) return undefined;

	let chainStart = wordStart;
	while (chainStart > 0 && CHAIN_CHAR_RE.test(lineText[chainStart - 1])) {
		chainStart--;
	}
	while (chainStart < wordStart && !IDENTIFIER_CHAR_RE.test(lineText[chainStart])) {
		chainStart++;
	}

	const chainText = lineText.slice(chainStart, end).replace(/\?\./g, ".");
	const rootWord = chainText.split(".")[0] || "";
	if (!rootWord || NON_EVALUATABLE_KEYWORDS.has(rootWord)) return undefined;

	return { text: chainText, start: chainStart, end };
}

/**
 * 场景断点调试求值表达式提供者 (Scene Evaluatable Expression Provider)
 * 职责：接管调试暂停态下的编辑器悬停求值提取，修复 VS Code 默认词法提取器在行首空白、
 * 关键字（如 let/const）及未执行声明左值处求值出 undefined 并遮挡 SceneHoverProvider 的问题。
 */
export class SceneEvaluatableExpressionProvider implements vscode.EvaluatableExpressionProvider {
	public provideEvaluatableExpression(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.EvaluatableExpression> {
		if (document.uri.scheme !== "file") return undefined;

		const lineText = document.lineAt(position.line).text;
		if (isNonEvaluatableLinePosition(lineText, position.character)) {
			return undefined;
		}

		const extracted = extractEvaluatableChain(lineText, position.character);
		if (!extracted) return undefined;

		const wsRoot = getWorkspaceRoot(false);
		const targetLine = position.line + 1;
		const docBps = activeBreakpointIndex.getBreakpointsForDocument(document.uri.fsPath, wsRoot);
		const matchedItems = docBps.filter((item) => Number(item.breakpoint.line) === targetLine);

		if (matchedItems.length > 0) {
			// 在已激活的场景断点行上：若悬停目标是函数调用名（后接 '('）或已在 Watch 表格中展示的变量，
			// 直接返回 undefined 以回退展示完整的 SceneHoverProvider 场景断点卡片与 Watch 表格
			const afterToken = lineText.slice(extracted.end).trimStart();
			if (afterToken.startsWith("(")) return undefined;

			const isWatched = matchedItems.some((item) => {
				const watches = (item.breakpoint as SourceSceneBreakpoint).watch;
				return Array.isArray(watches) && watches.includes(extracted.text);
			});
			if (isWatched) return undefined;
		}

		const range = new vscode.Range(position.line, extracted.start, position.line, extracted.end);
		return new vscode.EvaluatableExpression(range, extracted.text);
	}
}

/**
 * 场景断点编辑器全行悬停提供者 (Scene Hover Provider)
 * 职责：当鼠标悬停在断点所在行的任意位置（行首、行中代码或变量）时，
 * 稳定弹出场景断点信息与变量监视表格，彻底消除原生 Debug Hover 抢焦导致的 "undefined" 困扰。
 */
export class SceneHoverProvider implements vscode.HoverProvider {
	public provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.Hover> {
		if (document.uri.scheme !== "file") return undefined;

		const activeScenes = sceneStateManager.getActiveScenes();
		if (activeScenes.length === 0) return undefined;

		const wsRoot = getWorkspaceRoot(false);
		const targetLine = position.line + 1;
		const docBps = activeBreakpointIndex.getBreakpointsForDocument(document.uri.fsPath, wsRoot);
		const matchedItems = docBps.filter((item) => Number(item.breakpoint.line) === targetLine);

		if (matchedItems.length === 0) return undefined;

		const tooltipMarkdown = formatBreakpointTooltipMarkdown(matchedItems, wsRoot);
		const lineLength = document.lineAt(position.line).text.length;
		const range = new vscode.Range(position.line, 0, position.line, lineLength);
		return new vscode.Hover(tooltipMarkdown, range);
	}
}
