import * as path from "node:path";

/**
 * 统一将文件路径标准化为小写且正斜杠正向化的规范纯净字符串
 */
export function normalizeFsPath(filePath: string): string {
	if (!filePath) return "";
	return path.normalize(filePath).replace(/\\/g, "/").toLowerCase();
}

/**
 * 判断两个物理路径是否指向同一个文件 (跨平台大小写与斜杠容错)
 */
export function isSameFsPath(p1: string, p2: string): boolean {
	return normalizeFsPath(p1) === normalizeFsPath(p2);
}

/**
 * 判断目标文件路径与场景断点文件路径是否匹配
 * 支持绝对路径完全对齐、相对工作区对齐、以及跨 monorepo/子目录的尾部路径容错
 */
export function isFilePathMatch(
	targetFilePath: string,
	breakpointFile: string,
	workspaceRoot?: string,
): boolean {
	if (!targetFilePath || !breakpointFile) return false;

	const normTarget = normalizeFsPath(targetFilePath);
	const normBpFile = normalizeFsPath(breakpointFile);

	if (normTarget === normBpFile) return true;

	if (workspaceRoot) {
		const fullBpPath = path.isAbsolute(breakpointFile)
			? normalizeFsPath(breakpointFile)
			: normalizeFsPath(path.join(workspaceRoot, breakpointFile));
		if (normTarget === fullBpPath) return true;
	}

	// 容错：尾部路径对齐 (如 "src/foo.ts" 匹配 "/project/src/foo.ts")
	return normTarget.endsWith("/" + normBpFile) || normTarget.endsWith(normBpFile);
}
