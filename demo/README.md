# Scene Breakpoints 代码行号自愈（Line Drift Self-Healing）实战演练

本 Demo 专门用于测试和验证在代码发生增删行、AI 大面积改写或 Git 合并后，**Scene Breakpoints** 如何利用全维指纹自动修正断点行号并持久化回写。

---

## 预置信息

- **演示源码**: [`demo/healing-demo.ts`](file:///d:/project/my/scene-breakpoints-vscode/demo/healing-demo.ts)
- **初始场景名**: `demo-self-healing`
- **初始断点行号**: 第 **15** 行（`if (order.amount <= 0) {`）

---

## 极速演练步骤（4 步见证自愈）

### 第 1 步：激活初始场景

1. 打开 VS Code 左侧【运行与调试】面板，展开 **Scene Breakpoints** 视图；
2. 找到 `demo-self-healing` 场景，点击后面的 **激活按钮 ▶**（或按 `Ctrl+Shift+P` 输入 `Scene Breakpoints: Apply Scene`，选择 `demo-self-healing`）；
3. 打开 [`demo/healing-demo.ts`](file:///d:/project/my/scene-breakpoints-vscode/demo/healing-demo.ts)，可以看到第 **15** 行出现了一个红点断点。

---

### 第 2 步：模拟 AI 或手动增加代码（制造行号偏移）

1. 在 [`demo/healing-demo.ts`](file:///d:/project/my/scene-breakpoints-vscode/demo/healing-demo.ts) 的第 **13** 行（`console.log` 上方），按 3 次回车，或者插入以下几行模拟逻辑：
   ```typescript
   // 模拟 AI 新增的前置风控与审计逻辑
   console.log("[Audit] Checking user risk score...");
   const isRiskPassed = true;
   ```
2. 保存该文件；
3. 此时观察代码，原本的 `if (order.amount <= 0) {` 已经被向下推移到了第 **18** 行（或更靠后的行号）；
4. 打开 `.vscode/debug-scenes.json`，此时里面的断点记录仍然停留在旧的 `"line": 15`。

---

### 第 3 步：再次激活场景（触发自愈与持久化闭环）

1. 再次点击 `demo-self-healing` 场景后面的 **激活按钮 ▶**（或按 `Ctrl+Shift+P` 重新运行 `Apply Scene`）；
2. 观察 VS Code 右下角弹出的系统通知：
   > 🚀 **Scene(s) [demo-self-healing] activated! Loaded 1 breakpoint(s) (Auto-healed 1 drifted line(s)).**

---

### 第 4 步：验证自愈结果

1. **看编辑器**：打开 [`demo/healing-demo.ts`](file:///d:/project/my/scene-breakpoints-vscode/demo/healing-demo.ts)，红点断点已准确自动打在最新的第 **18** 行（精准命中 `if (order.amount <= 0) {`，绝无偏差）；
2. **看配置文件**：打开 [`.vscode/debug-scenes.json`](file:///d:/project/my/scene-breakpoints-vscode/.vscode/debug-scenes.json)，可以看到 `demo-self-healing` 里的 `"line": 15` 已经被插件**自动回写并更新为 `"line": 18`**！

---

## 核心算法保障

- **三行伴随指纹**：即使断点行号发生偏移，只要 `prev`、`current`、`next` 的结构存在，就能实现 100% 精确自愈；
- **空白与缩进解耦**：无论 AI 怎么格式化代码（加空格、转缩进），纯指纹依旧一致；
- **防灾与持久化闭环**：自愈后自动同步至本地声明式 JSON，协作分支与下次启动无需重复计算。
