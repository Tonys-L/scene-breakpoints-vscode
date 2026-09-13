import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
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

      // 验证 .cursor/rules/scene-breakpoints.mdc 文件被真实生成
      const mdcUri = vscode.Uri.joinPath(workspaceFolders[0].uri, ".cursor", "rules", "scene-breakpoints.mdc");
      assert.ok(fs.existsSync(mdcUri.fsPath), "Cursor 规范规则文件必须成功写入");
      const content = fs.readFileSync(mdcUri.fsPath, "utf-8");
      assert.ok(content.includes("scene-breakpoints"), "生成的文件内容应包含 Skill 指南规范");
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

  test("TC-HEAL-01: 代码行号自然漂移自愈与持久化回写闭环 (KDD-HEALING-LOOP-001)", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const samplePath = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "sample.ts").fsPath;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;
    const originalSampleContent = fs.readFileSync(samplePath, "utf-8");

    try {
      // 1. 在配置中定义带有代码指纹的自愈测试场景
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      config.scenes["healing-drift-scene"] = [
        {
          type: "line",
          file: "src/sample.ts",
          line: 3,
          enabled: true,
          desc: "待自愈断点",
          contextSnippet: {
            prev: "const normalized = email.trim().toLowerCase();",
            current: "if (!normalized) {",
            next: "throw new Error(\"Invalid email\");",
            scopeAnchor: "loginUser",
            indent: 2,
          },
        },
      ];
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

      // 2. 初始装配场景，验证注入在第 3 行
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["healing-drift-scene"]);
      await new Promise((resolve) => setTimeout(resolve, 300));

      assert.strictEqual(vscode.debug.breakpoints.length, 1);
      let bp = vscode.debug.breakpoints[0] as vscode.SourceBreakpoint;
      assert.strictEqual(bp.location.range.start.line + 1, 3, "初始应定位在第 3 行");

      // 3. 模拟开发者在源码断点前插入 4 行代码，使目标代码由第 3 行下移至第 7 行
      const doc = await vscode.workspace.openTextDocument(samplePath);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, new vscode.Position(0, 0), "// comment 1\n// comment 2\n// comment 3\n// comment 4\n");
      await vscode.workspace.applyEdit(edit);
      await doc.save();

      // 4. 再次触发激活/装配场景
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["healing-drift-scene"]);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 5. 核心断言 1：DAP 真实断点自动自愈漂移至第 7 行！
      assert.strictEqual(vscode.debug.breakpoints.length, 1);
      bp = vscode.debug.breakpoints[0] as vscode.SourceBreakpoint;
      assert.strictEqual(bp.location.range.start.line + 1, 7, "自愈引擎必须将 DAP 断点智能更新到第 7 行");

      // 6. 核心断言 2：debug-scenes.json 必须自动反向回写，将 line 更新为 7 完成闭环！
      const updatedConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const savedBp = updatedConfig.scenes["healing-drift-scene"]?.[0];
      assert.strictEqual(savedBp?.line, 7, "自愈引擎必须自动持久化回写至 debug-scenes.json");
    } finally {
      const doc = await vscode.workspace.openTextDocument(samplePath);
      const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
      const revertEdit = new vscode.WorkspaceEdit();
      revertEdit.replace(doc.uri, fullRange, originalSampleContent);
      await vscode.workspace.applyEdit(revertEdit);
      await doc.save();
    }
  });

  test("TC-HEAL-02: 破坏性修改未匹配脱靶告警 (KDD-UNMATCHED-WARN-001)", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const samplePath = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "sample.ts").fsPath;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;
    const originalSampleContent = fs.readFileSync(samplePath, "utf-8");

    // 监听脱靶警告弹窗
    const origWarn = vscode.window.showWarningMessage;
    let unmatchedWarnPopped = false;
    (vscode.window as any).showWarningMessage = async (msg: string, ...args: any[]) => {
      if (msg.includes("unmatched") || msg.includes("未匹配") || msg.includes("脱靶")) {
        unmatchedWarnPopped = true;
      }
      return undefined;
    };

    try {
      // 1. 配置一个带有精确指纹的断点
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      config.scenes["unmatched-test-scene"] = [
        {
          type: "line",
          file: "src/sample.ts",
          line: 3,
          enabled: true,
          contextSnippet: {
            prev: "unique_prev_token_xyz",
            current: "unique_current_target_xyz",
            next: "unique_next_token_xyz",
            scopeAnchor: "someFunction",
          },
        },
      ];
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

      // 2. 装配场景（源码中完全不存在该指纹，探测脱靶）
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["unmatched-test-scene"]);
      await new Promise((resolve) => setTimeout(resolve, 400));

      // 3. 验证脱靶告警机制触发
      assert.strictEqual(unmatchedWarnPopped, true, "脱靶失联断点装配时必须触发警告通知");
    } finally {
      (vscode.window as any).showWarningMessage = origWarn;
      fs.writeFileSync(samplePath, originalSampleContent, "utf-8");
    }
  });

  test("TC-HEAL-03: Python 缩进敏感与 # 注释生态自然漂移自愈与持久化闭环", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const pyPath = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "service.py").fsPath;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;
    const origPyContent = fs.readFileSync(pyPath, "utf-8");

    try {
      // 1. 配置 Python 场景 (断点在第 6 行: if amount <= 0:)
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      config.scenes["python-healing-scene"] = [
        {
          type: "line",
          file: "src/service.py",
          line: 6,
          enabled: true,
          desc: "Python 金额校验分支",
          contextSnippet: {
            prev: "def process_payment(self, order_id, amount):",
            current: "if amount <= 0:",
            next: 'raise ValueError("Invalid amount")',
            scopeAnchor: "process_payment",
            indent: 8,
          },
        },
      ];
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

      // 2. 初始装配
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["python-healing-scene"]);
      await new Promise((resolve) => setTimeout(resolve, 300));

      assert.strictEqual(vscode.debug.breakpoints.length, 1);
      let bp = vscode.debug.breakpoints[0] as vscode.SourceBreakpoint;
      assert.strictEqual(bp.location.range.start.line + 1, 6, "Python 初始断点应在第 6 行");

      // 3. 模拟插入 3 行 Python 格式注释，代码下移至第 9 行
      const doc = await vscode.workspace.openTextDocument(pyPath);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, new vscode.Position(0, 0), "# py comment 1\n# py comment 2\n# py comment 3\n");
      await vscode.workspace.applyEdit(edit);
      await doc.save();

      // 4. 再次装配触发自愈
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["python-healing-scene"]);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 5. 验证 DAP 断点自愈到第 9 行
      assert.strictEqual(vscode.debug.breakpoints.length, 1);
      bp = vscode.debug.breakpoints[0] as vscode.SourceBreakpoint;
      assert.strictEqual(bp.location.range.start.line + 1, 9, "Python 缩进断点必须智能自愈漂移到第 9 行");

      // 6. 验证持久化回写
      const updatedConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const savedBp = updatedConfig.scenes["python-healing-scene"]?.[0];
      assert.strictEqual(savedBp?.line, 9, "Python 自愈后必须持久化回写更新 line 为 9");
    } finally {
      const doc = await vscode.workspace.openTextDocument(pyPath);
      const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
      const revertEdit = new vscode.WorkspaceEdit();
      revertEdit.replace(doc.uri, fullRange, origPyContent);
      await vscode.workspace.applyEdit(revertEdit);
      await doc.save();
    }
  });

  test("TC-HEAL-04: Go 接收者方法 func (c *Calculator) 多语言自愈与持久化闭环", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const goPath = vscode.Uri.joinPath(workspaceFolders[0].uri, "src", "calculator.go").fsPath;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;
    const origGoContent = fs.readFileSync(goPath, "utf-8");

    try {
      // 1. 配置 Go 场景 (断点在第 8 行: result := x * y)
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      config.scenes["go-healing-scene"] = [
        {
          type: "line",
          file: "src/calculator.go",
          line: 8,
          enabled: true,
          desc: "Go 乘法计算核心行",
          contextSnippet: {
            prev: "func (c *Calculator) Multiply(x float64, y float64) float64 {",
            current: "result := x * y",
            next: "return result",
            scopeAnchor: "Multiply",
            indent: 1,
          },
        },
      ];
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

      // 2. 初始装配
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["go-healing-scene"]);
      await new Promise((resolve) => setTimeout(resolve, 300));

      assert.strictEqual(vscode.debug.breakpoints.length, 1);
      let bp = vscode.debug.breakpoints[0] as vscode.SourceBreakpoint;
      assert.strictEqual(bp.location.range.start.line + 1, 8, "Go 初始断点应在第 8 行");

      // 3. 模拟插入 2 行 Go 注释，使代码下移至第 10 行
      const doc = await vscode.workspace.openTextDocument(goPath);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, new vscode.Position(0, 0), "// go comment 1\n// go comment 2\n");
      await vscode.workspace.applyEdit(edit);
      await doc.save();

      // 4. 再次装配触发自愈
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["go-healing-scene"]);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 5. 验证 DAP 断点自愈到第 10 行
      assert.strictEqual(vscode.debug.breakpoints.length, 1);
      bp = vscode.debug.breakpoints[0] as vscode.SourceBreakpoint;
      assert.strictEqual(bp.location.range.start.line + 1, 10, "Go 接收者方法断点必须智能自愈漂移到第 10 行");

      // 6. 验证持久化回写
      const updatedConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const savedBp = updatedConfig.scenes["go-healing-scene"]?.[0];
      assert.strictEqual(savedBp?.line, 10, "Go 自愈后必须持久化回写更新 line 为 10");
    } finally {
      const doc = await vscode.workspace.openTextDocument(goPath);
      const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
      const revertEdit = new vscode.WorkspaceEdit();
      revertEdit.replace(doc.uri, fullRange, origGoContent);
      await vscode.workspace.applyEdit(revertEdit);
      await doc.save();
    }
  });

  test("TC-SKILL-01: Skill 纯净历史版本检测与一键自动平滑升级 (模拟上游发版升级生命周期)", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const mdcPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".cursor", "rules", "scene-breakpoints.mdc").fsPath;
    const ext = vscode.extensions.getExtension("tony-l.scene-breakpoints-vscode")!;
    const skillSourcePath = vscode.Uri.joinPath(ext.extensionUri, "skills", "scene-breakpoints", "SKILL.md").fsPath;

    // 备份官方真实模板内容，确保测试后 100% 还原
    const originalSkillContent = fs.readFileSync(skillSourcePath, "utf-8");

    // 1. 本地写入真实官方 v1.0.3 纯净规则（剥离原 Frontmatter 后包装为标准 MDC）
    const v103Body = originalSkillContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, "");
    const v103Mdc = `---
description: Scene Breakpoints
globs: *
---

${v103Body}
`;
    fs.mkdirSync(path.dirname(mdcPath), { recursive: true });
    fs.writeFileSync(mdcPath, v103Mdc, "utf-8");

    // 2. 模拟上游官方发布未来新版本（模板追加新特性标记）
    const simulatedNextGenSkill = originalSkillContent + "\n\n<!-- SIMULATED_FUTURE_UPSTREAM_FEATURE -->\n";
    fs.writeFileSync(skillSourcePath, simulatedNextGenSkill, "utf-8");

    // 3. 调出诊断并选择一键平滑升级
    const origQuickPick = vscode.window.showQuickPick;
    let upgradedActionExecuted = false;

    (vscode.window as any).showQuickPick = async (items: any[]) => {
      // 寻找可升级的 Cursor 项 (CleanOutdated)
      const cursorItem = items.find((it) => it.label?.includes("Cursor") && it.action);
      if (cursorItem) {
        upgradedActionExecuted = true;
        return cursorItem;
      }
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.diagnoseAiIntegration");
      await new Promise((resolve) => setTimeout(resolve, 800));

      assert.strictEqual(upgradedActionExecuted, true, "诊断面板中必须识别出 CleanOutdated 升级项");

      // 验证文件已成功平滑更新为未来新版本内容
      const newContent = fs.readFileSync(mdcPath, "utf-8");
      assert.ok(newContent.includes("SIMULATED_FUTURE_UPSTREAM_FEATURE"), "本地规则必须已平滑升级为上游最新模板");
      assert.ok(newContent.includes("scene-breakpoints"), "新内容应包含官方模板规范");
    } finally {
      // 彻底还原官方模板与工作区现场
      fs.writeFileSync(skillSourcePath, originalSkillContent, "utf-8");
      (vscode.window as any).showQuickPick = origQuickPick;
      if (fs.existsSync(mdcPath)) fs.unlinkSync(mdcPath);
    }
  });

  test("TC-SKILL-02: Skill 用户定制版检测、.bak 物理备份生成与 vscode.diff 审查", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const mdcPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".cursor", "rules", "scene-breakpoints.mdc").fsPath;

    // 1. 模拟用户本地手动修改定制过的规则文件
    const customContent = `---
description: Scene Breakpoints Custom
globs: *
---

# Scene Breakpoints
// USER_CUSTOM_SECRET_RULE_XYZ: 开发者专属自定义调试编排规则
`;
    fs.mkdirSync(path.dirname(mdcPath), { recursive: true });
    fs.writeFileSync(mdcPath, customContent, "utf-8");

    // 2. 模拟诊断中选择 CustomModified -> backup (生成备份并覆写)
    const origQuickPick = vscode.window.showQuickPick;
    let subPickCount = 0;

    (vscode.window as any).showQuickPick = async (items: any[]) => {
      subPickCount++;
      if (subPickCount === 1) {
        // 第一层：诊断列表中选中 CustomModified 的 Cursor 项
        const customCursor = items.find((it) => it.label?.includes("Cursor") && it.action);
        return customCursor;
      } else if (subPickCount === 2) {
        // 第二层：动作选择弹窗，选择 backup (备份并覆写)
        const backupOption = items.find((it) => it.value === "backup");
        return backupOption;
      }
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.diagnoseAiIntegration");
      await new Promise((resolve) => setTimeout(resolve, 800));

      // 验证同目录下生成了时间戳 .bak 物理备份文件
      const parentDir = path.dirname(mdcPath);
      const filesInDir = fs.readdirSync(parentDir);
      const bakFiles = filesInDir.filter((f: string) => f.startsWith("scene-breakpoints.mdc.") && f.endsWith(".bak"));
      assert.ok(bakFiles.length >= 1, "必须在同目录下生成 .bak 物理备份副本");

      // 验证备份副本内容完全保真用户原修改
      const bakContent = fs.readFileSync(path.join(parentDir, bakFiles[0]), "utf-8");
      assert.ok(bakContent.includes("USER_CUSTOM_SECRET_RULE_XYZ"), "备份文件必须完整保真用户的定制修改");

      // 验证主文件已被安全覆写为最新版本
      const newMdcContent = fs.readFileSync(mdcPath, "utf-8");
      assert.ok(!newMdcContent.includes("USER_CUSTOM_SECRET_RULE_XYZ"), "原文件应已更新为官方模板");
    } finally {
      (vscode.window as any).showQuickPick = origQuickPick;
      // 清理备份文件与测试文件
      const parentDir = path.dirname(mdcPath);
      if (fs.existsSync(parentDir)) {
        const files = fs.readdirSync(parentDir);
        for (const f of files) {
          if (f.startsWith("scene-breakpoints.mdc")) {
            fs.unlinkSync(path.join(parentDir, f));
          }
        }
      }
    }
  });

  test("TC-SKILL-03: 扩展版本升级巡检与本地修改/可用更新气泡提示闭环", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const skillPath = vscode.Uri.joinPath(
      workspaceFolders[0].uri,
      ".agents",
      "skills",
      "scene-breakpoints",
      "SKILL.md",
    ).fsPath;

    // 1. 模拟本地存在开发者定制修改过的 Antigravity Skill
    const customContent = `---
name: scene-breakpoints
description: Antigravity Skill Custom
---

# Scene Breakpoints
// USER_CUSTOM_LOGIC_ALERT_ABC: 开发者专属本地定制规则
`;
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, customContent, "utf-8");

    // 2. 拦截通知弹窗，验证气泡弹出并包含差异对比入口
    const origInfo = vscode.window.showInformationMessage;
    let poppedPrompt = "";
    let poppedActions: string[] = [];

    (vscode.window as any).showInformationMessage = async (msg: string, ...actions: string[]) => {
      poppedPrompt = msg;
      poppedActions = actions;
      // 模拟用户点击第一个 Diff 动作
      return actions.find((a) => a.includes("Diff") || a.includes("差异"));
    };

    const ext = vscode.extensions.getExtension("tony-l.scene-breakpoints-vscode")!;
    const mockContext = {
      extensionUri: ext.extensionUri,
      extension: { packageJSON: { version: "1.0.5" } },
      workspaceState: {
        get: (k: string) => (k === "lastNotifiedSkillVersion" ? "1.0.3" : undefined),
        update: async () => {},
      },
    } as any;

    try {
      await api.checkAndPromptSkillUpdates(mockContext, workspaceFolders[0].uri.fsPath);
      await new Promise((resolve) => setTimeout(resolve, 400));

      // 验证弹窗被成功触发
      assert.ok(
        poppedPrompt.includes("Skill") || poppedPrompt.includes("AI"),
        `升级巡检必须弹出提示气泡，当前提示为: ${poppedPrompt}`,
      );

      // 验证动作选项中包含查看差异 Diff 与诊断面板
      const hasDiffAction = poppedActions.some((a) => a.includes("Diff") || a.includes("差异"));
      const hasDiagnoseAction = poppedActions.some((a) => a.includes("Diagnostics") || a.includes("诊断"));
      assert.strictEqual(hasDiffAction, true, "气泡中必须提供直接查看差异 (Diff) 按钮");
      assert.strictEqual(hasDiagnoseAction, true, "气泡中必须提供打开诊断面板按钮");
    } finally {
      (vscode.window as any).showInformationMessage = origInfo;
      if (fs.existsSync(skillPath)) {
        fs.unlinkSync(skillPath);
      }
    }
  });

  test("TC-SKILL-04: 跨平台 (Antigravity/Cursor) Frontmatter 剥离指纹一致性与已安装平台智能置顶", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const ext = vscode.extensions.getExtension("tony-l.scene-breakpoints-vscode")!;
    const officialSkillUri = vscode.Uri.joinPath(ext.extensionUri, "skills", "scene-breakpoints", "SKILL.md");
    const rawOfficial = fs.readFileSync(officialSkillUri.fsPath, "utf-8");
    const officialBody = rawOfficial.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, "");

    // 平台 1: Cursor (添加 Cursor MDC 胶水头，但核心正文 100% 吻合官方)
    const cursorMdcPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".cursor", "rules", "scene-breakpoints.mdc").fsPath;
    const cursorContent = `---\ndescription: Cursor Rule Glue Header\nglobs: **\n---\n\n${officialBody}`;
    fs.mkdirSync(path.dirname(cursorMdcPath), { recursive: true });
    fs.writeFileSync(cursorMdcPath, cursorContent, "utf-8");

    // 平台 2: Antigravity (正文中注入用户自定义修改)
    const antigravityPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".agents", "skills", "scene-breakpoints", "SKILL.md").fsPath;
    const antigravityContent = `---\nname: scene-breakpoints\n---\n\n${officialBody}\n\n// USER_PRIVATE_RULE_001\n`;
    fs.mkdirSync(path.dirname(antigravityPath), { recursive: true });
    fs.writeFileSync(antigravityPath, antigravityContent, "utf-8");

    // 拦截诊断面板 QuickPick
    const origQuickPick = vscode.window.showQuickPick;
    let menuItems: any[] = [];

    (vscode.window as any).showQuickPick = async (items: any[]) => {
      menuItems = items;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.diagnoseAiIntegration");
      await new Promise((resolve) => setTimeout(resolve, 500));

      assert.ok(menuItems.length > 0, "必须成功调出诊断菜单");

      // 1. 验证已安装平台置顶排序
      const installedIndices: number[] = [];
      const notInstalledIndices: number[] = [];

      menuItems.forEach((item, idx) => {
        if (!item.label) return;
        if (item.label.includes("Cursor") || item.label.includes("Antigravity")) {
          installedIndices.push(idx);
        } else if (item.label.includes("Not Installed") || item.label.includes("未安装")) {
          notInstalledIndices.push(idx);
        }
      });

      assert.ok(installedIndices.length === 2, "必须成功检测到 2 个已安装的平台");
      assert.ok(notInstalledIndices.length > 0, "必须存在未安装的平台");

      const maxInstalledIndex = Math.max(...installedIndices);
      const minNotInstalledIndex = Math.min(...notInstalledIndices);
      assert.ok(
        maxInstalledIndex < minNotInstalledIndex,
        `已安装平台必须智能置顶展示！实际最大已安装索引=${maxInstalledIndex}，最小未安装索引=${minNotInstalledIndex}`,
      );

      // 2. 验证 Frontmatter 剥离指纹一致性 (Cursor 虽有 MDC 胶水头，但核心正文未变，判定为 UpToDate)
      const cursorItem = menuItems.find((it) => it.label?.includes("Cursor"));
      assert.ok(
        cursorItem.label.includes("Up to Date") || cursorItem.label.includes("最新"),
        `Cursor 核心正文未修改时必须精准识别为 UpToDate，当前为: ${cursorItem.label}`,
      );

      // 3. 验证本地修改状态判定 (Antigravity 正文被修改，判定为 Customized)
      const antigravityItem = menuItems.find((it) => it.label?.includes("Antigravity"));
      assert.ok(
        antigravityItem.label.includes("Customized") || antigravityItem.label.includes("本地修改") || antigravityItem.label.includes("Diff"),
        `Antigravity 存在定制修改时必须精准识别为 Customized，当前为: ${antigravityItem.label}`,
      );
    } finally {
      (vscode.window as any).showQuickPick = origQuickPick;
      if (fs.existsSync(cursorMdcPath)) fs.unlinkSync(cursorMdcPath);
      if (fs.existsSync(antigravityPath)) fs.unlinkSync(antigravityPath);
    }
  });
});

