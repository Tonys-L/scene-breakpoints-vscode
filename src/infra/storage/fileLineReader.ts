import * as fs from "node:fs";
import * as path from "node:path";
import type { ILineReader } from "#src/domain/ports/lineReader";

export interface FileLineReaderOptions {
	workspaceRoot?: string;
	cache?: Map<string, string[]>;
	getDocumentLines?: (filePath: string) => Promise<string[] | undefined> | string[] | undefined;
}

/**
 * 基于 Node.js 文件系统与 VS Code 文档缓存实现的行读取基础设施
 */
export class FileLineReader implements ILineReader {
	private readonly workspaceRoot?: string;
	private readonly cache: Map<string, string[]>;
	private readonly getDocumentLines?: (filePath: string) => Promise<string[] | undefined> | string[] | undefined;

	constructor(options: FileLineReaderOptions = {}) {
		this.workspaceRoot = options.workspaceRoot;
		this.cache = options.cache || new Map();
		this.getDocumentLines = options.getDocumentLines;
	}

	public async readLines(filePath: string): Promise<string[] | undefined> {
		if (!filePath || typeof filePath !== "string") {
			return undefined;
		}

		const fullPath =
			path.isAbsolute(filePath) || !this.workspaceRoot
				? filePath
				: path.join(this.workspaceRoot, filePath);

		// 1. 优先命中内存缓存
		if (this.cache.has(fullPath)) {
			return this.cache.get(fullPath);
		}

		// 2. 尝试从活动编辑器文档提供者获取 (命中未保存的脏缓冲区)
		let lines: string[] | undefined;
		if (this.getDocumentLines) {
			lines = await this.getDocumentLines(fullPath);
		}

		// 3. 读取磁盘物理文件
		if (!lines && fs.existsSync(fullPath)) {
			try {
				const content = await fs.promises.readFile(fullPath, "utf-8");
				lines = content.split(/\r?\n/);
			} catch {
				return undefined;
			}
		}

		if (lines) {
			this.cache.set(fullPath, lines);
		}

		return lines;
	}

	public clearCache(): void {
		this.cache.clear();
	}
}

export const defaultFileLineReader = new FileLineReader();
