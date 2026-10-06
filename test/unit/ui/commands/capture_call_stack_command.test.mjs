import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import { getLocalScenesConfigPath, loadScenesConfig } from "#src/infra/storage/jsonFileSceneRepository";
import { captureCallStackCommand } from "#src/ui/commands/captureCallStackCommand";
import { getCapturablePauseContext } from "#src/application/debugPauseContext";

/**
 * captureCallStackCommand 1:1 镜像单测 (v1.2.0 roadmap §4)
 * 覆盖：非暂停态拦截 / 堆栈帧过滤与去重 / 指纹提取 / 落盘分层 / DAP 异常与用户取消路径
 */
export async function runCaptureCallStackCommandTests() {
	console.log("  ▶ [Capture Call Stack] 运行调用栈固化命令全分支单测（真实源码）...");

	__resetMockVscodeState();
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-capture-stack-"));
	vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpRoot } }];

	const { configureDependencies } = await import("#src/application/index");
	const { jsonFileSceneRepository, vscodeBreakpointBridge, echoLoopGuard, registerDebugPauseService } =
		await import("#src/infra/index");
	configureDependencies({
		sceneRepository: jsonFileSceneRepository,
		breakpointBridge: vscodeBreakpointBridge,
		loopGuard: echoLoopGuard,
		lineReader: {
			readLines: async (filePath) => {
				try {
					return fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
				} catch {
					return undefined;
				}
			},
			clearCache: () => {},
		},
	});
	// 注册真实 DAP tracker 服务，使 stopped/continued/terminated 事件可经 _trackerFactories 通道驱动捕获上下文
	registerDebugPauseService();

	// 源码文件：3 行示例代码（含 v1.1.0 特性：子断点精确定位验证仍走真实指纹提取管线）
	const svcFile = path.join(tmpRoot, "src", "svc.ts");
	fs.mkdirSync(path.dirname(svcFile), { recursive: true });
	fs.writeFileSync(svcFile, "export function handle(req) {\n  return charge(req);\n}\n", "utf-8");

	// 通过真实 DAP tracker 通道登记暂停上下文（stopped 事件 -> capturablePause）
	const session = {
		customRequest: async (_cmd, args) => ({
			stackFrames: [
				{ name: "handleRequest", line: 2, source: { path: svcFile } },
				{ name: "charge", line: 2, source: { path: svcFile } }, // 同 file+line -> 去重
				{ name: "externalLib", line: 9, source: { path: path.join(os.tmpdir(), "outside-dep", "lib.ts") } }, // 工作区外 -> 过滤
				{ name: "nativeFrame", line: 1 }, // 无 source -> 过滤
			],
		}),
	};
	// 真实宿主中同一会话复用同一 tracker 实例（tracker 内部持有跨事件状态），测试侧按会话缓存对齐语义
	const trackerBySession = new Map();
	const fireTrackerMessage = (msg, sess = session) => {
		if (!trackerBySession.has(sess)) {
			for (const factory of vscode.debug._trackerFactories) {
				trackerBySession.set(sess, factory.createDebugAdapterTracker(sess));
			}
		}
		trackerBySession.get(sess)?.onDidSendMessage?.(msg);
	};
	const fireStopped = () => fireTrackerMessage({ type: "event", event: "stopped", body: { threadId: 7 } });
	const fireContinued = () => fireTrackerMessage({ type: "event", event: "continued", body: { threadId: 7 } });

	const messages = () => vscode.window.messages.map((m) => m.level);
	const lastEntryOf = (scene) => {
		const list = loadScenesConfig(tmpRoot).scenes[scene] || [];
		return list[list.length - 1];
	};

	try {
		// 1. 非暂停态（无捕获上下文）：仅提示，零写盘
		await captureCallStackCommand();
		assert.strictEqual(messages().includes("info"), true, "非暂停态必须推送 info 提示");
		assert.strictEqual(fs.existsSync(getLocalScenesConfigPath(tmpRoot)), false, "非暂停态严禁写盘");

		// 2. 暂停态：stopped 事件登记捕获上下文
		fireStopped();
		assert.ok(getCapturablePauseContext(), "stopped 事件必须登记捕获上下文");
		assert.strictEqual(getCapturablePauseContext().threadId, 7);

		// 3. 完整固化链路：过滤去重后 1 帧 -> 场景落 local 私有层
		vscode.window.messages.length = 0;
		vscode.window.showInputBox = async () => "crash-repro";
		await captureCallStackCommand();
		const entry = lastEntryOf("crash-repro");
		assert.strictEqual(entry.file, "src/svc.ts", "堆栈帧必须以工作区相对路径固化");
		assert.strictEqual(entry.line, 2);
		assert.strictEqual(entry.type, "line");
		assert.strictEqual(entry.desc, "handleRequest", "堆栈帧名必须沉淀为断点描述");
		assert.ok(entry.contextSnippet?.current, "固化断点必须携带三行上下文指纹");
		assert.strictEqual(
			JSON.parse(fs.readFileSync(getLocalScenesConfigPath(tmpRoot), "utf-8")).scenes["crash-repro"].length,
			1,
			"新场景必须落 local 私有层 (INV-032 新增场景缺省 local)",
		);
		assert.strictEqual(messages().includes("info"), true, "固化成功必须推送结果通知");

		// 4. 继续执行：捕获上下文即刻清除，恢复非可用态
		fireContinued();
		assert.strictEqual(getCapturablePauseContext(), undefined, "continued 事件必须清除捕获上下文");

		// 5. 重复登记 -> 再次捕获可运行（append 模式 upsert 同位置不重复）
		fireStopped();
		vscode.window.showInputBox = async () => "crash-repro";
		await captureCallStackCommand();
		assert.strictEqual(loadScenesConfig(tmpRoot).scenes["crash-repro"].length, 1, "同位置重复固化必须被 INV-001 upsert 去重");

		// 6. DAP customRequest 异常：显式错误弹窗且零写盘
		fireTrackerMessage({ type: "event", event: "continued", body: { threadId: 7 } });
		fireStopped();
		const throwingSession = {
			customRequest: async () => {
				throw new Error("session gone");
			},
		};
		// 以 throwing 会话重新登记捕获上下文
		for (const factory of vscode.debug._trackerFactories) {
			const tracker = factory.createDebugAdapterTracker(throwingSession);
			tracker?.onDidSendMessage?.({ type: "event", event: "stopped", body: { threadId: 8 } });
		}
		vscode.window.messages.length = 0;
		await captureCallStackCommand();
		assert.strictEqual(
			messages().includes("error"),
			true,
			"customRequest 抛错必须显式上报，严禁静默吞错 (GR-011)",
		);

		// 7. 用户取消场景名输入：严禁写盘
		const beforeCancel = JSON.stringify(loadScenesConfig(tmpRoot));
		vscode.window.showInputBox = async () => undefined;
		await captureCallStackCommand();
		assert.strictEqual(JSON.stringify(loadScenesConfig(tmpRoot)), beforeCancel, "取消输入严禁写盘");

		// 8. 恢复正常会话但堆栈全部不可固化：警告分支
		for (const factory of vscode.debug._trackerFactories) {
			const tracker = factory.createDebugAdapterTracker({
				customRequest: async () => ({ stackFrames: [{ name: "native", line: 3 }] }),
			});
			tracker?.onDidSendMessage?.({ type: "event", event: "stopped", body: { threadId: 9 } });
		}
		vscode.window.messages.length = 0;
		await captureCallStackCommand();
		assert.strictEqual(messages().includes("warning"), true, "无可固化帧必须推送 warning");
	} finally {
		fireTrackerMessage({ type: "event", event: "terminated", body: {} });
		vscode.debug.activeDebugSession = undefined;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}

	console.log("  ✅ [Capture Call Stack] captureCallStackCommand 单元测试全部通过！");
}

if (process.argv[1]?.endsWith("capture_call_stack_command.test.mjs")) {
	runCaptureCallStackCommandTests();
}
