import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Scene Breakpoints E2E Suite", () => {
  suiteSetup(async () => {
    // 等待扩展就绪
    const ext = vscode.extensions.getExtension("tony-l.scene-breakpoints-vscode");
    assert.ok(ext, "扩展 tony-l.scene-breakpoints-vscode 应被 VS Code 发现");
    if (!ext.isActive) {
      await ext.activate();
    }
    assert.strictEqual(ext.isActive, true, "扩展应处于已激活状态");
  });

  teardown(async () => {
    // 每个用例结束后清理断点，防止互相污染
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
  });

  test("E2E-01: 应该能够激活单个场景并真实注入 DAP 断点", async () => {
    // 触发命令激活 login-flow
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);

    // 等待 DAP 异步事件刷新
    await new Promise((resolve) => setTimeout(resolve, 500));

    const breakpoints = vscode.debug.breakpoints;
    assert.strictEqual(breakpoints.length, 2, "login-flow 场景应注入 2 个断点");

    const sourceBps = breakpoints.filter((bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint);
    assert.strictEqual(sourceBps.length, 2, "注入的断点均应为 SourceBreakpoint");

    // 检查行断点与条件断点
    const condBp = sourceBps.find((bp) => bp.condition === 'pass === "secret123"');
    assert.ok(condBp, "应包含 pass === 'secret123' 的条件断点");
    assert.strictEqual(condBp?.location.range.start.line + 1, 6, "条件断点物理行号应为 6");

    const lineBp = sourceBps.find((bp) => !bp.condition);
    assert.ok(lineBp, "应包含普通行断点");
    assert.strictEqual(lineBp?.location.range.start.line + 1, 3, "普通行断点物理行号应为 3");
  });

  test("E2E-02: 应该能够叠加激活多个场景并正确合并", async () => {
    // 触发叠加激活 login-flow + discount-flow
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow", "discount-flow"]);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const breakpoints = vscode.debug.breakpoints;
    assert.strictEqual(breakpoints.length, 3, "叠加激活后总断点数应为 3 (2 + 1)");

    const lines = breakpoints
      .filter((bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint)
      .map((bp) => bp.location.range.start.line + 1)
      .sort((a, b) => a - b);

    assert.deepStrictEqual(lines, [3, 6, 12], "断点物理行号应精准为 [3, 6, 12]");
  });

  test("E2E-03: 执行 clearAll 应该从 VS Code DAP 中完全卸载断点", async () => {
    // 先激活
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.debug.breakpoints.length, 2);

    // 后清空
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.strictEqual(vscode.debug.breakpoints.length, 0, "DAP 中所有断点应被完全清空");
  });
});
