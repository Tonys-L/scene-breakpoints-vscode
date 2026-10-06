import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
import { saveScenesConfig, loadScenesConfig } from "#src/infra/storage/jsonFileSceneRepository";
import { registerTreeCommands } from "#src/ui/commands/treeCommands";
import { SceneRefTreeItem, SceneTreeDataProvider } from "#src/ui/views/sceneTreeProvider";

/**
 * treeCommands 1:1 镜像单测
 * 覆盖高危未测函数 calculateTargetIndex：断点重排命令移动后树视图 reveal 定位索引推导全分支
 * (经 registerTreeCommands 注册的 moveBreakpointUp/Down/ToTop/ToBottom 命令入口驱动)
 */
export async function runTreeCommandsTests() {
	console.log("  ▶ [Tree Commands] 运行断点重排移动后 reveal 目标索引推导 (calculateTargetIndex) 单测（真实源码）...");

	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-tree-cmd-"));
	vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpRoot } }];

	const { configureDependencies } = await import("#src/application/index");
	const { jsonFileSceneRepository, vscodeBreakpointBridge, echoLoopGuard } = await import("#src/infra/index");
	configureDependencies({
		sceneRepository: jsonFileSceneRepository,
		breakpointBridge: vscodeBreakpointBridge,
		loopGuard: echoLoopGuard,
	});

	const treeDataProvider = new SceneTreeDataProvider();
	const revealCalls = [];
	const mockTreeView = {
		reveal: async (node, options) => {
			revealCalls.push({ node, options });
		},
	};
	registerTreeCommands({ subscriptions: [] }, treeDataProvider, mockTreeView);

	const resetScene = () => {
		saveScenesConfig(tmpRoot, {
			scenes: {
				reorder: [
					{ file: "src/reorder.ts", line: 10, type: "line", enabled: true },
					{ file: "src/reorder.ts", line: 20, type: "line", enabled: true },
					{ file: "src/reorder.ts", line: 30, type: "line", enabled: true },
				],
			},
		});
	};

	const waitReveal = async () => {
		await new Promise((resolve) => setTimeout(resolve, 120)); // 等待 50ms 防抖定时器后的异步 reveal
	};

	try {
		const nodeAt = async (index) => {
			const children = await treeDataProvider.getBreakpointNodes("reorder");
			return children.find((c) => c.index === index);
		};

		// ----------------------------------------------------
		// A. 上移 (index 1 -> 0)：移动成功后必须 reveal 到目标索引 0
		// ----------------------------------------------------
		{
			resetScene();
			revealCalls.length = 0;
			const node = await nodeAt(1);
			await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointUp", node);
			await waitReveal();

			assert.strictEqual(revealCalls.length, 1, "上移成功后必须 reveal 定位");
			assert.strictEqual(revealCalls[0].node.index, 0, "上移后目标索引必须为 currentIndex - 1");
			assert.strictEqual(revealCalls[0].node.breakpoint.line, 20, "reveal 必须命中移动后的断点节点");
			assert.deepStrictEqual(
				revealCalls[0].options,
				{ select: true, focus: true },
				"reveal 必须选中并聚焦目标节点",
			);
		}

		// ----------------------------------------------------
		// B. 下移 (index 1 -> 2)：目标索引 currentIndex + 1
		// ----------------------------------------------------
		{
			resetScene();
			revealCalls.length = 0;
			const node = await nodeAt(1);
			await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointDown", node);
			await waitReveal();

			assert.strictEqual(revealCalls.length, 1, "下移成功后必须 reveal 定位");
			assert.strictEqual(revealCalls[0].node.index, 2, "下移后目标索引必须为 currentIndex + 1");
		}

		// ----------------------------------------------------
		// C. 置顶 (index 2 -> 0)：目标索引恒为 0
		// ----------------------------------------------------
		{
			resetScene();
			revealCalls.length = 0;
			const node = await nodeAt(2);
			await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointToTop", node);
			await waitReveal();

			assert.strictEqual(revealCalls.length, 1, "置顶成功后必须 reveal 定位");
			assert.strictEqual(revealCalls[0].node.index, 0, "置顶后目标索引必须为 0");
			assert.strictEqual(revealCalls[0].node.breakpoint.line, 30, "置顶断点必须位于首位");
		}

		// ----------------------------------------------------
		// D. 置底 (index 0 -> 末位)：目标索引恒为 listLength - 1
		// ----------------------------------------------------
		{
			resetScene();
			revealCalls.length = 0;
			const node = await nodeAt(0);
			await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointToBottom", node);
			await waitReveal();

			assert.strictEqual(revealCalls.length, 1, "置底成功后必须 reveal 定位");
			assert.strictEqual(revealCalls[0].node.index, 2, "置底后目标索引必须为 listLength - 1");
			assert.strictEqual(revealCalls[0].node.breakpoint.line, 10, "置底断点必须位于末位");
		}

		// ----------------------------------------------------
		// E. 边界无操作：首位上移 / 末位下移 -> 领域层返回未移动，不触发 reveal
		// ----------------------------------------------------
		{
			resetScene();
			revealCalls.length = 0;
			const topNode = await nodeAt(0);
			await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointUp", topNode);
			await waitReveal();
			assert.strictEqual(revealCalls.length, 0, "首位断点上移为无操作，绝不触发 reveal");

			const bottomNode = await nodeAt(2);
			await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointDown", bottomNode);
			await waitReveal();
			assert.strictEqual(revealCalls.length, 0, "末位断点下移为无操作，绝不触发 reveal");

			// 磁盘配置保持原序
			const lines = loadScenesConfig(tmpRoot).scenes.reorder.map((bp) => bp.line);
			assert.deepStrictEqual(lines, [10, 20, 30], "边界无操作时磁盘配置必须保持原序不变");
		}

		// ----------------------------------------------------
		// F. 非法节点入口防御：undefined / 缺 index -> 静默返回
		// ----------------------------------------------------
		{
			resetScene();
			revealCalls.length = 0;
			await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointUp", undefined);
			await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointUp", { sceneName: "reorder" });
			await waitReveal();
			assert.strictEqual(revealCalls.length, 0, "非法节点必须静默返回，不触发移动与 reveal");
		}

		// ----------------------------------------------------
		// G. 批次4：revealRefSource 纯导航命令（字符串参 = TreeItem command 调用）
		// ----------------------------------------------------
		{
			saveScenesConfig(tmpRoot, {
				scenes: {
					pay: [{ type: "scene", name: "auth-core" }],
					"auth-core": [{ type: "line", file: "src/a.ts", line: 5 }],
				},
			});

			revealCalls.length = 0;
			await vscode.commands.executeCommand("sceneBreakpoints.revealRefSource", "auth-core", "pay");
			assert.strictEqual(revealCalls.length, 1, "源场景存在时必须 reveal 定位");
			assert.strictEqual(revealCalls[0].node.sceneName, "auth-core", "必须导航到被引用源场景节点");
			assert.deepStrictEqual(
				revealCalls[0].options,
				{ focus: true, select: true, expand: true },
				"导航必须聚焦、选中并展开源场景",
			);

			// 悬空引用：仅警告、不 reveal（无状态命令，不触碰 catalog）
			revealCalls.length = 0;
			vscode.window.messages.length = 0;
			await vscode.commands.executeCommand("sceneBreakpoints.revealRefSource", "ghost", "pay");
			assert.strictEqual(revealCalls.length, 0, "悬空引用必须禁止 reveal");
			assert.ok(
				vscode.window.messages.some((m) => m.level === "warning" && m.message.includes("ghost")),
				"悬空引用必须弹出警告通知并指明缺失场景名",
			);

			// 菜单调用形态：直接传入 SceneRefTreeItem 节点
			const refRoot = (await treeDataProvider.getChildren()).find((n) => n.sceneName === "pay");
			const refNode = (await treeDataProvider.getChildren(refRoot))[0];
			revealCalls.length = 0;
			await vscode.commands.executeCommand("sceneBreakpoints.revealRefSource", refNode);
			assert.strictEqual(revealCalls.length, 1, "菜单形态（引用节点参）必须同样触发导航");
			assert.strictEqual(revealCalls[0].node.sceneName, "auth-core");
		}

		// ----------------------------------------------------
		// H. 批次4：引用节点移除与重排（多态步骤操作穿透命令层）
		// ----------------------------------------------------
		{
			saveScenesConfig(tmpRoot, {
				scenes: {
					pay: [{ type: "line", file: "src/p.ts", line: 1 }, { type: "scene", name: "auth-core" }],
					"auth-core": [{ type: "line", file: "src/a.ts", line: 5 }],
				},
			});
			const payRoot = (await treeDataProvider.getChildren()).find((n) => n.sceneName === "pay");
			const stepNodes = await treeDataProvider.getChildren(payRoot);
			const refNode = stepNodes.find((n) => n instanceof SceneRefTreeItem);
			assert.ok(refNode, "引用条目必须投影为可操作节点");
			assert.strictEqual(refNode.index, 1);

			// 引用上移 -> 声明序变更落盘 + reveal 定位
			revealCalls.length = 0;
			await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointUp", refNode);
			await waitReveal();
			const afterMove = loadScenesConfig(tmpRoot).scenes.pay;
			assert.strictEqual(afterMove[0].type, "scene", "引用必须上移到索引 0");
			assert.strictEqual(revealCalls.length, 1, "引用移动成功后必须 reveal 定位");
			assert.strictEqual(revealCalls[0].node.index, 0);

			// 移除引用 -> removeStep 多态落盘
			const payRoot2 = (await treeDataProvider.getChildren()).find((n) => n.sceneName === "pay");
			const refNode2 = (await treeDataProvider.getChildren(payRoot2)).find((n) => n instanceof SceneRefTreeItem);
			await vscode.commands.executeCommand("sceneBreakpoints.removeBreakpointItem", refNode2);
			const afterRemove = loadScenesConfig(tmpRoot).scenes.pay;
			assert.strictEqual(afterRemove.length, 1, "引用条目必须被移除");
			assert.strictEqual(afterRemove[0].type, "line", "仅引用被移除，断点保持不变");
		}
	} finally {
		__resetMockVscodeState();
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}

	console.log("  ✅ [Tree Commands] 断点重排 reveal 目标索引推导单测全部通过！");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	runTreeCommandsTests();
}
