import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const require = createRequire(path.join(projectRoot, "package.json"));
const ts = require("typescript");

// ANSI Terminal Colors
export const C = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	bgRed: "\x1b[41m",
	bgYellow: "\x1b[43m",
};

// McCabe Cyclomatic Complexity Calculator (AST)
export function calculateCyclomaticComplexity(node) {
	let complexity = 1;

	function walk(n) {
		switch (n.kind) {
			case ts.SyntaxKind.IfStatement:
			case ts.SyntaxKind.WhileStatement:
			case ts.SyntaxKind.DoStatement:
			case ts.SyntaxKind.ForStatement:
			case ts.SyntaxKind.ForInStatement:
			case ts.SyntaxKind.ForOfStatement:
			case ts.SyntaxKind.CaseClause:
			case ts.SyntaxKind.CatchClause:
			case ts.SyntaxKind.ConditionalExpression:
				complexity++;
				break;
			case ts.SyntaxKind.BinaryExpression:
				if (
					n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
					n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
					n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
				) {
					complexity++;
				}
				break;
		}

		// Don't recurse into nested sub-function scopes
		if (
			n !== node &&
			(ts.isFunctionDeclaration(n) ||
				ts.isMethodDeclaration(n) ||
				ts.isFunctionExpression(n) ||
				ts.isArrowFunction(n) ||
				ts.isConstructorDeclaration(n) ||
				ts.isGetAccessorDeclaration(n) ||
				ts.isSetAccessorDeclaration(n))
		) {
			return;
		}

		ts.forEachChild(n, walk);
	}

	walk(node);
	return complexity;
}

export function getFunctionName(node, sourceFile) {
	if (node.name && ts.isIdentifier(node.name)) {
		return node.name.text;
	}
	if (ts.isConstructorDeclaration(node)) {
		return "constructor";
	}
	if (ts.isGetAccessor(node)) {
		return `get ${node.name?.getText(sourceFile) || "unknown"}`;
	}
	if (ts.isSetAccessor(node)) {
		return `set ${node.name?.getText(sourceFile) || "unknown"}`;
	}
	if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
		return node.parent.name.text;
	}
	if (ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name)) {
		return node.parent.name.text;
	}
	if (ts.isPropertyDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
		return node.parent.name.text;
	}
	return "<anonymous>";
}

function getAllTsFiles(dir) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...getAllTsFiles(full));
		} else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
			files.push(full);
		}
	}
	return files;
}

/**
 * 纯逻辑评测入口：用于 verify-guardrails 门禁及 CLI 报表
 */
export function evaluateCrapMetrics(workspaceRoot = projectRoot, options = {}) {
	const {
		warningThreshold = 6.0,
		criticalThreshold = 10.0,
		autoRunTests = false,
	} = options;

	const lcovPath = path.join(workspaceRoot, "coverage", "lcov.info");
	if (autoRunTests || !fs.existsSync(lcovPath)) {
		execSync("npm run test:coverage", { cwd: workspaceRoot, stdio: "pipe" });
	}

	if (!fs.existsSync(lcovPath)) {
		throw new Error("未找到 coverage/lcov.info，请先运行 npm run test:coverage");
	}

	const lcovContent = fs.readFileSync(lcovPath, "utf-8");
	const fileLineHits = new Map();
	let currentFileHits = null;

	for (const line of lcovContent.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("SF:")) {
			const rawPath = trimmed.slice(3).replace(/\\/g, "/").toLowerCase();
			currentFileHits = new Map();
			fileLineHits.set(rawPath, currentFileHits);
		} else if (trimmed.startsWith("DA:") && currentFileHits) {
			const [lineNumStr, hitsStr] = trimmed.slice(3).split(",");
			currentFileHits.set(parseInt(lineNumStr, 10), parseInt(hitsStr, 10));
		}
	}

	const srcDir = path.join(workspaceRoot, "src");
	const tsFiles = getAllTsFiles(srcDir);
	const allFunctions = [];

	for (const filePath of tsFiles) {
		const content = fs.readFileSync(filePath, "utf-8");
		const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
		const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
		const relPathLower = relPath.toLowerCase();
		const lineHits = fileLineHits.get(relPathLower) || new Map();

		function visit(node) {
			if (
				ts.isFunctionDeclaration(node) ||
				ts.isMethodDeclaration(node) ||
				ts.isFunctionExpression(node) ||
				ts.isArrowFunction(node) ||
				ts.isConstructorDeclaration(node) ||
				ts.isGetAccessorDeclaration(node) ||
				ts.isSetAccessorDeclaration(node)
			) {
				if (node.body) {
					const name = getFunctionName(node, sourceFile);
					const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
					const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
					const startLine1 = startLine + 1;
					const endLine1 = endLine + 1;

					const comp = calculateCyclomaticComplexity(node);

					let executableLines = 0;
					let coveredLines = 0;
					for (let l = startLine1; l <= endLine1; l++) {
						if (lineHits.has(l)) {
							executableLines++;
							if (lineHits.get(l) > 0) {
								coveredLines++;
							}
						}
					}

					const cov = executableLines > 0 ? (coveredLines / executableLines) * 100 : 100;
					const crap = Math.pow(comp, 2) * Math.pow(1 - cov / 100, 3) + comp;

					allFunctions.push({
						file: relPath,
						name,
						line: startLine1,
						endLine: endLine1,
						comp,
						cov: Math.round(cov * 10) / 10,
						executableLines,
						coveredLines,
						crap: Math.round(crap * 100) / 100,
					});
				}
			}
			ts.forEachChild(node, visit);
		}

		visit(sourceFile);
	}

	allFunctions.sort((a, b) => b.crap - a.crap);

	const totalFunctions = allFunctions.length;
	const totalComp = allFunctions.reduce((acc, f) => acc + f.comp, 0);
	const avgComp = Number((totalComp / totalFunctions).toFixed(2));
	const totalCrap = allFunctions.reduce((acc, f) => acc + f.crap, 0);
	const avgCrap = Number((totalCrap / totalFunctions).toFixed(2));

	const criticalFunctions = allFunctions.filter((f) => f.crap > criticalThreshold);
	const warningFunctions = allFunctions.filter(
		(f) => f.crap > warningThreshold && f.crap <= criticalThreshold
	);
	const extremeAntiPatterns = allFunctions.filter((f) => f.crap > 16.4);

	return {
		totalFunctions,
		avgComp,
		avgCrap,
		warningThreshold,
		criticalThreshold,
		warningFunctions,
		criticalFunctions,
		extremeAntiPatterns,
		allFunctions,
	};
}

