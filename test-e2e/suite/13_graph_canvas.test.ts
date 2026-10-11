import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Suite 13: 场景断点可视化画布与拓扑图 (TC-GRAPH-01 ~ TC-GRAPH-06, INV-028)
 * 覆盖：全景画布面板创建 / 单例聚焦 / 消息双向协议 / 源码直达跳转 / Mermaid 导出 / 生命周期干净退订
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite("Suite 13: 场景断点可视化画布与 Mermaid 导出", () => {
  let api: any;
  let initialConfigContent: string;
  let configPath: string;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension("tony-l.scene-breakpoints-vscode");
    assert.ok(ext, "扩展必须被 VS Code 发现");
    api = await ext.activate();
    assert.ok(api, "扩展应成功返回 ExtensionApi");
    assert.ok(api.graphCanvasController, "ExtensionApi 应导出 graphCanvasController");

    const workspaceFolders = vscode.workspace.workspaceFolders!;
    configPath = path.join(workspaceFolders[0].uri.fsPath, ".vscode", "debug-scenes.json");
    initialConfigContent = fs.readFileSync(configPath, "utf-8");
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    if (api.graphCanvasController?.getPanel()) {
      api.graphCanvasController.getPanel().dispose();
    }
    if (initialConfigContent) {
      fs.writeFileSync(configPath, initialConfigContent, "utf-8");
    }
  });

  teardown(async () => {
    if (api.graphCanvasController?.getPanel()) {
      api.graphCanvasController.getPanel().dispose();
    }
    await vscode.commands.executeCommand("sceneBreakpoints.clearAll");
    if (initialConfigContent) {
      fs.writeFileSync(configPath, initialConfigContent, "utf-8");
    }
    await sleep(200);
  });

  test("TC-GRAPH-01: 打开全景画布与快照渲染 (WebviewPanel 创建与 HTML 装配)", async () => {
    // 1. 激活含断点的场景 login-flow
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await sleep(300);

    // 2. 执行 showGraph 命令
    await vscode.commands.executeCommand("sceneBreakpoints.showGraph");
    await sleep(400);

    // 3. 断言 WebviewPanel 存在且就绪
    const panel = api.graphCanvasController.getPanel();
    assert.ok(panel, "画布 WebviewPanel 必须成功创建");
    assert.ok(panel.title.length > 0, "画布标题不应为空");

    // 4. 断言注入的 HTML 包含核心脚本与依赖引用
    const html: string = panel.webview.html;
    assert.ok(html.includes("g6-bundle.js"), "HTML 应包含 G6 渲染引擎资源引用");
    assert.ok(html.includes("graphWebview.js"), "HTML 应包含前端交互控制器资源引用");
    assert.ok(html.includes("graphWebview.css"), "HTML 应包含画布样式资源引用");
    assert.ok(html.includes("id=\"sb-payload\""), "HTML 应内联初始快照 payload 节点");
  });

  test("TC-GRAPH-02: 连续触发 showGraph 保持单例复用 (无重复 Tab 堆叠)", async () => {
    // 1. 第一次打开
    await vscode.commands.executeCommand("sceneBreakpoints.showGraph");
    await sleep(300);
    const panel1 = api.graphCanvasController.getPanel();
    assert.ok(panel1, "第一次打开应创建面板");

    // 2. 第二次打开相同命令
    await vscode.commands.executeCommand("sceneBreakpoints.showGraph");
    await sleep(200);
    const panel2 = api.graphCanvasController.getPanel();

    // 3. 验证实例严格相等
    assert.strictEqual(panel1, panel2, "多次触发 showGraph 必须复用同一面板单例");
  });

  test("TC-GRAPH-03: Webview 消息双向协议：Scope 变更与 ready 握手仿真", async () => {
    // 1. 激活并打开画布
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await vscode.commands.executeCommand("sceneBreakpoints.showGraph");
    await sleep(300);

    const controller = api.graphCanvasController;
    assert.ok(controller.getPanel(), "面板就绪");

    // 2. 模拟前端上报 ready 握手
    controller.dispatchWebviewMessage({ type: "ready" });

    // 3. 模拟前端切换 Scope 选择器
    const customScope = ["login-flow", "discount-flow"];
    controller.dispatchWebviewMessage({ type: "set-scope", scenes: customScope });

    // 4. 断言 visibleScenes 状态与前端选择同步
    assert.deepStrictEqual(
      controller.getVisibleScenes(),
      customScope,
      "Controller 应忠实记录前端 Scope Selector 选择的场景集合",
    );

    // 5. 模拟前端切换 Tab
    controller.dispatchWebviewMessage({ type: "switch-tab", tab: "raw" });
  });

  test("TC-GRAPH-04: 点击节点直达源码交互 (open-source 定位跳转)", async () => {
    // 1. 打开画布
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await vscode.commands.executeCommand("sceneBreakpoints.showGraph");
    await sleep(300);

    const controller = api.graphCanvasController;

    // 2. 模拟前端派发点击节点跳转源码请求
    controller.dispatchWebviewMessage({
      type: "open-source",
      file: "src/sample.ts",
      line: 3,
    });

    // 3. 等待并验证可见编辑器成功定位到目标文件与目标行
    let targetEditor: vscode.TextEditor | undefined;
    for (let i = 0; i < 20; i++) {
      targetEditor = vscode.window.visibleTextEditors.find((e) =>
        e.document.fileName.endsWith(path.join("src", "sample.ts")),
      );
      if (targetEditor) break;
      await sleep(100);
    }

    assert.ok(targetEditor, "应当成功在可见编辑区打开目标文件 src/sample.ts");
    assert.strictEqual(
      targetEditor.selection.start.line,
      2, // VS Code 0-indexed 行对应 line: 3
      "光标选区应精准落在断点物理所在行 (0-indexed line 2)",
    );
  });

  test("TC-GRAPH-05: 一键 Mermaid 导出零落盘 (exportGraphMermaid 写入剪贴板)", async () => {
    // 1. 激活真实场景 login-flow 并打开画布
    await vscode.commands.executeCommand("sceneBreakpoints.applyScene", ["login-flow"]);
    await vscode.commands.executeCommand("sceneBreakpoints.showGraph");
    await sleep(300);

    // 先清空剪贴板
    await vscode.env.clipboard.writeText("");
    await sleep(100);

    // 2. 执行 Mermaid 导出命令
    await vscode.commands.executeCommand("sceneBreakpoints.exportGraphMermaid");
    await sleep(400);

    // 3. 读取剪贴板内容并断言
    const clipboardText = await vscode.env.clipboard.readText();
    assert.ok(clipboardText.length > 0, "剪贴板中必须存在导出的内容");
    assert.ok(
      clipboardText.includes("flowchart TD"),
      "导出的 Mermaid 文本必须以 flowchart TD 声明开头",
    );
    assert.ok(
      clipboardText.includes("login-flow") || clipboardText.includes("subgraph"),
      "导出的 Mermaid 文本应包含泳道场景或子图定义",
    );
  });

  test("TC-GRAPH-06: 面板生命周期销毁与事件退订 (dispose 干净清理)", async () => {
    // 1. 打开画布
    await vscode.commands.executeCommand("sceneBreakpoints.showGraph");
    await sleep(300);

    const controller = api.graphCanvasController;
    const panel = controller.getPanel();
    assert.ok(panel, "面板创建成功");

    // 2. 模拟关闭面板
    panel.dispose();
    await sleep(200);

    // 3. 验证 panel 引用被正确置空，visibleScenes 复位
    assert.strictEqual(controller.getPanel(), undefined, "dispose 后 panel 必须置为 undefined");
    assert.strictEqual(
      controller.getVisibleScenes(),
      undefined,
      "dispose 后 visibleScenes 必须复位为 undefined",
    );

    // 4. 再次触发 showGraph，应重新创建全新面板
    await vscode.commands.executeCommand("sceneBreakpoints.showGraph");
    await sleep(300);
    const newPanel = controller.getPanel();
    assert.ok(newPanel, "再次触发应当能够重新拉起全新面板");
    assert.notStrictEqual(newPanel, panel, "重建的面板对象应为新实例");
  });
});
