import * as path from "node:path";
import * as vscode from "vscode";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { sceneManager } from "#src/application/sceneManager";
import type { SceneBreakpoint, ScenesConfig, SourceSceneBreakpoint } from "#src/domain/types";
import { getWorkspaceRoot } from "#src/ui/utils/workspaceRoot";


interface BreakpointStepItem {
	sceneName: string;
	stepIndex: number;
	breakpoint: SourceSceneBreakpoint;
}

export class SceneInlayHintsProvider implements vscode.InlayHintsProvider, vscode.Disposable {
	private readonly _onDidChangeInlayHints = new vscode.EventEmitter<void>();
	public readonly onDidChangeInlayHints: vscode.Event<void> = this._onDidChangeInlayHints.event;

	private readonly disposables: vscode.Disposable[] = [];
	private readonly configLoader: () => ScenesConfig;
	private readonly workspaceRootGetter: () => string | undefined;
	private readonly enabledGetter: () => boolean;

	constructor(
		configLoader?: () => ScenesConfig,
		workspaceRootGetter?: () => string | undefined,
		enabledGetter?: () => boolean,
	) {
		this.workspaceRootGetter = workspaceRootGetter ?? (() => getWorkspaceRoot(false));
		this.configLoader =
			configLoader ??
			(() => {
				const ws = this.workspaceRootGetter();
				return ws ? sceneManager.loadScenesConfig(ws) : { scenes: {} };
			});
		this.enabledGetter =
			enabledGetter ??
			(() => {
				const conf = vscode.workspace.getConfiguration("sceneBreakpoints");
				const val = conf.get<boolean>("inlayHints.enabled");
				return val !== false;
			});

		// 监听状态机激活场景变化，通知编辑器即刻刷新行末注解
		this.disposables.push(
			sceneStateManager.onDidChangeState(() => {
				this.refresh();
			}),
		);

		// 监听用户配置变化（如开启/关闭 Inlay Hints）
		if (vscode.workspace.onDidChangeConfiguration) {
			this.disposables.push(
				vscode.workspace.onDidChangeConfiguration((e) => {
					if (e.affectsConfiguration("sceneBreakpoints.inlayHints")) {
						this.refresh();
					}
				}),
			);
		}
	}

	public refresh(): void {
		this._onDidChangeInlayHints.fire();
	}

	/**
	 * 检索与当前激活场景和文档相匹配的断点步骤映射表
	 */
	private collectStepsForDocument(
		docFsPath: string,
		activeScenes: string[],
		scenes: Record<string, SceneBreakpoint[]>,
		wsRoot?: string,
	): Map<number, BreakpointStepItem[]> {
		const lineToStepsMap = new Map<number, BreakpointStepItem[]>();

		for (const sceneName of activeScenes) {
			const sceneBps = scenes[sceneName];
			if (!Array.isArray(sceneBps)) continue;

			let stepIndex = 0;
			for (const bp of sceneBps) {
				if (!bp || typeof bp !== "object" || bp.type === "function") continue;
				stepIndex++;

				const srcBp = bp as SourceSceneBreakpoint;
				if (!srcBp.file || typeof srcBp.line !== "number" || srcBp.line <= 0) continue;

				const bpRelative = srcBp.file.trim().replace(/\\/g, "/").toLowerCase();
				const bpFullPath = wsRoot
					? (path.isAbsolute(srcBp.file)
						? path.normalize(srcBp.file).toLowerCase().replace(/\\/g, "/")
						: path.normalize(path.join(wsRoot, srcBp.file)).toLowerCase().replace(/\\/g, "/"))
					: bpRelative;

				const matches =
					bpFullPath === docFsPath ||
					docFsPath.endsWith("/" + bpRelative) ||
					docFsPath.endsWith(bpRelative);

				if (matches) {
					const existing = lineToStepsMap.get(srcBp.line) || [];
					existing.push({ sceneName, stepIndex, breakpoint: srcBp });
					lineToStepsMap.set(srcBp.line, existing);
				}
			}
		}

		return lineToStepsMap;
	}