// 7. CLI Execution & Rendering
function runCli() {
	const args = process.argv.slice(2);
	let warningThreshold = 6.0;
	let criticalThreshold = 10.0;
	let topCount = 15;
	let autoRunTests = false;

	for (const arg of args) {
		if (arg === "--strict") {
			warningThreshold = 4.0;
			criticalThreshold = 8.0;
		} else if (arg.startsWith("--threshold=")) {
			warningThreshold = parseFloat(arg.split("=")[1]) || warningThreshold;
		} else if (arg.startsWith("--critical=")) {
			criticalThreshold = parseFloat(arg.split("=")[1]) || criticalThreshold;
		} else if (arg.startsWith("--top=")) {
			topCount = parseInt(arg.split("=")[1], 10) || topCount;
		} else if (arg === "--run-tests") {
			autoRunTests = true;
		}
	}

	const lcovPath = path.join(projectRoot, "coverage", "lcov.info");
	if (autoRunTests || !fs.existsSync(lcovPath)) {
		console.log(`${C.cyan}ℹ 正在运行测试套件以采集最新覆盖率数据 (npm run test:coverage)...${C.reset}`);
		execSync("npm run test:coverage", { cwd: projectRoot, stdio: "inherit" });
	}

	const metrics = evaluateCrapMetrics(projectRoot, {
		warningThreshold,
		criticalThreshold,
	});

	const {
		totalFunctions,
		avgComp,
		avgCrap,
		warningFunctions,
		criticalFunctions,
		allFunctions,
	} = metrics;

	console.log(`\n${C.bold}========================================================================${C.reset}`);
	console.log(`${C.bold}          CRAP (Change Risk Anti-Patterns) 代码健康度仪表盘            ${C.reset}`);
	console.log(`${C.bold}========================================================================${C.reset}\n`);

	console.log(`${C.bold}【全工程宏观指标】${C.reset}`);
	console.log(`  • 扫描函数总数       : ${C.bold}${totalFunctions}${C.reset} 个`);
	console.log(`  • 平均圈复杂度 (comp): ${C.green}${C.bold}${avgComp}${C.reset}  (Clean Code 推荐 <= 10)`);
	console.log(`  • 平均 CRAP 评分     : ${C.green}${C.bold}${avgCrap}${C.reset}  (业界警戒线 16.4，本项目标准 6.0/10.0)`);
	console.log(
		`  • 🟢 健康合格率 (<= ${warningThreshold})  : ${C.green}${C.bold}${(
			((totalFunctions - warningFunctions.length - criticalFunctions.length) / totalFunctions) *
			100
		).toFixed(1)}%${C.reset}`
	);
	console.log(
		`  • 🟡 关注预警数 (>${warningThreshold} & <=${criticalThreshold}) : ${warningFunctions.length > 0 ? C.yellow : C.green}${C.bold}${warningFunctions.length}${C.reset} 个 (${((warningFunctions.length / totalFunctions) * 100).toFixed(1)}%)`
	);
	console.log(
		`  • 🔴 高危告警数 (>${criticalThreshold})        : ${criticalFunctions.length > 0 ? C.red : C.green}${C.bold}${criticalFunctions.length}${C.reset} 个 (${((criticalFunctions.length / totalFunctions) * 100).toFixed(1)}%)\n`
	);

	console.log(`${C.bold}【CRAP 7级金字塔分布直方图】${C.reset}`);
	const buckets = [
		{ label: "CRAP <= 2.0 (极致轻量 / 顺序执行 / 单行属性)", max: 2, color: C.green },
		{ label: "2.0 < CRAP <= 4.0 (高健康区间 / 1~3分支且全覆盖)", max: 4, color: C.green },
		{ label: "4.0 < CRAP <= 6.0 (中等分支 / 4~5条件且全覆盖)", max: 6, color: C.cyan },
		{ label: "6.0 < CRAP <= 8.0 (算法核心 / 较高逻辑且全覆盖)", max: 8, color: C.blue },
		{ label: "8.0 < CRAP <= 10.0 (复杂算法 或 存在小覆盖盲区)", max: 10, color: C.yellow },
		{ label: "10.0 < CRAP <= 16.4 (高危边界 / 待重构或待补测)", max: 16.4, color: C.yellow },
		{ label: "CRAP > 16.4 (严重反模式 / 盲盒未测高危函数)", max: Infinity, color: C.red },
	];

	for (const b of buckets) {
		b.count = 0;
	}
	for (const f of allFunctions) {
		for (const b of buckets) {
			if (f.crap <= b.max) {
				b.count++;
				break;
			}
		}
	}

	for (const b of buckets) {
		const pct = ((b.count / totalFunctions) * 100).toFixed(1);
		const barLen = Math.round(b.count / 10);
		const bar = "█".repeat(barLen);
		console.log(
			`  ${b.color}${b.label.padEnd(46)}: ${String(b.count).padStart(3)} (${pct.padStart(5)}%) ${bar}${C.reset}`
		);
	}

	console.log(`\n${C.bold}【分层架构健康度透视 (Clean Architecture)】${C.reset}`);
	const layerStats = {};
	for (const f of allFunctions) {
		const parts = f.file.split("/");
		const layer = parts.length > 2 ? `${parts[1]}/${parts[2]}` : parts[1] || parts[0];
		if (!layerStats[layer]) {
			layerStats[layer] = { count: 0, criticalCount: 0, warningCount: 0, totalComp: 0, totalCrap: 0 };
		}
		layerStats[layer].count++;
		if (f.crap > criticalThreshold) layerStats[layer].criticalCount++;
		else if (f.crap > warningThreshold) layerStats[layer].warningCount++;
		layerStats[layer].totalComp += f.comp;
		layerStats[layer].totalCrap += f.crap;
	}

	const sortedLayers = Object.entries(layerStats).sort(
		(a, b) => b[1].totalCrap / b[1].count - a[1].totalCrap / a[1].count
	);

	console.log(
		`  ${"分层模块".padEnd(30)} ${"函数数".padStart(6)} ${"均复杂度".padStart(8)} ${"均CRAP".padStart(8)} ${"预警/高危".padStart(10)}`
	);
	console.log(`  ${"-".repeat(30)} ${"-".repeat(6)} ${"-".repeat(8)} ${"-".repeat(8)} ${"-".repeat(10)}`);

	for (const [layer, s] of sortedLayers) {
		const layerAvgCrap = s.totalCrap / s.count;
		const color = layerAvgCrap > criticalThreshold ? C.red : layerAvgCrap > warningThreshold ? C.yellow : C.green;
		const alertStr = `${s.warningCount} / ${s.criticalCount}`;
		console.log(
			`  ${layer.padEnd(30)} ${String(s.count).padStart(6)} ${(s.totalComp / s.count).toFixed(1).padStart(8)} ${color}${layerAvgCrap.toFixed(2).padStart(8)}${C.reset} ${alertStr.padStart(10)}`
		);
	}

	console.log(`\n${C.bold}【TOP ${topCount} 变更风险关注函数 (CRAP 降序)】${C.reset}`);
	const displayList = allFunctions.slice(0, topCount);

	displayList.forEach((f, idx) => {
		const tag =
			f.crap > criticalThreshold
				? `${C.bgRed}${C.white} CRITICAL ${C.reset}`
				: f.crap > warningThreshold
					? `${C.bgYellow}${C.white} WARNING ${C.reset}`
					: `${C.green} HEALTHY ${C.reset}`;

		const filePos = `${f.file}:${f.line}`;
		console.log(
			`  ${String(idx + 1).padStart(2)}. [CRAP: ${C.bold}${f.crap.toFixed(2)}${C.reset}] ${tag} ${C.cyan}${filePos}${C.reset} -> ${C.bold}${f.name}${C.reset}`
		);
		console.log(
			`      ${C.dim}圈复杂度: ${f.comp} | 行覆盖率: ${f.cov}% (${f.coveredLines}/${f.executableLines} 行)${C.reset}`
		);
	});

	console.log(`\n${C.bold}========================================================================${C.reset}\n`);
}

// Check if directly executed
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	runCli();
}
