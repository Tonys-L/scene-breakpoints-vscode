import type { SceneBreakpoint } from "#src/domain/types";
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

/**
 * 场景断点数据负载编解码领域服务 (ScenePayloadCodec Domain Service)
 * 职责：负责场景实体与通用外部传输数据（JSON 文本、代码块封装、多格式嗅探）之间的无损编码（Encode/Serialize）与解码清洗（Decode/Parse）
 * 纯度保证：100% 内存纯计算，绝对不依赖系统剪贴板（Clipboard）或任何宿主设备
 */
export class ScenePayloadCodec {
	private static readonly SCHEMA_URL =
		"https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json";
	private static readonly MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB

	/**
	 * 将指定场景或断点列表编码（序列化）为标准格式文本
	 */
	public encode(
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
			$schema: ScenePayloadCodec.SCHEMA_URL,
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

	/**
	 * 自动剥离外层的 Markdown 代码块包裹（如 ```json ... ```）
	 */
	public stripMarkdown(text: string): string {
		return stripMarkdown(text);
	}

	/**
	 * 清洗 JSON 字符串中的注释（单行 // 与多行 /* *\/）以及行尾悬挂逗号
	 */
	public stripComments(jsonStr: string): string {
		return stripComments(jsonStr);
	}

	/**
	 * 获取支持的外部传输格式示例模板 (纯文本协议，无特定硬件依赖)
	 */
	public getTemplate(titles: SupportedFormatsTitles = {}): string {
		const title = titles.title || "Scene Breakpoints: Supported Payload Formats";
		const format1Title = titles.format1Title || "Format 1: Standard Scene Payload (Recommended)";
		const format2Title = titles.format2Title || "Format 2: scenes dictionary (debug-scenes.json snippet)";
		const format3Title = titles.format3Title || "Format 3: Raw breakpoint array";

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

	/**
	 * 解码并清洗外部传入的 Payload 字符串，兼容多种结构（标准 Payload、scenes 字典、裸数组等）
	 */
	public decode(rawText: string, defaultSceneName?: string): ParsePayloadResult {
		if (!rawText || !rawText.trim()) {
			return { success: false, error: "Empty content" };
		}

		if (rawText.length > ScenePayloadCodec.MAX_PAYLOAD_SIZE) {
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

		const { targetSceneName, candidateBreakpoints } = this.resolveCandidatePayload(parsed, defaultSceneName);
		const validBreakpoints = this.sanitizeBreakpoints(candidateBreakpoints);

		if (validBreakpoints.length === 0) {
			return { success: false, error: "No valid breakpoints found in the payload" };
		}

		return {
			success: true,
			sceneName: targetSceneName,
			breakpoints: validBreakpoints,
		};
	}

	private resolveCandidatePayload(parsed: any, defaultSceneName?: string): { targetSceneName: string; candidateBreakpoints: any[] } {
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

	private sanitizeBreakpoints(candidates: any[]): SceneBreakpoint[] {
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

	// 静态快捷方式
	public static encode(sceneOrName: Scene | string, breakpoints?: SceneBreakpoint[]): string {
		return defaultScenePayloadCodec.encode(sceneOrName, breakpoints);
	}

	public static decode(rawText: string, defaultSceneName?: string): ParsePayloadResult {
		return defaultScenePayloadCodec.decode(rawText, defaultSceneName);
	}

	public static stripMarkdown(text: string): string {
		return stripMarkdown(text);
	}
}

export const defaultScenePayloadCodec = new ScenePayloadCodec();

export const encodeScenePayload = (sceneOrName: Scene | string, breakpoints?: SceneBreakpoint[]) =>
	defaultScenePayloadCodec.encode(sceneOrName, breakpoints);
export const decodeScenePayload = (rawText: string, defaultSceneName?: string): ParsePayloadResult =>
	defaultScenePayloadCodec.decode(rawText, defaultSceneName);
export const getSupportedFormatsTemplate = (titles?: SupportedFormatsTitles) =>
	defaultScenePayloadCodec.getTemplate(titles);
