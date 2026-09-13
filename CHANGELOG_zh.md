# 更新日志 (Change Log)

本项目的所有重要更新都会记录在此文件中。

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 规范。

<p><b>简体中文</b> | <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/CHANGELOG.md">English</a></p>

---

## [1.0.7] - 2026-09-13

### 新增与增强 (Added & Enhancements)
- **场景激活自动现场补齐行自愈指纹 (Auto-Enrich Missing Fingerprints)**：
  - 当通过 AI Agent（如 Antigravity、Cursor、Trae、Copilot 等）生成场景或开发者手工编写断点时，支持仅声明核心要素（`type`, `file`, `line`, `desc`），彻底免除人工抽取上下文代码片段的心智与 Token 负担；
  - 场景首次激活下发至 VS Code DAP 调试器时，内核自动读取目标源码，利用纯领域算法现场提取 100% 保真的三行伴随代码指纹（`contextSnippet`）及前导缩进；
  - 激活成功后，由内部串行持久化管道（受 `saveLoopGuard` 防回环守卫严格保护），静默将补全指纹后的断点回写至 `.vscode/debug-scenes.json`；
  - 断点自激活瞬间起全面享有两阶段滑动窗口与大跨度作用域巡航自愈保护，真正兑现“AI 极简声明、插件自动加固”。

---

## [1.0.6] - 2026-09-13

### 修复 (Fixed)
- **断点 Schema 规范与配置示例一致性修复**：
  - 修正配置示例中条件断点类型为 `type: "condition"`（原示例中误写为 `type: "line"` 带条件，导致条件被静默忽略）；
  - 修正断点备注字段为 `desc`（原示例误写为 `description`），与底层领域模型、`schema.json` 以及 AI Agent 技能定义保持 100% 严谨对齐，杜绝用户与 AI 照抄时备注丢失或编辑器报黄色警告；
  - 配置文件示例中显式补充 `activeScenes` 声明式激活字段及交互注脚说明。
- **文档规范与术语统一**：
  - 统一英文文档中的链路导览器术语（`Living Code Tours`）；
  - CI 徽章接入 GitHub Actions 官方实时动态 SVG；
  - 通用化 AI 宿主自适应感知输出示例，并优化快捷键表格排版。

---

## [1.0.5] - 2026-09-13

### 优化与瘦身 (Improvements & Optimization)
- **VSIX 离线包体积骤降 98%（极致瘦身）**：
  - 将 README 中的高清演示动图与截图切换至 GitHub 官方 Raw CDN 直连，不再本地塞入多张巨型 GIF；
  - 精细化 `.vscodeignore` 规则，彻底剔除 `.trae/` 本地 IDE 缓存、发布脚本与无关开发资产，将安装包从 5.4MB（解压 6MB）极致缩减至 **118KB**，实现秒级安装下载。
- **CI/CD 发版流水线全面自动化**：
  - 接入自动提取中英文双语 Changelog 机制，打 tag 时全自动组装富文本 Release Notes；
  - 统一 CI/CD Node.js 环境至 22.x，完美支持原生 ESM 零转译单测执行。

---

## [1.0.4] - 2026-09-13

### 新增 (Added)
- **断点全维高效排序交互体系**：
  - **原生鼠标拖拽排序 (Drag & Drop)**：支持在侧边栏树视图中直接按住鼠标拖拽断点至场景内任意目标位置松手重排，场景边界自动安全防护；
  - **键盘快捷键连按 (`Alt+↑` / `Alt+↓`)**：在树视图聚焦断点条目时按 `Alt+Up` / `Alt+Down` 快速上移/下移，且选中焦点（Reveal Focus）自动跟随，支持按住键盘连续顺畅位移；
  - **右键上下文菜单一键置顶/置底**：在断点条目右键支持 `置顶断点 (Move to Top)` 与 `置底断点 (Move to Bottom)`，大幅减少跨长距离翻调成本；
  - **按钮精炼文案与拖拽富文本提示**：行内移动按钮标明快捷键 `上移断点 (Alt+↑)`，断点信息悬浮气泡（MarkdownString）底部优雅附带拖拽操作指引，主次分明不喧宾夺主。
