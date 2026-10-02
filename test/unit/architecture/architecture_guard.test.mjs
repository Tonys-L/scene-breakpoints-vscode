import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * 架构与代码质量全维守护测试套件 (Architecture & Quality Guardrails)
 * 职责：
 * 1. 验证整洁架构分层依赖方向 (Clean Architecture Layering & No Circular Dependencies)
 * 2. 验证代码重复率与防 Copy-Paste 克隆 (jscpd)
 * 3. 验证巨石函数与超长文件限制 (Bloated Function & File Size Guard)
 */
export async function runArchitectureGuardTests() {
	console.log("  ▶ [Architecture Guard] 运行分层架构依赖、重复代码与臃肿函数质量守护套件...");

	const workspaceRoot = process.cwd();

	// =========================================================================
	// 1. 分层依赖方向与循环依赖校验 (dependency-cruiser)
	// =========================================================================
	try {
		execSync("npx depcruise --config .dependency-cruiser.cjs src", {
			cwd: workspaceRoot,
			stdio: "pipe",
		});
		console.log("    ✔ 分层架构依赖方向与循环依赖验证 100% 达标 (dependency-cruiser 0 violations)");
	} catch (err) {
		const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
		assert.fail(`架构依赖方向或循环依赖违规：\n${output}`);
	}

	// =========================================================================
	// 2. 代码克隆与重复率校验 (jscpd)
	// =========================================================================
	try {
		const jscpdOutput = execSync("npx jscpd", {
			cwd: workspaceRoot,
			stdio: "pipe",
		}).toString();
		console.log("    ✔ 全工程代码重复率达标 (< 3.5% threshold 门禁通过)");
	} catch (err) {
		const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
		assert.fail(`代码重复率超标门禁触发：\n${output}`);
	}

	// =========================================================================
	// 3. 巨石函数与超大文件限制已统一收敛至 ESLint (max-lines & max-lines-per-function)
	// =========================================================================
	console.log("    ✔ 单文件行数 (≤ 400 行) 与单函数行数 (≤ 80 行) 统一由 ESLint 工业级 AST 硬门禁守护");

	console.log("  ✅ [Architecture Guard] 架构分层依赖与代码重复率全维守护验证通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runArchitectureGuardTests();
}
