<div align="center">
  <img src="./icon.png" width="128" height="128" alt="Scene Breakpoints Logo" />
  <h1>场景断点 (Scene Breakpoints)</h1>
  <p><b>专为代码研读、复杂链路排查与 AI Agent 协同打造的 VS Code 场景化断点管理工具</b></p>

  <p>
    <a href="https://github.com/Tonys-L/scene-breakpoints-vscode"><img src="https://img.shields.io/badge/GitHub-仓库-blue?logo=github" alt="GitHub" /></a>
    <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/actions/workflows/ci.yml"><img src="https://github.com/Tonys-L/scene-breakpoints-vscode/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/LICENSE"><img src="https://img.shields.io/badge/开源协议-MIT-green.svg" alt="License" /></a>
  </p>

  <p><a href="https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/README.md">English</a> | <b>简体中文</b></p>
</div>

> 🏷️ **核心特性**：`断点分组管理` · `场景化调试` · `AI 读图制图双轨` · `自动巡航放行` · `变量监视断言` · `调试轨迹实时落盘` · `代码漂移自愈`

**一句话介绍**：把散落的临时断点，变成可复用、可分享、可自愈的工程化调试资产；按一次 F5 自动巡航跑完调用链并采集变量断言，AI 读盘即可秒级定位 Bug 根因。

---

## 💡 为什么需要这个插件？

平时在 VS Code 里调试代码，大家经常会遇到这几个头疼事：
1. **断点太多舍不得删，调试时到处乱停**：平时查各种问题留了几十个断点，查新 Bug 时走两步就误停一次，烦躁得不行；
2. **复杂调用链理顺了，过两天就忘光**：好不容易理清一条横跨十几个文件的复杂业务链路，过两周又忘了关键步骤在哪，新人接手更是一头雾水；
3. **Pull 一下代码或改了几行，断点全偏了**：代码行号一变，原来的断点全停在空行或注释上，彻底失效；*(这是多人协作、Git 分支切换与代码重构中最常见的断点失效场景)*
4. **想把断点分享给同事，换电脑断点全丢**：只能打字告诉同事“你在 xx 文件的 88 行打个断点”，换台电脑之前打的断点全没了；
5. **单步调试点到手抽筋，只为观察某几个变量**：为了看深层函数里某个变量是否符合预期，需要连续按十几下 F10/F5，手一抖按快了还得从头来过；
6. **AI 帮我梳理了流程，却无法直接布设断点与读取调试结果**：让 AI 查 Bug，AI 只能文字建议打断点，不仅需要人工手动跳转，跑完后还得把变量值大段复制给 AI。

**Scene Breakpoints** 就是你的**断点分组管理、自动化巡航导览器与 AI 调试协同中枢**：把断点按业务场景分组，绑定意图备注与变量断言，随切随用，自动随 Git 团队共享。支持 **AI 双轨协同（读图 Reader + 编排 Writer）** 与 **零提示词自动分析（Zero-Prompt Auto-Inspect）**！

---

## ✨ 它能帮你做什么？

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/sb.gif" alt="Scene Breakpoints 动态演示" width="100%" />
</p>

- 🗺️ **记录业务关键流程，秒变代码路线图**
  给每个断点写上中文备注（例如 `步骤1: 权限校验`、`步骤2: 扣减库存`）。一个场景就是一条完整的业务主干执行图，顺藤摸瓜看懂复杂源码，再也不用担心遗忘。

- 🎯 **切到哪个场景，就只留哪组断点**
  切到“登录”，VS Code 里就只生效登录的断点，其他无关断点自动藏起来；切到“支付”，就只断支付，绝不瞎停。

- 🚦 **断点命中自动巡航放行 (Auto-Continue Cruise, v1.5.0)**
  配置 `sceneBreakpoints.autoContinueMode: "onPass"`（默认）。按一次 F5 全自动跑完整个场景链路并求值所有监视变量；断言全部吻合自动放行继续执行，**一旦发现任何 Mismatch 或报错立即自动急刹定格在出错断点现场**！

- 📝 **调试轨迹实时落盘与 AI 零提示词闭环 (v1.5.0)**
  调试执行过程中的命中断点、监视变量求值、断言结果实时原子写入 `.vscode/debug-trace.local.json`（自动加入 `.gitignore`）。跑完 F5 后直接对 AI 说一句“跑完了/看下结果”，AI 自动读盘完成根因定位。

