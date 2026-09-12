import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Suite 03: 状态栏、CodeLens 与剪贴板导入导出", () => {
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  test("TC-STAT-01: 状态栏三态（无激活、激活绿、未保存黄）响应式色彩与文字", async () => {
    const statusBar = api.getStatusBarItem();
    assert.ok(statusBar);

    // 1. 无激活状态
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(statusBar.text.includes("(None)"));
    assert.strictEqual(statusBar.color, undefined, "未激活时应为默认无色");

    // 2. 正常激活状态
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(statusBar.text.includes("[login-flow]"));
    assert.strictEqual(statusBar.color, "#49c998", "激活态必须为主题绿高亮");

    // 3. 临时未保存断点 (Dirty 态)
    // 模拟在激活场景中新增一个外部断点使总数偏离基准
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "sample.ts");
    const tempBp = new vscode.SourceBreakpoint(new vscode.Location(fileUri, new vscode.Position(8, 0)));
    vscode.debug.addBreakpoints([tempBp]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 验证状态栏呈现黄色星号 Dirty 提示
    assert.ok(statusBar.text.includes("*"), "未保存临时断点时文本应带 *");
    assert.strictEqual(statusBar.color, "#cca700", "Dirty 态颜色应为警告黄色 #cca700");
  });

  test("TC-STAT-02: 状态栏点击呼出主菜单 sceneBreakpoints.showMenu", async () => {
    const statusBar = api.getStatusBarItem();
    assert.strictEqual(statusBar.command, "sceneBreakpoints.showMenu", "状态栏必须绑定 showMenu 命令");

    // 真实执行绑定的命令 (mock createQuickPick 避免界面悬停)
    const origCreateQuickPick = vscode.window.createQuickPick;
    let quickPickCalled = false;
    (vscode.window as any).createQuickPick = () => {
      quickPickCalled = true;
      const qp = origCreateQuickPick.call(vscode.window);
      setTimeout(() => qp.hide(), 10);
      return qp;
    };

    try {
      await vscode.commands.executeCommand(statusBar.command);
      assert.strictEqual(quickPickCalled, true, "点击状态栏必须成功调出 QuickPick 交互菜单");
    } finally {
      (vscode.window as any).createQuickPick = origCreateQuickPick;
    }
  });

  test("TC-LENS-01 & TC-LENS-02: debug-scenes.json 动态 CodeLens 与点击一键激活", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const configUri = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json");
    const doc = await vscode.workspace.openTextDocument(configUri);

    // 1. 未激活时提取 CodeLens
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    await new Promise((resolve) => setTimeout(resolve, 200));

    let lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      doc.uri,
    );
    assert.ok(lenses && lenses.length >= 2);

    const loginLens = lenses.find((l) => l.command?.arguments?.[0] === "login-flow");
    assert.ok(loginLens?.command);
    assert.ok(loginLens.command.title.includes("Apply Scene"), "未激活时 CodeLens 标题应包含 Apply Scene");

    // 2. 真实触发 CodeLens 上的激活命令
    await vscode.commands.executeCommand(loginLens.command.command, ...loginLens.command.arguments);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.debug.breakpoints.length, 2, "点击 CodeLens 必须激活对应断点");

    // 3. 激活后再拉取 CodeLens，断言切换为 Active 状态
    lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      doc.uri,
    );
    const updatedLoginLens = lenses.find((l) => l.command?.arguments?.[0] === "login-flow");
    assert.ok(updatedLoginLens?.command?.title.includes("Active"), "激活后 CodeLens 标题应更新为 Active");
  });

  test("TC-CLIP-01: 反向批量导出编辑器散落断点 exportScene", async () => {
    // 在编辑器中打两个断点
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "sample.ts");
    const bp1 = new vscode.SourceBreakpoint(new vscode.Location(fileUri, new vscode.Position(2, 0)));
    const bp2 = new vscode.SourceBreakpoint(new vscode.Location(fileUri, new vscode.Position(4, 0)));
    vscode.debug.addBreakpoints([bp1, bp2]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 执行 exportScene 并指定导出场景名为 my-exported-flow
    const origInput = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "my-exported-flow";

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.exportScene");
      await new Promise((resolve) => setTimeout(resolve, 400));

      const rootNodes = await api.treeDataProvider.getChildren();
      const exportedNode = rootNodes.find((n: any) => n.sceneName === "my-exported-flow");
      assert.ok(exportedNode, "树视图中必须出现成功导出的 my-exported-flow 场景");

      const children = await api.treeDataProvider.getChildren(exportedNode);
      assert.strictEqual(children.length, 2, "导出的场景应完整捕获编辑器的 2 个断点");
    } finally {
      (vscode.window as any).showInputBox = origInput;
    }
  });

  test("TC-CLIP-02: 场景一键复制到剪贴板 copySceneToClipboard", async () => {
    const rootNodes = await api.treeDataProvider.getChildren();
    const loginNode = rootNodes.find((n: any) => n.sceneName === "login-flow");
    assert.ok(loginNode);

    // 触发复制命令
    await vscode.commands.executeCommand("sceneBreakpoints.copySceneToClipboard", loginNode);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const clipText = await vscode.env.clipboard.readText();
    assert.ok(clipText && clipText.includes("login-flow"), "剪贴板中必须包含导出的场景数据");
    const parsed = JSON.parse(clipText);
    assert.strictEqual(parsed.sceneName, "login-flow", "剪贴板内容必须为合法的场景 Payload JSON");
    assert.ok(Array.isArray(parsed.breakpoints) && parsed.breakpoints.length > 0, "断点集合应为数组");
  });

  test("TC-CLIP-03: 剪贴板导入与 Markdown/JSONC 清洗 importSceneFromClipboard", async () => {
    // 写入包裹在 Markdown 围栏与带注释的极端 JSON 文本
    const payloadWithMarkdown = `
\`\`\`jsonc
// 这是来自团队群聊分享的场景断点
{
  "sceneName": "imported-clip-flow",
  "breakpoints": [
    {
      "type": "line",
      "file": "src/sample.ts",
      "line": 5,
      "enabled": true,
      "desc": "导入测试"
    }
  ]
}
\`\`\`
`;
    await vscode.env.clipboard.writeText(payloadWithMarkdown);

    // 执行从剪贴板导入命令 (mock showInformationMessage 避免等待用户手动确认)
    const origInfo = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async () => undefined;

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.importSceneFromClipboard");
      await new Promise((resolve) => setTimeout(resolve, 400));

      // 验证新场景被防御性清洗并成功导入到树视图中
      const rootNodes = await api.treeDataProvider.getChildren();
      const importedNode = rootNodes.find((n: any) => n.sceneName === "imported-clip-flow");
      assert.ok(importedNode, "包裹在 Markdown 中的场景应被防御性清洗并成功导入");

      const children = await api.treeDataProvider.getChildren(importedNode);
      assert.strictEqual(children.length, 1, "导入的场景应包含 1 个断点");
    } finally {
      (vscode.window as any).showInformationMessage = origInfo;
    }
  });
});
