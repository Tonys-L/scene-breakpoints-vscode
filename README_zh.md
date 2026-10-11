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

> 🏷️ **核心特性**：`断点分组管理` · `场景化调试` · `AI Agent 协同` · `代码漂移自愈` · `团队共享导览`

**一句话介绍**：把散落的临时断点，变成可复用、可分享、可自愈的工程化调试资产。

---

## 💡 为什么需要这个插件？

平时在 VS Code 里调试代码，大家经常会遇到这几个头疼事：
1. **断点太多舍不得删，调试时到处乱停**：平时查各种问题留了几十个断点，查新 Bug 时走两步就误停一次，烦躁得不行；
2. **复杂调用链理顺了，过两天就忘光**：好不容易理清一条横跨十几个文件的复杂业务链路，过两周又忘了关键步骤在哪，新人接手更是一头雾水；
3. **Pull 一下代码或改了几行，断点全偏了**：代码行号一变，原来的断点全停在空行或注释上，彻底失效；*（这是多人协作、Git 分支切换与代码重构中最常见的断点失效场景）*
4. **想把断点分享给同事，换电脑断点全丢**：只能打字告诉同事“你在 xx 文件的 88 行打个断点”，换台电脑之前打的断点全没了；
5. **AI 帮我梳理了业务流程，却没法直接把断点布置到编辑器**：让 AI 查 Bug 或理顺复杂逻辑，AI 找出了关键函数与条件分支，但只能文字回复“建议在 a.ts 第 20 行打断点”，开发者还得人工一个个文件去跳转并手动打断点。

**Scene Breakpoints** 就是你的**断点分组与链路导览器**：把断点按业务场景分组，带上步骤备注，随切随用，自动随 Git 团队共享。同时支持 **AI Agent 一键直接写入并激活场景**——你只需要说一句话，AI 就能帮你完成断点编排。

---

## ✨ 它能帮你做什么？

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/sb.gif" alt="Scene Breakpoints 动态演示" width="100%" />
</p>

- 🗺️ **记录业务关键流程，秒变代码路线图**
  给每个断点写上中文备注（例如 `步骤1: 权限校验`、`步骤2: 扣减库存`）。一个场景就是一条完整的业务主干执行图，顺藤摸瓜看懂复杂源码，再也不用担心遗忘。

- 🎯 **切到哪个场景，就只留哪组断点**
  切到“登录”，VS Code 里就只生效登录的断点，其他无关断点自动藏起来；切到“支付”，就只断支付，绝不瞎停。

- 🛡️ **行号变了，断点自动找回（防漂移）**
  拉取了最新代码或改动了行号？激活场景时，插件会自动根据代码内容把断点精准吸附到新行号上，再也不用手动重打。

- 🔄 **随手打断点，一键另存为分组**
  不用专门去写配置文件。平时该怎么打断点就怎么打，调通后点一下“导出为新场景”，直接打包存盘。

- 🌲 **侧边栏像清单一样打勾管理**
  在左侧“运行与调试”面板里直接看所有场景，点击复选框随手开启/关闭某个断点，还能同时勾选多个场景一起生效。

- ⚡ **按 F5 启动调试，自动加载对应断点**
  在 `launch.json` 里配好名字，按 F5 启动调试时，自动把关联场景的断点打好，不用每次手动切。

- 📊 **可视化画板全景透视，复杂链路一览无余 (v1.3.0)**
  点击调试侧边栏顶部的拓扑图按钮（或在命令面板输入 `Scene Breakpoints: Show Graph Canvas`），即可秒级打开交互式只读画板。泳道分层、场景引用嵌套、断点卡片一目了然；调试时实时脉冲点亮执行流并记录命中轨迹，还支持一键导出 Mermaid 流程图分享到文档或 PR。

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/graph-canvas.png" alt="场景断点可视化画布与执行链路拓扑 (Scene Graph Canvas)" width="85%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/graph-hit-trace.png" alt="调试运行时断点实时脉冲与执行流命中轨迹 (Hit Trace)" width="85%" />
</p>

