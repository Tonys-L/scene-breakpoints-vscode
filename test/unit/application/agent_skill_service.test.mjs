import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	agentSkillService,
	formatSkillContent,
	backupSkillFile,
	getSupportedSkillTargets,
	isTargetHostMatch,
} from "#src/application/agentSkillService.ts";

export async function runAgentSkillServiceTests() {
	console.log("  ▶ [Agent Skill Service] 运行 AgentSkillService 应用层单元测试套件...");

	// 1. 目标平台元数据与只读探测
	{
		const targets = agentSkillService.getSupportedSkillTargets();
		assert.strictEqual(targets.length, 8, "必须支持 8 大主流 AI Agent 环境");
		assert.strictEqual(targets[0].label, "Antigravity", "默认置顶 Antigravity");
		assert.strictEqual(targets[0].id, "antigravity");
		const labels = targets.map((t) => t.label);
		assert.ok(labels.includes("Cursor"));
		assert.ok(labels.includes("Trae IDE"));
		assert.ok(labels.includes("Windsurf"));
		assert.ok(labels.includes("Cline"));
		assert.ok(labels.includes("Roo Code"));
		assert.ok(labels.includes("Continue"));
		assert.ok(labels.includes("VS Code / GitHub Copilot"));
	}

	// 2. 宿主应用匹配算法 isTargetHostMatch
	{
		const antigravityTarget = getSupportedSkillTargets().find((t) => t.id === "antigravity");
		const cursorTarget = getSupportedSkillTargets().find((t) => t.id === "cursor");

		assert.ok(isTargetHostMatch(antigravityTarget, "Antigravity AI IDE"));
		assert.ok(isTargetHostMatch(cursorTarget, "Cursor"));
		assert.strictEqual(isTargetHostMatch(cursorTarget, "VS Code"), false);
		assert.strictEqual(isTargetHostMatch(cursorTarget, undefined), false);
	}

	// 3. 模板格式化与 Frontmatter 替换 formatSkillContent
	{
		const baseTemplate = "---\nname: official\n---\n\n# Body Content";
		const customHeader = "---\ndescription: custom\nglobs: **\n---\n\n";

		// 无 customHeader
		const out1 = formatSkillContent(baseTemplate, {});
		assert.strictEqual(Buffer.from(out1).toString("utf-8"), baseTemplate);

		// 有 customHeader
		const out2 = formatSkillContent(baseTemplate, { customHeader });
		assert.strictEqual(Buffer.from(out2).toString("utf-8"), customHeader + "# Body Content");
	}

	// 4. 磁盘物理备份 backupSkillFile
	{
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-skill-test-"));
		try {
			const filePath = path.join(tmpDir, "test.md");
			fs.writeFileSync(filePath, "my test content", "utf-8");

			const backupPath = backupSkillFile(filePath);
			assert.ok(fs.existsSync(backupPath), "备份文件必须生成");
			assert.ok(backupPath.endsWith(".bak"), "必须以 .bak 为后缀");
			assert.strictEqual(fs.readFileSync(backupPath, "utf-8"), "my test content");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}

	// 5. 模板安全部署 deploySkillToTarget
	{
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-skill-deploy-"));
		try {
			const target = {
				id: "antigravity",
				label: "Antigravity",
				description: "Antigravity Skill",
				dir: ".agents/skills/scene-breakpoints",
				file: "SKILL.md",
			};

			const success = await agentSkillService.deploySkillToTarget(tmpDir, target, "# Official Skill");
			assert.strictEqual(success, true, "部署必须成功");

			const deployedFile = path.join(tmpDir, target.dir, target.file);
			assert.ok(fs.existsSync(deployedFile), "部署文件必须物理存在");
			assert.strictEqual(fs.readFileSync(deployedFile, "utf-8"), "# Official Skill");

			// 空模版失败守卫
			const emptyDeploy = await agentSkillService.deploySkillToTarget(tmpDir, target, "");
			assert.strictEqual(emptyDeploy, false, "空模板必须拦截返回 false");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}

	// 6. 全平台巡检与排序 inspectSkillTargets
	{
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-skill-inspect-"));
		try {
			const officialContent = "# Official Template v1.0.8";

			// 6.1 全新目录：全部返回 NotInstalled
			const freshInspected = agentSkillService.inspectSkillTargets(tmpDir, officialContent, "1.0.8");
			assert.strictEqual(freshInspected.length, 8);
			assert.ok(freshInspected.every((item) => item.status === "NotInstalled" && !item.exists));

			// 6.2 安装一个 Antigravity 技能，测试已安装状态检测
			const antigravityTarget = freshInspected.find((i) => i.target.id === "antigravity").target;
			await agentSkillService.deploySkillToTarget(tmpDir, antigravityTarget, officialContent);

			const inspectedAfterDeploy = agentSkillService.inspectSkillTargets(
				tmpDir,
				officialContent,
				"1.0.8",
				"Antigravity",
			);
			assert.strictEqual(inspectedAfterDeploy[0].target.id, "antigravity", "已安装且宿主匹配必须排在首位");
			assert.strictEqual(inspectedAfterDeploy[0].exists, true);
			assert.strictEqual(inspectedAfterDeploy[0].isCurrentHost, true);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}

	console.log("  ✅ [Agent Skill Service] AgentSkillService 应用层单元测试全部通过！");
}

if (process.argv[1]?.endsWith("agent_skill_service.test.mjs")) {
	runAgentSkillServiceTests();
}
