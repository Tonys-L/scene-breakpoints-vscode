import assert from "node:assert";
import {
	computeSkillFingerprint,
	LATEST_SKILL_VERSION,
	normalizeSkillContent,
	OFFICIAL_SKILL_HISTORY,
	resolveSkillLifecycleState,
	stripSkillFrontmatter,
} from "../../../src/domain/skillLifecycleResolver.ts";

export function runSkillLifecycleTests() {
	console.log("  ▶ [Skill Lifecycle] 运行 AI Skill 版本生命周期与指纹反查测试套件...");

	const latestTemplate = `---
name: scene-breakpoints
description: Orchestrate and declare breakpoint scenes in .vscode/debug-scenes.json
---

# Skill: scene-breakpoints

## 何时使用
- Bug 排查
- 源码研读
`;

	// 1. Frontmatter 剥离能力验证
	{
		const cursorMdc = `---\ndescription: Cursor Rule\nglobs: **\n---\n\n# Skill: scene-breakpoints\nBody`;
		const yamlHeader = `---\r\nname: scene-breakpoints\r\n---\r\n\r\n# Skill: scene-breakpoints\r\nBody`;
		const noHeader = `# Skill: scene-breakpoints\nBody`;

		assert.strictEqual(stripSkillFrontmatter(cursorMdc).trim().replace(/\r\n/g, "\n"), "# Skill: scene-breakpoints\nBody");
		assert.strictEqual(stripSkillFrontmatter(yamlHeader).trim().replace(/\r\n/g, "\n"), "# Skill: scene-breakpoints\nBody");
		assert.strictEqual(stripSkillFrontmatter(noHeader).trim().replace(/\r\n/g, "\n"), "# Skill: scene-breakpoints\nBody");
	}

	// 2. 跨平台 CRLF 与 LF 归一化等价性测试
	{
		const crlf = "---\r\nname: test\r\n---\r\n# Title\r\nLine 1   \r\nLine 2\r\n";
		const lf = "---\nname: test\n---\n# Title\nLine 1\nLine 2\n";

		assert.strictEqual(
			normalizeSkillContent(crlf),
			normalizeSkillContent(lf),
			"CRLF 与 LF 经归一化后必须完全一致",
		);
		assert.strictEqual(
			computeSkillFingerprint(crlf),
			computeSkillFingerprint(lf),
			"CRLF 与 LF 算出的指纹必须绝对相等",
		);
	}

	// 3. 最新版状态识别 (UpToDate)
	{
		// 本地安装了 Cursor 版本 (带 MDC 头)，模板是标准 Antigravity (带 YAML 头)
		const localCursor = `---\ndescription: Cursor Rule\nglobs: **\n---\n\n# Skill: scene-breakpoints\n\n## 何时使用\n- Bug 排查\n- 源码研读\n`;
		const res = resolveSkillLifecycleState(localCursor, latestTemplate);

		assert.strictEqual(res.status, "UpToDate");
		assert.strictEqual(res.detectedVersion, LATEST_SKILL_VERSION);
		assert.strictEqual(res.localHash, res.latestHash);
	}

	// 4. 纯净历史旧版识别 (CleanOutdated)
	{
		// 验证当前 1.0.3 基线指纹已记录
		const v103Hash = "f026e091703950315e7b7ca2e55a3650af729c2a9512e49bd82e5e695be5ffea";
		assert.strictEqual(OFFICIAL_SKILL_HISTORY[v103Hash], "1.0.3");

		// 模拟上游发版升级为未来版本模板，而本地仍保留官方纯净 1.0.3 基线版本
		const officialV103Content = "# Skill: scene-breakpoints\n\nOfficial v1.0.3 rules";
		const officialV103Hash = computeSkillFingerprint(officialV103Content);
		OFFICIAL_SKILL_HISTORY[officialV103Hash] = "1.0.3";

		const upstreamFutureTemplate = `${latestTemplate}\n## 新增未来特性\n- 自适应排障\n`;
		const res = resolveSkillLifecycleState(officialV103Content, upstreamFutureTemplate);

		assert.strictEqual(res.status, "CleanOutdated");
		assert.strictEqual(res.detectedVersion, "1.0.3");
		delete OFFICIAL_SKILL_HISTORY[officialV103Hash];
	}

	// 5. 用户自定义修改识别 (CustomModified)
	{
		// 用户在最新模板中加了一句私有规则
		const customizedLocal = `---\nname: scene-breakpoints\n---\n\n# Skill: scene-breakpoints\n\n## 何时使用\n- Bug 排查\n- 源码研读\n\n## 我的项目私有规则\n- 必须同时打在 src/my.ts\n`;
		const res = resolveSkillLifecycleState(customizedLocal, latestTemplate);

		assert.strictEqual(res.status, "CustomModified");
		assert.strictEqual(res.detectedVersion, undefined);
		assert.notStrictEqual(res.localHash, res.latestHash);
	}

	console.log("  ✅ [Skill Lifecycle] AI Skill 版本生命周期与指纹反查测试全部通过！");
}
