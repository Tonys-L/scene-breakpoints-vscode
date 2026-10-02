import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Suite 06: 编辑器行末注解 Inlay Hints 渲染", () => {
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

  test("TC-HINT-01: 编辑器行末注解与幽灵文本 (Inlay Hints) 原生渲染与响应式联动", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "sample.ts");
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const range = new vscode.Range(0, 0, doc.lineCount, 0);

    // 1. 未激活任何场景时，拉取 Inlay Hints 必须为空
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    await new Promise((resolve) => setTimeout(resolve, 200));

    let hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
      "vscode.executeInlayHintProvider",
      doc.uri,
      range,
    );
    assert.strictEqual(hints?.length ?? 0, 0, "未激活场景时绝对不产生 Inlay Hints");

    // 2. 激活 login-flow 场景（在 sample.ts 中有 2 个断点）
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
      "vscode.executeInlayHintProvider",
      doc.uri,
      range,
    );
    assert.ok(hints && hints.length === 2, `激活 login-flow 后在 sample.ts 中必须生成 2 个 Inlay Hints, actual = ${hints?.length}`);

    const label0 = typeof hints[0].label === "string" ? hints[0].label : "";
    assert.ok(
      label0.includes("login-flow") && label0.includes("检查 normalized email"),
      `Inlay Hint 必须包含场景名与步骤描述: actual = ${label0}`,
    );

    // 3. 配置关闭时，静默返回空
    const config = vscode.workspace.getConfiguration("sceneBreakpoints");
    await config.update("inlayHints.enabled", false, vscode.ConfigurationTarget.Global);
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
        "vscode.executeInlayHintProvider",
        doc.uri,
        range,
      );
      assert.strictEqual(hints?.length ?? 0, 0, "用户配置关闭 Inlay Hints 时必须返回空");
    } finally {
      await config.update("inlayHints.enabled", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