- **调试运行时暂停命中视觉跟随 (PAUSED)**：
  - 当调试器命中已激活场景中的断点暂停时，侧边栏树视图自动展开对应场景，并将命中断点标记为专属高亮 `▶ [PAUSED]` 与 `bp-paused.svg` 图标；调试复位后自动恢复常规态。

### 优化 (Improvements)
- **状态栏启动秒现与常驻保障**：
  - 补充 `activationEvents: ["onStartupFinished"]`，开机或刚安装完插件后立即自动激活，状态栏第一时间在底部呈现，无需任何前置命令操作。
- **场景主菜单结构重构（快捷动作置顶）**：
  - 将 `清空所有断点`、`多选场景激活...`、`导出场景...` 等常用全局命令置顶展示，彻底解决场景配置过多时管理动作被淹没需要滚动的痛点。
- **AI 诊断面板宿主自适应感知与置顶**：
  - 基于 `vscode.env.appName` 与特征关键词，自动精准识别当前 IDE 宿主（Antigravity、Trae、Cursor 等），并将其对应的平台条目动态置顶展示于首屏中央；
  - 已部署/已修改平台绝对置顶，告别翻页查找。

### 架构与质量工程 (Architecture & Quality Gates)
- **KDD 硬护栏沉淀**：
  - 确立“版本 SSOT 铁律”，以 `package.json` 为全生命周期版本唯一事实来源；
  - 确立“单测严禁私有镜像副本铁律”，测试代码 100% 直连生产模块，彻底杜绝“假绿”反模式；
  - 端到端（E2E）沙箱测试扩展至 47 项，全量 25 大扩展命令就绪校验与拖拽控制器真实执行 100% 绿灯。

---

## [1.0.3] - 2026-09-12

### 新增 (Added)
- **AI Agent 深度协同与一键 Skill 矩阵**：
  - **声明式场景激活 (`activeScenes`)**：AI Agent 可直接通过修改 `.vscode/debug-scenes.json` 中的 `activeScenes` 字段静默激活指定断点场景，无需复杂的工具调用或 MCP 服务，插件内部自动监听并即时挂载断点。
  - **一键安装 Agent Skill**：新增命令 `Scene Breakpoints: Install AI Agent Skill...` (`sceneBreakpoints.installAgentSkill`)，可将经过严格优化的 `scene-breakpoints` 技能矩阵一键安装至当前工作区。
  - **主流 AI 助手全面兼容**：开箱即用支持 Antigravity (`.agents/skills/scene-breakpoints/SKILL.md`)、Cursor (`.cursor/rules/scene-breakpoints.mdc`)、Windsurf (`.windsurfrules`)、GitHub Copilot (`.github/copilot-instructions.md`)、Claude Code (`CLAUDE.md`)、Roo Code、Cline、Continue 等 8 大主流 AI 编程助手，并标准化 YAML 技能元数据。
  - **Skill 生命周期感知与安全更新**：
    - 基于统一核心正文指纹反查（Hash 作为 Key，`O(1)` 秒查），自动剥离 MDC/YAML 平台头部并统一归一化换行符；
    - 精准三态生命周期判定（`UpToDate` 最新、`CleanOutdated` 官方平滑升级、`CustomModified` 用户已自定义）；
    - 诊断面板一键平滑升级无修改规则；对用户自定义规则提供 VS Code 原生 `vscode.diff` 并排比对由用户自主合并，覆写前自动生成 `.bak` 时间戳物理备份，保障规则资产绝对安全。
- **多语言语法自愈扩展 (Polyglot Self-Healing)**：
  - 增强作用域巡航引擎（Phase 2 Scope Cruise）对多种主流语言的作用域识别能力，现已原生支持 Python (`def`/`class`)、Go (`func`)、Rust (`fn`/`impl`)、Java / C++ / C# / PHP 等语法块，在跨文件、多语言重构时实现精准自愈。

