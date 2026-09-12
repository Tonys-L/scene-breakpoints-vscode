import assert from "node:assert";
import {
	computeSkillFingerprint,
	LATEST_SKILL_VERSION,
	normalizeSkillContent,
	OFFICIAL_SKILL_HISTORY,
	resolveSkillLifecycleState,
	stripSkillFrontmatter,
} from "../src/config/skillLifecycleResolver.ts";

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
		// 模拟 1.0.2 纯净历史正文（剥离头部的历史 Hash 命中清单）
		const historicalHash = "4cde9f15455967ee70c8ca04c9d95ae0190300e13396b592b94bb7216b1d2f93";
		assert.strictEqual(OFFICIAL_SKILL_HISTORY[historicalHash], "1.0.2");

		// 构造一个 Hash 刚好等于 1.0.2 的本地文件（即使带有 Cursor 独有头部）
		// 我们通过 mock 校验 resolveSkillLifecycleState 在命中清单时的行为
		const dummyOldContent = "dummy_old";
		const dummyOldHash = computeSkillFingerprint(dummyOldContent);

		// 临时将 dummyOldHash 加入映射表中进行验证
		OFFICIAL_SKILL_HISTORY[dummyOldHash] = "1.0.2-test";
		const res = resolveSkillLifecycleState(dummyOldContent, latestTemplate);

		assert.strictEqual(res.status, "CleanOutdated");
		assert.strictEqual(res.detectedVersion, "1.0.2-test");
		delete OFFICIAL_SKILL_HISTORY[dummyOldHash];
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
