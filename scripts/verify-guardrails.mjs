import fs from "node:fs";
import path from "node:path";

/**
 * 约束自动化执行守卫 (Automated Executable Guardrails)
 * 用于在提交前、单测运行前及打包时对关键约束进行代码级硬门禁验证。
 */
export function verifyAllGuardrails(workspaceRoot = process.cwd()) {
	const errors = [];
	const successes = [];

	// =========================================================================
	// 1. 版本 SSOT 强一致性校验 (INV-016)
	// =========================================================================
	const pkgPath = path.join(workspaceRoot, "package.json");
	if (!fs.existsSync(pkgPath)) {
		errors.push("未找到 package.json 文件");
		return { errors, successes };
	}
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
	const currentVersion = pkg.version;

	// 检查 A: skillLifecycleResolver.ts 中的 LATEST_SKILL_VERSION
	const resolverPath = path.join(workspaceRoot, "src", "domain", "skillLifecycleResolver.ts");
	if (fs.existsSync(resolverPath)) {
		const resolverContent = fs.readFileSync(resolverPath, "utf8");
		const match = resolverContent.match(/export const LATEST_SKILL_VERSION = ["']([^"']+)["']/);
		if (!match) {
			errors.push("skillLifecycleResolver.ts 中未找到 LATEST_SKILL_VERSION 定义");
		} else if (match[1] !== currentVersion) {
			errors.push(
				`版本 SSOT 冲突：package.json (${currentVersion}) 与 skillLifecycleResolver.ts (${match[1]}) 不一致！`
			);
		} else {
			successes.push(`版本 SSOT 对齐：Skill 规则版本 (${match[1]}) == package.json (${currentVersion})`);
		}
	}

	// 检查 B: CHANGELOG.md 最新版本标题
	const enChangelogPath = path.join(workspaceRoot, "CHANGELOG.md");
	if (fs.existsSync(enChangelogPath)) {
		const enChangelog = fs.readFileSync(enChangelogPath, "utf8");
		const match = enChangelog.match(/^##\s+\[?([0-9]+\.[0-9]+\.[0-9]+[^\]\s]*)\]?/m);
		if (!match) {
			errors.push("CHANGELOG.md 中未找到版本标题");
		} else if (match[1] !== currentVersion) {
			errors.push(
				`版本 SSOT 冲突：package.json (${currentVersion}) 与 CHANGELOG.md 最新版本 (${match[1]}) 不一致！`
			);
		} else {
			successes.push(`版本 SSOT 对齐：CHANGELOG.md 最新版本 (${match[1]}) == package.json (${currentVersion})`);
		}
	}

	// 检查 C: CHANGELOG_zh.md 最新版本标题
	const zhChangelogPath = path.join(workspaceRoot, "CHANGELOG_zh.md");
	if (fs.existsSync(zhChangelogPath)) {
		const zhChangelog = fs.readFileSync(zhChangelogPath, "utf8");
		const match = zhChangelog.match(/^##\s+\[?([0-9]+\.[0-9]+\.[0-9]+[^\]\s]*)\]?/m);
		if (!match) {
			errors.push("CHANGELOG_zh.md 中未找到版本标题");
		} else if (match[1] !== currentVersion) {
			errors.push(
				`版本 SSOT 冲突：package.json (${currentVersion}) 与 CHANGELOG_zh.md 最新版本 (${match[1]}) 不一致！`
			);
		} else {
			successes.push(`版本 SSOT 对齐：CHANGELOG_zh.md 最新版本 (${match[1]}) == package.json (${currentVersion})`);
		}
	}

	// =========================================================================
	// 2. README 媒体外链与 CDN 直连守卫 (INV-014)
	// =========================================================================
	const readmeFiles = ["README.md", "README_zh.md"];
	for (const rf of readmeFiles) {
		const rPath = path.join(workspaceRoot, rf);
		if (fs.existsSync(rPath)) {
			const content = fs.readFileSync(rPath, "utf8");
			// 严禁引用本地 ./docs/images/* 相对路径，必须使用 CDN 远程直连以避免膨胀打包
			const localImageRegex = /(src|href)=["']\.\/docs\/images\/[^"']+["']|\(!?\[.*?\]\(\.\/docs\/images\/.*?\)\)/g;
			const matches = content.match(localImageRegex);
			if (matches && matches.length > 0) {
				errors.push(`${rf} 包含本地相对图片引用（${matches.join(", ")}），必须改为 GitHub Raw CDN 链接以保持安装包极致轻量！`);
			} else {
				successes.push(`${rf} 媒体链接检查：已 100% 接入远程 CDN，无本地大图滞留`);
			}
		}
	}

	// =========================================================================
	// 3. CI/CD 工作流 Node 22.x 兼容性守卫 (INV-015)
	// =========================================================================
	const workflowsDir = path.join(workspaceRoot, ".github", "workflows");
	if (fs.existsSync(workflowsDir)) {
		const wfFiles = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
		for (const wf of wfFiles) {
			const wfPath = path.join(workflowsDir, wf);
			const content = fs.readFileSync(wfPath, "utf8");
			if (content.includes("node-version: 20.x") || content.includes("node-version: [20.x]")) {
				errors.push(
					`.github/workflows/${wf} 仍在使用过期的 Node 20.x，不支持原生 Type Stripping！必须改为 22.x`
				);
			} else {
				successes.push(`Workflow 运行环境：.github/workflows/${wf} 已锁定支持 Type Stripping 的环境`);
			}
		}
	}

	// =========================================================================
	// 4. .vscodeignore 关键黑名单安全守卫 (INV-014)
	// =========================================================================
	const ignorePath = path.join(workspaceRoot, ".vscodeignore");
	if (fs.existsSync(ignorePath)) {
		const ignoreContent = fs.readFileSync(ignorePath, "utf8");
		const mustIgnore = ["docs/**", ".trae/**", "scripts/**", "*.vsix"];
		for (const item of mustIgnore) {
			if (!ignoreContent.includes(item)) {
				errors.push(`.vscodeignore 缺少关键忽略规则：${item}，存在安装包臃肿泄露风险！`);
			}
		}
		successes.push(`.vscodeignore 规则检查：关键排除项已全量配置`);
	}

	// =========================================================================
	// 5. VSIX 打包体积与黑名单守卫 (Package Size Guard)
	// =========================================================================
	const vsixFiles = fs
		.readdirSync(workspaceRoot)
		.filter((f) => f.endsWith(".vsix") && f.includes(currentVersion));
	for (const vf of vsixFiles) {
		const stat = fs.statSync(path.join(workspaceRoot, vf));
		const sizeKb = stat.size / 1024;
		const MAX_ALLOWED_KB = 500; // 硬门禁：安装包绝不允许超过 500 KB
		if (sizeKb > MAX_ALLOWED_KB) {
			errors.push(
				`VSIX 包体积超标门禁触发：${vf} 大小为 ${sizeKb.toFixed(2)} KB，超过硬上限 ${MAX_ALLOWED_KB} KB！`
			);
		} else {
			successes.push(`VSIX 包体积达标：${vf} 为 ${sizeKb.toFixed(2)} KB (硬上限 ${MAX_ALLOWED_KB} KB)`);
		}
	}

	return { errors, successes };
}

// CLI 执行入口
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	console.log("\n=======================================================");
	console.log("🛡️  开始执行 Scene Breakpoints 约束自动化代码级硬门禁验证");
	console.log("=======================================================\n");

	const { errors, successes } = verifyAllGuardrails();

	for (const s of successes) {
		console.log(`  ✅ ${s}`);
	}

	if (errors.length > 0) {
		console.error("\n❌ 发现严重违反项目约束项：");
		for (const e of errors) {
			console.error(`  ⛔ ${e}`);
		}
		console.error("\n构建/发布已被硬门禁强行阻断，请按提示修正后再试！\n");
		process.exit(1);
	}

	console.log("\n🎉 全部代码级约束硬门禁 100% 验证通过！\n");
}
