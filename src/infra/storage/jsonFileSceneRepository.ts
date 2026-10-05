import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { echoLoopGuard } from "./echoLoopGuard";
import { AtomicFileJsonStore, type ISelfHealingStore } from "./atomicFileJsonStore";
import { stripComments, hasGitConflictMarkers } from "#src/shared/utils/textUtils";
import type { ScenesConfig } from "#src/domain/types";
import type { ISceneRepository } from "#src/domain/ports/sceneRepository";
import { sanitizeScenesConfig } from "#src/domain/services/scenePayloadCodec";

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

export { hasGitConflictMarkers, sanitizeScenesConfig };
export const stripJsonComments = stripComments;

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
