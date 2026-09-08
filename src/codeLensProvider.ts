import * as vscode from "vscode";
import { stripJsonComments } from "./configManager";
import { sceneStateManager } from "./sceneStateManager";

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class SceneCodeLensProvider implements vscode.CodeLensProvider {
	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (!document.fileName.endsWith("debug-scenes.json")) {
			return [];
		}

		const lenses: vscode.CodeLens[] = [];
		try {
			const cleaned = stripJsonComments(document.getText());
			const parsed = JSON.parse(cleaned);
			const scenes = (parsed && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes))
				? parsed.scenes
				: (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});

			const sceneNames = Object.keys(scenes).filter((k) => k !== "$schema" && Array.isArray(scenes[k]));

			for (const sceneName of sceneNames) {
				const count = Array.isArray(scenes[sceneName]) ? scenes[sceneName].length : 0;
				const keyPattern = new RegExp(`^\\s*"${escapeRegex(sceneName)}"\\s*:`);
				const isActive = sceneStateManager.isSceneActive(sceneName);

				for (let i = 0; i < document.lineCount; i++) {
					const lineText = document.lineAt(i).text;
					if (keyPattern.test(lineText)) {
						const range = new vscode.Range(i, 0, i, 0);
						const title = isActive
							? vscode.l10n.t("✔ Active ({0} bps)", count)
							: vscode.l10n.t("▶ Apply Scene ({0} bps)", count);

						lenses.push(
							new vscode.CodeLens(range, {
								title,
								tooltip: vscode.l10n.t("Click to activate this scene and clean other breakpoints"),
								command: "sceneBreakpoints.applyScene",
								arguments: [sceneName],
							}),
						);
						break;
					}
				}
			}
		} catch {
			// 编辑过程中 JSON 语法临时不完整时静默忽略
		}

		return lenses;
	}
}
