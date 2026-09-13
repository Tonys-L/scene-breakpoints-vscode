import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
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

  test("TC-CMD-01: 命令面板 (Ctrl+Shift+P) 全量 25 大命令注册与总线就绪校验", async () => {
    // 1. 读取 package.json 中声明的 contributes.commands
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const contributesCommands: Array<{ command: string; title: string }> = pkg.contributes?.commands || [];
    assert.strictEqual(contributesCommands.length, 25, "package.json 应完整声明 25 个命令");

    // 2. 从 VS Code 内部命令总线拉取所有已注册的内部与扩展命令
    const allRegisteredCommands = await vscode.commands.getCommands(true);

    // 3. 逐一验证每个在 Ctrl+Shift+P 中展现的命令均已成功挂载到 VS Code 命令总线
    for (const cmd of contributesCommands) {
      assert.ok(
        allRegisteredCommands.includes(cmd.command),
        `命令 [${cmd.command}] (${cmd.title}) 必须在 VS Code 命令总线中注册就绪`,
      );
    }

    // 4. 验证命令面板主入口 sceneBreakpoints.showMenu 与 refreshView 的分发能力
    const origQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => undefined;
    try {
      await vscode.commands.executeCommand("sceneBreakpoints.refreshView");
      await vscode.commands.executeCommand("sceneBreakpoints.showMenu");
    } finally {
      (vscode.window as any).showQuickPick = origQuickPick;
    }
  });

  test("TC-KEY-01: 快捷键 (Keybindings) 映射契约与 editorTextFocus/TreeView 焦点触发验证", async () => {
    // 1. 读取 package.json 中声明的 keybindings
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const keybindings: Array<{ command: string; key: string; mac?: string; when?: string }> =
      pkg.contributes?.keybindings || [];

    // 2. 校验快捷键声明完整性与 when 条件约束
    const addBpKeybinding = keybindings.find((k) => k.command === "sceneBreakpoints.addBreakpoint");
    assert.ok(addBpKeybinding, "快捷键列表必须包含 addBreakpoint 绑定");
    assert.strictEqual(addBpKeybinding.key.toLowerCase(), "ctrl+alt+b", "Windows/Linux 快捷键应为 ctrl+alt+b");
    assert.strictEqual(addBpKeybinding.mac?.toLowerCase(), "cmd+alt+b", "macOS 快捷键应为 cmd+alt+b");
    assert.strictEqual(addBpKeybinding.when, "editorTextFocus", "快捷键必须严格约束在 editorTextFocus 上下文生效");

    const showMenuKeybinding = keybindings.find((k) => k.command === "sceneBreakpoints.showMenu");
    assert.ok(showMenuKeybinding, "快捷键列表必须包含 showMenu 绑定");
    assert.strictEqual(showMenuKeybinding.key.toLowerCase(), "ctrl+alt+s", "Windows/Linux 快捷键应为 ctrl+alt+s");
    assert.strictEqual(showMenuKeybinding.mac?.toLowerCase(), "cmd+alt+s", "macOS 快捷键应为 cmd+alt+s");

    const moveUpKeybinding = keybindings.find((k) => k.command === "sceneBreakpoints.moveBreakpointUp");
    assert.ok(moveUpKeybinding, "快捷键列表必须包含 moveBreakpointUp 绑定");
    assert.strictEqual(moveUpKeybinding.key.toLowerCase(), "alt+up", "移动快捷键应为 alt+up");
    assert.strictEqual(moveUpKeybinding.when, "focusedView == 'sceneBreakpointsView'");

    const moveDownKeybinding = keybindings.find((k) => k.command === "sceneBreakpoints.moveBreakpointDown");
    assert.ok(moveDownKeybinding, "快捷键列表必须包含 moveBreakpointDown 绑定");
    assert.strictEqual(moveDownKeybinding.key.toLowerCase(), "alt+down", "移动快捷键应为 alt+down");
    assert.strictEqual(moveDownKeybinding.when, "focusedView == 'sceneBreakpointsView'");

    // 3. 模拟激活场景与文本编辑器（获取 editorTextFocus 上下文）
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "sample.ts");
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(doc);

    // 将光标定位在第 9 行（0-based index 8）
    editor.selection = new vscode.Selection(new vscode.Position(8, 0), new vscode.Position(8, 0));

    // 触发快捷键绑定的添加断点命令 (带 mock 以便非交互式自动化完成)
    const origQuickPick = vscode.window.showQuickPick;
    const origInputBox = vscode.window.showInputBox;
    let step = 0;
    (vscode.window as any).showQuickPick = async (items: any) => {
      step++;
      if (step === 1) {
        return items.find((i: any) => i.sceneName === "login-flow") || items[0];
      }
      return items.find((i: any) => i.type === "line") || items[0];
    };
    (vscode.window as any).showInputBox = async () => "快捷键断点描述";

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.addBreakpoint");
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 验证该断点已成功通过快捷键命令注入到当前行
      const matchedBp = vscode.debug.breakpoints.find((bp) => {
        if (bp instanceof vscode.SourceBreakpoint) {
          return bp.location.range.start.line === 8;
        }
        return false;
      });
      assert.ok(matchedBp, "当编辑器获得焦点时，触发快捷键绑定命令必须成功在当前行注入断点");

      // 4. 触发快捷键绑定的 showMenu 命令验证 (模拟 Esc 取消，避免子命令递归阻塞)
      (vscode.window as any).showQuickPick = async () => undefined;
      await vscode.commands.executeCommand("sceneBreakpoints.showMenu");
    } finally {
      (vscode.window as any).showQuickPick = origQuickPick;
      (vscode.window as any).showInputBox = origInputBox;
    }
  });
});



