import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

export function runI18nTests() {
	console.log("  ▶ [i18n] 运行国际化多语言一致性与源码全覆盖测试套件...");

	const rootDir = process.cwd();
	const enPath = path.join(rootDir, "l10n", "bundle.l10n.json");
	const zhPath = path.join(rootDir, "l10n", "bundle.l10n.zh-cn.json");

	assert.ok(fs.existsSync(enPath), "英文资源文件 bundle.l10n.json 必须存在");
	assert.ok(fs.existsSync(zhPath), "中文资源文件 bundle.l10n.zh-cn.json 必须存在");

	const enJson = JSON.parse(fs.readFileSync(enPath, "utf-8"));
	const zhJson = JSON.parse(fs.readFileSync(zhPath, "utf-8"));

	const enKeys = Object.keys(enJson).sort();
	const zhKeys = Object.keys(zhJson).sort();

	// 1. 验证中英文字典 Key 数量必须严格相等
	assert.strictEqual(
		enKeys.length,
		zhKeys.length,
		`中英文国际化词条总数必须完全对称！(英文: ${enKeys.length}, 中文: ${zhKeys.length})`,
	);

	// 2. 验证中英文字典 Key 逐项严格一致
	for (const key of enKeys) {
		assert.ok(
			Object.prototype.hasOwnProperty.call(zhJson, key),
			`中文国际化字典漏掉了词条: "${key}"`,
		);
		assert.ok(
			typeof zhJson[key] === "string" && zhJson[key].trim().length > 0,
			`中文国际化词条 "${key}" 的翻译内容不得为空`,
		);
	}

	for (const key of zhKeys) {
		assert.ok(
			Object.prototype.hasOwnProperty.call(enJson, key),
			`英文国际化字典漏掉了词条: "${key}"`,
		);
	}

	// 3. 扫描 src 目录中所有源码文件，提取 vscode.l10n.t("...") 调用点
	const srcDir = path.join(rootDir, "src");
	const tCallPattern = /vscode\.l10n\.t\(\s*(["'])(.+?)\1/g;
	const missingInDictionary = new Set();
	let scannedCount = 0;

	function scanDir(dir) {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				scanDir(full);
			} else if (entry.name.endsWith(".ts")) {
				scannedCount++;
				const content = fs.readFileSync(full, "utf-8");
				let match;
				while ((match = tCallPattern.exec(content)) !== null) {
					const term = match[2];
					// 过滤掉带动态插值的变量传入 (例如 vscode.l10n.t(someVar))
					if (term && !enJson[term]) {
						missingInDictionary.add(term);
					}
				}
			}
		}
	}

	scanDir(srcDir);

	assert.strictEqual(
		missingInDictionary.size,
		0,
		`发现源码中调用了 vscode.l10n.t，但未在国际化字典中定义的词条: ${JSON.stringify([...missingInDictionary])}`,
	);

	console.log(`  ✅ [i18n] 国际化套件验证通过！扫描了 ${scannedCount} 个源码文件，中英文 ${enKeys.length} 个词条 100% 双向对齐！`);
}

if (process.argv[1] && process.argv[1].endsWith("i18n.test.mjs")) {
	runI18nTests();
}
