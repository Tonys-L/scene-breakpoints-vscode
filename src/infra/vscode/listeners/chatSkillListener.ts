import * as vscode from "vscode";

/**
 * Chat Skill 动态注入协同服务 (Chat Skill Service)
 * 职责：若 VS Code 宿主支持实验性 Chat Skill Provider API，向宿主动态声明并注入扩展内置的 Skill 清单
 */
export function registerChatSkillService(context: vscode.ExtensionContext): vscode.Disposable {
	if (typeof (vscode as any).chat?.registerSkillProvider === "function") {
		const skillProvider = {
			onDidChangeSkills: new vscode.EventEmitter<void>().event,
			provideSkills(): any[] {
				return [
					{
						uri: vscode.Uri.joinPath(
							context.extensionUri,
							"skills",
							"scene-breakpoints",
							"SKILL.md",
						),
					},
				];
			},
		};
		try {
			return (vscode as any).chat.registerSkillProvider(skillProvider);
		} catch {
			// 忽略实验性 API 不兼容异常
		}
	}
	return { dispose: () => {} };
}

export const registerChatSkillCoordinator = registerChatSkillService;

