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

  test("TC-HINT-02: 可见文本编辑器失焦状态下场景激活与清空注解即刻呈现与消除", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "sample.ts");
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    assert.ok(editor, "sample.ts 必须成功作为可见文本编辑器打开");

    const range = new vscode.Range(0, 0, doc.lineCount, 0);

    // 1. 确保初始处于清空状态
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    await new Promise((r) => setTimeout(r, 250));

    let hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
      "vscode.executeInlayHintProvider",
      doc.uri,
      range,
    );
    assert.strictEqual(hints?.length ?? 0, 0, "初始清空状态下 Inlay Hints 必须为 0");

    // 2. 模拟用户在左侧侧边栏操作：通过 tree item 激活场景（此时焦点在侧边栏）
    // 构造模拟的 SceneNode
    await vscode.commands.executeCommand("sceneBreakpoints.applySceneItem", { sceneName: "login-flow" });
    await new Promise((r) => setTimeout(r, 250));

    // 验证激活后立即获取 Inlay Hints
    hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
      "vscode.executeInlayHintProvider",
      doc.uri,
      range,
    );
    assert.strictEqual(hints?.length, 2, `激活 login-flow 后必须立即提供 2 个 Inlay Hints, actual=${hints?.length}`);

    // 3. 添加新断点到当前激活场景 (addBreakpoint)
    const origQuickPick = vscode.window.showQuickPick;
    const origInputBox = vscode.window.showInputBox;
    let callIndex = 0;
    (vscode.window as any).showQuickPick = async (items: any) => {
      callIndex++;
      if (callIndex === 1) {
        return items.find((i: any) => i.sceneName === "login-flow") || items[0];
      }
      return items.find((i: any) => i.type === "line") || items[0];
    };
    (vscode.window as any).showInputBox = async () => "动态添加的新断点";
    try {
      await vscode.commands.executeCommand("sceneBreakpoints.addBreakpoint");
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      vscode.window.showQuickPick = origQuickPick;
      vscode.window.showInputBox = origInputBox;
    }

    hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
      "vscode.executeInlayHintProvider",
      doc.uri,
      range,
    );
    console.log("[DEBUG TC-HINT-02] After add breakpoint, hints count:", hints?.length);

    // 4. 点击取消激活 (toggleSceneActivation)
    await vscode.commands.executeCommand("sceneBreakpoints.toggleSceneActivation", { sceneName: "login-flow" });
    await new Promise((r) => setTimeout(r, 250));

    hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
      "vscode.executeInlayHintProvider",
      doc.uri,
      range,
    );
    console.log("[DEBUG TC-HINT-02] After cancel activation, hints count:", hints?.length);
    assert.strictEqual(hints?.length ?? 0, 0, `取消激活后 Inlay Hints 必须立即归零, actual=${hints?.length}`);

    // 5. 后续再次激活 (applySceneItem)
    await vscode.commands.executeCommand("sceneBreakpoints.applySceneItem", { sceneName: "login-flow" });
    await new Promise((r) => setTimeout(r, 250));

    hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
      "vscode.executeInlayHintProvider",
      doc.uri,
      range,
    );
    console.log("[DEBUG TC-HINT-02] After re-activate, hints count:", hints?.length);
    assert.ok(hints && hints.length > 0, `再次激活后 Inlay Hints 必须立即显示, actual=${hints?.length}`);
  });
});
