import assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { SceneInlayHintsProvider } from "#src/ui/views/sceneInlayHintsProvider";
import { sceneStateManager } from "#src/application/sceneStateManager";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";

export async function runInlayHintsProviderTests() {
	console.log("  ▶ [Inlay Hints Provider] 运行 SceneInlayHintsProvider 单元测试套件（直连生产源码）...");

	const mockWorkspaceRoot = "d:/test-project";

	// 模拟 scenes 配置仓库加载器
	const mockConfig = {
		scenes: {
			"order-pay": [
				{
					type: "line",
					file: "src/order.ts",
					line: 10,
					desc: "订单金额核验",
				},
				{
					type: "condition",
					file: "src/order.ts",
					line: 25,
					condition: "order.amount > 1000",
					desc: "大额订单拦截",
				},
				{
					type: "line",
					file: "src/user.ts",
					line: 5,
					desc: "用户鉴权",
				},
			],
			"audit-log": [
				{
					type: "logpoint",
					file: "src/order.ts",
					line: 25,
					logMessage: "Audit: order {order.id}",
					desc: "审计日志记录",
				},
			],
			"empty-desc-scene": [
				{
					type: "line",
					file: "src/order.ts",
					line: 30,
				},
			],
		},
	};

	const configProvider = () => mockConfig;

	// 辅助构造虚拟文档
	function createMockDoc(filePath, lines = []) {
		const norm = path.normalize(filePath);
		return {
			fileName: norm,
			uri: vscode.Uri.file(norm),
			lineCount: lines.length || 50,
			lineAt: (i) => ({
				text: lines[i] !== undefined ? lines[i] : `const line_${i} = true;`,
			}),
		};
	}

	// 1. 无任何场景激活时，直接返回空数组
	{
		__resetMockVscodeState();
		sceneStateManager.setActiveScenes([]);
		const provider = new SceneInlayHintsProvider(configProvider, () => mockWorkspaceRoot);
		const doc = createMockDoc("d:/test-project/src/order.ts");
		const hints = provider.provideInlayHints(doc);
		assert.strictEqual(hints.length, 0, "无激活场景时必须返回空提示数组");
	}

	// 2. 当用户配置关闭 Inlay Hints 时，直接返回空数组
	{
		__resetMockVscodeState();
		sceneStateManager.setActiveScenes(["order-pay"]);
		const provider = new SceneInlayHintsProvider(
			configProvider,
			() => mockWorkspaceRoot,
			() => false, // 配置为禁用
		);
		const doc = createMockDoc("d:/test-project/src/order.ts");
		const hints = provider.provideInlayHints(doc);
		assert.strictEqual(hints.length, 0, "配置禁用时必须返回空数组");
	}

	// 3. 单场景激活且文件命中时，正确生成 Inlay Hints
	{
		__resetMockVscodeState();
		sceneStateManager.setActiveScenes(["order-pay"]);
		const provider = new SceneInlayHintsProvider(
			configProvider,
			() => mockWorkspaceRoot,
			() => true,
		);
		const doc = createMockDoc("d:/test-project/src/order.ts");
		const hints = provider.provideInlayHints(doc);

		assert.strictEqual(hints.length, 2, "order-pay 在 order.ts 中有 2 个断点，应生成 2 个提示");

		// 检查第 10 行（0-based line 9）
		const hint10 = hints.find((h) => h.position.line === 9);
		assert.ok(hint10, "第 10 行断点必须生成 InlayHint");
		assert.strictEqual(hint10.label, "💡 [order-pay #1] 订单金额核验");
		assert.strictEqual(hint10.paddingLeft, true);
		assert.ok(hint10.tooltip instanceof vscode.MarkdownString);
		assert.ok(hint10.tooltip.value.includes("order-pay"));
		assert.ok(hint10.tooltip.value.includes("订单金额核验"));

		// 检查第 25 行（0-based line 24，带 condition）
		const hint25 = hints.find((h) => h.position.line === 24);
		assert.ok(hint25, "第 25 行断点必须生成 InlayHint");
		assert.strictEqual(hint25.label, "💡 [order-pay #2] 大额订单拦截");
		assert.ok(hint25.tooltip.value.includes("order.amount > 1000"));
	}

	// 4. 断点无 desc 备注时，格式优雅回退为 "💡 [场景名 #序号]"
	{
		__resetMockVscodeState();
		sceneStateManager.setActiveScenes(["empty-desc-scene"]);
		const provider = new SceneInlayHintsProvider(
			configProvider,
			() => mockWorkspaceRoot,
			() => true,
		);
		const doc = createMockDoc("d:/test-project/src/order.ts");
		const hints = provider.provideInlayHints(doc);

		assert.strictEqual(hints.length, 1);
		assert.strictEqual(hints[0].label, "💡 [empty-desc-scene #1]");
	}

	// 5. 多场景叠加激活在同一物理行时，紧凑合并呈现
	{
		__resetMockVscodeState();
		// 同时激活 order-pay 和 audit-log
		sceneStateManager.setActiveScenes(["order-pay", "audit-log"]);
		const provider = new SceneInlayHintsProvider(
			configProvider,
			() => mockWorkspaceRoot,
			() => true,
		);
		const doc = createMockDoc("d:/test-project/src/order.ts");
		const hints = provider.provideInlayHints(doc);

		// 第 25 行（0-based line 24）同时被两个场景引用
		const hint25 = hints.find((h) => h.position.line === 24);
		assert.ok(hint25, "第 25 行必须生成合并提示");
		assert.ok(
			hint25.label.includes("[order-pay #2] 大额订单拦截"),
			`应包含 order-pay: ${hint25.label}`,
		);
		assert.ok(
			hint25.label.includes("[audit-log #1] 审计日志记录"),
			`应包含 audit-log: ${hint25.label}`,
		);
		assert.ok(hint25.label.includes(" | "), `多场景应以管道符分隔: ${hint25.label}`);
	}

	// 6. 文件未在激活场景中时，返回空数组
	{
		__resetMockVscodeState();
		sceneStateManager.setActiveScenes(["order-pay"]);
		const provider = new SceneInlayHintsProvider(
			configProvider,
			() => mockWorkspaceRoot,
			() => true,
		);
		const doc = createMockDoc("d:/test-project/src/other.ts");
		const hints = provider.provideInlayHints(doc);
		assert.strictEqual(hints.length, 0, "非场景关联文件不产生提示");
	}

	// 7. 响应式事件触发：当场景状态变化或手动触发 refresh 时，发射 onDidChangeInlayHints
	{
		const provider = new SceneInlayHintsProvider(
			configProvider,
			() => mockWorkspaceRoot,
			() => true,
		);
		let eventFiredCount = 0;
		provider.onDidChangeInlayHints(() => {
			eventFiredCount++;
		});

		provider.refresh();
		assert.strictEqual(eventFiredCount, 1, "refresh 必须触发 onDidChangeInlayHints");

		sceneStateManager.setActiveScenes(["audit-log"]);
		assert.strictEqual(eventFiredCount, 2, "状态机激活场景变动必须自动通知 InlayHints 重绘");

		provider.dispose();
	}

	// 8. 冷启动/重载窗口场景：内存状态机暂为空，但磁盘配置中声明了 activeScenes，自动回退感知
	{
		__resetMockVscodeState();
		sceneStateManager.setActiveScenes([]); // 模拟刚启动未手动激活
		const configWithActive = {
			activeScenes: ["order-pay"],
			scenes: mockConfig.scenes,
		};
		const provider = new SceneInlayHintsProvider(
			() => configWithActive,
			() => mockWorkspaceRoot,
			() => true,
		);
		const doc = createMockDoc("d:/test-project/src/order.ts");
		const hints = provider.provideInlayHints(doc);
		assert.strictEqual(hints.length, 2, "冷启动时自动回退读取磁盘 activeScenes 并成功点亮提示");
	}

	console.log("  ✅ [Inlay Hints Provider] SceneInlayHintsProvider 单元测试全部通过！");
}
