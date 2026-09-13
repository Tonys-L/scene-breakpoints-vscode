import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { extractChangelogSection, generateReleaseNotes } from "../../../scripts/extract-changelog.mjs";

export function runExtractChangelogTests() {
	console.log("  ▶ [Release Notes] 运行 extractChangelog 单元测试套件...");

	// 1. 正常提取现有版本 (1.0.6 与历史 1.0.5)
	const enChangelogPath = path.resolve("CHANGELOG.md");
	const section106 = extractChangelogSection(enChangelogPath, "1.0.6");
	assert.ok(section106.length > 0, "应能成功提取 1.0.6 章节");
	assert.ok(section106.includes("Breakpoint Schema & JSON Example Accuracy"), "应包含 1.0.6 的新增内容");
	assert.ok(!section106.includes("## [1.0.5]"), "不应越界包含 1.0.5 的内容");

	const section = extractChangelogSection(enChangelogPath, "1.0.5");
	assert.ok(section.length > 0, "应能成功提取 1.0.5 章节");
	assert.ok(section.includes("Ultra-Slim VSIX Package"), "应包含 1.0.5 的新增内容");
	assert.ok(!section.includes("## [1.0.4]"), "不应越界包含 1.0.4 的内容");

	// 2. 带 v 前缀版本号容错
	const sectionWithV = extractChangelogSection(enChangelogPath, "v1.0.6");
	assert.equal(sectionWithV, section106, "v1.0.6 与 1.0.6 提取结果应完全一致");

	// 3. 不存在版本号返回空字符串
	const missing = extractChangelogSection(enChangelogPath, "9.9.9");
	assert.equal(missing, "", "不存在的版本应返回空字符串");

	// 4. 生成 release notes 测试
	const testOutPath = path.resolve(".test-release-notes.md");
	try {
		const notes = generateReleaseNotes({
			version: "1.0.5",
			outputFile: testOutPath,
		});
		assert.ok(notes.includes("## What's Changed in v1.0.5"), "英文标题应存在");
		assert.ok(notes.includes("🇨🇳 简体中文更新说明"), "中文折叠应存在");
		assert.ok(fs.existsSync(testOutPath), "输出文件应存在");
	} finally {
		if (fs.existsSync(testOutPath)) {
			fs.unlinkSync(testOutPath);
		}
	}

	console.log("  ✅ [Release Notes] extractChangelog 自动化单测全部通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runExtractChangelogTests();
}
