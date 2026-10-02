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
