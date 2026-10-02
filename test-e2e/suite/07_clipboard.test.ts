import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Suite 07: 剪贴板场景导入导出与数据清洗", () => {
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
