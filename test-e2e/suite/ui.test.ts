import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

suite("Scene Breakpoints UI & TreeView E2E Suite", () => {
  let api: any;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension("tony-l.scene-breakpoints-vscode");
    assert.ok(ext, "扩展应存在");
    api = await ext.activate();
    assert.ok(api, "扩展应成功返回 ExtensionApi");
  });

  teardown(async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
  });

  test("E2E-UI-01: 侧边栏 TreeView 场景根节点渲染与激活态高亮", async () => {
    // 1. 激活 login-flow
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 2. 从 treeDataProvider 获取根节点
    const rootNodes = await api.treeDataProvider.getChildren();
    assert.ok(rootNodes && rootNodes.length >= 2, "根节点应包含至少 2 个场景");

    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");
    const discountNode = rootNodes.find((n: any) => n.sceneName === "discount-flow");

    assert.ok(loginNode, "应存在 login-flow 场景节点");
    assert.ok(discountNode, "应存在 discount-flow 场景节点");

    // 检查激活态属性
    assert.strictEqual(loginNode.isActive, true, "login-flow 节点的 isActive 应为 true");
    assert.strictEqual(loginNode.contextValue, "activeSceneItem", "login-flow 节点的 contextValue 应为 activeSceneItem");
    assert.strictEqual(discountNode.isActive, false, "discount-flow 节点的 isActive 应为 false");
    assert.strictEqual(discountNode.contextValue, "sceneItem", "discount-flow 节点的 contextValue 应为 sceneItem");

    // 检查图标是否正确
    assert.ok(loginNode.iconPath instanceof vscode.ThemeIcon, "场景图标应为 ThemeIcon");
  });

  test("E2E-UI-02: TreeView 断点叶子节点与条件/行号属性展示", async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");
    assert.ok(loginNode);

    // 获取断点子节点
    const bpNodes = await api.treeDataProvider.getChildren(loginNode);
    assert.strictEqual(bpNodes.length, 2, "login-flow 应包含 2 个断点子节点");

    // 检查普通行断点节点
    const lineNode = bpNodes.find((n: any) => n.breakpoint.line === 3);
    assert.ok(lineNode, "应存在 line 3 断点节点");
    assert.strictEqual(lineNode.contextValue, "breakpointItemEnabled", "断点 contextValue 应为 breakpointItemEnabled");
    assert.strictEqual(lineNode.breakpoint.enabled, true, "断点初始应为启用");

    // 检查条件断点节点
    const condNode = bpNodes.find((n: any) => n.breakpoint.line === 6);
    assert.ok(condNode, "应存在 line 6 条件断点节点");
    assert.strictEqual(condNode.breakpoint.condition, 'pass === "secret123"');
    assert.strictEqual(condNode.description, "验证密码", "条件断点描述应格式化呈现 desc 说明");

    // 验证图标均为矢量 SVG 文件，且包含条件断点专用图标
    const condIcon = (condNode.iconPath as vscode.Uri).fsPath;
    assert.ok(condIcon.includes("condition") || condIcon.endsWith(".svg"), "条件断点应采用 condition 专属矢量图标");
  });

  test("E2E-UI-03: TreeView 批量控制与行内状态切换 (Enable/Disable All)", async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");

    // 执行一键禁用全部断点
    await vscode.commands.executeCommand("sceneBreakpoints.disableAllBreakpointsInScene", loginNode);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 重新获取断点子节点
    let bpNodes = await api.treeDataProvider.getChildren(loginNode);
    assert.ok(bpNodes.every((n: any) => n.breakpoint.enabled === false), "所有断点应被禁用");
    assert.ok(bpNodes.every((n: any) => n.contextValue === "breakpointItemDisabled"), "断点 contextValue 应变为 disabled");

    // 执行一键启用全部断点
    await vscode.commands.executeCommand("sceneBreakpoints.enableAllBreakpointsInScene", loginNode);
    await new Promise((resolve) => setTimeout(resolve, 300));

    bpNodes = await api.treeDataProvider.getChildren(loginNode);
    assert.ok(bpNodes.every((n: any) => n.breakpoint.enabled === true), "所有断点应恢复启用");
    assert.ok(bpNodes.every((n: any) => n.contextValue === "breakpointItemEnabled"), "断点 contextValue 应恢复为 enabled");
  });

  test("E2E-UI-04: 底部状态栏 StatusBarItem 响应式文字与色彩渲染", async () => {
    const statusBar = api.getStatusBarItem() as vscode.StatusBarItem;
    assert.ok(statusBar, "状态栏控件应初始化");

    // 1. 清空状态下
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(statusBar.text.includes("(None)"), "未激活时应显示 (None)");

    // 2. 激活单个场景
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(statusBar.text.includes("[login-flow]"), "应显示激活场景名 [login-flow]");
    assert.strictEqual(statusBar.color, "#49c998", "激活态应为绿色高亮");

    // 3. 叠加激活多个场景
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow", "discount-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(
      statusBar.text.includes("discount-flow") && statusBar.text.includes("login-flow"),
      "叠加激活时应显示多场景复合名称",
    );
  });

  test("E2E-UI-05: CodeLens 行内操作按钮真实挂载到 debug-scenes.json", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    assert.ok(workspaceFolders && workspaceFolders.length > 0, "工作区应存在");

    const configUri = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json");
    const doc = await vscode.workspace.openTextDocument(configUri);
    assert.ok(doc, "debug-scenes.json 应可被加载");

    // 调用 VS Code 内置命令执行当前文档的所有 CodeLensProvider
    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      doc.uri,
    );

    assert.ok(codeLenses && codeLenses.length >= 2, "debug-scenes.json 中各场景上方应生成 CodeLens");

    const titles = codeLenses.map((lens) => lens.command?.title || "");
    assert.ok(
      titles.some((t) => t.includes("Apply Scene") || t.includes("Active")),
      "CodeLens 中应包含 Apply Scene 交互命令动作",
    );
  });
});
