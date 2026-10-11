import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Suite 12: 场景引用组合引擎 (TC-REF-01 ~ TC-REF-05, INV-030)
 * 覆盖：组合激活时序 / 成环阻断 / 悬空降级 / 引用启停子树摘除 / 导出导入保真往返
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// DAP 断点行号读取（1-based 行 - 1；沿用 Suite 11 的 SourceBreakpoint 收窄惯例）
const bpLine = (b: vscode.Breakpoint): number => (b as vscode.SourceBreakpoint).location!.range.start.line;

// 与 test-fixtures/sample-workspace/src/sample.ts 实际源码对齐的上下文指纹（保障自愈匹配不误报脱靶）
const AUTH_SNIPPET = {
  current: "if (!normalized) {",
  prev: "const normalized = email.trim().toLowerCase();",
  next: 'throw new Error("Invalid email");',
  scopeAnchor: "loginUser",
  indent: 2,
};
const PAYMENT_SNIPPET = {
  current: 'if (level === "vip") {',
  prev: "let rate = 1.0;",
  next: "rate = 0.8;",
  scopeAnchor: "calculateDiscount",
  indent: 2,
};

const authCoreBp = {
  type: "line",
  file: "src/sample.ts",
  line: 3,
  enabled: true,
  desc: "auth-core 通用断点",
  contextSnippet: AUTH_SNIPPET,
};
const paymentOwnBp = {
  type: "line",
  file: "src/sample.ts",
  line: 12,
  enabled: true,
  desc: "payment 自有业务断点",
  contextSnippet: PAYMENT_SNIPPET,
};

