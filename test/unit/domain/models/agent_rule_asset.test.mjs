import assert from "node:assert";
import crypto from "node:crypto";
import {
	LATEST_SKILL_VERSION,
	LATEST_RULE_VERSION,
	OFFICIAL_SKILL_HISTORY,
	OFFICIAL_RULE_HISTORY,
	AgentRuleAsset,
	pureSha256,
} from "#src/domain/models/agentRuleAsset.ts";

// 便捷函数：等价于已删除的 skillLifecycleResolver 中的薄包装
function stripSkillFrontmatter(content) {
	return new AgentRuleAsset("", content).getCoreBody();
}
function normalizeSkillContent(content) {
	return new AgentRuleAsset("", content).getNormalizedBody();
}
function computeSkillFingerprint(content, hasher) {
	return new AgentRuleAsset("", content).computeFingerprint(hasher);
}
function resolveSkillLifecycleState(localContent, latestTemplate, version = LATEST_SKILL_VERSION) {
	return new AgentRuleAsset("local", localContent).evaluateLifecycle(latestTemplate, version);
}

export function runSkillLifecycleTests() {
	console.log("  ▶ [Skill Lifecycle] 运行 AgentRuleAsset / SkillAsset 版本生命周期与指纹反查测试套件...");

	const latestTemplate = `---
name: scene-breakpoints
description: Orchestrate and declare breakpoint scenes in .vscode/debug-scenes.json
---

# Skill: scene-breakpoints

## 何时使用
- Bug 排查
- 源码研读
`;

	// 1. Frontmatter 剥离能力验证（含不同换行与无 Frontmatter）
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

	// 6. 构造函数空输入与默认兜底防御
	{
		const emptyAsset = new AgentRuleAsset("some-path", null);
		assert.strictEqual(emptyAsset.targetPath, "some-path");
		assert.strictEqual(emptyAsset.rawContent, "");
		assert.strictEqual(emptyAsset.getCoreBody(), "");
		assert.strictEqual(emptyAsset.getNormalizedBody(), "");

		const undefinedAsset = new AgentRuleAsset("path", undefined);
		assert.strictEqual(undefinedAsset.rawContent, "");
	}

	// 7. 自定义 hasher 端口注入与委托调用 (击杀 computeFingerprint / evaluateLifecycle hasher 变异)
	{
		let hasherInvoked = false;
		const mockHasher = {
			sha256: (text) => {
				hasherInvoked = true;
				return `mocked-hash-for-${text.slice(0, 10)}`;
			},
		};

		const asset = new AgentRuleAsset("custom-path", "# Title\nCustom content");
		const hash = asset.computeFingerprint(mockHasher);
		assert.strictEqual(hasherInvoked, true, "当传入合法的 IHashService 时必须优先调用注入的 hasher");
		assert.ok(hash.startsWith("mocked-hash-for-"));

		// 支持纯函数形式的 Hasher
		let fnHasherInvoked = false;
		const fnHasher = (text) => {
			fnHasherInvoked = true;
			return `fn-hash-${text.slice(0, 5)}`;
		};
		const fnHash = asset.computeFingerprint(fnHasher);
		assert.strictEqual(fnHasherInvoked, true, "当传入纯函数 Hasher 时必须直接调用该函数");
		assert.strictEqual(fnHash, "fn-hash-# Tit");

		// hasher 非函数或空对象时，降级走默认 pureSha256
		const fallbackHash = asset.computeFingerprint({});
		assert.strictEqual(typeof fallbackHash, "string");
		assert.strictEqual(fallbackHash.length, 64, "降级默认 pureSha256 必须生成 64 位标准十六进制指纹");
	}

	// 8. evaluateLifecycle 多态参数形态测试
	{
		const asset = new AgentRuleAsset("path", "# Same Content");
		const sameTemplate = "# Same Content";

		// 8.1 第二参数传入 IHashService 对象
		let secondParamHasherCalled = false;
		const customHasherObj = {
			sha256: (txt) => {
				secondParamHasherCalled = true;
				return "hash-from-second-param";
			},
		};
		const resWithHasher = asset.evaluateLifecycle(sameTemplate, customHasherObj);
		assert.strictEqual(secondParamHasherCalled, true, "第二参数传入 IHashService 时应当被识别为 actualHasher");
		assert.strictEqual(resWithHasher.status, "UpToDate");
		assert.strictEqual(resWithHasher.detectedVersion, LATEST_RULE_VERSION);
		assert.strictEqual(resWithHasher.localHash, "hash-from-second-param");

		// 8.2 第二参数传入 version 字符串，第三参数传入 IHashService
		let thirdParamHasherCalled = false;
		const thirdParamHasher = {
			sha256: () => {
				thirdParamHasherCalled = true;
				return "hash-from-third-param";
			},
		};
		const resWithBoth = asset.evaluateLifecycle(sameTemplate, "2.0.0-custom", thirdParamHasher);
		assert.strictEqual(thirdParamHasherCalled, true);
		assert.strictEqual(resWithBoth.detectedVersion, "2.0.0-custom");

		// 8.3 第二参数直接传入纯函数 Hasher
		let secondParamFnCalled = false;
		const directFnHasher = (txt) => {
			secondParamFnCalled = true;
			return "hash-from-second-param-fn";
		};
		const resWithFn = asset.evaluateLifecycle(sameTemplate, directFnHasher);
		assert.strictEqual(secondParamFnCalled, true, "第二参数传入纯函数 Hasher 时应当被识别为 actualHasher");
		assert.strictEqual(resWithFn.status, "UpToDate");
		assert.strictEqual(resWithFn.localHash, "hash-from-second-param-fn");
	}

	// 9. pureSha256 FIPS 180-4 标准向量与非 ASCII 编码校验（转写偏差修复守卫）
	{
		// 9.1 FIPS 180-4 公开标准向量：素数筛上限 313 修复后必须与标准 SHA-256 逐字节一致
		assert.strictEqual(pureSha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		assert.strictEqual(pureSha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		assert.strictEqual(pureSha256("hello world"), "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
		assert.strictEqual(
			pureSha256("The quick brown fox jumps over the lazy dog"),
			"d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
		);

		// 9.2 与 node:crypto 动态交叉验证：覆盖中文 UTF-8 经 computeFingerprint 的 latin1 字节流编码路径
		const zhAsset = new AgentRuleAsset("zh.md", "中文断点场景");
		assert.strictEqual(
			zhAsset.computeFingerprint(),
			crypto.createHash("sha256").update("中文断点场景", "utf8").digest("hex"),
			"computeFingerprint 中文 UTF-8 路径必须与 node:crypto 标准 SHA-256 一致",
		);

		// 9.3 pureSha256 包含非 ASCII 码点时安全返回空字符串（契约不变）
		const nonAsciiDirect = pureSha256("中文\u{1F600}");
		assert.strictEqual(nonAsciiDirect, "", "pureSha256 直接遇到大于 255 的字符时必须安全返回空字符串");
	}

	// 10. 常量保真对齐
	{
		assert.strictEqual(LATEST_RULE_VERSION, LATEST_SKILL_VERSION);
		assert.strictEqual(OFFICIAL_RULE_HISTORY, OFFICIAL_SKILL_HISTORY);
	}

	console.log("  ✅ [Skill Lifecycle] AI Skill 版本生命周期与指纹反查测试全部通过！");
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
	runSkillLifecycleTests();
}
