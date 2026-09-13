import assert from "node:assert";
import * as vscode from "vscode";
import {
	TemplateContentProvider,
	templateContentProvider,
} from "#src/infra/vscode/templateContentProvider";

export function runTemplateProviderTests() {
	console.log("  ▶ [Template Provider] 运行 TemplateContentProvider 虚拟文档提供者单元测试（真实源码）...");

	// 1. scheme 常量契约
	assert.strictEqual(
		TemplateContentProvider.scheme,
		"scene-breakpoints-template",
		"scheme 必须为 scene-breakpoints-template",
	);

	const provider = new TemplateContentProvider();

	// 2. 初始未命中时安全返回空字符串
	const missingUri = vscode.Uri.parse("scene-breakpoints-template:/non-existent.md");
	assert.strictEqual(provider.provideTextDocumentContent(missingUri), "");

	// 3. 写入模板内容并读取
	provider.setTemplateContent("AGENTS.md", "# Agent Instructions\nDo not break breakpoints.");
	const hitUri = vscode.Uri.parse("scene-breakpoints-template:/AGENTS.md");
	assert.strictEqual(
		provider.provideTextDocumentContent(hitUri),
		"# Agent Instructions\nDo not break breakpoints.",
		"必须精确读取缓存的模板内容",
	);

	// 4. 无前导斜杠路径兼容
	const directUri = { path: "AGENTS.md" };
	assert.strictEqual(
		provider.provideTextDocumentContent(directUri),
		"# Agent Instructions\nDo not break breakpoints.",
	);

	// 5. 单例导出存在性
	assert.ok(templateContentProvider instanceof TemplateContentProvider);

	console.log("  ✅ [Template Provider] TemplateContentProvider 单元测试全部通过！");
}