- 🔒 **团队共享与个人私有配置智能隔离 (v1.2.0)**
  公共场景保存在 `.vscode/debug-scenes.json` 随 Git 团队共享；个人临时调试断点自动保存到 `.vscode/debug-scenes.local.json` 并自动追加至 `.gitignore`。本地调试随心所欲，绝对不会污染代码仓库。

- 📸 **暂停态逆向固化：调用栈一键生成场景 (v1.2.0)**
  命中断点暂停时，右键即可将当前调用栈中跨文件的源码帧提取为新场景，自带 3 行上下文指纹。遇到棘手 Bug 时一键保存“事故现场”，随时复现或交给同事与 AI 协查。

- 🤖 **AI 自动生成场景断点，调用链路一键落盘**
  让 AI 分析 Bug 或梳理业务时，AI 梳理完关键步骤可直接生成一套带有步骤备注的场景断点并自动激活。告别对照聊天记录人肉翻文件打断点的麻烦，按 F5 就能直接顺着链路调试。

---

## 🚀 快速上手

### 1. 安装方式

- **扩展面板搜索**：在 VS Code 扩展市场搜索 `Scene Breakpoints` 直接安装；
- **VSIX 文件安装**：在扩展面板点击右上角 `...` $\rightarrow$ 选择 `从 VSIX 安装...`。

### 2. 三步上手流程

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

### 1. 场景断点可视化画布 (Visual Graph Canvas, v1.3.0)

在调试侧边栏“Scene Breakpoints”标题栏点击拓扑图按钮（或在命令面板输入 `Scene Breakpoints: Show Graph Canvas`），即可唤出交互式画板：
- **执行流 DAG 拓扑全景**：以泳道分层（团队主场景 / 本地私有场景）、引用嵌套（Scene Reference）和清晰的断点卡片直观呈现；
- **点击直达源码**：在画布中点击任意断点卡片或执行步数，编辑器自动分屏打开目标文件、视口平滑居中并触发 800ms 行高亮；
- **Live DAP 实时脉冲与命中轨迹**：调试运行命中断点时，画布节点同步闪烁脉冲；并以内联时间线（Trace Timeline）记录执行步数与循环折叠，清楚展现“代码停在哪、从哪跳过来”；
- **场景范围选择器 (Scope Selector)**：支持勾选查看任意场景（包含未激活场景），所见即所得；
- **一键 Mermaid 流程图导出**：在画布右上角点击导出按钮，秒级生成合法 `flowchart TD` 并复制到剪贴板，直接粘贴到 Markdown 文档、GitHub PR 或架构评审报告中。

### 2. 团队与个人私有配置智能隔离 (v1.2.0)

针对多人协作项目中“临时断点容易污染 Git 提交”的痛点，插件提供双层配置机制：
- **团队主配置**：`.vscode/debug-scenes.json`（提交到 Git，团队统一沉淀与共享主干业务场景）；
- **个人私有配置**：`.vscode/debug-scenes.local.json`（插件激活时**自动追加到 `.gitignore`**，私有场景零污染）；
- **分层合并与就地覆盖**：本地与团队同名场景时，本地私有层自动无缝覆盖团队层，侧边栏合并展示并标记 `[local]` 徽标。

### 3. 事故现场逆向固化：调用栈一键生成场景 (v1.2.0)

当调试命中断点或代码抛错暂停时：
- 在代码编辑器右键选择 `Scene Breakpoints: Capture Call Stack to Scene`（或在命令面板执行）；
- 插件会自动提取当前线程的所有源码堆栈帧（自动去重并过滤外部依赖），自动计算 3 行上下文指纹（防代码漂移），一键固化存盘为新场景！

---