- 🔍 **编辑器断点整行悬浮透视卡片 (v1.5.0)**
  鼠标悬停在激活断点行的任意位置，即可弹出包含步骤意图、`watch` 变量实时求值、期望值与校验状态（`✅` / `❌ Mismatch` / `⚠️ Error`）的 Markdown 表格卡片。智能拦截行首无意义浮窗，绝不干扰正常代码阅读。

- 🛡️ **行号变了，断点自动找回（防漂移）**
  拉取了最新代码或改动了行号？激活场景时，插件会自动根据代码三行指纹与函数作用域锚点把断点精准吸附到新行号上，再也不用手动重打。

- 📊 **可视化画板全景透视，副侧边栏常驻与全屏独立 Tab (v1.3.0 ~ v1.4.0)**
  副侧边栏常驻呈现拓扑全景图，支持泳道分层、嵌套展开、执行流实时脉冲闪烁，并可通过全屏逃生门一键展开为独立编辑器 Tab 深入探索。支持一键导出 Mermaid 流程图分享至 PR 或文档。

- 🧩 **场景引用：组合复用，一处维护 (v1.1.0)**
  在场景中声明 `{ "type": "scene", "name": "..." }`，组合复用公共鉴权与初始化断点，内置成环阻断安全保护。

- 🔒 **团队共享与个人私有配置智能隔离 (v1.2.0)**
  公共场景保存在 `.vscode/debug-scenes.json` 随 Git 共享；个人私有断点写入 `.vscode/debug-scenes.local.json` 零污染。

- 📸 **事故现场逆向固化：调用栈一键生成场景 (v1.2.0)**
  命中断点或异常崩溃时，右键即可将跨文件源码调用栈一键逆向固化为包含上下文指纹的新场景。

---

## 🚀 快速上手

### 1. 安装方式

- **扩展面板搜索**：在 VS Code 扩展市场搜索 `Scene Breakpoints` 直接安装；
- **VSIX 文件安装**：在扩展面板点击右上角 `...` $\rightarrow$ 选择 `从 VSIX 安装...`。

### 2. 基础三步上手

1. **添加断点**：在任意代码行右键选择 `Add to Debug Scene...`，或者直接按下快捷键 `Ctrl + Alt + B`（macOS: `Cmd + Alt + B`），选择场景并输入备注；

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/context-menu-add.png" alt="右键菜单或快捷键 Ctrl+Alt+B 添加断点" width="75%" />
</p>

2. **切换场景**：点击 VS Code 底部状态栏（或按下快捷键 `Ctrl + Alt + S` / macOS: `Cmd + Alt + S`），选择场景一键激活。激活后，底部状态栏会立即显示当前场景名，侧边栏对应场景高亮展开，VS Code 断点列表与代码行断点红点同步即时挂载；

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/scene-quickpick.png" alt="场景快速切换与多选 QuickPick 弹窗" width="85%" />
</p>

3. **反向导出**：在编辑器打好断点后，在命令面板输入 `Scene: 将当前所有断点导出为新场景` 一键固化存盘。

---

## ⌨️ 快捷键速查

| 快捷键 | 功能说明 |
| :--- | :--- |
| `Ctrl + Alt + S`（macOS: `Cmd + Alt + S`） | 呼出场景控制菜单 / 快速切换与多选场景（亦可点击底部状态栏） |
| `Ctrl + Alt + B`（macOS: `Cmd + Alt + B`） | 将当前代码行保存到指定场景并输入备注 |
| `Alt + ↑` / `Alt + ↓` | 侧边栏树视图中快速上移 / 下移断点（支持长按连续位移，亦可鼠标拖拽） |

> 💡 **快捷键冲突提示**：Windows 下如果 `Ctrl + Alt + B` 等快捷键被输入法或显卡驱动热键占用，可在 VS Code 的“键盘快捷方式”（`Ctrl + K Ctrl + S`）中搜索 `sceneBreakpoints` 自定义绑定。

---

## 🎨 进阶核心特性

### 1. 变量监视锚点与断言比对 (Watch Anchors & Assertions, v1.5.0)

在断点中声明 `watch` 列表，为关键变量定义期望断言：

```json
{
  "type": "line",
  "file": "src/services/pay.ts",
  "line": 52,
  "desc": "步骤 2: 校验支付返回状态",
  "watch": [
    { "name": "result.status", "expected": "\"SUCCESS\"" },
    { "name": "result.code", "expected": 200 }
  ]
}
```
- **自动 DAP 求值**：命中断点时底层自动提取变量运行时值，捕获基本类型、复杂对象与异常状态；
- **智能容差比对**：自动归一化单双引号（如 `js-debug` 输出的 `'SUCCESS'` 自动匹配 `"SUCCESS"`），消除不同调试器输出格式带来的误判。

