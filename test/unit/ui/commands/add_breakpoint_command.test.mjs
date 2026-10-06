import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import { saveScenesConfig, loadScenesConfig } from "#src/infra/storage/jsonFileSceneRepository";
import { addBreakpointCommand } from "#src/ui/commands/addBreakpointCommand";

/**
 * addBreakpointCommand 1:1 镜像单测
 * 覆盖高危未测函数：
 * - promptBreakpointParams：condition / hitCount / logpoint / function 四类类型参数收集，
 *   与用户取消（undefined）或空白输入时的提前退出守卫全分支矩阵
 */
export async function runAddBreakpointCommandTests() {
	console.log("  ▶ [Add Breakpoint Command] 运行添加断点参数收集全分支单测（真实源码）...");

	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-add-bp-cmd-"));
	vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpRoot } }];

	const { configureDependencies } = await import("#src/application/index");
	const { jsonFileSceneRepository, vscodeBreakpointBridge, echoLoopGuard } = await import("#src/infra/index");
	configureDependencies({
		sceneRepository: jsonFileSceneRepository,
		breakpointBridge: vscodeBreakpointBridge,
		loopGuard: echoLoopGuard,
		lineReader: {
			readLines: async (filePath) => {
				try {
					const content = fs.readFileSync(filePath, "utf-8");
					return content.split(/\r?\n/);
				} catch {
					return undefined;
				}
			},
			clearCache: () => {},
		},
	});

	// 活动编辑器 mock：两行示例源码，光标停在第 1 行
	const sampleFile = path.join(tmpRoot, "src", "sample.ts");
	fs.mkdirSync(path.dirname(sampleFile), { recursive: true });
	fs.writeFileSync(sampleFile, "const order = createOrder();\nconst paid = charge(order);\n", "utf-8");
	vscode.window.activeTextEditor = {
		document: {
			fileName: sampleFile,
			uri: vscode.Uri.file(sampleFile),
			lineCount: 2,
			lineAt: (i) => ({ text: i === 0 ? "const order = createOrder();" : "const paid = charge(order);" }),
		},
		selection: { active: new vscode.Position(0, 0) },
	};

	/**
	 * 统一驱动器：场景 QuickPick -> 类型 QuickPick -> 类型参数 InputBox -> 描述 InputBox
	 * line 类型无类型参数输入框，仅有可选描述输入
	 */
	const driveAddBreakpoint = async ({ type, paramInput, descInput }) => {
		vscode.window.showQuickPick = async (items) => {
			if (items.some((i) => i.sceneName !== undefined)) {
				return items.find((i) => i.sceneName === "login");
			}
			return items.find((i) => i.type === type);
		};
		const inputs = type === "line" ? [descInput] : [paramInput, descInput];
		let inputStep = 0;
		vscode.window.showInputBox = async () => inputs[inputStep++];
		await addBreakpointCommand();
	};

	// 取消路径断言辅助：命令必须静默退出且不产生任何写盘副作用
	const assertConfigUnchanged = async (drive) => {
		const before = JSON.stringify(loadScenesConfig(tmpRoot));
		await drive();
		assert.strictEqual(JSON.stringify(loadScenesConfig(tmpRoot)), before, "取消路径严禁写盘");
	};

	const lastEntryOf = (scene) => {
		const config = loadScenesConfig(tmpRoot);
		const list = config.scenes[scene] || [];
		return list[list.length - 1];
	};

	try {
		saveScenesConfig(tmpRoot, {
			scenes: { login: [{ file: "src/login.ts", line: 10, type: "line", enabled: true }] },
			activeScenes: [],
		});

		// 1. line 类型：无类型参数输入，描述留空 -> 条目落盘且 desc 为 undefined
		await driveAddBreakpoint({ type: "line", descInput: undefined });
		assert.strictEqual(lastEntryOf("login").type, "line");
		assert.strictEqual(lastEntryOf("login").file, "src/sample.ts");
		assert.strictEqual(lastEntryOf("login").line, 1);
		assert.strictEqual(lastEntryOf("login").desc, undefined);
		assert.ok(lastEntryOf("login").contextSnippet, "行断点必须携带三行上下文指纹");

		// 2. condition：输入表达式 -> condition 与 desc 双落盘
		await driveAddBreakpoint({ type: "condition", paramInput: "x > 50", descInput: "verify gate" });
		assert.strictEqual(lastEntryOf("login").type, "condition");
		assert.strictEqual(lastEntryOf("login").condition, "x > 50");
		assert.strictEqual(lastEntryOf("login").desc, "verify gate");

		// 3. condition：参数输入取消 (undefined) -> 提前退出且不写盘
		await assertConfigUnchanged(() => driveAddBreakpoint({ type: "condition", paramInput: undefined }));

		// 4. hitCount：输入命中条件 -> hitCondition 落盘
		await driveAddBreakpoint({ type: "hitCount", paramInput: "> 5" });
		assert.strictEqual(lastEntryOf("login").type, "hitCount");
		assert.strictEqual(lastEntryOf("login").hitCondition, "> 5");

		// 5. hitCount：参数输入取消 -> 提前退出且不写盘
		await assertConfigUnchanged(() => driveAddBreakpoint({ type: "hitCount", paramInput: undefined }));

		// 6. logpoint：输入日志消息 -> logMessage 落盘
		await driveAddBreakpoint({ type: "logpoint", paramInput: "User state: {user.id}" });
		assert.strictEqual(lastEntryOf("login").type, "logpoint");
		assert.strictEqual(lastEntryOf("login").logMessage, "User state: {user.id}");

		// 7. logpoint：参数输入取消 -> 提前退出且不写盘
		await assertConfigUnchanged(() => driveAddBreakpoint({ type: "logpoint", paramInput: undefined }));

		// 8. function：输入函数名 -> function 条目落盘（无 file/line/contextSnippet）
		await driveAddBreakpoint({ type: "function", paramInput: "handleAuth" });
		assert.strictEqual(lastEntryOf("login").type, "function");
		assert.strictEqual(lastEntryOf("login").functionName, "handleAuth");
		assert.strictEqual(lastEntryOf("login").file, undefined);
		assert.strictEqual(lastEntryOf("login").line, undefined);

		// 9. function：空白输入（validateInput 守卫语义）-> 提前退出且不写盘
		await assertConfigUnchanged(() => driveAddBreakpoint({ type: "function", paramInput: "" }));
	} finally {
		__resetMockVscodeState();
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}

	console.log("  ✅ [Add Breakpoint Command] 添加断点参数收集单测全部通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runAddBreakpointCommandTests();
}
