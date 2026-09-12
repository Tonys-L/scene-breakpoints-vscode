import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Suite 02: 调试侧边栏 TreeView 视口与全按钮交互", () => {
  let api: any;
  let initialConfigContent: string;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension("tony-l.scene-breakpoints-vscode");
    assert.ok(ext);
    api = await ext.activate();
    assert.ok(api);

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

  test("TC-TREE-01: 切换到调试侧边栏面板并聚焦 TreeView", async () => {
    // 切换到 Run & Debug
    await vscode.commands.executeCommand("workbench.view.debug");
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 聚焦 sceneBreakpointsView
    await vscode.commands.executeCommand("sceneBreakpointsView.focus");
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.ok(api.treeView, "树视图实例必须存在");
    assert.strictEqual(api.treeView.visible, true, "切换并聚焦后树视图应处于可见状态");
  });

  test("TC-TREE-02 & TC-TREE-03: 场景根节点渲染与断点叶子节点矢量 SVG 保真", async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 验证根节点
    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");
    assert.ok(loginNode, "应存在 login-flow 根节点");
    assert.strictEqual(loginNode.isActive, true, "login-flow 应高亮激活");
    assert.strictEqual(loginNode.contextValue, "activeSceneItem");

    // 验证断点叶子节点
    const bpNodes = await api.treeDataProvider.getChildren(loginNode);
    assert.strictEqual(bpNodes.length, 2, "子节点应包含 2 个断点");

    const lineNode = bpNodes.find((n: any) => n.breakpoint.line === 3);
    const condNode = bpNodes.find((n: any) => n.breakpoint.line === 6);
    assert.ok(lineNode && condNode);

    assert.strictEqual(lineNode.contextValue, "breakpointItemEnabled");
    assert.strictEqual(condNode.contextValue, "breakpointItemEnabled");
    assert.strictEqual(condNode.description, "验证密码");

    // 验证矢量 SVG 图标
    const condIcon = (condNode.iconPath as vscode.Uri).fsPath;
    assert.ok(condIcon.endsWith(".svg"), "断点图标必须采用矢量 SVG 路径");
  });

  test("TC-TREE-04: 单点断点条目联动打开源码并精准定位选区行", async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");
    const bpNodes = await api.treeDataProvider.getChildren(loginNode);
    const lineNode = bpNodes.find((n: any) => n.breakpoint.line === 3);
    assert.ok(lineNode?.command, "断点条目必须绑定点击打开命令");

    // 真实触发树条目的点击命令
    await vscode.commands.executeCommand(
      lineNode.command.command,
      ...lineNode.command.arguments,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "编辑器应成功打开目标文件");
    assert.ok(activeEditor.document.fileName.endsWith("sample.ts"), "应打开 sample.ts");
    assert.strictEqual(
      activeEditor.selection.start.line,
      2,
      "光标选区行号应精准落在第 3 行 (0-indexed 为 2)",
    );
  });

  test("TC-TREE-05 & TC-TREE-14: 原生 Checkbox 勾选与行内 toggle 切换全双工同步", async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");
    let bpNodes = await api.treeDataProvider.getChildren(loginNode);
    const lineNode = bpNodes.find((n: any) => n.breakpoint.line === 3);
    assert.ok(lineNode);

    // 1. 触发单个断点 toggle 按钮
    await vscode.commands.executeCommand("sceneBreakpoints.toggleBreakpointItem", lineNode);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 验证状态变为禁用
    bpNodes = await api.treeDataProvider.getChildren(loginNode);
    const toggledNode = bpNodes.find((n: any) => n.breakpoint.line === 3);
    assert.strictEqual(toggledNode.breakpoint.enabled, false);
    assert.strictEqual(toggledNode.contextValue, "breakpointItemDisabled");

    // 验证 DAP 对应断点也同步禁用
    const lineBp = vscode.debug.breakpoints.find(
      (bp): bp is vscode.SourceBreakpoint =>
        bp instanceof vscode.SourceBreakpoint && bp.location.range.start.line + 1 === 3,
    );
    assert.strictEqual(lineBp?.enabled, false, "DAP 断点必须同步为 disabled");

    // 2. 再次 toggle 恢复启用
    await vscode.commands.executeCommand("sceneBreakpoints.toggleBreakpointItem", toggledNode);
    await new Promise((resolve) => setTimeout(resolve, 300));

    bpNodes = await api.treeDataProvider.getChildren(loginNode);
    const restoredNode = bpNodes.find((n: any) => n.breakpoint.line === 3);
    assert.strictEqual(restoredNode.breakpoint.enabled, true);
    assert.strictEqual(restoredNode.contextValue, "breakpointItemEnabled");
  });

  test("TC-TREE-11 & TC-TREE-12: 场景右键批量启用/禁用全部断点", async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");

    // 批量禁用全部
    await vscode.commands.executeCommand(
      "sceneBreakpoints.disableAllBreakpointsInScene",
      loginNode,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    let bpNodes = await api.treeDataProvider.getChildren(loginNode);
    assert.ok(bpNodes.every((n: any) => n.breakpoint.enabled === false));

    // 批量启用全部
    await vscode.commands.executeCommand(
      "sceneBreakpoints.enableAllBreakpointsInScene",
      loginNode,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    bpNodes = await api.treeDataProvider.getChildren(loginNode);
    assert.ok(bpNodes.every((n: any) => n.breakpoint.enabled === true));
  });

  test("TC-TREE-13: 场景右键克隆副本 duplicateScene", async () => {
    const rootNodesBefore = await api.treeDataProvider.getChildren();
    const discountNode = rootNodesBefore.find((n: any) => n.sceneName === "discount-flow");
    assert.ok(discountNode);

    // 触发克隆副本 (mock 输入目标场景名)
    const origInput = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "discount-flow-copy";

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.duplicateScene", discountNode);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 重新获取根节点
      const rootNodesAfter = await api.treeDataProvider.getChildren();
      const copyNode = rootNodesAfter.find((n: any) => n.sceneName === "discount-flow-copy");
      assert.ok(copyNode, "树视图中必须出现克隆出的 discount-flow-copy 场景");

      const copyBps = await api.treeDataProvider.getChildren(copyNode);
      assert.strictEqual(copyBps.length, 1, "副本场景断点数应与原场景完全一致");
    } finally {
      (vscode.window as any).showInputBox = origInput;
    }
  });

  test("TC-TREE-06: 标题栏按钮：新建空白场景 createNewScene", async () => {
    const origInput = vscode.window.showInputBox;
    const testSceneName = "new-brand-scene";
    (vscode.window as any).showInputBox = async () => testSceneName;

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.createNewScene");
      await new Promise((resolve) => setTimeout(resolve, 300));

      const rootNodes = await api.treeDataProvider.getChildren();
      const createdNode = rootNodes.find((n: any) => n.sceneName === testSceneName);
      assert.ok(createdNode, "新建的空白场景必须呈现在树视图中");

      // 空白场景在 TreeView 中包含一个占位提示节点 (PlaceholderNode)
      const children = await api.treeDataProvider.getChildren(createdNode);
      assert.strictEqual(children.length, 1, "空白场景应展示占位节点");
      assert.ok(children[0].label?.toString().includes("No breakpoints"), "应提示当前场景无断点");
    } finally {
      (vscode.window as any).showInputBox = origInput;
    }
  });

  test("TC-TREE-07: 标题栏按钮：刷新视图 refreshView", async () => {
    // 调用 refreshView 命令，确保无异常且能正常触发
    await vscode.commands.executeCommand("sceneBreakpoints.refreshView");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const rootNodes = await api.treeDataProvider.getChildren();
    assert.ok(rootNodes.length > 0, "刷新后树视图必须正常呈现节点");
  });

  test("TC-TREE-08 & TC-TREE-10: 场景行内按钮激活与删除场景保护", async () => {
    // 1. 先通过行内按钮激活 discount-flow
    let rootNodes = await api.treeDataProvider.getChildren();
    const discountNode = rootNodes.find((n: any) => n.sceneName === "discount-flow");
    assert.ok(discountNode);

    await vscode.commands.executeCommand("sceneBreakpoints.applySceneItem", discountNode);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.debug.breakpoints.length, 1);

    // 2. 模拟删除前克隆出的 discount-flow-copy
    const copyNode = rootNodes.find((n: any) => n.sceneName === "discount-flow-copy");
    if (copyNode) {
      const origWarn = vscode.window.showWarningMessage;
      (vscode.window as any).showWarningMessage = async (
        msg: string,
        opts: any,
        ...items: string[]
      ) => items[0]; // 模拟点击确认删除

      try {
        await vscode.commands.executeCommand("sceneBreakpoints.deleteSceneItem", copyNode);
        await new Promise((resolve) => setTimeout(resolve, 300));

        rootNodes = await api.treeDataProvider.getChildren();
        const deletedNode = rootNodes.find((n: any) => n.sceneName === "discount-flow-copy");
        assert.strictEqual(deletedNode, undefined, "删除后该场景节点应被移除");
      } finally {
        (vscode.window as any).showWarningMessage = origWarn;
      }
    }
  });

  test("TC-TREE-15: 断点行内按钮：移除单断点 removeBreakpointItem", async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");
    let bpNodes = await api.treeDataProvider.getChildren(loginNode);
    assert.strictEqual(bpNodes.length, 2);

    // 移除第 2 个断点 (line 6)
    const condNode = bpNodes.find((n: any) => n.breakpoint.line === 6);
    await vscode.commands.executeCommand("sceneBreakpoints.removeBreakpointItem", condNode);
    await new Promise((resolve) => setTimeout(resolve, 300));

    bpNodes = await api.treeDataProvider.getChildren(loginNode);
    assert.strictEqual(bpNodes.length, 1, "移除后树视图该场景断点数应减为 1");
  });
});
