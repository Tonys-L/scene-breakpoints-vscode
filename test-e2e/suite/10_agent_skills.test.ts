import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

suite("Suite 10: Agent 技能分发、巡检与平滑升级", () => {
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
