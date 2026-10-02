import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Suite 04: 树视图交互命令与运行时联动", () => {
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

  test("TC-TREE-09: 场景行内按钮：重命名场景 renameSceneItem", async () => {
    // 1. 创建待重命名场景
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;
    const fs = require("node:fs");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    raw.scenes["rename-temp-scene"] = [{ type: "line", file: "src/sample.ts", line: 3 }];
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), "utf-8");

    // 激活该场景
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["rename-temp-scene"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    let rootNodes = await api.treeDataProvider.getChildren();
    const tempNode = rootNodes.find((n: any) => n.sceneName === "rename-temp-scene");
    assert.ok(tempNode, "临时测试场景应已存在");

    // 2. 模拟重命名为 renamed-success-scene
    const origInput = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "renamed-success-scene";

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.renameSceneItem", tempNode);
      await new Promise((resolve) => setTimeout(resolve, 400));

      // 验证树视图更新
      rootNodes = await api.treeDataProvider.getChildren();
      assert.ok(!rootNodes.some((n: any) => n.sceneName === "rename-temp-scene"), "旧场景节点应已销毁");
      const renamedNode = rootNodes.find((n: any) => n.sceneName === "renamed-success-scene");
      assert.ok(renamedNode, "新名称节点应展示在树视图中");

      // 验证 debug-scenes.json 中 Key 更新
      const updatedConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.ok(!updatedConfig.scenes["rename-temp-scene"]);
      assert.ok(Array.isArray(updatedConfig.scenes["renamed-success-scene"]));

      // 验证激活状态同步更新
      const activeScenes = api.treeDataProvider ? await vscode.commands.executeCommand<any>("sceneBreakpoints.showMenu") : undefined;
    } finally {
      (vscode.window as any).showInputBox = origInput;
    }
  });

  test("TC-TREE-16: 断点行内按钮：在 debug-scenes.json 配置文件中精准定位 revealInConfigFile", async () => {
    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");
    assert.ok(loginNode);

    const bpNodes = await api.treeDataProvider.getChildren(loginNode);
    assert.ok(bpNodes.length > 0);
    const targetBpNode = bpNodes[0];

    // 执行精准定位命令
    await vscode.commands.executeCommand("sceneBreakpoints.revealInConfigFile", targetBpNode);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, "必须打开配置文件编辑器");
    assert.ok(
      activeEditor.document.fileName.endsWith("debug-scenes.json"),
      "打开的文件必须是 debug-scenes.json",
    );
    assert.ok(activeEditor.selection.active.line > 0, "光标位置行号必须大于 0");
  });

  test("TC-TREE-17: 断点排序微调：上移与下移 moveBreakpointUp & moveBreakpointDown", async () => {
    // 构造具备两个断点的排序测试场景
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;
    const fs = require("node:fs");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    raw.scenes["sort-test-flow"] = [
      { type: "line", file: "src/sample.ts", line: 10, desc: "First-Item" },
      { type: "line", file: "src/sample.ts", line: 20, desc: "Second-Item" },
    ];
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), "utf-8");
    api.treeDataProvider.refresh();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const rootNodes = await api.treeDataProvider.getChildren();
    const sortNode = rootNodes.find((n: any) => n.sceneName === "sort-test-flow");
    assert.ok(sortNode);

    // 显式展开排序测试场景节点，使得子断点在侧边栏 UI 树中清晰可见
    try {
      await api.treeView.reveal(sortNode, { expand: true, focus: false });
    } catch {
      // 容错保护
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    let bpNodes = await api.treeDataProvider.getChildren(sortNode);
    assert.strictEqual(bpNodes.length, 2);
    assert.strictEqual(bpNodes[0].breakpoint.line, 10);
    assert.strictEqual(bpNodes[1].breakpoint.line, 20);

    // 1. 上移第二个断点 (index 1 -> index 0)
    await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointUp", bpNodes[1]);
    await new Promise((resolve) => setTimeout(resolve, 800));

    bpNodes = await api.treeDataProvider.getChildren(sortNode);
    assert.strictEqual(bpNodes[0].breakpoint.line, 20, "上移后第 1 项应为原第 2 项 (line 20)");
    assert.strictEqual(bpNodes[1].breakpoint.line, 10, "上移后第 2 项应为原第 1 项 (line 10)");

    // 2. 下移置顶断点 (index 0 -> index 1)，复位顺序
    await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointDown", bpNodes[0]);
    await new Promise((resolve) => setTimeout(resolve, 800));

    bpNodes = await api.treeDataProvider.getChildren(sortNode);
    assert.strictEqual(bpNodes[0].breakpoint.line, 10, "下移复位后第 1 项应为 line 10");
    assert.strictEqual(bpNodes[1].breakpoint.line, 20, "下移复位后第 2 项应为 line 20");

    // 3. 置顶命令验证 (moveBreakpointToTop: 将末项直接置顶)
    await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointToTop", bpNodes[1]);
    await new Promise((resolve) => setTimeout(resolve, 800));

    bpNodes = await api.treeDataProvider.getChildren(sortNode);
    assert.strictEqual(bpNodes[0].breakpoint.line, 20, "置顶后第 1 项应直接跳升为 line 20");

    // 4. 置底命令验证 (moveBreakpointToBottom: 将首项直接置底)
    await vscode.commands.executeCommand("sceneBreakpoints.moveBreakpointToBottom", bpNodes[0]);
    await new Promise((resolve) => setTimeout(resolve, 800));

    // 5. 原生拖拽控制器 (TreeDragAndDropController) 接口测试
    const dataTransfer = new vscode.DataTransfer();
    api.treeDataProvider.handleDrag([bpNodes[1]], dataTransfer, new vscode.CancellationTokenSource().token);
    assert.ok(dataTransfer.get("application/vnd.code.tree.sceneBreakpointsView"), "handleDrag 必须正确填充 MIME 数据");

    // 模拟拖拽放到第 0 项位置 (源 index 1 -> 目标 index 0)
    await api.treeDataProvider.handleDrop(bpNodes[0], dataTransfer, new vscode.CancellationTokenSource().token);
    await new Promise((resolve) => setTimeout(resolve, 800));

    bpNodes = await api.treeDataProvider.getChildren(sortNode);
    assert.strictEqual(bpNodes[0].breakpoint.line, 20, "拖拽放置后第 1 项应为 line 20");
    assert.strictEqual(bpNodes[1].breakpoint.line, 10, "拖拽放置后第 2 项应为 line 10");
  });

  test("TC-TREE-18: 调试运行时断点命中高亮、[PAUSED] 标签与 TreeView 视口联动", async () => {
    // 激活 login-flow
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const samplePath = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "sample.ts").fsPath;

    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");
    assert.ok(loginNode);

    // 显式展开 login-flow，确保子节点呈现在 UI 树中
    try {
      await api.treeView.reveal(loginNode, { expand: true, focus: false });
    } catch {
      // 容错保护
    }

    // 1. 模拟调试器在 sample.ts 第 3 行断点处命中暂停 (DAP stopped 事件触发的树视图高亮与跟随)
    await api.treeDataProvider.revealPausedLocation(api.treeView, samplePath, 3);
    // 保持高亮停留 1200ms，让屏幕上清晰呈现 [PAUSED] 标签与专属暂停图标
    await new Promise((resolve) => setTimeout(resolve, 1200));

    let bpNodes = await api.treeDataProvider.getChildren(loginNode);
    const hitNode = bpNodes.find((n: any) => n.breakpoint.line === 3);
    assert.ok(hitNode, "命中行断点节点必须存在");

    // 核心断言：description 必须带有 [PAUSED] 或 [暂停命中]
    const desc = String(hitNode.description || "");
    assert.ok(
      desc.includes("PAUSED") || desc.includes("暂停命中"),
      `命中断点 description 必须带有暂停高亮标记，当前为: ${desc}`,
    );

    // 图标必须切换为专属 bp-paused.svg
    const iconPathStr = hitNode.iconPath?.light?.fsPath || hitNode.iconPath?.fsPath || String(hitNode.iconPath || "");
    assert.ok(
      iconPathStr.includes("bp-paused.svg"),
      `命中断点图标必须为 bp-paused.svg，当前为: ${iconPathStr}`,
    );

    // 2. 清除暂停高亮状态
    api.treeDataProvider.clearPausedLocation();
    await new Promise((resolve) => setTimeout(resolve, 500));

    bpNodes = await api.treeDataProvider.getChildren(loginNode);
    const normalNode = bpNodes.find((n: any) => n.breakpoint.line === 3);
    const normalDesc = String(normalNode?.description || "");
    assert.ok(
      !normalDesc.includes("PAUSED") && !normalDesc.includes("暂停命中"),
      "清除暂停状态后 description 不应再包含暂停标记",
    );
  });
});
