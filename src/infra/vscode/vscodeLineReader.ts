import * as vscode from "vscode";
import { FileLineReader } from "#src/infra/storage/fileLineReader";

/**
 * 创建对接 VS Code 编辑器活动文档与未保存脏缓冲区的行提取适配器
 * 优先读取 VS Code 内存中文档（openTextDocument），未打开时自动回退至底层磁盘文件
 */
export function createVsCodeLineReader(workspaceRoot?: string): FileLineReader {
	const reader = new FileLineReader({
		workspaceRoot,
		getDocumentLines: async (filePath: string) => {
			try {
				const uri = vscode.Uri.file(filePath);
				const doc = await vscode.workspace.openTextDocument(uri);
				const lines: string[] = [];
				for (let i = 0; i < doc.lineCount; i++) {
					lines.push(doc.lineAt(i).text);
				}
				return lines;
			} catch {
				return undefined;
			}
		},
	});

	if (typeof vscode?.workspace?.onDidChangeTextDocument === "function") {
		vscode.workspace.onDidChangeTextDocument(() => {
			reader.clearCache();
		});
	}

	return reader;
}

/**
 * 默认全局 VS Code 源码行提取单例适配器（实现 ILineReader 领域端口契约）
 */
export const vscodeLineReader: FileLineReader = createVsCodeLineReader();
