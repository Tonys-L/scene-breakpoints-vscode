import * as vscode from "vscode";

/**
 * 官方 Skill 模板虚拟只读文档提供者 (用于 vscode.diff 并排比对)
 * Scheme: scene-breakpoints-template
 */
export class TemplateContentProvider implements vscode.TextDocumentContentProvider {
	public static readonly scheme = "scene-breakpoints-template";

	private templateCache: Map<string, string> = new Map();
	private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
	public readonly onDidChange = this.onDidChangeEmitter.event;

	public setTemplateContent(key: string, content: string): void {
		this.templateCache.set(key, content);
	}

	public provideTextDocumentContent(uri: vscode.Uri): string {
		const key = uri.path.replace(/^\//, "");
		return this.templateCache.get(key) || "";
	}
}

export const templateContentProvider = new TemplateContentProvider();