	/**
	 * 构建断点步骤的丰富悬停 Markdown 信息
	 */
	private buildHintTooltip(stepItems: BreakpointStepItem[]): vscode.MarkdownString {
		const tooltipMarkdown = new vscode.MarkdownString("", true);
		tooltipMarkdown.isTrusted = true;

		for (let i = 0; i < stepItems.length; i++) {
			const item = stepItems[i];
			const bp = item.breakpoint;
			const isUnmatched = sceneStateManager.isBreakpointUnmatched(bp.file, bp.line);

			if (i > 0) {
				tooltipMarkdown.appendMarkdown("\n\n---\n\n");
			}

			tooltipMarkdown.appendMarkdown(`### 💡 ${vscode.l10n.t("Scene Breakpoint: {0}", item.sceneName)}\n\n`);
			tooltipMarkdown.appendMarkdown(`- **${vscode.l10n.t("Step")}**: #${item.stepIndex}\n`);
			tooltipMarkdown.appendMarkdown(`- **${vscode.l10n.t("Type")}**: \`${bp.type}\`\n`);

			if (bp.desc) tooltipMarkdown.appendMarkdown(`- **${vscode.l10n.t("Description")}**: ${bp.desc}\n`);
			if (bp.condition) tooltipMarkdown.appendMarkdown(`- **${vscode.l10n.t("Condition")}**: \`${bp.condition}\`\n`);
			if (bp.hitCondition) tooltipMarkdown.appendMarkdown(`- **${vscode.l10n.t("Hit Condition")}**: \`${bp.hitCondition}\`\n`);
			if (bp.logMessage) tooltipMarkdown.appendMarkdown(`- **${vscode.l10n.t("Log Message")}**: \`${bp.logMessage}\`\n`);
			if (isUnmatched) tooltipMarkdown.appendMarkdown(`- **${vscode.l10n.t("Status")}**: ⚠️ ${vscode.l10n.t("Unmatched (Code Drift Detected)")}\n`);
		}

		return tooltipMarkdown;
	}

	/**
	 * 创建单行的 InlayHint 实体
	 */
	private createInlayHint(
		document: vscode.TextDocument,
		bpLine: number,
		stepItems: BreakpointStepItem[],
	): vscode.InlayHint | undefined {
		const zeroBasedLine = bpLine - 1;
		if (zeroBasedLine < 0 || zeroBasedLine >= document.lineCount) return undefined;

		const lineLength = document.lineAt(zeroBasedLine).text.length;
		const position = new vscode.Position(zeroBasedLine, lineLength);

		const labelParts = stepItems.map((item) => {
			const base = `[${item.sceneName} #${item.stepIndex}]`;
			const desc = item.breakpoint.desc?.trim();
			return desc ? `${base} ${desc}` : base;
		});

		const hint = new vscode.InlayHint(position, `💡 ${labelParts.join(" | ")}`);
		hint.paddingLeft = true;
		hint.tooltip = this.buildHintTooltip(stepItems);
		return hint;
	}

	public provideInlayHints(
		document: vscode.TextDocument,
		_range?: vscode.Range,
		_token?: vscode.CancellationToken,
	): vscode.InlayHint[] {
		if (!this.enabledGetter()) return [];

		const config = this.configLoader();
		if (!config || !config.scenes) return [];

		let activeScenes = sceneStateManager.getActiveScenes();
		if (activeScenes.length === 0 && Array.isArray(config.activeScenes) && config.activeScenes.length > 0) {
			activeScenes = config.activeScenes;
		}
		if (activeScenes.length === 0) return [];

		const wsRoot = this.workspaceRootGetter();
		const docFsPath = path.normalize(document.uri.fsPath).toLowerCase().replace(/\\/g, "/");
		const lineToStepsMap = this.collectStepsForDocument(docFsPath, activeScenes, config.scenes, wsRoot);
		if (lineToStepsMap.size === 0) return [];

		const hints: vscode.InlayHint[] = [];
		for (const [bpLine, stepItems] of lineToStepsMap.entries()) {
			const hint = this.createInlayHint(document, bpLine, stepItems);
			if (hint) hints.push(hint);
		}

		return hints;
	}

	public dispose(): void {
		this._onDidChangeInlayHints.dispose();
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables.length = 0;
	}
}
