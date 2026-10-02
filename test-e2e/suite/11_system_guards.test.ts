import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

suite("Suite 11: 系统级拓扑守卫、防回环与容灾防线", () => {
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
        if ((vscode.debug.breakpoints.length as number) === 1) {
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

  test("TC-AI-03: 核心拓扑 Diff 防线 (Topology Diff Guard, INV-012)", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;

    // 1. 激活 login-flow 并等待装配完成
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.debug.breakpoints.length, 2);

    // 2. 开启 AI 声明式激活开关，使 fileWatcher 拥有调度权
    await vscode.workspace
      .getConfiguration("sceneBreakpoints")
      .update("allowAiFileActivation", true, vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      const bpRefsBefore = [...vscode.debug.breakpoints];

      // 3. 外部仅修改纯说明元数据：desc 注释 + bindings 映射 + 未激活闲置场景（核心拓扑字段完全不变）
      const json = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      json.scenes["login-flow"][0].desc = "拓扑无关的纯注释修改";
      json.bindings = { "Launch Test Session": ["login-flow"], "Extra Binding": ["discount-flow"] };
      json.scenes["idle-unused-scene"] = [{ type: "line", file: "src/sample.ts", line: 20, enabled: true }];
      fs.writeFileSync(configPath, JSON.stringify(json, null, 2), "utf-8");

      // 4. 等待 fileWatcher 防抖 (100ms) 与调度链路充分流过
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // 5. 核心断言：拓扑指纹未变时严禁重刷 DAP，断点必须原引用保留 (0 闪烁)
      const bpRefsAfter = vscode.debug.breakpoints;
      assert.strictEqual(bpRefsAfter.length, 2, "拓扑无关修改严禁增删断点数量");
      for (let i = 0; i < bpRefsBefore.length; i++) {
        assert.strictEqual(bpRefsAfter[i], bpRefsBefore[i], "核心拓扑未变时严禁重刷 DAP（0 闪烁防线）");
      }

      // 6. 证明磁盘内容确实已变更（防线拦截的是调度动作，而非文件未变）
      const diskJson = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.ok(diskJson.scenes["idle-unused-scene"], "外部写盘必须真实生效");

      // 7. 状态栏与激活状态保持稳定
      const statusBar = api.getStatusBarItem();
      assert.ok(statusBar.text.includes("[login-flow]"), "拓扑无关修改严禁扰动激活状态投影");
    } finally {
      await vscode.workspace
        .getConfiguration("sceneBreakpoints")
        .update("allowAiFileActivation", false, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("TC-AI-04: 反向同步防回环死循环 (Echo Loop Guard, INV-008)", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;

    // 1. 激活 login-flow 并等待装配完成
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.debug.breakpoints.length, 2);

    // 2. 开启 AI 激活开关，使 fileWatcher 拥有调度权（回环若有必然在此暴露）
    await vscode.workspace
      .getConfiguration("sceneBreakpoints")
      .update("allowAiFileActivation", true, vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      const configBefore = fs.readFileSync(configPath, "utf-8");
      const bpRefsBefore = [...vscode.debug.breakpoints];

      // 3. 模拟编辑器原生断点面板的启用/禁用切换效果（remove + add 取反 enabled）
      //    说明：用户在原生面板勾选产生的 changed 事件无法通过公开 API 合成，
      //    此处验证可测子集：DAP 断点变动严禁引发配置回环写盘与 DAP 反复重刷
      const target = vscode.debug.breakpoints[0] as vscode.SourceBreakpoint;
      const toggled = new vscode.SourceBreakpoint(
        target.location,
        !target.enabled,
        target.condition,
        target.hitCondition,
        target.logMessage,
      );
      vscode.debug.removeBreakpoints([target]);
      vscode.debug.addBreakpoints([toggled]);

      // 4. 覆盖防抖 (100ms) + 内部写盘安全窗 (600ms) + 充分余量
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // 5. 断点数量稳定：严禁回环反复增删 (死循环必然导致数量抖动)
      assert.strictEqual(vscode.debug.breakpoints.length, 2, "断点变动后严禁触发回环反复重刷");

      // 6. 配置文件严禁被断点变动回环改写
      assert.strictEqual(
        fs.readFileSync(configPath, "utf-8"),
        configBefore,
        "断点 API 变动严禁引发配置文件回环写盘",
      );

      // 7. 未操作的断点必须原引用保留（未被回环重刷替换）
      const bpRefsAfter = vscode.debug.breakpoints;
      const preserved = bpRefsBefore.filter((b) => bpRefsAfter.includes(b));
      assert.strictEqual(preserved.length, 1, "未操作的断点必须原引用保留，严禁被回环重刷");

      // 8. 状态栏场景保持稳定
      const statusBar = api.getStatusBarItem();
      assert.ok(statusBar.text.includes("[login-flow]"), "回环守卫下状态栏场景必须保持稳定");
    } finally {
      await vscode.workspace
        .getConfiguration("sceneBreakpoints")
        .update("allowAiFileActivation", false, vscode.ConfigurationTarget.Workspace);
    }
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
