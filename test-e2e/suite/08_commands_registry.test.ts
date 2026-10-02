import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

suite("Suite 08: 扩展命令总线就绪与快捷键触发契约", () => {
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
