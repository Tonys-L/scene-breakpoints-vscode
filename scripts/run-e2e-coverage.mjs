import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const tempCoverageDir = path.resolve(rootDir, "coverage/tmp/e2e");

console.log("=======================================================");
console.log("🚀 开始执行 VS Code 真实宿主 E2E 沙箱测试代码覆盖率采集");
console.log("=======================================================\n");

// 1. 清理并初始化临时覆盖率快照目录
if (fs.existsSync(tempCoverageDir)) {
	fs.rmSync(tempCoverageDir, { recursive: true, force: true });
}
fs.mkdirSync(tempCoverageDir, { recursive: true });

// 2. 编译插件与测试套件 (包含 Source Map)
console.log("📦 构建包含 Source Map 的插件包与 E2E 运行时...");
execSync("npm run build && npm run build:test", {
	cwd: rootDir,
	stdio: "inherit",
});

// 3. 注入 NODE_V8_COVERAGE 运行 E2E 测试
console.log("\n🧪 启动真实宿主 Electron 沙箱并注入 V8 覆盖率引擎...");
try {
	execSync("node test-e2e/runTest.mjs", {
		cwd: rootDir,
		stdio: "inherit",
		env: {
			...process.env,
			NODE_V8_COVERAGE: tempCoverageDir,
		},
	});
} catch (err) {
	console.error("❌ E2E 测试运行未完全通过，退出码:", err.status);
	process.exit(err.status || 1);
}

// 4. 读取 V8 原始记录并结合 Source Map 逆向解析输出报告
console.log("\n📊 正在逆向推导 TypeScript 源码覆盖率并生成报表...");
execSync(
	`npx c8 report --temp-directory="${tempCoverageDir}" --include=src/** --reporter=text --reporter=html --reporter=lcov --reports-dir=coverage/e2e`,
	{
		cwd: rootDir,
		stdio: "inherit",
	},
);

console.log("\n🎉 E2E 宿主测试覆盖率报表已生成！明细查看: coverage/e2e/index.html");
