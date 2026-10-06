import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import { checkAndPromptSkillUpdates } from "#src/ui/commands/skillCommands";
import { AgentRuleAsset, OFFICIAL_SKILL_HISTORY } from "#src/domain/models/agentRuleAsset";

export async function runSkillCommandsTests() {
	console.log("  ▶ [Skill Commands] 运行 skillCommands 巡检提示单测套件...");

	// 官方内置模板取自仓库真实产物，保障与生产 readOfficialTemplate 完全同源
	const extensionRoot = path.resolve(".");
	const officialTemplate = fs.readFileSync(
		path.join(extensionRoot, "skills", "scene-breakpoints", "SKILL.md"),
		"utf-8",
	);

	// CleanOutdated 夹具：哈希临时注册进官方历史指纹表（沿用 agent_rule_asset.test.mjs 先例，finally 删除还原）
	const outdatedBody = "---\nname: scene-breakpoints\nversion: 1.0.3\n---\n\n# Historical Clean Body\n";
	const outdatedHash = new AgentRuleAsset("fixture", outdatedBody).computeFingerprint();

	const upToDateContent = officialTemplate;
	const customModifiedContent = officialTemplate + "\n\n> local personalized tweak\n";

	/** 构造独立 ExtensionContext（每次提示均需全新 workspaceState，避免通知版本闸门短路） */
	const mkContext = (root) => {
		const memState = {
			_map: new Map(),
			get(k, def) {
				return this._map.has(k) ? this._map.get(k) : def;
			},
			async update(k, v) {
				this._map.set(k, v);
			},
		};
		return {
			subscriptions: [],
			extensionPath: root,
			extensionUri: vscode.Uri.file(root),
			workspaceState: memState,
			globalState: memState,
			extension: { packageJSON: { version: "1.0.9" } },
		};
	};

	const mkWorkspace = () => fs.mkdtempSync(path.join(os.tmpdir(), "sb-skill-cmd-"));
	const writeTargetFile = (ws, dir, file, content) => {
		fs.mkdirSync(path.join(ws, dir), { recursive: true });
		fs.writeFileSync(path.join(ws, dir, file), content, "utf-8");
	};

	// 捕获式消息弹窗：记录提示与动作数组，并按 reply 模拟用户选择
	let lastMsg = null;
	let lastActions = null;
	let reply = undefined;
	vscode.window.showInformationMessage = async (msg, ...actions) => {
		lastMsg = msg;
		lastActions = actions;
		return reply;
	};

	OFFICIAL_SKILL_HISTORY[outdatedHash] = "1.0.3";

	try {
		// ----------------------------------------------------
		// 1. 同版本已通知过 → 必须静默提前返回
		// ----------------------------------------------------
		{
			const ws = mkWorkspace();
			const context = mkContext(extensionRoot);
			await context.workspaceState.update("lastNotifiedSkillVersion", "1.0.9");
			lastMsg = "SENTINEL";
			await checkAndPromptSkillUpdates(context, ws);
			assert.strictEqual(lastMsg, "SENTINEL", "同版本已通知过必须静默跳过");
			fs.rmSync(ws, { recursive: true, force: true });
		}

		// ----------------------------------------------------
		// 2. 官方模板读取失败（extensionUri 指向空目录）→ 提前返回
		// ----------------------------------------------------
		{
			const emptyExtDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-skill-empty-"));
			try {
				const context = mkContext(emptyExtDir);
				lastMsg = "SENTINEL";
				await checkAndPromptSkillUpdates(context, mkWorkspace());
				assert.strictEqual(lastMsg, "SENTINEL", "模板读取失败必须静默跳过");
			} finally {
				fs.rmSync(emptyExtDir, { recursive: true, force: true });
			}
		}

		// ----------------------------------------------------
		// 3. 全部目标均为最新或未安装 → 无过期目标不弹提示
		// ----------------------------------------------------
		{
			const ws = mkWorkspace();
			writeTargetFile(ws, ".agents/skills/scene-breakpoints", "SKILL.md", upToDateContent);
			const context = mkContext(extensionRoot);
			lastMsg = "SENTINEL";
			await checkAndPromptSkillUpdates(context, ws);
			assert.strictEqual(lastMsg, "SENTINEL", "无过期目标必须静默跳过");
			fs.rmSync(ws, { recursive: true, force: true });
		}

		// ----------------------------------------------------
		// 4. 存在纯净过期目标 → 弹提示且动作 = [更新, 诊断, 稍后]，提示前写入通知版本
		// ----------------------------------------------------
		{
			const ws = mkWorkspace();
			writeTargetFile(ws, ".trae/skills/scene-breakpoints", "SKILL.md", outdatedBody);
			const context = mkContext(extensionRoot);
			reply = undefined;
			await checkAndPromptSkillUpdates(context, ws);
			assert.ok(lastMsg, "存在过期目标必须弹出巡检提示");
			assert.strictEqual(lastActions.length, 3, "仅 CleanOutdated 时动作 = [更新, 诊断, 稍后]");
			assert.strictEqual(
				context.workspaceState._map.get("lastNotifiedSkillVersion"),
				"1.0.9",
				"提示前必须先写入 lastNotifiedSkillVersion 闸门",
			);
			fs.rmSync(ws, { recursive: true, force: true });
		}

		// ----------------------------------------------------
		// 5. 选择"更新纯净 Skill" → 最新官方模板物理落盘
		// ----------------------------------------------------
		{
			const ws = mkWorkspace();
			const skillPath = path.join(ws, ".trae/skills/scene-breakpoints/SKILL.md");
			writeTargetFile(ws, ".trae/skills/scene-breakpoints", "SKILL.md", outdatedBody);

			// 第一次调用捕获"更新"动作实例（l10n 确定性输出，值相等可复用）
			const probeContext = mkContext(extensionRoot);
			reply = undefined;
			await checkAndPromptSkillUpdates(probeContext, ws);
			const updateAction = lastActions[0];

			// 第二次调用（全新 context 绕过通知闸门）选择"更新"
			const context = mkContext(extensionRoot);
			reply = updateAction;
			await checkAndPromptSkillUpdates(context, ws);
			const updated = fs.readFileSync(skillPath, "utf-8");
			assert.strictEqual(updated, officialTemplate, "更新后必须落盘与官方完全一致的最新模板");
			fs.rmSync(ws, { recursive: true, force: true });
		}

		// ----------------------------------------------------
		// 6. 选择"稍后"/直接关闭 → 不产生任何文件副作用
		// ----------------------------------------------------
		{
			const ws = mkWorkspace();
			const skillPath = path.join(ws, ".trae/skills/scene-breakpoints/SKILL.md");
			writeTargetFile(ws, ".trae/skills/scene-breakpoints", "SKILL.md", outdatedBody);
			const context = mkContext(extensionRoot);
			reply = undefined;
			await checkAndPromptSkillUpdates(context, ws);
			assert.strictEqual(
				fs.readFileSync(skillPath, "utf-8"),
				outdatedBody,
				"选择稍后时旧文件必须保持原样",
			);
			fs.rmSync(ws, { recursive: true, force: true });
		}

		// ----------------------------------------------------
		// 7. 单个本地定制目标 → 动作含"查看差异"，选择后调起 vscode.diff 虚拟比对
		// ----------------------------------------------------
		{
			const ws = mkWorkspace();
			writeTargetFile(ws, ".windsurf/rules", "scene-breakpoints.md", customModifiedContent);

			const originalExecute = vscode.commands.executeCommand;
			let diffInvoked = false;
			vscode.commands.executeCommand = async (cmd, ...args) => {
				if (cmd === "vscode.diff") {
					diffInvoked = true;
					return undefined;
				}
				return originalExecute(cmd, ...args);
			};
			try {
				const probeContext = mkContext(extensionRoot);
				reply = undefined;
				await checkAndPromptSkillUpdates(probeContext, ws);
				assert.strictEqual(lastActions.length, 3, "单定制目标时动作 = [差异, 诊断, 稍后]，无更新动作");
				const diffAction = lastActions[0];

				const context = mkContext(extensionRoot);
				reply = diffAction;
				await checkAndPromptSkillUpdates(context, ws);
				assert.strictEqual(diffInvoked, true, "必须调起 vscode.diff 虚拟比对窗口");
			} finally {
				vscode.commands.executeCommand = originalExecute;
			}
			fs.rmSync(ws, { recursive: true, force: true });
		}

		// ----------------------------------------------------
		// 8. 选择"打开诊断" → 分发 diagnoseAiIntegration 命令
		// ----------------------------------------------------
		{
			const ws = mkWorkspace();
			writeTargetFile(ws, ".trae/skills/scene-breakpoints", "SKILL.md", outdatedBody);

			const originalExecute = vscode.commands.executeCommand;
			let diagnoseCmd = null;
			vscode.commands.executeCommand = async (cmd) => {
				diagnoseCmd = cmd;
				return undefined;
			};
			try {
				const probeContext = mkContext(extensionRoot);
				reply = undefined;
				await checkAndPromptSkillUpdates(probeContext, ws);
				const diagnoseAction = lastActions[1];

				const context = mkContext(extensionRoot);
				reply = diagnoseAction;
				await checkAndPromptSkillUpdates(context, ws);
				assert.strictEqual(diagnoseCmd, "sceneBreakpoints.diagnoseAiIntegration", "必须分发诊断命令");
			} finally {
				vscode.commands.executeCommand = originalExecute;
			}
			fs.rmSync(ws, { recursive: true, force: true });
		}

		// ----------------------------------------------------
		// 9. 多个本地定制目标 → 无"查看差异"动作，动作 = [诊断, 稍后]
		// ----------------------------------------------------
		{
			const ws = mkWorkspace();
			writeTargetFile(ws, ".windsurf/rules", "scene-breakpoints.md", customModifiedContent);
			writeTargetFile(ws, ".clinerules", "scene-breakpoints.md", customModifiedContent);
			const context = mkContext(extensionRoot);
			reply = undefined;
			await checkAndPromptSkillUpdates(context, ws);
			assert.strictEqual(lastActions.length, 2, "多定制目标时不提供 Diff 动作 = [诊断, 稍后]");
			assert.ok(lastMsg, "多定制目标仍必须弹出巡检提示");
			fs.rmSync(ws, { recursive: true, force: true });
		}

		console.log("  ✅ [Skill Commands] skillCommands 巡检提示单测全部通过！");
	} finally {
		delete OFFICIAL_SKILL_HISTORY[outdatedHash];
		__resetMockVscodeState();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	runSkillCommandsTests();
}
