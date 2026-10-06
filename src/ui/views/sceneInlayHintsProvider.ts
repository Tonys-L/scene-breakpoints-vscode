import * as vscode from "vscode";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { sceneManager } from "#src/application/sceneManager";
import { appEventBus } from "#src/application/eventBus";
import { activeBreakpointIndex } from "#src/application/activeBreakpointIndex";
import type { ScenesConfig, SourceSceneBreakpoint } from "#src/domain/types";
import { getWorkspaceRoot } from "#src/ui/utils/commandRunner";


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

		// 监听状态机激活场景变化与应用事件总线，通知编辑器即刻刷新行末注解
		this.disposables.push(
			sceneStateManager.onDidChangeState(() => {
				this.refresh();
			}),
			appEventBus.on("breakpoints:changed", () => {
				this.refresh();
			}),
			appEventBus.on("scenes:changed", () => {
				if (sceneStateManager.getActiveScenes().length > 0) {
					this.refresh();
				}
			}),
		);

		// 监听编辑器可见性与活动编辑器切换，确保新打开或切入的编辑器即刻获得装饰
		if (vscode.window.onDidChangeVisibleTextEditors) {
			this.disposables.push(
				vscode.window.onDidChangeVisibleTextEditors((editors) => {
					this.updateDecorations(editors);
				}),
			);
		}
		if (vscode.window.onDidChangeActiveTextEditor) {
			this.disposables.push(
				vscode.window.onDidChangeActiveTextEditor((editor) => {
					if (editor) {
						this.updateDecorations([editor]);
					}
				}),
			);
		}

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

		// 监听 VS Code 调试断点集合变动（DAP 注入或启闭），提供双重刷新防护
		if (vscode.debug?.onDidChangeBreakpoints) {
			this.disposables.push(
				vscode.debug.onDidChangeBreakpoints(() => {
					if (sceneStateManager.isApplyingScene()) {
						return;
					}
					this.refresh();
				}),
			);
		}

		activeProviderInstance = this;
	}

	/**
	 * 统一刷新入口：派发 onDidChangeInlayHints 并穿透可见编辑器装饰管线，
	 * 零延时、零竞态、单次精准通知宿主重绘
	 */
	public refresh(): void {
		this._onDidChangeInlayHints.fire();
		this.updateDecorations();
	}

	/**
	 * 主动向可见文本编辑器触发无感微触唤醒，
	 * 唤醒 Monaco 底层 deltaDecorations 调度，穿透失焦节流屏障，且避免在行末生成双重文本重影。
	 */
	public updateDecorations(editors?: readonly vscode.TextEditor[]): void {
		const targetEditors = editors ?? vscode.window.visibleTextEditors;
		if (!targetEditors || targetEditors.length === 0) return;

		const deco = getSceneAnnotationDecorationType();
		for (const editor of targetEditors) {
			try {
				editor.setDecorations(deco, []);
			} catch {
				// 容错：忽略失焦环境下的编辑器微触异常
			}
		}
	}

	/**
	 * 解析当前有效的激活场景列表（含冷启动自动降级与显式状态区分）
	 */
	private resolveActiveScenes(): string[] {
		let activeScenes = sceneStateManager.getActiveScenes();
		if (activeScenes.length === 0 && !sceneStateManager.hasExplicitState()) {
			const config = this.configLoader();
			if (config && Array.isArray(config.activeScenes) && config.activeScenes.length > 0) {
				activeScenes = config.activeScenes;
			}
		}
		return activeScenes;
	}

	/**
	 * 将已索引断点聚合为按物理行号索引的步骤映射表
	 */
	private groupBreakpointsByLine(indexedBps: BreakpointStepItem[]): Map<number, BreakpointStepItem[]> {
		const lineToStepsMap = new Map<number, BreakpointStepItem[]>();
		for (const item of indexedBps) {
			const bpLine = item.breakpoint.line;
			const existing = lineToStepsMap.get(bpLine) || [];
			existing.push(item);
			lineToStepsMap.set(bpLine, existing);
		}
		return lineToStepsMap;
	}

	/**
	 * 解析并确保当前活跃断点内存索引有效，返回与指定文档关联的按行聚合断点映射
	 */
	private getGroupedBreakpointsForDocument(
		docFsPath: string,
	): Map<number, BreakpointStepItem[]> | undefined {
		if (!this.enabledGetter()) return undefined;

		const activeScenes = this.resolveActiveScenes();
		if (activeScenes.length === 0) return undefined;

		const wsRoot = this.workspaceRootGetter();
		if (!activeBreakpointIndex.isUpToDate(wsRoot || "", activeScenes)) {
			const config = this.configLoader();
			if (config && config.scenes) {
				activeBreakpointIndex.sync(wsRoot || "", config.scenes, activeScenes);
			}
		}

		const indexedBps = activeBreakpointIndex.getBreakpointsForDocument(docFsPath, wsRoot);
		if (indexedBps.length === 0) return undefined;

		return this.groupBreakpointsByLine(indexedBps);
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
		const lineToStepsMap = this.getGroupedBreakpointsForDocument(document.uri.fsPath);
		if (!lineToStepsMap) return [];

		const hints: vscode.InlayHint[] = [];
		for (const [bpLine, stepItems] of lineToStepsMap.entries()) {
			const hint = this.createInlayHint(document, bpLine, stepItems);
			if (hint) hints.push(hint);
		}

		return hints;
	}

	public dispose(): void {
		if (activeProviderInstance === this) {
			activeProviderInstance = undefined;
		}
		this._onDidChangeInlayHints.dispose();
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables.length = 0;
		if (sceneAnnotationDecorationType) {
			sceneAnnotationDecorationType.dispose();
			sceneAnnotationDecorationType = undefined;
		}
	}
}

let activeProviderInstance: SceneInlayHintsProvider | undefined;
let sceneAnnotationDecorationType: vscode.TextEditorDecorationType | undefined;

export function getSceneAnnotationDecorationType(): vscode.TextEditorDecorationType {
	if (!sceneAnnotationDecorationType) {
		sceneAnnotationDecorationType = vscode.window.createTextEditorDecorationType({
			after: {
				margin: "0 0 0 1.5em",
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
		});
	}
	return sceneAnnotationDecorationType;
}

/**
 * 主动向当前所有可见文本编辑器派发断点注解更新，穿透宿主失焦惰性节流屏障，即时呈现或清除
 */
export function flushVisibleEditors(): void {
	if (activeProviderInstance) {
		activeProviderInstance.updateDecorations();
	}
}