suite("Suite 12: 场景引用组合激活、成环拦截、悬空降级、引用启停与导出保真", () => {
  let api: any;
  let initialConfigContent: string;
  let configPath: string;

  const writeConfig = (scenes: Record<string, unknown[]>): void => {
    fs.writeFileSync(configPath, JSON.stringify({ scenes }, null, 2), "utf-8");
  };

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension("tony-l.scene-breakpoints-vscode");
    assert.ok(ext, "扩展必须被 VS Code 发现");
    api = await ext.activate();
    assert.ok(api, "扩展应成功返回 ExtensionApi");

    const workspaceFolders = vscode.workspace.workspaceFolders!;
    configPath = path.join(workspaceFolders[0].uri.fsPath, ".vscode", "debug-scenes.json");
    initialConfigContent = fs.readFileSync(configPath, "utf-8");
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    if (initialConfigContent) {
      fs.writeFileSync(configPath, initialConfigContent, "utf-8");
    }
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const localConfigPath = path.join(workspaceFolders[0].uri.fsPath, ".vscode", "debug-scenes.local.json");
    if (fs.existsSync(localConfigPath)) {
      try { fs.unlinkSync(localConfigPath); } catch {}
    }
  });

  teardown(async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    if (initialConfigContent) {
      fs.writeFileSync(configPath, initialConfigContent, "utf-8");
    }
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const localConfigPath = path.join(workspaceFolders[0].uri.fsPath, ".vscode", "debug-scenes.local.json");
    if (fs.existsSync(localConfigPath)) {
      try { fs.unlinkSync(localConfigPath); } catch {}
    }
    await sleep(200);
  });

  test("TC-REF-01: 组合激活时序——引用按声明序深度优先展开下发，树呈现嵌套引用结构", async () => {
    writeConfig({
      "auth-core": [authCoreBp],
      "payment-debug": [{ type: "scene", name: "auth-core" }, paymentOwnBp],
    });
    await sleep(500);

    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["payment-debug"]);
    await sleep(400);

    // 断点按声明序深度优先展开：先被引用 auth-core 的 L3，后 payment-debug 自有 L12
    const bps = vscode.debug.breakpoints;
    assert.strictEqual(bps.length, 2, "引用子树断点与自有断点应全部下发");
    assert.strictEqual(bpLine(bps[0]), 2, "首个断点应为被引用 auth-core 的 L3（深度优先声明序）");
    assert.strictEqual(bpLine(bps[1]), 11, "第二个断点应为 payment-debug 自有的 L12");

    // 树视图声明态投影：引用为一等节点，子树只读
    const rootNodes = await api.treeDataProvider.getChildren();
    const paymentNode = rootNodes.find((n: any) => n.sceneName === "payment-debug");
    assert.ok(paymentNode, "树中必须存在 payment-debug 场景节点");
    const children = await api.treeDataProvider.getChildren(paymentNode);
    assert.strictEqual(children.length, 2, "场景子层应投影引用节点与断点节点");
    const refNode = children[0];
    assert.strictEqual(refNode.refName, "auth-core", "首子节点应为 auth-core 一等引用节点");
    assert.strictEqual(refNode.index, 0, "引用节点应保真其在声明步骤中的索引");
    assert.strictEqual(refNode.isEnabled, true, "引用节点初始应为启用态");
    const refChildren = await api.treeDataProvider.getChildren(refNode);
    assert.strictEqual(refChildren.length, 1, "引用子树应投影源场景声明态");
    assert.ok(
      typeof refChildren[0].isReadonly === "function" && refChildren[0].isReadonly(),
      "引用内断点应为只读投影节点",
    );
  });

  test("TC-REF-02: 引用成环阻断激活——错误通知含完整环路径且零下发零落盘", async () => {
    writeConfig({
      "ref-a": [{ type: "scene", name: "ref-b" }],
      "ref-b": [{ type: "scene", name: "ref-a" }],
    });
    await sleep(500);
    const before = fs.readFileSync(configPath, "utf-8");

    const origError = vscode.window.showErrorMessage;
    const errors: unknown[] = [];
    (vscode.window as any).showErrorMessage = async (msg: unknown) => {
      errors.push(msg);
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["ref-a"]);
      await sleep(400);
    } finally {
      (vscode.window as any).showErrorMessage = origError;
    }

    assert.ok(
      errors.some((m) => typeof m === "string" && m.includes("ref-a → ref-b → ref-a")),
      "错误通知必须包含完整环路径 ref-a → ref-b → ref-a",
    );
    assert.strictEqual(vscode.debug.breakpoints.length, 0, "成环激活不得下发任何断点");
    assert.strictEqual(fs.readFileSync(configPath, "utf-8"), before, "成环激活不得改写配置文件");
  });

  test("TC-REF-03: 悬空引用降级警告——存活断点正常下发且激活不被中断", async () => {
    writeConfig({
      "ref-dangling-host": [{ type: "scene", name: "ghost-scene" }, paymentOwnBp],
    });
    await sleep(500);

    const origWarn = vscode.window.showWarningMessage;
    const warns: Array<{ msg: unknown; detail?: string }> = [];
    (vscode.window as any).showWarningMessage = async (msg: unknown, ...rest: any[]) => {
      const opts = rest.find((r) => r && typeof r === "object" && "detail" in r);
      warns.push({ msg, detail: opts?.detail });
      return undefined;
    };

    try {
      await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["ref-dangling-host"]);
      await sleep(400);
    } finally {
      (vscode.window as any).showWarningMessage = origWarn;
    }

    assert.ok(
      warns.some((w) => typeof w.detail === "string" && w.detail.includes("ghost-scene")),
      "解析警告通知必须点名悬空引用 ghost-scene",
    );
    assert.ok(
      warns.some((w) => typeof w.msg === "string" && w.msg.includes("1")),
      "应提示激活伴随 1 条解析警告",
    );

    const bps = vscode.debug.breakpoints;
    assert.strictEqual(bps.length, 1, "悬空引用仅降级跳过，存活断点应正常下发");
    assert.strictEqual(bpLine(bps[0]), 11);
    const statusBar = api.getStatusBarItem();
    assert.ok(statusBar.text.includes("ref-dangling-host"), "状态栏应确认场景激活未被中断");
  });

  test("TC-REF-04: 引用启停与子树摘除——禁用后仅存自有断点，恢复后子树回归", async () => {
    writeConfig({
      "auth-core": [authCoreBp],
      "payment-debug": [{ type: "scene", name: "auth-core", enabled: false }, paymentOwnBp],
    });
    await sleep(500);

    // 禁用态激活：子树整体摘除 (INV-030.5)
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["payment-debug"]);
    await sleep(400);
    let bps = vscode.debug.breakpoints;
    assert.strictEqual(bps.length, 1, "禁用引用后应仅下发自有断点");
    assert.strictEqual(bpLine(bps[0]), 11);

    // 禁用态落盘保真；树图标同步呈现禁用态（contextValue + 未勾选）
    const rootNodes = await api.treeDataProvider.getChildren();
    const paymentNode = rootNodes.find((n: any) => n.sceneName === "payment-debug");
    assert.ok(paymentNode);
    const children = await api.treeDataProvider.getChildren(paymentNode);
    const refNode = children[0];
    assert.strictEqual(refNode.refName, "auth-core");
    assert.strictEqual(refNode.contextValue, "sceneRefDisabled", "树节点应同步呈现禁用态");
    assert.strictEqual(refNode.isEnabled, false, "树节点应同步呈现禁用态");
    const diskConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.strictEqual(diskConfig.scenes["payment-debug"][0].enabled, false, "禁用态必须落盘保真");

    // 恢复引用启用并重新激活：子树断点回归
    writeConfig({
      "auth-core": [authCoreBp],
      "payment-debug": [{ type: "scene", name: "auth-core" }, paymentOwnBp],
    });
    await sleep(500);
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["payment-debug"]);
    await sleep(400);
    bps = vscode.debug.breakpoints;
    assert.strictEqual(bps.length, 2, "恢复引用后子树断点应全部回归");
    // 集合语义断言：增量 Diff 装配（0 闪烁）会保留存量断点位置并追加回归断点，位置序不保证
    const restoredLines = bps.map(bpLine).sort((a: number, b: number) => a - b);
    assert.deepStrictEqual(restoredLines, [2, 11], "子树断点 L3 与自有断点 L12 应回归下发");
  });

  test("TC-REF-05: 导出导入含引用保真往返——引用条目字段与顺序 100% 保留 (INV-030.7)", async () => {
    writeConfig({
      "auth-core": [authCoreBp],
      "payment-debug": [{ type: "scene", name: "auth-core", desc: "复用登录内核" }, paymentOwnBp],
    });
    await sleep(500);

    // 导出：copySceneToClipboard 产出声明态 payload（引用条目是声明的一部分，随 payload 序列化）
    await vscode.commands.executeCommand("sceneBreakpoints.copySceneToClipboard", "payment-debug");
    await sleep(300);
    const payload = JSON.parse(await vscode.env.clipboard.readText());
    assert.strictEqual(payload.sceneName, "payment-debug");
    assert.deepStrictEqual(
      payload.breakpoints[0],
      { type: "scene", name: "auth-core", desc: "复用登录内核" },
      "导出 payload 必须原样保留引用条目",
    );

    // 模拟跨工作区导入：改写场景名避免同名碰撞后从剪贴板导入
    payload.sceneName = "payment-debug-imported";
    await vscode.env.clipboard.writeText(JSON.stringify(payload, null, 2));
    const origInfo = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async () => undefined;
    try {
      await vscode.commands.executeCommand("sceneBreakpoints.importSceneFromClipboard");
      await sleep(400);
    } finally {
      (vscode.window as any).showInformationMessage = origInfo;
    }

    // 导入结果：引用条目在配置中原样保留（字段/顺序 100% 保真）
    // 遵循 INV-032 分层配置守卫：新场景缺省落 local 私有层，若存在 local 文件优先从 local 读取
    const workspaceFolders = vscode.workspace.workspaceFolders!;
    const localConfigPath = path.join(workspaceFolders[0].uri.fsPath, ".vscode", "debug-scenes.local.json");
    const targetConfigPath = fs.existsSync(localConfigPath) ? localConfigPath : configPath;
    const diskConfig = JSON.parse(fs.readFileSync(targetConfigPath, "utf-8"));
    const imported = diskConfig.scenes["payment-debug-imported"];
    assert.ok(Array.isArray(imported), "导入场景必须写入配置文件");
    assert.strictEqual(imported.length, 2, "导入场景应包含引用条目与断点条目");
    assert.deepStrictEqual(
      imported[0],
      { type: "scene", name: "auth-core", desc: "复用登录内核" },
      "引用条目必须字段保真",
    );
    assert.strictEqual(imported[0] !== undefined && imported[1].type === "line", true, "声明顺序必须保真（引用在前）");
    assert.strictEqual(imported[1].file, "src/sample.ts");
    assert.strictEqual(imported[1].line, 12);
  });
});
