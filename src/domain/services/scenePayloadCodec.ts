import type { SceneBreakpoint, ScenesConfig } from "#src/domain/types";
import { Scene } from "#src/domain/models/scene";
import { stripMarkdown, stripComments } from "#src/shared/utils/textUtils";

export interface SupportedFormatsTitles {
	title?: string;
	format1Title?: string;
	format2Title?: string;
	format3Title?: string;
}

export type ParsePayloadResult =
	| { success: true; sceneName: string; breakpoints: SceneBreakpoint[] }
	| { success: false; error: string };

export const SCHEMA_URL =
	"https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json";
export const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB

/**
 * 将指定场景实体或断点列表无损序列化为标准 JSON 字符串 (纯函数)
 */
export function encodeScenePayload(
	sceneOrName: Scene | string,
	breakpoints?: SceneBreakpoint[],
): string {
	let name: string;
	let bps: SceneBreakpoint[];

	if (sceneOrName instanceof Scene) {
		name = sceneOrName.name;
		bps = sceneOrName.getBreakpoints().map((b) => b.raw);
	} else {
		name = sceneOrName;
		bps = breakpoints || [];
	}

	const payload = {
		$schema: SCHEMA_URL,
		version: "1.0",
		sceneName: name.trim(),
		exportedAt: new Date().toISOString(),
		breakpoints: bps.map((bp) => {
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

function resolveCandidatePayload(
	parsed: any,
	defaultSceneName?: string,
): { targetSceneName: string; candidateBreakpoints: any[] } {
	const fallbackSceneName = (defaultSceneName || "imported-scene").trim();

	if (Array.isArray(parsed)) {
		return { targetSceneName: fallbackSceneName, candidateBreakpoints: parsed };
	}
	if (parsed.sceneName && Array.isArray(parsed.breakpoints)) {
		const sceneName = String(parsed.sceneName).trim();
		return {
			targetSceneName: sceneName || fallbackSceneName,
			candidateBreakpoints: parsed.breakpoints,
		};
	}
	if (parsed.scenes && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes)) {
		const keys = Object.keys(parsed.scenes);
		const targetSceneName = keys[0];
		if (targetSceneName) {
			return {
				targetSceneName,
				candidateBreakpoints: Array.isArray(parsed.scenes[targetSceneName]) ? parsed.scenes[targetSceneName] : [],
			};
		}
	}
	const keys = Object.keys(parsed).filter((k) => k !== "$schema" && k !== "version" && k !== "exportedAt");
	const firstKey = keys[0];
	if (firstKey && Array.isArray(parsed[firstKey])) {
		return {
			targetSceneName: firstKey,
			candidateBreakpoints: parsed[firstKey],
		};
	}
	return { targetSceneName: fallbackSceneName, candidateBreakpoints: [] };
}

function sanitizeBreakpoints(candidates: any[]): SceneBreakpoint[] {
	const validBreakpoints: SceneBreakpoint[] = [];
	for (const item of candidates) {
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
			const type = ["condition", "hitCount", "logpoint"].includes(item.type) ? item.type : "line";
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
	return validBreakpoints;
}

/**
 * 解码并清洗外部传入的各种格式 Payload 字符串 (纯函数)
 */
export function decodeScenePayload(rawText: string, defaultSceneName?: string): ParsePayloadResult {
	if (!rawText || !rawText.trim()) {
		return { success: false, error: "Empty content" };
	}

	if (rawText.length > MAX_PAYLOAD_SIZE) {
		return { success: false, error: "Content exceeds maximum size limit (1MB)" };
	}

	let parsed: any;
	try {
		const unmarshalled = stripMarkdown(rawText);
		const sanitized = stripComments(unmarshalled);
		parsed = JSON.parse(sanitized);
	} catch (e: any) {
		return { success: false, error: `Invalid JSON format: ${e.message}` };
	}

	if (!parsed || typeof parsed !== "object") {
		return { success: false, error: "Payload must be a JSON object or array" };
	}

	const { targetSceneName, candidateBreakpoints } = resolveCandidatePayload(parsed, defaultSceneName);
	const validBreakpoints = sanitizeBreakpoints(candidateBreakpoints);

	if (validBreakpoints.length === 0) {
		return { success: false, error: "No valid breakpoints found in the payload" };
	}

	return {
		success: true,
		sceneName: targetSceneName,
		breakpoints: validBreakpoints,
	};
}

/**
 * 获取支持的外部传输格式示例模板 (纯函数)
 */
export function getSupportedFormatsTemplate(titles: SupportedFormatsTitles = {}): string {
	const title = titles.title || "Scene Breakpoints: Supported Payload Formats";
	const format1Title = titles.format1Title || "Format 1: Standard Scene Payload (Recommended)";
	const format2Title = titles.format2Title || "Format 2: scenes dictionary (debug-scenes.json snippet)";
	const format3Title = titles.format3Title || "Format 3: Raw breakpoint array";

	return `// ========================================================
// ${title}
// ========================================================

// ${format1Title}
{
  "$schema": "${SCHEMA_URL}",
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

/**
 * 校验并规范化原始对象为合法的 ScenesConfig (纯函数)
 */
export function sanitizeScenesConfig(parsed: any): ScenesConfig {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { scenes: {} };
	}
	const candidateScenes = (parsed.scenes && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes))
		? parsed.scenes
		: parsed;

	const cleanScenes: Record<string, any[]> = {};
	for (const [k, v] of Object.entries(candidateScenes)) {
		if (k !== "$schema" && k !== "bindings" && k !== "activeScenes" && Array.isArray(v)) {
			cleanScenes[k] = (v as any[]).filter((it) => it && typeof it === "object");
		}
	}

	let cleanActiveScenes: string[] | undefined;
	const rawActiveScenes = parsed.activeScenes || candidateScenes.activeScenes;
	if (Array.isArray(rawActiveScenes)) {
		cleanActiveScenes = rawActiveScenes
			.map((it) => String(it).trim())
			.filter(Boolean);
	}

	let cleanBindings: Record<string, string | string[]> | undefined;
	const rawBindings = parsed.bindings || candidateScenes.bindings;
	if (rawBindings && typeof rawBindings === "object" && !Array.isArray(rawBindings)) {
		cleanBindings = {};
		for (const [bk, bv] of Object.entries(rawBindings)) {
			if (typeof bv === "string" && bv.trim()) {
				cleanBindings[bk] = bv.trim();
			} else if (Array.isArray(bv)) {
				cleanBindings[bk] = (bv as unknown[]).map((it) => String(it).trim()).filter(Boolean);
			}
		}
	}

	const result: ScenesConfig = { scenes: cleanScenes };
	if (cleanBindings && Object.keys(cleanBindings).length > 0) {
		result.bindings = cleanBindings;
	}
	if (cleanActiveScenes && cleanActiveScenes.length > 0) {
		result.activeScenes = cleanActiveScenes;
	}
	return result;
}

/**
 * 场景断点数据负载编解码兼容门面 (保留 ScenePayloadCodec 类与单例实例)
 */
export class ScenePayloadCodec {
	public static readonly SCHEMA_URL = SCHEMA_URL;
	public static readonly MAX_PAYLOAD_SIZE = MAX_PAYLOAD_SIZE;

	public encode(sceneOrName: Scene | string, breakpoints?: SceneBreakpoint[]): string {
		return encodeScenePayload(sceneOrName, breakpoints);
	}

	public decode(rawText: string, defaultSceneName?: string): ParsePayloadResult {
		return decodeScenePayload(rawText, defaultSceneName);
	}

	public sanitizeConfig(parsed: any): ScenesConfig {
		return sanitizeScenesConfig(parsed);
	}

	public getTemplate(titles: SupportedFormatsTitles = {}): string {
		return getSupportedFormatsTemplate(titles);
	}

	public stripMarkdown(text: string): string {
		return stripMarkdown(text);
	}

	public stripComments(jsonStr: string): string {
		return stripComments(jsonStr);
	}

	// 静态快捷方式
	public static encode(sceneOrName: Scene | string, breakpoints?: SceneBreakpoint[]): string {
		return encodeScenePayload(sceneOrName, breakpoints);
	}

	public static decode(rawText: string, defaultSceneName?: string): ParsePayloadResult {
		return decodeScenePayload(rawText, defaultSceneName);
	}

	public static sanitizeConfig(parsed: any): ScenesConfig {
		return sanitizeScenesConfig(parsed);
	}

	public static stripMarkdown(text: string): string {
		return stripMarkdown(text);
	}
}

export const defaultScenePayloadCodec = new ScenePayloadCodec();
export const scenePayloadCodec = defaultScenePayloadCodec;