断点数据以纯文本声明式保存在工作区 `.vscode/debug-scenes.json` 中，自带代码透视（CodeLens）一键激活与语法提示：

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/config-file-codelens.png" alt="debug-scenes.json 配置文件与 CodeLens 视图" width="85%" />
</p>

```json
{
  "$schema": "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
  "activeScenes": ["login-debug"],
  "bindings": {
    "Launch API Server": "login-debug"
  },
  "scenes": {
    "login-debug": [
      {
        "type": "condition",
        "file": "src/auth.ts",
        "line": 45,
        "condition": "user.isVip === true",
        "desc": "步骤 1: 仅在 VIP 用户登录时拦截"
      },
      {
        "type": "logpoint",
        "file": "src/agent-loop.ts",
        "line": 104,
        "logMessage": "Current status: {state.status}",
        "desc": "步骤 2: 输出运行时状态不暂停"
      },
      {
        "type": "line",
        "file": "src/user.ts",
        "line": 88,
        "desc": "步骤 3: 提取用户会话核心数据"
      }
    ]
  }
}
```

> 💡 **`activeScenes` 字段**：记录当前激活的场景列表（支持多场景并发激活）。AI Agent 通过修改此字段即可实现免命令唤起的声明式场景切换（详见下方 AI 协同章节）。

---

## 🤖 AI Agent 协同与一键 Skill 赋能

Scene Breakpoints 支持与主流 AI 编程助手协同，让 AI 理解并直接帮你管理断点场景：

### 1. 主流 AI Agent Skill 一键部署
按 `Ctrl+Shift+P` 执行 **`Scene Breakpoints: Install Agent Skill (安装 Skill)`**，即可一键将 `scene-breakpoints` 专属技能部署到工作区，覆盖以下 8 个平台：
- **Antigravity**: `.agents/skills/scene-breakpoints/SKILL.md`
- **Cursor IDE**: `.cursor/rules/scene-breakpoints.mdc`
- **Windsurf**: `.windsurf/rules/scene-breakpoints.md`
- **Cline (Claude Dev)**: `.clinerules/scene-breakpoints.md`
- **Roo Code**: `.roorules/scene-breakpoints.md`
- **Continue.dev**: `.continue/prompts/scene-breakpoints.prompt`
- **GitHub Copilot**: `.github/skills/scene-breakpoints/SKILL.md`
- **Trae IDE**: `.trae/skills/scene-breakpoints/SKILL.md`

安装后，向 AI 说一句：“*帮我分析登录失败的原因，并建立断点场景*”，AI 便会自动研读代码、组织断点并为你激活！

### 2. AI 集成状态全维诊断
按 `Ctrl+Shift+P` 执行 **`Scene Breakpoints: Diagnose AI Integration (AI 集成状态诊断)`**，可一目了然查看当前各平台 Skill 部署情况并提供一键修复：

```text
⚡ [AI 宿主感知] 自动识别当前 IDE (Antigravity / Cursor / Trae / VS Code) 并置顶对应规则
✅ [配置状态] allowAiFileActivation: 已开启 (支持 AI 声明式读写场景)
✅ [已就绪 Skill] Antigravity, Cursor, Trae (最新规则基线)
⚠️ [待部署平台] GitHub Copilot, Windsurf → 点击 [一键安装] 即可秒级补齐
```

---

## 📖 更多文档

- 📕 [完整使用指南与常见问题 (FAQ)](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/docs/guide_zh.md)
- 📝 [版本更新日志 (CHANGELOG_zh.md)](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/CHANGELOG_zh.md)

---

## 💖 支持与反馈

如果这个插件对你有帮助，欢迎在 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Tony-L.scene-breakpoints-vscode) 或 [Open VSX](https://open-vsx.org/extension/tony-l/scene-breakpoints-vscode) 给个评分 ⭐。  
遇到问题或有任何建议，欢迎[提交 Issue](https://github.com/Tonys-L/scene-breakpoints-vscode/issues)。

---

## 📄 开源许可

[MIT License](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/LICENSE) © 2026 Tony.L

