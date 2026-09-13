import assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "vscode";
import { resolveHealedLine } from "#src/domain/healingEngine";
import {
	applySceneBreakpoints,
	applySingleBreakpointToEditor,
	collectCurrentBreakpoints,
	syncBreakpointEnabledToEditor,
} from "#src/infra/vscode/vscodeBreakpointBridge";
import { activateScene } from "#src/application/sceneService";

export async function runBreakpointBridgeTests() {
	console.log("  ▶ [Breakpoint Bridge] 运行宿主断点桥接器 (vscodeBreakpointBridge) 纯正测试套件...");

	// 1. 跨平台路径斜杠归一化 (Windows \\ 必须转为标准 /，与 vscodeBreakpointBridge 一致)
	{
		const wsRoot = "D:/project/repo";
		const winFile = "D:\\project\\repo\\src\\components\\auth\\login.ts";
		const relPath = path.win32.relative(wsRoot, winFile).replace(/\\/g, "/");
		assert.strictEqual(relPath, "src/components/auth/login.ts", "Windows 反斜杠路径必须统一归一化为 /");
		assert.ok(!relPath.includes("\\"), "路径中严禁残留 Windows 反斜杠");

		// POSIX 路径交叉验证
		const posixWsRoot = "/home/runner/work/repo";
		const posixFile = "/home/runner/work/repo/src/components/auth/login.ts";
		const posixResult = path.posix.relative(posixWsRoot, posixFile).replace(/\\/g, "/");
		assert.strictEqual(posixResult, "src/components/auth/login.ts", "POSIX 路径必须保持标准 /");
	}

	// 2. 全类型断点推导与 enabled: false 禁用态持久化（直连 collectCurrentBreakpoints 生产源码）
	{
		__resetMockVscodeState();
		const wsRoot = "D:/project/repo";

		// 向 vscode.debug.breakpoints 注入 5 种不同类型的宿主断点
		const disabledBp = new vscode.SourceBreakpoint(
			new vscode.Location(vscode.Uri.file("D:/project/repo/src/a.ts"), new vscode.Position(9, 0)),
			false, // enabled = false
		);

		const condBp = new vscode.SourceBreakpoint(
			new vscode.Location(vscode.Uri.file("D:/project/repo/src/b.ts"), new vscode.Position(19, 0)),
			true,
			"user.id === 100", // condition
		);

		const hitBp = new vscode.SourceBreakpoint(
			new vscode.Location(vscode.Uri.file("D:/project/repo/src/c.ts"), new vscode.Position(29, 0)),
			true,
			undefined,
			"> 50", // hitCondition
		);

		const logBp = new vscode.SourceBreakpoint(
			new vscode.Location(vscode.Uri.file("D:/project/repo/src/d.ts"), new vscode.Position(39, 0)),
			true,
			undefined,
			undefined,
			"User token: {token}", // logMessage
		);

		const funcDisabled = new vscode.FunctionBreakpoint(
			"handleAuth",
			false, // enabled = false
		);

		vscode.debug.breakpoints.push(disabledBp, condBp, hitBp, logBp, funcDisabled);

		// 调用真实的 collectCurrentBreakpoints 生产代码
		const exported = await collectCurrentBreakpoints(wsRoot);

		assert.strictEqual(exported.length, 5, "必须解析出全部 5 个断点");

		// (1) 处于禁用状态的普通行断点
		const exDisabled = exported.find((b) => b.file === "src/a.ts");
		assert.ok(exDisabled);
		assert.strictEqual(exDisabled.type, "line");
		assert.strictEqual(exDisabled.line, 10);
		assert.strictEqual(exDisabled.enabled, false, "必须忠实保留 enabled: false 状态");

		// (2) 条件断点
		const exCond = exported.find((b) => b.file === "src/b.ts");
		assert.ok(exCond);
		assert.strictEqual(exCond.type, "condition");
		assert.strictEqual(exCond.line, 20);
		assert.strictEqual(exCond.condition, "user.id === 100");

		// (3) 命中计数断点
		const exHit = exported.find((b) => b.file === "src/c.ts");
		assert.ok(exHit);
		assert.strictEqual(exHit.type, "hitCount");
		assert.strictEqual(exHit.line, 30);
		assert.strictEqual(exHit.hitCondition, "> 50");

		// (4) 日志断点 (Logpoint)
		const exLog = exported.find((b) => b.file === "src/d.ts");
		assert.ok(exLog);
		assert.strictEqual(exLog.type, "logpoint");
		assert.strictEqual(exLog.line, 40);
		assert.strictEqual(exLog.logMessage, "User token: {token}");

		// (5) 禁用的函数断点
		const exFunc = exported.find((b) => b.type === "function");
		assert.ok(exFunc);
		assert.strictEqual(exFunc.functionName, "handleAuth");
		assert.strictEqual(exFunc.enabled, false);
	}

	// 3. 增量 Diff 引擎：共有断点 0 闪烁原地保留，仅增删差量断点（直连 applySceneBreakpoints 生产源码）
	{
		__resetMockVscodeState();
		const wsRoot = "D:/project/repo";

		// 拦截 findFiles 让任何文件都能被定位到模拟 Uri
		vscode.workspace.findFiles = async (pattern) => {
			const fileName = pattern.replace(/^.*[\\/]/, "");
			return [vscode.Uri.file(`D:/project/repo/src/${fileName}`)];
		};

		// 初始宿主断点状态：
		// A: a.ts:10 (切换后不再需要 -> 应被 remove)
		// B: b.ts:20 (目标场景中完全相同 -> 应原地保留，0 闪烁，不可被 remove/add)
		// C: c.ts:30 条件为 x === 1 (目标场景中条件变更为 x === 2 -> 应被 remove 随后 add 新属性)
		const bpA = new vscode.SourceBreakpoint(
			new vscode.Location(vscode.Uri.file("D:/project/repo/src/a.ts"), new vscode.Position(9, 0)),
			true,
		);
		const bpB = new vscode.SourceBreakpoint(
			new vscode.Location(vscode.Uri.file("D:/project/repo/src/b.ts"), new vscode.Position(19, 0)),
			true,
		);
		const bpC = new vscode.SourceBreakpoint(
			new vscode.Location(vscode.Uri.file("D:/project/repo/src/c.ts"), new vscode.Position(29, 0)),
			true,
			"x === 1",
		);

		vscode.debug.breakpoints.push(bpA, bpB, bpC);

		// 监听 remove 与 add 动作，确认是否有冗余闪烁
		const removedBps = [];
		const addedBps = [];
		const origRemove = vscode.debug.removeBreakpoints;
		const origAdd = vscode.debug.addBreakpoints;
		vscode.debug.removeBreakpoints = async (bps) => {
			removedBps.push(...bps);
			return origRemove(bps);
		};
		vscode.debug.addBreakpoints = async (bps) => {
			addedBps.push(...bps);
			return origAdd(bps);
		};

		// 目标场景定义：
		// B: b.ts:20 (相同)
		// C: c.ts:30 (条件为 x === 2)
		// D: d.ts:40 (全新断点)
		const targetBps = [
			{ type: "line", file: "src/b.ts", line: 20, enabled: true },
			{ type: "condition", file: "src/c.ts", line: 30, condition: "x === 2", enabled: true },
			{ type: "line", file: "src/d.ts", line: 40, enabled: true },
		];

		// 执行真实的生产增量应用逻辑
		await applySceneBreakpoints(wsRoot, "targetScene", targetBps);

		// 恢复 hook
		vscode.debug.removeBreakpoints = origRemove;
		vscode.debug.addBreakpoints = origAdd;

		// 核心断言 1: B 完全没有被 remove，0 闪烁原地保留！
		assert.strictEqual(removedBps.includes(bpB), false, "共有断点 B 绝不可被 remove（必须 0 闪烁原地保留）");
		// 核心断言 2: 旧 A 与旧条件的 C 被精确移除
		assert.strictEqual(removedBps.includes(bpA), true, "不再需要的断点 A 必须被精确移除");
		assert.strictEqual(removedBps.includes(bpC), true, "条件发生变更的断点 C 旧实例必须被精确移除");
		assert.strictEqual(removedBps.length, 2, "移除的断点数必须精确为 2");

		// 核心断言 3: 新增了新条件的 C 和全新的 D
		assert.strictEqual(addedBps.length, 2, "新增的断点数必须精确为 2");
		assert.ok(addedBps.some((b) => b.location.uri.fsPath.endsWith("c.ts") && b.condition === "x === 2"));
		assert.ok(addedBps.some((b) => b.location.uri.fsPath.endsWith("d.ts")));

		// 核心断言 4: 终态断点列表中包含且仅包含 B、新 C、D
		assert.strictEqual(vscode.debug.breakpoints.length, 3, "终态必须精确保留 3 个断点");
		assert.ok(vscode.debug.breakpoints.includes(bpB), "终态列表中必须依然包含原对象实例 B");
	}

	// 4. 即刻点亮单个新断点注入 (applySingleBreakpointToEditor)
	{
		__resetMockVscodeState();
		const wsRoot = "D:/project/repo";

		// 注入行断点
		const okLine = await applySingleBreakpointToEditor(wsRoot, {
			type: "line",
			file: "src/user.ts",
			line: 15,
		});
		assert.strictEqual(okLine, true, "首次注入断点应返回 true");
		assert.strictEqual(vscode.debug.breakpoints.length, 1);

		// 重复注入同文件同行号断点 -> 幂等防重
		const okDup = await applySingleBreakpointToEditor(wsRoot, {
			type: "line",
			file: "src/user.ts",
			line: 15,
		});
		assert.strictEqual(okDup, false, "重复注入同位置断点应返回 false (幂等防重)");
		assert.strictEqual(vscode.debug.breakpoints.length, 1);

		// 注入函数断点
		const okFunc = await applySingleBreakpointToEditor(wsRoot, {
			type: "function",
			functionName: "dispatchFlow",
		});
		assert.strictEqual(okFunc, true, "注入函数断点应返回 true");
		assert.strictEqual(vscode.debug.breakpoints.length, 2);
	}

	// 5. 就地同步单个断点的启用/禁用状态到 VS Code DAP (syncBreakpointEnabledToEditor)
	{
		__resetMockVscodeState();
		const wsRoot = "D:/project/repo";

		// 先注入一个启用的行断点与函数断点
		const bpLine = new vscode.SourceBreakpoint(
			new vscode.Location(vscode.Uri.file("D:/project/repo/src/user.ts"), new vscode.Position(14, 0)),
			true,
		);
		const bpFunc = new vscode.FunctionBreakpoint("dispatchFlow", true);
		vscode.debug.breakpoints.push(bpLine, bpFunc);

		// 同步行断点为禁用态
		const okSyncLine = await syncBreakpointEnabledToEditor(
			wsRoot,
			{ type: "line", file: "src/user.ts", line: 15 },
			false,
		);
		assert.strictEqual(okSyncLine, true, "同步修改状态应返回 true");
		const foundLine = vscode.debug.breakpoints.find(
			(b) => b instanceof vscode.SourceBreakpoint && b.location.range.start.line === 14,
		);
		assert.strictEqual(foundLine.enabled, false, "DAP 断点 enabled 属性必须被同步更新为 false");

		// 同步函数断点为禁用态
		const okSyncFunc = await syncBreakpointEnabledToEditor(
			wsRoot,
			{ type: "function", functionName: "dispatchFlow" },
			false,
		);
		assert.strictEqual(okSyncFunc, true);
		const foundFunc = vscode.debug.breakpoints.find(
			(b) => b instanceof vscode.FunctionBreakpoint && b.functionName === "dispatchFlow",
		);
		assert.strictEqual(foundFunc.enabled, false);
	}

	// 6. 自愈源码行解析短期缓存 (fileLinesCache) 命中与隔离测试（直连 resolveHealedLine 生产源码）
	{
		const fileLinesCache = new Map();
		const wsRoot = "D:/project/repo";
		const fakePath = path.join(wsRoot, "src/user.ts");
		const simulatedLines = [
			"import * as auth from './auth';",
			"export function getUser() {",
			"  const user = auth.verify();",
			"  return user;",
			"}",
		];

		// 预先将解析行放入短期缓存
		fileLinesCache.set(fakePath, simulatedLines);

		const bp1 = {
			file: "src/user.ts",
			line: 2,
			contextSnippet: { current: "const user = auth.verify();" }, // 真实在第 3 行
		};
		const bp2 = {
			file: "src/user.ts",
			line: 3,
			contextSnippet: { current: "return user;" }, // 真实在第 4 行
		};

		// 传入共享 fileLinesCache 调用生产代码 resolveHealedLine
		const res1 = await resolveHealedLine(wsRoot, bp1, fileLinesCache);
		const res2 = await resolveHealedLine(wsRoot, bp2, fileLinesCache);

		assert.strictEqual(res1.healedLine, 3, "bp1 必须基于缓存行自愈到第 3 行");
		assert.strictEqual(res2.healedLine, 4, "bp2 必须基于缓存行自愈到第 4 行");
		assert.strictEqual(fileLinesCache.has(fakePath), true, "短期缓存必须持续保留供后续断点复用");
	}

	// 7. 自愈持久化多场景断点反向映射回写测试 (Loopback Persistence，直连 activateScene 生产源码)
	{
		__resetMockVscodeState();
		const wsRoot = "D:/project/repo";

		let savedConfig = null;
		const mockRepo = {
			loadScenesConfig: () => ({
				scenes: {
					"login-flow": [
						{ type: "line", file: "src/auth.ts", line: 10, contextSnippet: { current: "token = issueToken();" } },
					],
					"order-flow": [
						{ type: "line", file: "src/order.ts", line: 20, contextSnippet: { current: "order = createOrder();" } },
					],
				},
				activeScenes: [],
			}),
			saveScenesConfig: (_ws, config) => {
				savedConfig = JSON.parse(JSON.stringify(config));
			},
		};

		// 模拟底层桥接返回 order.ts 行号自愈漂移 (20 -> 25)
		const mockBridge = {
			applySceneBreakpoints: async (_ws, _label, bps) => {
				const healedBps = bps.map((b) => {
					if (b.file === "src/order.ts") {
						return { ...b, line: 25 };
					}
					return b;
				});
				return {
					loadedCount: healedBps.length,
					healedCount: 1,
					healedBreakpoints: healedBps,
				};
			},
			collectCurrentBreakpoints: async () => [],
			clearAllBreakpoints: async () => {},
			applySingleBreakpointToEditor: async () => true,
			syncBreakpointEnabledToEditor: async () => true,
		};

		// 触发真实的多场景激活与反向回写闭环
		await activateScene({
			workspaceRoot: wsRoot,
			targetScenes: ["login-flow", "order-flow"],
			sceneRepository: mockRepo,
			breakpointBridge: mockBridge,
		});

		assert.ok(savedConfig, "必须触发配置持久化写盘");
		assert.strictEqual(
			savedConfig.scenes["order-flow"][0].line,
			25,
			"order-flow 场景中的行号必须成功被生产代码反向回写为自愈后的 25",
		);
		assert.strictEqual(
			savedConfig.scenes["login-flow"][0].line,
			10,
			"login-flow 场景未漂移断点必须忠实保持原样",
		);
	}

	// 8. 缺失自愈指纹断点自动提取补齐与回写闭环 (Auto-enrich missing contextSnippet)
	{
		__resetMockVscodeState();
		const wsRoot = "D:/project/repo";

		let savedConfig = null;
		const mockRepo = {
			loadScenesConfig: () => ({
				scenes: {
					"ai-scene": [
						{ type: "line", file: "src/print.ts", line: 5, enabled: true, desc: "AI 生成断点" },
					],
				},
				activeScenes: [],
			}),
			saveScenesConfig: (_ws, config) => {
				savedConfig = JSON.parse(JSON.stringify(config));
			},
		};

		const mockBridge = {
			applySceneBreakpoints: async (_ws, _label, bps) => {
				const enrichedBps = bps.map((b) => ({
					...b,
					contextSnippet: {
						prev: "// prev line",
						current: "console.log('print entry');",
						next: "// next line",
						indent: 4,
					},
				}));
				return {
					loadedCount: enrichedBps.length,
					healedCount: 0,
					enrichedCount: 1,
					healedBreakpoints: enrichedBps,
				};
			},
			collectCurrentBreakpoints: async () => [],
			clearAllBreakpoints: async () => {},
			applySingleBreakpointToEditor: async () => true,
			syncBreakpointEnabledToEditor: async () => true,
		};

		const result = await activateScene({
			workspaceRoot: wsRoot,
			targetScenes: ["ai-scene"],
			sceneRepository: mockRepo,
			breakpointBridge: mockBridge,
		});

		assert.strictEqual(result.enrichedCount, 1, "激活结果必须准确返回 enrichedCount = 1");
		assert.ok(savedConfig, "当有指纹补齐时必须触发持久化回写");
		assert.ok(
			savedConfig.scenes["ai-scene"][0].contextSnippet,
			"ai-scene 中缺失指纹的断点必须被成功写入 contextSnippet",
		);
		assert.strictEqual(
			savedConfig.scenes["ai-scene"][0].contextSnippet.current,
			"console.log('print entry');",
		);
	}

	console.log("  ✅ [Breakpoint Bridge] 宿主断点桥接器测试全部通过！");
}
