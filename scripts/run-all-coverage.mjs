import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const tempCoverageDir = path.resolve(rootDir, "coverage/tmp/all");

console.log("=======================================================");
console.log("🌟 开始执行 全量测试 (单测 + 真实宿主 E2E) 统一覆盖率汇总测量");
console.log("=======================================================\n");

// 1. 初始化统一临时目录
if (fs.existsSync(tempCoverageDir)) {
	fs.rmSync(tempCoverageDir, { recursive: true, force: true });
}
fs.mkdirSync(tempCoverageDir, { recursive: true });

// 2. 运行单测并注入统一快照目录
console.log("▶ [阶段 1/2] 运行全量 23 大单元测试套件...");
execSync(
	`npx c8 --temp-directory="${tempCoverageDir}" --clean=false --include=src/** node --experimental-transform-types --import ./test/register.mjs test/run-all.mjs`,
	{
		cwd: rootDir,
		stdio: "inherit",
	},
);

// 3. 构建并运行 E2E 测试并注入相同快照目录
console.log("\n▶ [阶段 2/2] 构建并运行全量 49 个真实宿主 E2E 沙箱测试...");
execSync("npm run build && npm run build:test", {
	cwd: rootDir,
	stdio: "inherit",
});

execSync("node test-e2e/runTest.mjs", {
	cwd: rootDir,
	stdio: "inherit",
	env: {
		...process.env,
		NODE_V8_COVERAGE: tempCoverageDir,
	},
});

// 4. 读取全量快照进行数据归并与综合报表生成
console.log("\n=======================================================");
console.log("📊 正在归并 [单测 + E2E] 双层执行数据并计算全局代码覆盖率...");
console.log("=======================================================\n");

execSync(
	`npx c8 report --temp-directory="${tempCoverageDir}" --reporter=text --reporter=html --reporter=lcov --reports-dir=coverage/all`,
	{
		cwd: rootDir,
		stdio: "inherit",
	},
);

console.log("\n🎉 全量测试综合覆盖率报表已生成！");
console.log("  📁 可视化网页报告: coverage/all/index.html");
console.log("  📄 LCOV 映射数据:  coverage/all/lcov.info (可直接供 Coverage Gutters 插件在编辑器中展示)");
