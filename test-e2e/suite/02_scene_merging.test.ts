import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Suite 02: 多场景正向叠加与冲突合并", () => {
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
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    if (initialConfigContent) {
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

  test("TC-MUL-06: 显式空数组参数调用 applyScene([]) 彻底清空断点", async () => {
    // 1. 初始激活两个场景
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", [
      "login-flow",
      "discount-flow",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.debug.breakpoints.length, 3, "初始应激活 3 个断点");

    // 2. 显式传入 [] 参数调用 applyScene，断言不弹窗且直接清空
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", []);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 3. 断言全部断点被清空，状态栏复位为 (None)
    assert.strictEqual(vscode.debug.breakpoints.length, 0, "传入 [] 应清空全部断点");
    const statusBar = api.getStatusBarItem();
    assert.ok(statusBar.text.includes("(None)"), "状态栏应复位为 (None)");
  });
});
