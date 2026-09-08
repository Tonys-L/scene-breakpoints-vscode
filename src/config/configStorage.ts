import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { syncCoordinator } from "../syncCoordinator";
import type { ScenesConfig } from "../types";

export function getWorkspaceRoot(warnIfMissing = false): string | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		if (warnIfMissing) {
			vscode.window.showWarningMessage(vscode.l10n.t("Please open a workspace folder to use Scene Breakpoints."));
		}
		return undefined;
	}
	return folders[0].uri.fsPath;
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
		if (k !== "$schema" && k !== "bindings" && Array.isArray(v)) {
			cleanScenes[k] = (v as any[]).filter((it) => it && typeof it === "object");
		}
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

	if (cleanBindings && Object.keys(cleanBindings).length > 0) {
		return { bindings: cleanBindings, scenes: cleanScenes };
	}
	return { scenes: cleanScenes };
}

export function loadScenesConfig(workspaceRoot: string): ScenesConfig {
	const configPath = getScenesConfigPath(workspaceRoot);
	if (!fs.existsSync(configPath)) {
		return { scenes: {} };
	}

	try {
		const content = fs.readFileSync(configPath, "utf-8");
		if (!content || !content.trim()) {
			return { scenes: {} };
		}

		if (hasGitConflictMarkers(content)) {
			vscode.window.showErrorMessage(
				vscode.l10n.t("Git conflict detected in debug-scenes.json. Keeping existing breakpoint settings safe."),
			);
			return { scenes: {} };
		}

		const sanitized = stripJsonComments(content);
		const parsed = JSON.parse(sanitized);

		if (!parsed || typeof parsed !== "object") {
			vscode.window.showWarningMessage(vscode.l10n.t("debug-scenes.json root must be an object"));
			return { scenes: {} };
		}

		const candidateScenes = (parsed.scenes && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes))
			? parsed.scenes
			: parsed;

		const cleanScenes: Record<string, any[]> = {};
		for (const [k, v] of Object.entries(candidateScenes)) {
			if (k !== "$schema" && k !== "bindings" && Array.isArray(v)) {
				cleanScenes[k] = (v as any[]).filter((it) => it && typeof it === "object");
			}
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

		if (cleanBindings && Object.keys(cleanBindings).length > 0) {
			return { bindings: cleanBindings, scenes: cleanScenes };
		}
		return { scenes: cleanScenes };
	} catch (e: any) {
		vscode.window.showErrorMessage(vscode.l10n.t("Failed to read debug-scenes.json: {0}", e.message));
	}
	return { scenes: {} };
}

let isWriting = false;
let pendingSave: { workspaceRoot: string; config: ScenesConfig } | undefined;

export function saveScenesConfig(workspaceRoot: string, config: ScenesConfig): void {
	const configPath = getScenesConfigPath(workspaceRoot);
	const vscodeDir = path.dirname(configPath);
	try {
		syncCoordinator.markInternalSaving();
		if (!fs.existsSync(vscodeDir)) {
			fs.mkdirSync(vscodeDir, { recursive: true });
		}
		const content = JSON.stringify(config, null, 2);
		syncCoordinator.setLastSavedContent(content);

		// 并发互斥保护：若当前正在写盘，缓存最新配置，待当前写完后原子续写
		if (isWriting) {
			pendingSave = { workspaceRoot, config };
			return;
		}

		isWriting = true;
		try {
			fs.writeFileSync(configPath, content, "utf-8");
		} finally {
			isWriting = false;
			syncCoordinator.markInternalSaving();
			if (pendingSave) {
				const next = pendingSave;
				pendingSave = undefined;
				saveScenesConfig(next.workspaceRoot, next.config);
			}
		}
	} catch (e: any) {
		vscode.window.showErrorMessage(vscode.l10n.t("Failed to save debug-scenes.json: {0}", e.message));
	}
}

export function isContentMatchingLastSaved(content: string): boolean {
	return syncCoordinator.isContentMatchingLastSaved(content);
}

export function getLastSavedContent(): string {
	return syncCoordinator.getLastSavedContent();
}
