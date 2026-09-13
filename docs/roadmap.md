# Scene Breakpoints 功能演进与创新路线图 (Feature Proposals & Roadmap)

> **定位**：轻量级场景化断点编排器，专为**代码研读、执行链路追踪与 AI Agent 协同**打造。  
> 本文档汇总了插件在完成 v1.0.6 基础底座（多场景并发、自愈防漂移、侧边栏拖拽重排、8 大平台 AI Skill 矩阵）后的高价值特性规划与创新设计。

---

## 目录

- [一、交互体验与沉浸感升级](#一交互体验与沉浸感升级)
  - [1. 链路巡航漫游模式 (Step Player)](#1-链路巡航漫游模式-step-player)
  - [2. 行末注解与幽灵文本透视 (Inlay Hints)](#2-行末注解与幽灵文本透视-inlay-hints)
  - [3. 混音台灵感：场景“静音”与“独占” (Mute & Solo)](#3-混音台灵感场景静音与独占-mute--solo)
- [二、事故现场捕获与运行时可观测性](#二事故现场捕获与运行时可观测性)
  - [4. 事故现场逆向固化：调用栈一键存为场景 (Capture Call Stack)](#4-事故现场逆向固化调用栈一键存为场景-capture-call-stack)
  - [5. 链路耗时感知：轻量级断点 APM 探针 (Execution Stopwatch)](#5-链路耗时感知轻量级断点-apm-探针-execution-stopwatch)
- [三、研发工作流与团队协作沉淀](#三研发工作流与团队协作沉淀)
  - [6. Git 分支感知：分支绑定专属场景 (Branch-Bound Presets)](#6-git-分支感知分支绑定专属场景-branch-bound-presets)
  - [7. PR 审查与 Code Review 导览生成 (PR Debug Walkthrough)](#7-pr-审查与-code-review-导览生成-pr-debug-walkthrough)
  - [8. 流程图与文档化互转 (Export Mermaid & Markdown)](#8-流程图与文档化互转-export-mermaid--markdown)
- [四、AI Agent 深度协同与全自动闭环](#四ai-agent-深度协同与全自动闭环)
  - [9. 调试现场上下文一键喂给 AI (Copy Context for AI)](#9-调试现场上下文一键喂给-ai-copy-context-for-ai)
  - [10. AI 自动调试巡航与自主验货 (Autonomous Debugging Loop)](#10-ai-自动调试巡航与自主验货-autonomous-debugging-loop)
- [五、演进节奏与优先级矩阵 (Priority Matrix)](#五演进节奏与优先级矩阵-priority-matrix)

---

## 一、交互体验与沉浸感升级

### 1. 链路巡航漫游模式 (Step Player)
- **痛点场景**：开发者不仅在调试代码时使用插件，更多时候是在**静态阅读复杂源码**（研读开源项目、学习新接手工程）。目前要在步骤间穿梭，只能用鼠标反复点击侧边栏树节点，打断研读心流。
- **核心机制**：
  - 提供全局快捷键：`Alt + [`（上一步） / `Alt + ]`（下一步）；
  - 底部状态栏显示迷你控制条：`⏮️ 2/5 [步骤 2: 校验权限] ⏭️`；
  - 按下快捷键，编辑器平滑滚动并高亮目标行，并自动弹出轻量气泡展示该步骤备注，无需运行调试即可如 PPT 般流畅漫游调用链。
- **推荐等级**：⭐️⭐️⭐️⭐️⭐️（研读源码杀手锏）

### 2. 行末注解与幽灵文本透视 (Inlay Hints)
- **痛点场景**：打开源文件时，断点只有一个普通的红点，无法一眼识别该断点属于哪个场景、处于第几步，必须悬浮鼠标等待 Tooltip 展开。
- **核心机制**：
  - 基于 VS Code `languages.registerInlayHintsProvider`，在当前激活场景涉及的代码行末尾，渲染半透明优雅浅灰注解：
    ```typescript
    if (!user.isVip) return false; // 💡 [登录场景] 步骤 1: VIP 拦截
    ```
  - 支持配置一键开关（默认开启），低干扰度，不影响实际代码编辑。
- **推荐等级**：⭐️⭐️⭐️⭐️（视觉沉浸感极强）

### 3. 混音台灵感：场景“静音”与“独占” (Mute & Solo)
- **痛点场景**：同时勾选激活了 3 个业务场景进行交叉联调，突然某个场景中的循环断点高频暂停打扰排查，目前只能手动反选取消，排查完又得重新找回来勾选。
- **核心机制**：
  - 借鉴音频 DAW 混音台控制逻辑：
    - **Solo（独占模式 `[S]`）**：点一下场景条目旁的 `[S]`，其他所有勾选场景瞬间静默，仅当前场景断点生效；再次点击完美恢复此前勾选组合；
    - **Mute（静音模式 `[M]`）**：临时冻结某个场景的断点下发，保留勾选状态不丢失。
- **推荐等级**：⭐️⭐️⭐️⭐️（极客范交互）

---

## 二、事故现场捕获与运行时可观测性

### 4. 事故现场逆向固化：调用栈一键存为场景 (Capture Call Stack)
- **痛点场景**：程序抛出未捕获异常崩溃，或卡在深层调试断点时，调用栈（Call Stack）横跨了十几个文件的调用链路。一旦终止调试，该链路信息立刻丢失，复现又得重新顺藤摸瓜。
- **核心机制**：
  - 处于调试暂停或崩溃态时，提供上下文菜单与快捷命令：`Scene: 将当前调用栈保存为场景断点`；
  - 插件通过 DAP（Debug Adapter Protocol）自动拉取当前激活线程的调用栈帧，一键转换为带顺序的场景断点序列：
    - `步骤 1: dispatchAction (src/core/dispatcher.ts:52)`
    - `步骤 2: executeMiddleware (src/middleware/auth.ts:18)`
    - `步骤 3: handleCrashPoint (src/controller/order.ts:99) [崩溃现场]`
- **推荐等级**：⭐️⭐️⭐️⭐️⭐️（瞬态事故秒变工程资产）

### 5. 链路耗时感知：轻量级断点 APM 探针 (Execution Stopwatch)
- **痛点场景**：排查慢接口或性能瓶颈时，开发者通常被迫手写 `console.time()` / `Date.now()` 埋点，查完后又必须手动删代码，侵入性极高。
- **核心机制**：
  - 在场景断点（如 Logpoint 或连续命中断点）之间，插件在 DAP 命中事件中自动计算相邻断点的时间差（$\Delta t$）；
  - 在侧边栏树视图直接标注运行耗时：
    ```text
    步骤 1: 权限拦截入口 (auth.ts:45)
      ↳ ⏱️ +15ms
    步骤 2: 复杂 SQL 查询 (dao.ts:120)
      ↳ ⏱️ +940ms ⚠️ [耗时瓶颈]
    步骤 3: 数据响应组装 (view.ts:33)
    ```
- **推荐等级**：⭐️⭐️⭐️⭐️⭐️（零侵入本地 APM 探针）

---

## 三、研发工作流与团队协作沉淀

### 6. Git 分支感知：分支绑定专属场景 (Branch-Bound Presets)
- **痛点场景**：在 `feature/order` 分支排查订单时打了一组断点，临时切到 `hotfix/login` 分支修漏洞时断点混乱报红，切回订单分支后又得重新打。
- **核心机制**：
  - 在 `.vscode/debug-scenes.json` 中支持 `"branchBindings"`：
    ```json
    "branchBindings": {
      "feature/order": "order-debug",
      "hotfix/login": ["auth-debug", "token-debug"]
    }
    ```
  - 监听 Git 扩展的分支切换事件，切换分支时自动静默挂载对应分支绑定的场景断点。
- **推荐等级**：⭐️⭐️⭐️⭐️（分支无缝切换）

### 7. PR 审查与 Code Review 导览生成 (PR Debug Walkthrough)
- **痛点场景**：提交复杂 PR（涉及 10+ 文件）时，Reviewer 面对扁平的文件改动列表难以梳理核心调用脉络。
- **核心机制**：
  - 执行命令 `Scene: 导出为 PR Review 导览`，自动格式化生成精炼的 Markdown 导览段落，直接粘贴至 PR 描述：
    ```markdown
    ### 🧭 核心执行链路导引
    建议使用 `Scene Breakpoints` 激活 `pr-order-flow` 场景进行审阅：
    1. 步骤 1: 参数防重校验 (`src/api/order.ts:35`)
    2. 步骤 2: 库存原子扣减 (`src/domain/inventory.ts:88`)
    3. 步骤 3: 状态机流转存盘 (`src/infra/repo.ts:140`)
    ```
- **推荐等级**：⭐️⭐️⭐️⭐️（团队协作规范利器）

### 8. 流程图与文档化互转 (Export Mermaid & Markdown)
- **核心机制**：
  - 一键将选定场景转换为标准 Mermaid 流程图或 Markdown 步骤列表，粘贴至内部 Wiki / 文档库；
  - 反向：识别剪贴板中的步骤列表，一键反向生成断点场景。
- **推荐等级**：⭐️⭐️⭐️（文档沉淀）

---

## 四、AI Agent 深度协同与全自动闭环

### 9. 调试现场上下文一键喂给 AI (Copy Context for AI)
- **痛点场景**：断点命中后，开发者常需询问 AI：“为什么走到了这一步？变量为什么是空？” 手工把当前场景背景、上一步在哪、当前断点目的敲给 AI 极其繁琐。
- **核心机制**：
  - 命中断点暂停时，侧边栏或悬浮窗提供 `Copy Scene Context for AI`；
  - 结构化打包：场景名称 + 前置已通过步骤 + 当前命中步骤（附带备注与代码片段）+ 预期下一步，一键注入剪贴板/AI 聊天框。
- **推荐等级**：⭐️⭐️⭐️⭐️⭐️（AI 协同反向闭环）

### 10. AI 自动调试巡航与自主验货 (Autonomous Debugging Loop)
- **核心机制**：
  - 扩充 8 大平台 Agent Skill 能力：
    允许 AI 执行调试启动，并在断点命中时读取作用域变量，自主比对预期值并输出自动化诊断报告（例如确认修复是否生效，哪个分支产生了脏数据）。
- **推荐等级**：⭐️⭐️⭐️⭐️⭐️（未来感全自动 Agentic Debugging）

---

## 五、演进节奏与优先级矩阵 (Priority Matrix)

| 阶段 | 核心特性 | 价值定位 | 预计改动层级 |
| :--- | :--- | :--- | :--- |
| **Phase 1 (快速见效)** | **链路巡航模式 (Step Player)**<br>**事故调用栈一键固化 (Capture Call Stack)**<br>**AI 现场上下文一键复制** | 读代码心流、查 Bug 资产固化与 AI 问答提效 | 纯前端命令与视图层（`infra/vscode`），零核心领域侵入 |
| **Phase 2 (工作流深化)** | **Git 分支绑定 (Branch Bindings)**<br>**场景静音与独占 (Mute & Solo)**<br>**行末透视注解 (Inlay Hints)** | 提升日常高频调试幸福感与多场景并发调度 | 扩展 `application/sceneService` 调度与状态机标志位 |
| **Phase 3 (进阶探针与 Agent)** | **链路耗时 APM 探针 (Stopwatch)**<br>**PR Review 导览导出**<br>**AI 自动验货巡航闭环** | 性能调优、团队工程化与 Agentic 深度融合 | DAP 运行期时间统计与 Skill 反向工具定义 |

---
*文档编制完成于 2026-09-13。遵循 KISS 与渐进式演进原则，按需投入设计与开发。*
