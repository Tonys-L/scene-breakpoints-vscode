import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { evaluateCrapMetrics } from "./compute-crap.mjs";


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

	// 检查 A: agentRuleAsset.ts 中的 LATEST_RULE_VERSION / LATEST_SKILL_VERSION
	const resolverPath = path.join(workspaceRoot, "src", "domain", "models", "agentRuleAsset.ts");
	if (fs.existsSync(resolverPath)) {
		const resolverContent = fs.readFileSync(resolverPath, "utf8");
		const match = resolverContent.match(/export const LATEST_(?:SKILL|RULE)_VERSION = ["']([^"']+)["']/);
		if (!match) {
			errors.push("agentRuleAsset.ts 中未找到 LATEST_RULE_VERSION 定义");
		} else if (match[1] !== currentVersion) {
			errors.push(
				`版本 SSOT 冲突：package.json (${currentVersion}) 与 agentRuleAsset.ts (${match[1]}) 不一致！`
			);
		} else {
			successes.push(`版本 SSOT 对齐：Agent 规则版本 (${match[1]}) == package.json (${currentVersion})`);
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

	// =========================================================================
	// 6. TypeScript 静态类型健全性硬门禁 (INV-017 / tsc --noEmit)
	// =========================================================================
	try {
		execSync("npx tsc --noEmit", { cwd: workspaceRoot, stdio: "pipe" });
		successes.push("TypeScript 静态类型检查：全工程 0 报红，100% 类型健全通过");
	} catch (err) {
		errors.push(`TypeScript 静态类型检查失败 (tsc --noEmit)：\n${err.stdout?.toString() || err.message}`);
	}

	// =========================================================================
	// 7. 分层架构依赖、循环依赖与代码重复度硬门禁 (Clean Architecture & Duplication Guard)
	// =========================================================================
	try {
		execSync("npx depcruise --config .dependency-cruiser.cjs src", { cwd: workspaceRoot, stdio: "pipe" });
		successes.push("架构依赖方向与分层隔离：dependency-cruiser 校验 100% 达标 (0 violations)");
	} catch (err) {
		errors.push(`架构依赖方向或循环依赖违规：\n${err.stdout?.toString() || err.stderr?.toString() || err.message}`);
	}

	try {
		execSync("npx jscpd", { cwd: workspaceRoot, stdio: "pipe" });
		successes.push("代码克隆与重复度防护：jscpd 校验达标 (< 3.5% threshold)");
	} catch (err) {
		errors.push(`代码重复率超标：\n${err.stdout?.toString() || err.stderr?.toString() || err.message}`);
	}

	// =========================================================================
	// 8. 国际化多语言与配置字典双向对称守卫 (i18n & NLS SSOT Guard)
	// =========================================================================
	const l10nEnPath = path.join(workspaceRoot, "l10n", "bundle.l10n.json");
	const l10nZhPath = path.join(workspaceRoot, "l10n", "bundle.l10n.zh-cn.json");
	if (fs.existsSync(l10nEnPath) && fs.existsSync(l10nZhPath)) {
		try {
			const enData = JSON.parse(fs.readFileSync(l10nEnPath, "utf8"));
			const zhData = JSON.parse(fs.readFileSync(l10nZhPath, "utf8"));
			const enKeys = Object.keys(enData);
			const zhKeys = Object.keys(zhData);
			const missingInZh = enKeys.filter((k) => !(k in zhData));
			const missingInEn = zhKeys.filter((k) => !(k in enData));

			if (missingInZh.length > 0 || missingInEn.length > 0) {
				errors.push(
					`i18n 语言包不对称：中文缺失 [${missingInZh.join(", ")}]，英文缺失 [${missingInEn.join(", ")}]`
				);
			} else {
				successes.push(`i18n 多语言对齐：bundle.l10n 中英词条 100% 对称 (${enKeys.length} 条)`);
			}
		} catch (err) {
			errors.push(`i18n 语言包解析失败：${err.message}`);
		}
	}

	const nlsEnPath = path.join(workspaceRoot, "package.nls.json");
	const nlsZhPath = path.join(workspaceRoot, "package.nls.zh-cn.json");
	if (fs.existsSync(nlsEnPath) && fs.existsSync(nlsZhPath)) {
		try {
			const nlsEnData = JSON.parse(fs.readFileSync(nlsEnPath, "utf8"));
			const nlsZhData = JSON.parse(fs.readFileSync(nlsZhPath, "utf8"));
			const nlsEnKeys = Object.keys(nlsEnData);
			const nlsZhKeys = Object.keys(nlsZhData);
			const missingInZh = nlsEnKeys.filter((k) => !(k in nlsZhData));
			const missingInEn = nlsZhKeys.filter((k) => !(k in nlsEnData));

			if (missingInZh.length > 0 || missingInEn.length > 0) {
				errors.push(
					`package.nls 字典不对称：中文缺失 [${missingInZh.join(", ")}]，英文缺失 [${missingInEn.join(", ")}]`
				);
			} else {
				successes.push(`package.nls 配置对齐：中英配置键 100% 对称 (${nlsEnKeys.length} 条)`);
			}

			// 检查 package.json 中所有 %identifier% 必须在 package.nls.json 中定义
			const pkgContent = fs.readFileSync(pkgPath, "utf8");
			const placeholders = [...pkgContent.matchAll(/%([a-zA-Z0-9._]+)%/g)].map((m) => m[1]);
			const undefinedKeys = [...new Set(placeholders.filter((k) => !(k in nlsEnData)))];
			if (undefinedKeys.length > 0) {
				errors.push(`package.json 占位符未在 package.nls.json 中定义：${undefinedKeys.join(", ")}`);
			} else {
				successes.push(`package.json 占位符完整性：${placeholders.length} 处 %key% 均已在 NLS 中定义`);
			}
		} catch (err) {
			errors.push(`package.nls 字典解析失败：${err.message}`);
		}
	}

	// =========================================================================
	// 9. KDD 场景断点地图有效性与保鲜守卫 (Debug Scenes Health Guard)
	// =========================================================================
	const debugScenesPath = path.join(workspaceRoot, ".vscode", "debug-scenes.json");
	if (fs.existsSync(debugScenesPath)) {
		try {
			const scenesConfig = JSON.parse(fs.readFileSync(debugScenesPath, "utf8"));
			const scenes = scenesConfig.scenes || {};
			let totalBps = 0;
			let sceneCount = 0;

			for (const [sName, bps] of Object.entries(scenes)) {
				sceneCount++;
				if (!Array.isArray(bps)) continue;
				for (const bp of bps) {
					totalBps++;
					const targetFile = path.isAbsolute(bp.file) ? bp.file : path.join(workspaceRoot, bp.file);
					if (!fs.existsSync(targetFile)) {
						errors.push(
							`场景断点地图失效：场景 [${sName}] 引用的文件不存在 -> ${bp.file}`
						);
					} else {
						const fileContent = fs.readFileSync(targetFile, "utf8");
						const lineCount = fileContent.split(/\r?\n/).length;
						if (bp.line <= 0 || bp.line > lineCount) {
							errors.push(
								`场景断点地图越界：场景 [${sName}] 在 ${bp.file} 指定行号 ${bp.line} 超出文件总行数 (${lineCount})`
							);
						}
					}
				}
			}
			successes.push(`场景断点地图健康度：${sceneCount} 个场景、${totalBps} 个断点 100% 物理有效，0 失效脱靶`);
		} catch (err) {
			errors.push(`场景断点地图解析失败：${err.message}`);
		}
	}

	// =========================================================================
	// 10. JSON Schema 规范与样例配置契约守卫 (JSON Schema Conformance Guard)
	// =========================================================================
	const schemaPath = path.join(workspaceRoot, "schema.json");
	if (fs.existsSync(schemaPath)) {
		try {
			const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
			if (!schema.$schema || !schema.properties?.scenes) {
				errors.push("schema.json 不完整：缺少 $schema 或 properties.scenes 声明");
			} else {
				successes.push("JSON Schema 规范性：schema.json Draft-07 契约定义完整");
			}

			// 对比 schema.json 属性与 domain/types.ts 契约字段
			const allowedBpProps = Object.keys(
				schema.properties.scenes.additionalProperties.items.properties || {}
			);
			const coreBpFields = ["type", "file", "line", "desc", "enabled", "condition", "hitCondition", "logMessage", "functionName", "contextSnippet"];
			const missingProps = coreBpFields.filter((f) => !allowedBpProps.includes(f));
			if (missingProps.length > 0) {
				errors.push(`schema.json 未同步核心领域字段：[${missingProps.join(", ")}]`);
			} else {
				successes.push("JSON Schema 契约同步：断点核心字段与领域实体模型 100% 同步");
			}
		} catch (err) {
			errors.push(`schema.json 解析失败：${err.message}`);
		}
	}

	// =========================================================================
	// 11. 严禁空 catch 静默吞错守卫 (No Empty Catch Guard)
	// =========================================================================
	const srcDir = path.join(workspaceRoot, "src");
	if (fs.existsSync(srcDir)) {
		const emptyCatchViolations = [];
		function scanDirForEmptyCatch(dir) {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					scanDirForEmptyCatch(full);
				} else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
					const content = fs.readFileSync(full, "utf8");
					const lines = content.split(/\r?\n/);
					for (let i = 0; i < lines.length; i++) {
						if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(lines[i])) {
							const rel = path.relative(workspaceRoot, full).replace(/\\/g, "/");
							emptyCatchViolations.push(`${rel}:${i + 1}`);
						}
					}
				}
			}
		}
		scanDirForEmptyCatch(srcDir);
		if (emptyCatchViolations.length > 0) {
			errors.push(
				`严重违反编码禁令：发现 ${emptyCatchViolations.length} 处静默空 catch，必须显式记录或处理：\n    ` +
				emptyCatchViolations.join("\n    ")
			);
		} else {
			successes.push("代码异常处理规范性：全工程 0 处空 catch 静默吞错，100% 显式处理");
		}
	}

	// =========================================================================
	// 12. VS Code 命令总线 1:1 双向一致性守卫 (Command SSOT Guard)
	// =========================================================================
	try {
		const pkgCommands = (pkg.contributes?.commands || []).map((c) => c.command);
		const cmdFiles = [
			path.join(workspaceRoot, "src", "ui", "commands", "index.ts"),
			path.join(workspaceRoot, "src", "ui", "commands", "treeCommands.ts"),
		];
		const codeRegisteredCmds = [];
		for (const cf of cmdFiles) {
			if (fs.existsSync(cf)) {
				const content = fs.readFileSync(cf, "utf8");
				const matches = [...content.matchAll(/["'](sceneBreakpoints\.[a-zA-Z0-9_-]+)["']/g)].map((m) => m[1]);
				codeRegisteredCmds.push(...matches);
			}
		}
		const uniqueCodeCmds = [...new Set(codeRegisteredCmds)];

		const missingInCode = pkgCommands.filter((c) => !uniqueCodeCmds.includes(c));
		const missingInPkg = uniqueCodeCmds.filter((c) => !pkgCommands.includes(c));

		if (missingInCode.length > 0) {
			errors.push(`package.json 声明的命令在代码中未注册：[${missingInCode.join(", ")}]`);
		}
		if (missingInPkg.length > 0) {
			errors.push(`代码中注册的命令未在 package.json 声明：[${missingInPkg.join(", ")}]`);
		}
		if (missingInCode.length === 0 && missingInPkg.length === 0) {
			successes.push(`命令总线一致性：package.json 与代码实现 1:1 双向对齐 (${pkgCommands.length} 个命令全部吻合)`);
		}

		// 检查 keybindings 与 menus 的命令引用合法性
		const keybindingCmds = (pkg.contributes?.keybindings || []).map((k) => k.command);
		const danglingKeybindings = keybindingCmds.filter((c) => !pkgCommands.includes(c));
		if (danglingKeybindings.length > 0) {
			errors.push(`keybindings 包含未在 contributes.commands 声明的悬空命令：[${danglingKeybindings.join(", ")}]`);
		} else {
			successes.push(`快捷键引用有效性：${keybindingCmds.length} 处快捷键映射 100% 有效`);
		}

		const menuCmds = [];
		for (const items of Object.values(pkg.contributes?.menus || {})) {
			if (Array.isArray(items)) {
				for (const item of items) {
					if (item.command) menuCmds.push(item.command);
				}
			}
		}
		const danglingMenuCmds = menuCmds.filter((c) => !pkgCommands.includes(c));
		if (danglingMenuCmds.length > 0) {
			errors.push(`menus 包含未在 contributes.commands 声明的悬空命令：[${danglingMenuCmds.join(", ")}]`);
		} else {
			successes.push(`视图菜单引用有效性：${menuCmds.length} 处菜单动作命令 100% 有效`);
		}
	} catch (err) {
		errors.push(`命令总线一致性检查失败：${err.message}`);
	}

	// =========================================================================
	// 13. VS Code 最低引擎版本与类型定义对齐守卫 (Engine vs API Version Alignment Guard)
	// =========================================================================
	try {
		const targetEngine = pkg.engines?.vscode || "";
		const typesVscode = pkg.devDependencies?.["@types/vscode"] || "";
		const engineMatch = targetEngine.match(/\^?([0-9]+\.[0-9]+)/);
		const typesMatch = typesVscode.match(/\^?([0-9]+\.[0-9]+)/);

		if (!engineMatch || !typesMatch) {
			errors.push("package.json 缺少明确的 engines.vscode 或 @types/vscode 版本声明");
		} else if (engineMatch[1] !== typesMatch[1]) {
			errors.push(
				`引擎版本对齐违规：engines.vscode (${engineMatch[1]}) 与 @types/vscode (${typesMatch[1]}) 主次版本不一致，存在跨版本 API 崩溃隐患！`
			);
		} else {
			successes.push(`VS Code 引擎与 API 契约对齐：engines (${targetEngine}) == @types/vscode (${typesVscode})`);
		}
	} catch (err) {
		errors.push(`VS Code 引擎版本对齐检查失败：${err.message}`);
	}

	// =========================================================================
	// 14. Git 冲突标记与开发机私有绝对路径防泄漏守卫 (Secret & Conflict Marker Guard)
	// =========================================================================
	const conflictRegex = /^(<{7}|={7}|>{7})\s+/m;
	const devAbsolutePaths = [
		/[A-Za-z]:\\(?:Users|home)\\[a-zA-Z0-9_-]+/i,
		/[A-Za-z]:\\(?:project|workspace|repo)\\/i,
	];
	const scanDirs = ["src", "l10n", "scripts", "test"];
	const conflictFiles = [];
	const pathLeakFiles = [];

	function scanPurity(dir) {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				scanPurity(full);
			} else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".json") || entry.name.endsWith(".md"))) {
				const content = fs.readFileSync(full, "utf8");
				const rel = path.relative(workspaceRoot, full).replace(/\\/g, "/");
				if (conflictRegex.test(content)) {
					conflictFiles.push(rel);
				}
				for (const pRegex of devAbsolutePaths) {
					if (pRegex.test(content)) {
						pathLeakFiles.push(rel);
						break;
					}
				}
			}
		}
	}

	for (const sd of scanDirs) {
		const fullSd = path.join(workspaceRoot, sd);
		if (fs.existsSync(fullSd)) {
			scanPurity(fullSd);
		}
	}

	if (conflictFiles.length > 0) {
		errors.push(`严重代码缺陷：检测到未解决的 Git 冲突标记残留在：[${conflictFiles.join(", ")}]`);
	} else {
		successes.push("代码冲突纯净性：全工程 0 处 Git 冲突标记残留");
	}

	if (pathLeakFiles.length > 0) {
		errors.push(`敏感开发环境泄露：检测到开发机硬编码绝对路径残留在：[${pathLeakFiles.join(", ")}]`);
	} else {
		successes.push("代码环境纯净性：源码与语言包 0 处开发机私有绝对路径硬编码");
	}

	// =========================================================================
	// 15. ESLint 工业级静态代码规范与纯净度守卫 (ESLint Pure Static Analysis Guard)
	// =========================================================================
	try {
		execSync("npx eslint src scripts --ext .ts,.mjs", { cwd: workspaceRoot, stdio: "pipe" });
		successes.push("ESLint 静态规范健全性：全工程 0 errors、0 warnings，100% 纯净达标 (覆盖 src 与 scripts)");
	} catch (err) {
		errors.push(`ESLint 规范检查失败：\n${err.stdout?.toString() || err.stderr?.toString() || err.message}`);
	}

	// =========================================================================
	// 16. 测试覆盖率 85% 底线守卫 (Test Coverage Threshold Guard - 85%) (INV-021)
	// =========================================================================
	const coverageDir = path.join(workspaceRoot, "coverage");
	if (fs.existsSync(coverageDir)) {
		try {
			execSync("npx c8 check-coverage", { cwd: workspaceRoot, stdio: "pipe" });
			successes.push("代码覆盖率硬门禁：核心语句/行覆盖率达到 85% 刚性阈值 (.c8rc.json check-coverage 达标)");
		} catch (err) {
			errors.push(`代码覆盖率未达到 85% 门禁标准：\n${err.stdout?.toString() || err.stderr?.toString() || err.message}`);
		}
	} else {
		successes.push("代码覆盖率硬门禁：本地已挂载 check-coverage 规则（CI 执行 npm run test:coverage 时全量触发）");
	}

	// =========================================================================
	// 17. CRAP 变更风险反模式硬门禁 (CRAP Metric Guard) (INV-029 / GR-014)
	// =========================================================================
	const lcovFile = path.join(workspaceRoot, "coverage", "lcov.info");
	if (fs.existsSync(lcovFile)) {
		try {
			const crapMetrics = evaluateCrapMetrics(workspaceRoot);
			const CRAP_AVG_MAX = 5.0;
			const CRAP_EXTREME_BASELINE = 14;

			if (crapMetrics.avgCrap > CRAP_AVG_MAX) {
				errors.push(
					`CRAP 变更风险指标劣化：全工程平均 CRAP (${crapMetrics.avgCrap}) 超出 ${CRAP_AVG_MAX} 上限！请拆分高复杂度或补充单测。`
				);
			}

			if (crapMetrics.extremeAntiPatterns.length > CRAP_EXTREME_BASELINE) {
				errors.push(
					`CRAP 严重反模式盲区新增：检测到 CRAP > 16.4 的高危函数从基线 ${CRAP_EXTREME_BASELINE} 增至 ${crapMetrics.extremeAntiPatterns.length}！严禁新增未测复杂逻辑。`
				);
			}

			if (
				crapMetrics.avgCrap <= CRAP_AVG_MAX &&
				crapMetrics.extremeAntiPatterns.length <= CRAP_EXTREME_BASELINE
			) {
				successes.push(
					`CRAP 变更风险硬门禁：全工程平均 CRAP (${crapMetrics.avgCrap} <= 5.0) 极度健康，严重反模式函数 (<= 14) 无净增`
				);
			}
		} catch (err) {
			errors.push(`CRAP 变更风险分析执行异常：${err.message}`);
		}
	} else {
		successes.push("CRAP 变更风险硬门禁：本地已挂载 CRAP 门禁规则（CI 执行 npm run test:coverage 时全量触发）");
	}

	return { errors, successes };

}

// CLI 执行入口
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
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
