import * as vscode from "vscode";
import type { SceneBreakpoint, SourceSceneBreakpoint } from "../core/types";
import { stripJsonComments } from "../infra/storage/jsonFileSceneRepository";

/**
 * 将指定场景断点列表序列化为可共享的标准 JSON 文本 Payload
 */
export function generateScenePayload(
	sceneName: string,
	breakpoints: SceneBreakpoint[],
): string {
	const payload = {
		$schema: "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
		version: "1.0",
		sceneName: sceneName.trim(),
		exportedAt: new Date().toISOString(),
		breakpoints: breakpoints.map((bp) => {
			if (bp.type !== "function") {
				return {
					...bp,
					file: bp.file.replace(/\\/g, "/"),
				};
			}
			return bp;
		}),
	};
	return JSON.stringify(payload, null, 2);
}

export const serializeScenePayload = generateScenePayload;

/**
 * 自动剥离外层的 Markdown 代码块包裹（如 ```json ... ```）
 */
export function stripMarkdownCodeBlocks(text: string): string {
	const trimmed = text.trim();
	const blockMatch = trimmed.match(/^```(?:json|jsonc)?[\r\n]+([\s\S]*?)[\r\n]+```$/i);
	if (blockMatch) {
		return blockMatch[1].trim();
	}
	return trimmed;
}

/**
 * 动态获取当前 VS Code 语言环境下的支持格式示例模板
 */
export function getSupportedFormatsTemplate(): string {
	const title = vscode.l10n.t("Scene Breakpoints: Supported Clipboard Formats");
	const format1Title = vscode.l10n.t("Format 1: Standard Scene Payload (Recommended)");
	const format2Title = vscode.l10n.t("Format 2: scenes dictionary (debug-scenes.json snippet)");
	const format3Title = vscode.l10n.t("Format 3: Raw breakpoint array");

	return `// ========================================================
// ${title}
// ========================================================

// ${format1Title}
{
  "$schema": "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
  "version": "1.0",
  "sceneName": "order-debug",
  "breakpoints": [
    {
      "type": "line",
      "file": "src/order.ts",
      "line": 42,
      "enabled": true,
      "condition": "order.total > 100",
      "desc": "Check order total"
    },
    {
      "type": "function",
      "functionName": "handleOrderPayment",
      "enabled": true
    }
  ]
}

// ${format2Title}
{
  "scenes": {
    "order-debug": [
      {
        "file": "src/order.ts",
        "line": 42,
        "enabled": true
      }
    ]
  }
}

// ${format3Title}
[
  {
    "file": "src/order.ts",
    "line": 42,
    "enabled": true
  },
  {
    "type": "function",
    "functionName": "handleOrderPayment"
  }
]
`;
}

export const SUPPORTED_FORMATS_TEMPLATE = getSupportedFormatsTemplate;

/**
 * 解析并清洗外部传入的剪贴板 Payload 字符串，兼容多种结构
 */
export function parseScenePayload(
	rawText: string,
	defaultSceneName?: string,
): { success: true; sceneName: string; breakpoints: SceneBreakpoint[] } | { success: false; error: string } {
	if (!rawText || !rawText.trim()) {
		return { success: false, error: "Empty content" };
	}

	if (rawText.length > 1024 * 1024) {
		return { success: false, error: "Content exceeds maximum size limit (1MB)" };
	}

	let parsed: any;
	try {
		const unmarshalled = stripMarkdownCodeBlocks(rawText);
		const sanitized = stripJsonComments(unmarshalled);
		parsed = JSON.parse(sanitized);
	} catch (e: any) {
		return { success: false, error: `Invalid JSON format: ${e.message}` };
	}

	if (!parsed || typeof parsed !== "object") {
		return { success: false, error: "Payload must be a JSON object or array" };
	}

	let targetSceneName = (defaultSceneName || "imported-scene").trim();
	let candidateBreakpoints: any[] = [];

	if (Array.isArray(parsed)) {
		candidateBreakpoints = parsed;
	} else if (parsed.sceneName && Array.isArray(parsed.breakpoints)) {
		targetSceneName = String(parsed.sceneName).trim() || targetSceneName;
		candidateBreakpoints = parsed.breakpoints;
	} else if (parsed.scenes && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes)) {
		const keys = Object.keys(parsed.scenes);
		if (keys.length > 0) {
			targetSceneName = keys[0];
			candidateBreakpoints = Array.isArray(parsed.scenes[targetSceneName]) ? parsed.scenes[targetSceneName] : [];
		}
	} else {
		const keys = Object.keys(parsed).filter((k) => k !== "$schema" && k !== "version" && k !== "exportedAt");
		if (keys.length > 0 && Array.isArray(parsed[keys[0]])) {
			targetSceneName = keys[0];
			candidateBreakpoints = parsed[keys[0]];
		}
	}

	const validBreakpoints: SceneBreakpoint[] = [];
	for (const item of candidateBreakpoints) {
		if (!item || typeof item !== "object") continue;

		if (item.type === "function") {
			if (typeof item.functionName === "string" && item.functionName.trim()) {
				validBreakpoints.push({
					type: "function",
					functionName: item.functionName.trim(),
					condition: item.condition?.trim() || undefined,
					hitCondition: item.hitCondition?.trim() || undefined,
					enabled: typeof item.enabled === "boolean" ? item.enabled : true,
					desc: item.desc?.trim() || undefined,
				});
			}
			continue;
		}

		if (typeof item.file === "string" && item.file.trim() && typeof item.line === "number" && item.line > 0) {
			const type = ["condition", "hitCount", "logpoint", "line"].includes(item.type) ? item.type : "line";
			validBreakpoints.push({
				type,
				file: item.file.trim().replace(/\\/g, "/"),
				line: Math.floor(item.line),
				condition: item.condition?.trim() || undefined,
				hitCondition: item.hitCondition?.trim() || undefined,
				logMessage: item.logMessage?.trim() || undefined,
				enabled: typeof item.enabled === "boolean" ? item.enabled : true,
				desc: item.desc?.trim() || undefined,
				contextSnippet: item.contextSnippet && typeof item.contextSnippet === "object" ? item.contextSnippet : undefined,
			});
		}
	}

	if (validBreakpoints.length === 0) {
		return { success: false, error: "No valid breakpoints found in the payload" };
	}

	return {
		success: true,
		sceneName: targetSceneName,
		breakpoints: validBreakpoints,
	};
}
