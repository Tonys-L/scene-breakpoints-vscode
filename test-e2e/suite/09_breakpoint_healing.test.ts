import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

suite("Suite 09: 智能断点自然漂移自愈与持久化回写", () => {
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

  test("TC-ENRICH-01: 外部保存空指纹场景自动预加固与多场景激活持久化闭环", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "debug-scenes.json").fsPath;
    const origConfig = fs.readFileSync(configPath, "utf-8");

    try {
      // 1. 模拟外部写入两个无 contextSnippet 的全新未激活场景
      const parsed = JSON.parse(origConfig);
      parsed.scenes["unactivated-pre-enrich"] = [
        {
          type: "line",
          file: "src/sample.ts",
          line: 5,
          enabled: true,
          desc: "未激活场景断点",
        },
      ];
      parsed.scenes["second-multi-scene"] = [
        {
          type: "line",
          file: "src/sample.ts",
          line: 12,
          enabled: true,
          desc: "第二个未激活场景断点",
        },
      ];
      fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), "utf-8");

      // 2. 模拟文件保存触发外部变更与全场景预加固
      const { handleExternalScenesFileChange } = await import("#src/infra/vscode/listeners/configFileWatcherListener.js");
      await handleExternalScenesFileChange(workspaceFolders[0].uri.fsPath);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 3. 验证未激活场景断点已被静默预补齐 contextSnippet
      const enrichedConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const enrichedBp1 = enrichedConfig.scenes["unactivated-pre-enrich"]?.[0];
      assert.ok(enrichedBp1?.contextSnippet, "外部保存后，未激活场景断点必须自动加固 contextSnippet");
      assert.ok(typeof enrichedBp1?.contextSnippet?.current === "string" && enrichedBp1.contextSnippet.current.length > 0);

      // 4. 激活多场景叠加装配
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", [
        "unactivated-pre-enrich",
        "second-multi-scene",
      ]);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 5. 验证多场景激活下所有场景断点均持久化存在且指纹完备
      const afterApplyConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const finalBp2 = afterApplyConfig.scenes["second-multi-scene"]?.[0];
      assert.ok(finalBp2?.contextSnippet, "多场景激活后，所有叠加场景断点必须 100% 持久化保留指纹");
      assert.strictEqual(vscode.debug.breakpoints.length, 2, "DAP 必须成功挂载 2 个多场景断点");
    } finally {
      fs.writeFileSync(configPath, origConfig, "utf-8");
      await vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    }
  });
});
