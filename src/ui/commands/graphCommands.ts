import * as vscode from "vscode";
import type { GraphSnapshot } from "#src/application/sceneGraphProjection";
import { exportGraphToMermaid } from "#src/shared/utils/mermaidGraphExporter";
import { getWorkspaceRoot } from "#src/ui/utils/commandRunner";
import type { GraphCanvasController } from "#src/ui/views/graphCanvas/graphCanvasController";

/**
 * 场景断点画布命令入口 (v1.3.0 Scene Graph Canvas)
 * 职责：showGraph 打开/聚焦画布；exportGraphMermaid 将画布快照导出为 Mermaid 文本并复制到剪贴板。
 * 零落盘、零业务副作用：快照经注入的 loadSnapshot 只读投影（INV-028 弱耦合）。
 */

export interface GraphCommandDeps {
	readonly controller: GraphCanvasController;
	readonly loadSnapshot: (workspaceRoot: string, visibleScenes?: readonly string[]) => GraphSnapshot;
}

/** 装配根注入点（extension.ts 组装后调用，对齐 sceneCommands.setExtensionGlobalState 先例） */
let deps: GraphCommandDeps | undefined;

export function setGraphCommandDeps(next: GraphCommandDeps): void {
	deps = next;
}

/** 打开或聚焦场景断点画布（幂等） */
export async function showGraphCommand(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(true);
	if (!workspaceRoot || !deps) return;
	deps.controller.show(workspaceRoot);
}

/** 导出画布可见范围为 Mermaid flowchart 文本并复制到剪贴板（零落盘，对齐设计 §7） */
export async function exportGraphMermaidCommand(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(true);
	if (!workspaceRoot || !deps) return;

	// 所见即所得：导出对齐画布当前 Scope 选择（undefined = 跟随激活集）
	const snapshot = deps.loadSnapshot(workspaceRoot, deps.controller.getVisibleScenes());
	if (snapshot.lanes.length === 0) {
		void vscode.window.showWarningMessage(
			vscode.l10n.t("No scenes in the current scope to export."),
		);
		return;
	}

	const mermaid = exportGraphToMermaid(snapshot);
	await vscode.env.clipboard.writeText(mermaid);
	void vscode.window.showInformationMessage(
		vscode.l10n.t("Scene graph exported as Mermaid and copied to clipboard."),
	);
}