### 2. 断点命中自动巡航放行 (Auto-Continue Cruise, v1.5.0)

无需一次次单步敲击键盘！在设置中开启自动巡航（默认即为 `"onPass"`）：
- **`"onPass"` (默认推荐)**：断点命中后自动求值 `watch` 表达式；全部吻合期望值（或未配置 `watch`）时**自动 Continue 放行**；一旦发现任何 `Mismatch` 或求值错误，**立即定格暂停在出错现场**供开发者深入排查；
- **`"always"`**：静默采集全链路所有断点的数据，不因断言失败而暂停，全速跑完链路；
- **`"off"`**：关闭自动放行，每次断点命中均保持 VS Code 原生断点暂停。

内置代次守卫（`pauseSeq`）与栈顶锁（`ActivePauseAuthority`），彻底解决 `const x = await fn()` 同行多次暂停的竞态。

### 3. 调试轨迹实时落盘与 AI 零提示词闭环 (v1.5.0)

整个调试会话期间，断点执行轨迹实时原子持久化到 `.vscode/debug-trace.local.json`：
- 记录当前调试状态（`running` / `paused` / `terminated`）、是否有断言失败（`hasMismatchOrError`）、当前暂停位置及每一步求得的变量值；
- **零提示词闭环 (Zero-Prompt Auto-Inspect)**：按 F5 跑完调试后，无需复制粘贴变量，只需在对话中对 AI 说：
  > “跑完了，看下结果” 或 “分析一下为什么挂了”  
  AI 自动读取本地 Trace 文件，瞬间识别出哪一步断言失败并指出根因！

### 4. 编辑器断点整行悬浮透视卡片 (Scene Hover Inspector, v1.5.0)

将鼠标悬停在断点所在代码行的**任意位置**（不仅限红点本体）：
- 立即弹出格式化的 Markdown 表格卡片，清晰呈现该步排查意图、当前变量求值结果、期望值及比对徽标（`✅` / `❌ Mismatch` / `⚠️ Error`）；
- 智能屏蔽原生调试器在行首空白和类型声明处弹出的干扰浮窗，保障清爽的代码阅读体验。

### 5. 场景断点可视化画布 (Visual Graph Canvas, v1.3.0 ~ v1.4.0)

在调试侧边栏标题栏点击拓扑树按钮，即可唤出交互式画板：
- **常驻副侧边栏 (Secondary Side Bar)**：右侧常驻拓扑全景，左侧代码，双屏伴随；
- **全屏独立编辑器逃生门**：支持一键将画板在新 Tab 中全屏展开，复杂链路一览无余；
- **Live DAP 实时脉冲**：命中断点时画布节点同步高亮脉冲并记录命中轨迹；
- **一键 Mermaid 导出**：点击右上角导出按钮秒级生成合法 `flowchart TD` 代码，直接粘贴进 PR 或文档。

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/graph-canvas.png" alt="场景断点可视化画布与执行链路拓扑 (Scene Graph Canvas)" width="85%" />
</p>

### 6. 场景组合引擎：内联场景引用 (v1.1.0)

在场景声明列表中声明 `{ "type": "scene", "name": "common-auth" }`，即可将公共基础断点按声明位置深度优先展开，内置循环引用检测与成环阻断保护。

### 7. 团队与个人私有配置智能隔离 (v1.2.0)

- **团队主配置**：`.vscode/debug-scenes.json`（提交到 Git，全团队共用）；
- **个人私有配置**：`.vscode/debug-scenes.local.json`（自动追加进 `.gitignore`，本地临时断点绝不污染仓库）；
- 本地与团队同名场景自动就地覆盖，侧边栏标记 `[local]` 徽标。

---

## 配置文件完整参考 (`debug-scenes.json`)

断点数据以纯文本声明式保存在工作区 `.vscode/debug-scenes.json` 中，自带代码透视（CodeLens）一键激活与语法提示：