### 优化与基础设施 (Improvements & Infrastructure)
- **CI/CD 自动化与质量门禁**：
  - 新增完整的 GitHub Actions 持续集成工作流（支持 Linux/Windows 矩阵测试与 xvfb 无头端到端测试）。
  - 完善命令面板所有 8 大交互命令及核心快捷键的自动化测试覆盖，保障版本稳定性。
  - 建立自动化 Release 工作流，推送版本标签自动触发构建与 `.vsix` 离线包发布。
- **文档与社区支持**：
  - 精简 README 视觉层级，新增关于 AI 调试断点布置痛点的场景说明。
  - 文档底部增加 Marketplace、Open VSX 评分 ⭐ 与 GitHub Issue 快速反馈通道。

---

## [1.0.2] - 2026-09-12

### 修复 (Fixed)
- **文档与市场页面链接在线化**：
  - 将用户指南、开源协议等所有徽标与文档链接升级为 GitHub 官方在线绝对路径，确保在 VS Code 编辑器插件详情页以及网页版市场中点击均可直接跳转打开。
  - 在发布包中放行 `docs/guide.md` 与 `docs/guide_zh.md`，离线包与分发包均自带完整手册。
- **扩展热重载空值安全加固 (INV-006)**：
  - 强化树视图数据提供者中的数组类型检查与空值保护，杜绝插件重新安装热重载瞬时出现的 `reading 'length'` 警告。

---

## [1.0.1] - 2026-09-12

### 新增 (Added)
- **两阶段自愈引擎升级 (INV-003)**：
  - 引入全文作用域巡航大跨度重锚定（Phase 2 Scope Cruise），轻松抵御超长代码位移（超 30 行甚至百行）。
  - 引入非空拓扑伴随窗口（Non-empty Topology Window），自动穿透空行与格式化干扰。
- **当前行本体守卫 (Target Existence Guard)**：
  - 目标代码行被彻底删除时，严格拦截仅凭单侧上下文引发的误自愈，精准判定为脱靶未匹配（`unmatched`）。
- **侧边栏脱靶断点专属矢量 SVG 警告图标**：
  - 新增标准 16x16 琥珀黄警告三角矢量图标，脱靶状态一目了然。
  - 前置 `[未匹配]` 文本标签，彻底根治侧边栏面板狭窄时的文字末尾省略号截断问题。

### 修复 (Fixed)
- 修复 `applyScene` 激活脱靶告警分支中漏写 `path` 模块导入的潜在运行时错误。
- 修复剪贴板导入与导出场景后内部写盘拦截树视图刷新的问题。
- 增强 Windows 平台路径反斜杠与正斜杠在脱靶状态下的比对归一化。

---

## [1.0.0] - 首发版本 (2026-09-08)

### 新增 (Added)
- **场景化断点分组管理**：按业务场景组织断点，一键切换、自动隔离清理无关断点。
- **代码漂移自愈**：代码改了行号变了？自动找回断点正确位置。
- **侧边栏树视图**：专属面板管理所有场景，支持复选框直接启用/禁用断点。
- **全类型断点支持**：行断点、条件断点、命中计数、Logpoint、函数断点全覆盖。
- **launch.json 自动联动**：启动调试时自动激活关联的场景断点。
- **断点双向实时同步**：编辑器里改了断点，场景自动更新；场景切换了，编辑器自动跟上。
- **多场景自由叠加**：同时激活多个场景，断点自动去重合并。
- **一键导出与导入**：当前断点导出为场景，或通过剪贴板分享给团队。
- **CodeLens 快捷入口**：在 `debug-scenes.json` 中直接点击 `▶ Apply Scene` 激活。
- **中英文双语自适应**：跟随 VS Code 语言设置自动切换。
- **声明式 JSON 配置**：`.vscode/debug-scenes.json` 随 Git 版本化，带 JSON Schema 校验。
