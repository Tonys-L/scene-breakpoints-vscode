import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { echoLoopGuard } from "./echoLoopGuard";
import { AtomicFileJsonStore } from "./atomicFileJsonStore";
import type { ISelfHealingStore } from "./selfHealingStore";
import type { ScenesConfig } from "#src/domain/types";
import type { ISceneRepository } from "#src/domain/ports/sceneRepository";

/**
 * 存储层用户通知抽象 (消除基础设施直接对 VS Code 弹窗硬绑定)
 */
export interface StorageNotifier {
	error(message: string): void;
	info(message: string): void;
	warn(message: string): void;
}

const defaultNotifier: StorageNotifier = {
	error: (msg) => {
		void vscode.window.showErrorMessage(msg);
	},
	info: (msg) => {
		void vscode.window.showInformationMessage(msg);
	},
	warn: (msg) => {
		void vscode.window.showWarningMessage(msg);
	},
};

let activeNotifier: StorageNotifier = defaultNotifier;

export function setStorageNotifier(notifier: StorageNotifier): void {
	activeNotifier = notifier;
}

export function resetStorageNotifier(): void {
	activeNotifier = defaultNotifier;
}

export function getScenesConfigPath(workspaceRoot: string): string {
	return path.join(workspaceRoot, ".vscode", "debug-scenes.json");
}


export function stripJsonComments(jsonStr: string): string {
	if (typeof jsonStr !== "string") return "{}";
	const stripped = jsonStr
		.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (_match, stringLiteral) => {
			return stringLiteral ? stringLiteral : "";
		})
		.replace(/,\s*([\]}])/g, "$1")
		.trim();
	return stripped.length > 0 ? stripped : "{}";
}

export function hasGitConflictMarkers(text: string): boolean {
	if (typeof text !== "string") return false;
	return /^[<]{7}\s|^[=]{7}$|^[>]{7}\s/m.test(text);
}

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

const atomicStore: ISelfHealingStore<ScenesConfig, string> = new AtomicFileJsonStore<ScenesConfig>();

export function loadScenesConfig(workspaceRoot: string): ScenesConfig {
	const configPath = getScenesConfigPath(workspaceRoot);
	if (!fs.existsSync(configPath)) {
		return { scenes: {} };
	}

	try {
		const raw = fs.readFileSync(configPath, "utf-8");
		if (hasGitConflictMarkers(raw)) {
			activeNotifier.error(
				vscode.l10n.t("Scene configuration has Git merge conflicts. Please resolve them first."),
			);
			return { scenes: {} };
		}
	} catch {
		// 忽略读取错误，交由 atomicStore 完整性自愈管道处理
	}

	try {
		const report = atomicStore.load(configPath, {
			fallback: () => ({ scenes: {} }),
			parse: (text) => JSON.parse(stripJsonComments(text)),
			validate: (data): data is ScenesConfig => Boolean(data && typeof data === "object"),
			onHealed: (msg) => {
				activeNotifier.info(
					vscode.l10n.t("Scene configuration self-healed: {0}", msg),
				);
			},
		});

		if (report.status === "healed") {
			echoLoopGuard.markInternalSaving();
		}

		return sanitizeScenesConfig(report.data);
	} catch (e: any) {
		activeNotifier.error(vscode.l10n.t("Failed to read debug-scenes.json: {0}", e?.message || String(e)));
		return { scenes: {} };
	}
}

export function saveScenesConfig(workspaceRoot: string, config: ScenesConfig): void {
	const configPath = getScenesConfigPath(workspaceRoot);
	try {
		echoLoopGuard.markInternalSaving();
		const content = JSON.stringify(config, null, 2);
		echoLoopGuard.setLastSavedContent(content);

		atomicStore.save(configPath, config);
	} catch (e: any) {
		activeNotifier.error(vscode.l10n.t("Failed to save debug-scenes.json: {0}", e?.message || String(e)));
	}
}

export function isContentMatchingLastSaved(content: string): boolean {
	return echoLoopGuard.isContentMatchingLastSaved(content);
}

export function getLastSavedContent(): string {
	return echoLoopGuard.getLastSavedContent();
}

export const jsonFileSceneRepository: ISceneRepository = {
	loadScenesConfig,
	saveScenesConfig,
	getScenesConfigPath,
};
