/**
 * 源文件行读取能力契约端口 (Port)
 * 职责：领域层与外部文件系统或编辑器文档获取解耦，领域层仅面向此接口读取代码行数组
 */
export interface ILineReader {
	/**
	 * 读取指定文件路径的代码行数组 (纯文本按行拆分)
	 * @param filePath 绝对路径或工作区相对路径
	 * @returns 行数组 (0-indexed) 或 undefined (当文件不存在或读取失败时)
	 */
	readLines(filePath: string): Promise<string[] | undefined>;
	clearCache?(): void;
}
