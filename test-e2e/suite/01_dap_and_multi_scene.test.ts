import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Suite 01: DAP 原生断点装配与多场景矩阵", () => {
  let api: any;
  let initialConfigContent: string;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension("tony-l.scene-breakpoints-vscode");
    assert.ok(ext, "扩展必须被 VS Code 发现");
    api = await ext.activate();
    assert.ok(api, "扩展应成功返回 ExtensionApi");

    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const configUri = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json");
    initialConfigContent = Buffer.from(await vscode.workspace.fs.readFile(configUri)).toString("utf-8");
  });

  suiteTeardown(async () => {
    if (initialConfigContent) {
      const workspaceFolders = vscode.workspace.workspaceFolders!;
      const configUri = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json");
      await vscode.workspace.fs.writeFile(configUri, Buffer.from(initialConfigContent, "utf-8"));
    }
  });

  teardown(async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    if (initialConfigContent) {
      const workspaceFolders = vscode.workspace.workspaceFolders!;
      const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;
      require("node:fs").writeFileSync(configPath, initialConfigContent, "utf-8");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  test("TC-DAP-01: 5 类断点（行/条件/计数/日志/函数）真实注入 DAP", async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["full-type-scene"]);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const breakpoints = vscode.debug.breakpoints;
    assert.strictEqual(breakpoints.length, 5, "full-type-scene 应注入 5 个断点");

    // 1. 普通行断点
    const lineBp = breakpoints.find(
      (bp): bp is vscode.SourceBreakpoint =>
        bp instanceof vscode.SourceBreakpoint &&
        !bp.condition &&
        !bp.hitCondition &&
        !bp.logMessage &&
        bp.location.range.start.line + 1 === 3,
    );
    assert.ok(lineBp, "应成功注入行断点 (line 3)");

    // 2. 条件断点
    const condBp = breakpoints.find(
      (bp): bp is vscode.SourceBreakpoint =>
        bp instanceof vscode.SourceBreakpoint && bp.condition === 'pass === "secret123"',
    );
    assert.ok(condBp, "应成功注入条件断点 (line 6)");

    // 3. 命中计数断点
    const hitBp = breakpoints.find(
      (bp): bp is vscode.SourceBreakpoint =>
        bp instanceof vscode.SourceBreakpoint && bp.hitCondition === ">5",
    );
    assert.ok(hitBp, "应成功注入命中计数断点 (line 13)");

    // 4. 日志断点
    const logBp = breakpoints.find(
      (bp): bp is vscode.SourceBreakpoint =>
        bp instanceof vscode.SourceBreakpoint &&
        bp.logMessage === "Discount calculated: {price}",
    );
    assert.ok(logBp, "应成功注入日志断点 (line 15)");

    // 5. 函数断点
    const funcBp = breakpoints.find(
      (bp): bp is vscode.FunctionBreakpoint =>
        bp instanceof vscode.FunctionBreakpoint &&
        bp.functionName === "calculateDiscount",
    );
    assert.ok(funcBp, "应成功注入函数断点 (calculateDiscount)");
  });

  test("TC-DAP-02: 全局清空断点 clearAll", async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(vscode.debug.breakpoints.length > 0);

    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.strictEqual(vscode.debug.breakpoints.length, 0, "DAP 断点数应清空为 0");
    const statusBar = api.getStatusBarItem();
    assert.ok(statusBar.text.includes("(None)"), "状态栏文本应复位为 (None)");
  });

  test("TC-DAP-03: 增量 Diff 装配与 0 闪烁", async () => {
    // 激活 login-flow (含行 3 和行 6)
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const initialBps = [...vscode.debug.breakpoints];
    const initialLine3 = initialBps.find(
      (bp): bp is vscode.SourceBreakpoint =>
        bp instanceof vscode.SourceBreakpoint && bp.location.range.start.line + 1 === 3,
    );
    assert.ok(initialLine3);

    // 叠加激活 discount-flow (保留行 3 和行 6，仅新增行 12)
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", [
      "login-flow",
      "discount-flow",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const afterBps = vscode.debug.breakpoints;
    assert.strictEqual(afterBps.length, 3, "总断点数应为 3");

    // 共有断点对象引用必须严格保留（原地 Diff）
    const retainedLine3 = afterBps.find(
      (bp): bp is vscode.SourceBreakpoint =>
        bp instanceof vscode.SourceBreakpoint && bp.location.range.start.line + 1 === 3,
    );
    assert.strictEqual(retainedLine3, initialLine3, "共有断点对象引用应原地保留，杜绝销毁重建");
  });

  test("TC-DAP-04: 当前行快捷添加断点 addBreakpoint", async () => {
    // 先激活 login-flow
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const countBefore = vscode.debug.breakpoints.length;

    // 打开 sample.ts，将选区置于第 11 行
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "sample.ts");
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(10, 0, 10, 0); // 物理第 11 行

    // 执行快捷添加断点 (mock 选择场景为 login-flow，断点类型为标准物理行断点，可选描述为测试描述)
    const origQuickPick = vscode.window.showQuickPick;
    const origInputBox = vscode.window.showInputBox;
    let callIndex = 0;
    (vscode.window as any).showQuickPick = async (items: any) => {
      callIndex++;
      if (callIndex === 1) {
        // 第一步：选择场景目标为 login-flow
        return items.find((i: any) => i.sceneName === "login-flow") || items[0];
      }
      // 第二步：选择断点类型为标准物理行断点
      return items.find((i: any) => i.type === "line") || items[0];
    };
    (vscode.window as any).showInputBox = async () => "快速添加测试断点";

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.addBreakpoint");
      await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      (vscode.window as any).showQuickPick = origQuickPick;
      (vscode.window as any).showInputBox = origInputBox;
    }

    // 断言 DAP 立即点亮并注入了第 11 行断点
    const newBps = vscode.debug.breakpoints;
    assert.strictEqual(newBps.length, countBefore + 1, "断点总数应自增 1");
    const addedBp = newBps.find(
      (bp): bp is vscode.SourceBreakpoint =>
        bp instanceof vscode.SourceBreakpoint && bp.location.range.start.line + 1 === 11,
    );
    assert.ok(addedBp, "物理第 11 行应被即刻点亮注入 DAP");
  });

  test("TC-MUL-01: 多场景正向叠加组合", async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", [
      "login-flow",
      "discount-flow",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.strictEqual(vscode.debug.breakpoints.length, 3);
    const statusBar = api.getStatusBarItem();
    assert.ok(
      statusBar.text.includes("discount-flow") && statusBar.text.includes("login-flow"),
    );
  });

  test("TC-MUL-02: 多场景动态单点剔除降级", async () => {
    // 初始激活 [login-flow, discount-flow]
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", [
      "login-flow",
      "discount-flow",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.debug.breakpoints.length, 3);

    // 获取 login-flow 根节点，点击 toggleSceneActivation 取消该场景
    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");
    assert.ok(loginNode);

    await vscode.commands.executeCommand("sceneBreakpoints.toggleSceneActivation", loginNode);
    await new Promise((resolve) => setTimeout(resolve, 400));

    // 仅保留 discount-flow 的 1 个断点
    assert.strictEqual(vscode.debug.breakpoints.length, 1, "剔除后应仅保留 1 个断点");
    const statusBar = api.getStatusBarItem();
    assert.ok(statusBar.text.includes("[discount-flow]"), "状态栏应降级为 [discount-flow]");
  });

  test("TC-MUL-03: 多场景取消复位清空", async () => {
    // 当前激活 [discount-flow]
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["discount-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.debug.breakpoints.length, 1);

    const rootNodes = await api.treeDataProvider.getChildren();
    const discountNode = rootNodes.find((n: any) => n.sceneName === "discount-flow");
    assert.ok(discountNode);

    // 再次点击取消激活
    await vscode.commands.executeCommand("sceneBreakpoints.toggleSceneActivation", discountNode);
    await new Promise((resolve) => setTimeout(resolve, 400));

    assert.strictEqual(vscode.debug.breakpoints.length, 0, "全部取消后断点应完全清空");
    const statusBar = api.getStatusBarItem();
    assert.ok(statusBar.text.includes("(None)"), "状态栏应复位为 (None)");
  });

  test("TC-MUL-04: 冲突断点先到先得与 enabled 覆盖 (INV-011)", async () => {
    // 1. 先 A (enabled: false) 后 B (enabled: true)
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", [
      "conflict-a",
      "conflict-b",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    let bps = vscode.debug.breakpoints;
    assert.strictEqual(bps.length, 1, "同位置冲突应去重为 1 条");
    assert.strictEqual(bps[0].enabled, false, "先到先得：先 A 后 B 应保留 A 的 enabled: false");

    // 2. 先 B (enabled: true) 后 A (enabled: false)
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", [
      "conflict-b",
      "conflict-a",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    bps = vscode.debug.breakpoints;
    assert.strictEqual(bps.length, 1);
    assert.strictEqual(bps[0].enabled, true, "先到先得：先 B 后 A 应保留 B 的 enabled: true");
  });

  test("TC-MUL-05: 多场景状态栏自适应折叠", async () => {
    // 激活 3 个超长场景
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", [
      "ultra-long-scenario-authentication-pipeline",
      "ultra-long-scenario-order-settlement-pipeline",
      "ultra-long-scenario-payment-gateway-pipeline",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const statusBar = api.getStatusBarItem();
    // 验证状态栏文字包含折叠后缀 (如 , +2)
    assert.ok(
      statusBar.text.includes("+2"),
      "超长场景名应自适应折叠并携带 +2 后缀",
    );
    // Tooltip 应包含全部三个完整场景名
    assert.ok(
      statusBar.tooltip.includes("authentication-pipeline") &&
        statusBar.tooltip.includes("order-settlement-pipeline") &&
        statusBar.tooltip.includes("payment-gateway-pipeline"),
      "Tooltip 应保留完整全景清单",
    );
  });
});
