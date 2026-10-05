import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import {
	formatSkillContent,
	backupSkillFile,
	readOfficialTemplate,
	writeSkillToTarget,
	showSkillDiff,
	agentRuleManager,
} from "#src/ui/utils/agentRuleManager.ts";
import { templateContentProvider } from "#src/ui/views/templateContentProvider.ts";

export async function runAgentRuleManagerTests() {
	console.log("  ▶ [Agent Rule Manager] 运行 agentRuleManager 单元测试套件...");

	// 1. 门面方法完整性
	assert.strictEqual(typeof agentRuleManager.getSupportedSkillTargets, "function");
	assert.strictEqual(typeof agentRuleManager.formatSkillContent, "function");
	assert.strictEqual(typeof agentRuleManager.backupSkillFile, "function");
	assert.strictEqual(typeof agentRuleManager.readOfficialTemplate, "function");
	assert.strictEqual(typeof agentRuleManager.writeSkillToTarget, "function");
	assert.strictEqual(typeof agentRuleManager.showSkillDiff, "function");

	// 1.1 验证主流 AI Agent 平台清单
	{
		const targets = agentRuleManager.getSupportedSkillTargets();
		assert.strictEqual(targets.length, 8, "必须支持 8 大主流 AI Agent 环境");
		assert.strictEqual(targets[0].label, "Antigravity", "默认置顶 Antigravity");
		const labels = targets.map((t) => t.label);
		assert.ok(labels.includes("Cursor"));
		assert.ok(labels.includes("Trae IDE"));
		assert.ok(labels.includes("Windsurf"));
		assert.ok(labels.includes("Cline"));
	}

	// 2. formatSkillContent 格式化与 Frontmatter 替换
	{
		const baseWithFrontmatter = "---\nname: test\n---\n\n# Body Content";
		const customHeader = "---\ndescription: custom\n---\n\n";

		// 2.1 无 customHeader 时保持原样
		const raw1 = formatSkillContent(baseWithFrontmatter, {});
		assert.strictEqual(Buffer.from(raw1).toString("utf-8"), baseWithFrontmatter);

		// 2.2 有 customHeader 时剥离原有 Frontmatter 并注入新 Header
		const raw2 = formatSkillContent(baseWithFrontmatter, { customHeader });
		assert.strictEqual(Buffer.from(raw2).toString("utf-8"), customHeader + "# Body Content");

		// 2.3 支持 Uint8Array 输入
		const bytes = Buffer.from(baseWithFrontmatter, "utf-8");
		const raw3 = formatSkillContent(bytes, { customHeader });
		assert.strictEqual(Buffer.from(raw3).toString("utf-8"), customHeader + "# Body Content");
	}

	// 3. backupSkillFile 磁盘文件物理备份
	{
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rule-bak-"));
		try {
			const srcFile = path.join(tmpDir, "SKILL.md");
			fs.writeFileSync(srcFile, "original skill content", "utf-8");

			const backupPath = backupSkillFile(srcFile);
			assert.ok(fs.existsSync(backupPath), "备份文件必须生成在同目录下");
			assert.ok(backupPath.endsWith(".bak"), "备份文件后缀必须为 .bak");
			assert.strictEqual(fs.readFileSync(backupPath, "utf-8"), "original skill content");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}

	// 4. readOfficialTemplate 模版读取与异常防御
	{
		const mockContext = {
			extensionUri: vscode.Uri.file("/mock/ext"),
		};

		// 4.1 当读取成功时返回文本
		const contentStr = await readOfficialTemplate(mockContext);
		assert.strictEqual(typeof contentStr, "string");
	}

	// 5. showSkillDiff 虚拟比对调用验证
	{
		const originalExecute = vscode.commands.executeCommand;
		let diffCommandInvoked = false;
		let diffArgs = [];

		vscode.commands.executeCommand = async (cmd, ...args) => {
			if (cmd === "vscode.diff") {
				diffCommandInvoked = true;
				diffArgs = args;
				return undefined;
			}
			return originalExecute(cmd, ...args);
		};

		try {
			const target = {
				label: "Test Agent",
				dir: ".agents",
				file: "SKILL.md",
			};

			await showSkillDiff(target, "/workspace/.agents/SKILL.md", "# Official Content", "1.0.8");
			assert.strictEqual(diffCommandInvoked, true, "必须调用 vscode.diff 指令");
			assert.strictEqual(diffArgs.length, 3);
			assert.strictEqual(diffArgs[0].fsPath.replace(/\\/g, "/"), "/workspace/.agents/SKILL.md");
			assert.strictEqual(templateContentProvider.provideTextDocumentContent(diffArgs[1]), "# Official Content");
		} finally {
			vscode.commands.executeCommand = originalExecute;
		}
	}

	console.log("  ✅ [Agent Rule Manager] agentRuleManager 单元测试全部通过！");
}

if (process.argv[1]?.endsWith("agent_rule_manager.test.mjs")) {
	runAgentRuleManagerTests();
}