```json
{
  "$schema": "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
  "activeScenes": ["order-checkout-flow"],
  "bindings": {
    "Launch API Server": "order-checkout-flow"
  },
  "scenes": {
    "common-auth": [
      {
        "type": "line",
        "file": "src/auth/session.ts",
        "line": 15,
        "desc": "公共链路：用户 Token 鉴权",
        "watch": [
          { "name": "session.isValid", "expected": true }
        ]
      }
    ],
    "order-checkout-flow": [
      {
        "type": "scene",
        "name": "common-auth",
        "desc": "步骤 0: 组合公共鉴权链路"
      },
      {
        "type": "condition",
        "file": "src/order/service.ts",
        "line": 42,
        "condition": "order.total > 0",
        "desc": "步骤 1: 校验订单金额有效性",
        "watch": [
          { "name": "order.total", "expected": 199.9 }
        ]
      },
      {
        "type": "logpoint",
        "file": "src/order/service.ts",
        "line": 68,
        "logMessage": "Order created: {order.id}",
        "desc": "步骤 2: 打印订单落库日志"
      },
      {
        "type": "line",
        "file": "src/payment/gateway.ts",
        "line": 95,
        "desc": "步骤 3: 触发第三方支付网关",
        "watch": [
          { "name": "res.status", "expected": "\"SUCCESS\"" },
          { "name": "res.code", "expected": 200 }
        ]
      }
    ]
  }
}
```

---

## 🤖 AI Agent 协同与双轨模式 (v1.4.1 ~ v1.5.0)

Scene Breakpoints 专为现代 AI 编程生态设计，支持通过标准 Skill 实现深度协同：

### 1. AI Skill 双轨模式 (v1.4.1)
- **读图五步法 (Scene Breakpoints Reader)**：AI 在排查问题或阅读工程时，优先按图索骥——执行前置廉价探测、场景语义匹配、内联引用展开与物理行号精准跳读，以最低 Token 消耗建立工程空间感；
- **规范制图标准 (Scene Breakpoints Writer)**：指导 AI 为断点编写精准排查意图标注（如“观察密码校验比对失败分支”），并规范锚定 `watch` 变量与预期断言。

### 2. 8 大主流平台一键部署
按 `Ctrl+Shift+P` 执行 **`Scene Breakpoints: Install Agent Skill (安装 Skill)`**，支持一键部署到：
- **Antigravity**: `.agents/skills/scene-breakpoints/SKILL.md`
- **Cursor IDE**: `.cursor/rules/scene-breakpoints.mdc`
- **Windsurf**: `.windsurf/rules/scene-breakpoints.md`
- **Cline (Claude Dev)**: `.clinerules/scene-breakpoints.md`
- **Roo Code**: `.roorules/scene-breakpoints.md`
- **Continue.dev**: `.continue/prompts/scene-breakpoints.prompt`
- **GitHub Copilot**: `.github/skills/scene-breakpoints/SKILL.md`
- **Trae IDE**: `.trae/skills/scene-breakpoints/SKILL.md`

### 3. AI 集成状态全维诊断
按 `Ctrl+Shift+P` 执行 **`Scene Breakpoints: Diagnose AI Integration (AI 集成状态诊断)`** 随时检查规则就绪状态。

---

## ⚙️ 配置项速查

可在 VS Code `settings.json` 中配置以下选项：

| 配置项 | 默认值 | 可选值 | 说明 |
| :--- | :--- | :--- | :--- |
| `sceneBreakpoints.autoContinueMode` | `"onPass"` | `"onPass"`, `"always"`, `"off"` | 断点命中时的自动放行巡航策略：`"onPass"` 表示断言均通过时自动放行，遇 Mismatch 自动定格 |
| `sceneBreakpoints.allowAiFileActivation` | `false` | `true`, `false` | 是否允许 AI Agent 直接在 `debug-scenes.json` 中修改 `activeScenes` 声明式激活场景 |

---

## 📖 更多文档

- 📕 [完整实战指南与常见问题 (docs/guide_zh.md)](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/docs/guide_zh.md)
- 📝 [版本更新日志 (CHANGELOG_zh.md)](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/CHANGELOG_zh.md)

---

## 💖 支持与反馈

如果这个插件对你有帮助，欢迎在 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Tony-L.scene-breakpoints-vscode) 或 [Open VSX](https://open-vsx.org/extension/tony-l/scene-breakpoints-vscode) 给个五星评分 ⭐。  
遇到问题或有任何建议，欢迎[提交 Issue](https://github.com/Tonys-L/scene-breakpoints-vscode/issues)。

---

## 📄 开源许可

[MIT License](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/LICENSE) © 2026 Tony.L
