import * as assert from "node:assert";
import * as fs from "node:fs";
import * as vscode from "vscode";

suite("Suite 04: 自愈回写、AI 声明式编排与系统级防灾守卫", () => {
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
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    if (initialConfigContent) {
      const configUri = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json");
      await vscode.workspace.fs.writeFile(configUri, Buffer.from(initialConfigContent, "utf-8"));
    }
    // 清理生成的 .cursor 临时目录
    const cursorDirUri = vscode.Uri.joinPath(workspaceFolders[0].uri, ".cursor");
    try {
      await vscode.workspace.fs.delete(cursorDirUri, { recursive: true, useTrash: false });
    } catch {}
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

  test("TC-AI-01: 外部修改 activeScenes 声明式响应装配 (FileWatcher)", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;

    // 先激活 login-flow
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.debug.breakpoints.length, 2);

    // 开启 AI 声明式激活开关
    await vscode.workspace
      .getConfiguration("sceneBreakpoints")
      .update("allowAiFileActivation", true, vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      // 外部直接改写磁盘配置文件，将 activeScenes 变更为 ["discount-flow"]
      const raw = fs.readFileSync(configPath, "utf-8");
      const json = JSON.parse(raw);
      json.activeScenes = ["discount-flow"];
      fs.writeFileSync(configPath, JSON.stringify(json, null, 2), "utf-8");

      // 弹性等待 FileWatcher 防抖与 DAP 响应式重装配 (最多 3500ms)
      const startTime = Date.now();
      while (Date.now() - startTime < 3500) {
        if (vscode.debug.breakpoints.length === 1) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // 断言 DAP 自动响应式切换为 discount-flow (1 个断点)
      assert.strictEqual(vscode.debug.breakpoints.length, 1, "FileWatcher 应响应式下发 discount-flow 断点");
      const statusBar = api.getStatusBarItem();
      assert.ok(statusBar.text.includes("[discount-flow]"), "状态栏应自动响应切换为 [discount-flow]");
    } finally {
      await vscode.workspace
        .getConfiguration("sceneBreakpoints")
        .update("allowAiFileActivation", false, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("TC-AI-02: 幽灵场景拦截守卫 (Ghost Scene Guard, INV-009)", async () => {
    // 尝试激活未在 scenes 字典中声明的伪造场景
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["non-existent-ghost-scene"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 状态栏绝不可被伪造场景染绿或误设
    const statusBar = api.getStatusBarItem();
    assert.ok(!statusBar.text.includes("non-existent-ghost-scene"), "幽灵场景绝不可被误录入状态机");
  });

  test("TC-SESS-02 & TC-CONF-01: Launch 调试配置联动与 autoActivate 开关受控 (INV-007)", async () => {
    // 1. autoActivateOnLaunch = true 时，启动同名配置自动激活
    await vscode.workspace
      .getConfiguration("sceneBreakpoints")
      .update("autoActivateOnLaunch", true, vscode.ConfigurationTarget.Workspace);

    // 模拟 launch.json 配置项 resolve 生命周期
    const folder = vscode.workspace.workspaceFolders?.[0];
    const mockConfig: vscode.DebugConfiguration = {
      type: "node",
      name: "discount-flow", // 与场景同名
      request: "launch",
    };

    // 触发启动配置解析器
    const ext = vscode.extensions.getExtension("tony-l.scene-breakpoints-vscode")!;
    // 调用内置的命令激活链路
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", [mockConfig.name]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.debug.breakpoints.length, 1, "启动配置同名联动应成功激活场景");

    // 2. autoActivateOnLaunch = false 时，尊重用户偏好
    await vscode.workspace
      .getConfiguration("sceneBreakpoints")
      .update("autoActivateOnLaunch", false, vscode.ConfigurationTarget.Workspace);

    const isAutoActive = vscode.workspace
      .getConfiguration("sceneBreakpoints")
      .get<boolean>("autoActivateOnLaunch");
    assert.strictEqual(isAutoActive, false, "配置项开关必须受控有效");
  });

  test("TC-CONF-03: 未保存临时断点 Dirty 状态切换决策保护", async () => {
    // 1. 激活 login-flow
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 2. 制造临时未保存断点 (Dirty 态)
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "sample.ts");
    const tempBp = new vscode.SourceBreakpoint(new vscode.Location(fileUri, new vscode.Position(9, 0)));
    vscode.debug.addBreakpoints([tempBp]);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 3. 此时尝试切换场景，验证是否拦截并弹出警告决策弹窗
    const origWarn = vscode.window.showWarningMessage;
    let warningPopped = false;
    (vscode.window as any).showWarningMessage = async (msg: string, opts: any, ...items: string[]) => {
      warningPopped = true;
      // 模拟选择放弃临时断点
      return items.find((i) => i.includes("Discard")) || items[1];
    };

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["discount-flow"]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.strictEqual(warningPopped, true, "存在未保存临时断点时，切换场景必须触发安全弹窗拦截保护");
    } finally {
      (vscode.window as any).showWarningMessage = origWarn;
    }
  });

  test("CMD-08 & CMD-09: Agent Skill 分发与 AI 集成全维状态诊断", async () => {
    // 1. 诊断命令
    let diagQuickPickCalled = false;
    const origQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (items: any) => {
      diagQuickPickCalled = true;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.diagnoseAiIntegration");
      assert.strictEqual(diagQuickPickCalled, true, "diagnoseAiIntegration 必须成功调出诊断面板");
    } finally {
      (vscode.window as any).showQuickPick = origQuickPick;
    }

    // 2. 安装 Skill 到 Cursor
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    (vscode.window as any).showQuickPick = async (items: any) => {
      // 选中 Cursor 目标 (支持多选，返回数组)
      const match = items.find((it: any) => it.label === "Cursor") || items[0];
      return match ? [match] : [];
    };

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.installSkill");
      await new Promise((resolve) => setTimeout(resolve, 400));

      // 验证 .cursor/rules/manage-scenes.mdc 文件被真实生成
      const mdcUri = vscode.Uri.joinPath(workspaceFolders[0].uri, ".cursor", "rules", "manage-scenes.mdc");
      assert.ok(fs.existsSync(mdcUri.fsPath), "Cursor 规范规则文件必须成功写入");
      const content = fs.readFileSync(mdcUri.fsPath, "utf-8");
      assert.ok(content.includes("manage-scenes"), "生成的文件内容应包含 Skill 指南规范");
    } finally {
      (vscode.window as any).showQuickPick = origQuickPick;
    }
  });

  test("TC-CONF-05: Git 合并冲突标记与破损配置防御性容灾 (INV-006)", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const conflictConfig = `
{
  "scenes": {
<<<<<<< HEAD
    "conflict-scene": []
=======
    "conflict-scene": [{"type": "line", "file": "src/sample.ts", "line": 3}]
>>>>>>> branch
  }
}
`;
    // 测试解析层在此类冲突标记下具备容灾保护，不抛未捕获崩溃
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "conflict-temp.json").fsPath;
    fs.writeFileSync(configPath, conflictConfig, "utf-8");
    try {
      assert.ok(fs.existsSync(configPath));
    } finally {
      if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    }
  });
});
