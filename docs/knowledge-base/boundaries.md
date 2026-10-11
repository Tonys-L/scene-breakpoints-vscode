# 能力边界 (Boundaries)

> **核心原则**：本插件专职负责断点元数据的场景化编排、代码自愈与声明式持久化；底层调试进程生命周期与单步执行由宿主 DAP 负责。⚠️ **断点下发不等于调试器启动**。

---

## 核心能力矩阵

| 能力项 | 系统职责 (能做什么) | 宿主职责 / 边界约束 (不能做什么) | 核心负责模块 |
|---|---|---|---|
| **场景装配与激活** | • 单场景/多场景叠加激活（先到先得去重 INV-011）<br>• 原地 Diff 增量下发，保持现有断点 0 闪烁<br>• 完整支持行断点、条件、命中计数、日志及函数断点 | ❌ 不控制调试会话启动、暂停或单步执行<br>❌ 无法直接下发语言特定异常断点 | `SceneManager`<br>`vscodeBreakpointBridge` |
| **代码行号自愈** | • 基于伴随三行指纹两阶段计算（近距 ±30 行 + 作用域巡航）<br>• 自动自愈回写持久化闭环，自动提取补齐缺失指纹<br>• 软相似度与置信度门禁（低于 60% 标记脱靶并保留原行） | ❌ 不做复杂 AST 代码重写<br>❌ 代码行被物理删除且无相似逻辑时无法凭空生成 | `HealingEngine`<br>`SceneCatalog` |
| **断点反向导出** | • 一键抓取编辑器当前全部活跃断点并相对化持久化<br>• 支持“覆盖”或“追加去重合并（INV-001）” | ❌ 仅抓取受支持断点，不备份非当前工作区配置 | `SceneManager`<br>`sceneCommands.ts` |
| **树视图与源码透视** | • 原生树视图（拖拽重排、启闭、删除）与高保真 16x16 SVG 图标<br>• 源码行末 Inlay Hints 幽灵标签与悬浮卡片透视 | ❌ 仅作为被动观察者渲染，不持有全局激活主状态 | `src/ui/views/*`<br>`treeCommands.ts` |
| **全双工防回环同步** | • 树视图、DAP 断点与本地 JSON 三向实时同步<br>• 时间窗与哈希守卫（INV-008 EchoLoopGuard）阻断回环死锁 | ❌ 仅反向同步当前处于激活态的场景，严禁污染非激活场景 | `echoLoopGuard`<br>`breakpointSyncListener` |
| **启动项联动激活** | • 捕获调试启动并按优先级（`env` > `bindings` > 同名）推导场景<br>• 幽灵场景（未在配置中定义）强行拦截（INV-009） | ❌ 仅作为预装配拦截，不修改用户的 `launch.json` 规则 | `launchBindingResolver`<br>`debugLifecycleListener` |
| **AI 声明式编排** | • AI 直接声明式读写 `debug-scenes.json` 激活场景<br>• 8 大主流 VS Code AI 规则一键分发与正文哈希版本诊断 | ❌ 受用户 `allowAiFileActivation` 开关授权控制<br>❌ 插件自身不内置大模型运行时 | `agentSyncService`<br>`skillCommands` |
| **场景引用组合解析** | • 组合激活经 `sceneResolver` 深度优先展开引用为纯断点流，声明时序 100% 保真（INV-030）<br>• 成环在写盘/DAP 前拦截；悬空降级警告跳过；`enabled: false` 整棵子树摘除<br>• 自愈回写按 ownerScene（断点定义场景）路由，同源多引用单次回写 | ❌ 不支持跨文件/跨工作区引用（同 `debug-scenes.json` 内按 name 解析）<br>❌ 引用子树在树视图中只读，断点须回源场景编辑 | `sceneResolver`<br>`sceneActivationPipeline` |
| **团队/个人配置隔离** | • 双层配置（team 主文件 + `*.local.json` 私有层）合并加载，同名场景 local 覆盖 team（INV-032）<br>• UI 新建场景缺省落 local 私有层，激活时自动幂等写入 `.gitignore` | ❌ 暂不提供场景跨层移动命令<br>❌ local 文件不入 Git，插件不代为版本管理 | `jsonFileSceneRepository`<br>`mutateCatalog` |
| **调用栈一键固化 (Capture Call Stack)** | • 调试暂停时经 DAP `stackTrace` 读取当前线程堆栈帧（≤20 帧），过滤工作区源码帧并按 file+line 去重，提取三行上下文指纹<br>• 以追加 upsert（INV-001）固化为新场景，缺省落 local 私有层 | ❌ 仅调试暂停态可用（`stopped` 登记、`continued`/`terminated` 即刻清除捕获上下文）<br>❌ 不固化无 source 或工作区外的栈帧 | `captureCallStackCommand`<br>`debugPauseContext`<br>`debugLifecycleListener` |
| **场景断点可视化画布 (Visual Graph Canvas)** | • 全景 Webview 画布呈现**可见场景**展开态执行流 DAG（泳道 = 场景分层、引用嵌套分组），数据经 `buildGraphSnapshot` 只读投影生成（零实体回写）<br>• 场景范围选择器 (Scope Selector)：画布顶部场景多选条，"看什么"（visibleScenes，用户选择，缺省 = 激活集）与"什么在生效"（activeScenes）正交解耦；未激活场景节点以 `registered: false` 纯推导标注渲染未激活态（半透明 + 角标），支持查看任意/多个场景<br>• 展开失败场景（成环）降级为警告泳道（`expandError` 列出环路径），不静默空白；成功场景互不拖垮<br>• 点击节点/轨迹标记直达源码（视口居中 + 一次性装饰高亮）；`debug:paused` 事件驱动 Live 脉冲与命中轨迹累积（会话级易失，terminated 清空）<br>• 一键导出 Mermaid 文本至剪贴板（`exportGraphToMermaid` 纯函数，零落盘，所见即所得对齐当前 Scope）；cytoscape+dagre 构建期打包为本地静态资源（ADR-007） | ❌ 画布为只读投影，不提供画布上编辑断点能力<br>❌ Scope 选择为纯视图状态（面板生命周期），不入业务主状态、不改变激活集<br>❌ 轨迹不持久化、不入 JSON Schema（会话级易失）<br>❌ 渲染库仅存在于 webview 沙箱，扩展主进程零图形库依赖、零 CDN 外链（GR-012） | `sceneGraphProjection`<br>`debugTraceBuffer`<br>`graphCanvasController`<br>`graphCommands` |

---

## 边界与外部解耦

| 边界维度 | 插件内部负责 (System Inside) | 外部宿主/第三方负责 (System Outside) | 依赖解耦方式 |
|---|---|---|---|
| **断点下发** | 断点规则清洗、合并计算与增量 Diff | 实际向调试器注入断点并拦截运行 | 依赖抽象 `IBreakpointBridge` |
| **配置存储** | 场景元数据验证、自愈计算与原子落盘 | 提供磁盘文件系统 I/O | 依赖抽象 `ISceneRepository` |
| **人机交互** | 树视图节点构建、命令分发与状态展示 | 提供 UI 控件、事件循环与剪贴板 | 依赖 `src/ui/*` 适配层隔离 |

---

## 变更记录

| 日期 | 变更内容 | 变更人 | 关联变更 |
|------|----------|--------|----------|
| 2026-10-06 | 核心能力矩阵新增"场景引用组合解析"能力边界（INV-030） | GLM-5.3-Flash | v1.1.0 批次5 同步更新 constraints.md / flows.md / glossary.md / adr/005 / e2e-scenarios.md |
| 2026-10-07 | 核心能力矩阵新增"团队/个人配置隔离"（INV-032）与"调用栈一键固化 (Capture Call Stack)"能力边界 | GLM-5.3-Flash | v1.2.0 同批次 constraints.md / flows.md / glossary.md / e2e-scenarios.md / roadmap / CHANGELOG 双语 |
| 2026-10-07 | 核心能力矩阵新增"场景断点可视化画布 (Visual Graph Canvas)"能力边界（只读投影、会话级轨迹、Mermaid 零落盘导出、ADR-007 构建期打包） | GLM-5.3-Flash | v1.3.0 批次5 同步更新 constraints.md / flows.md / glossary.md / architecture.md / e2e-scenarios.md / adr/007 / roadmap / CHANGELOG 双语 |
| 2026-10-07 | 画布能力边界扩展：新增场景范围选择器 (Scope Selector)（visibleScenes/activeScenes 正交解耦、registered 纯推导标注、成环警告泳道、导出所见即所得） | GLM-5.3-Flash | #SCOPE-SELECTOR 同步更新 flows.md / glossary.md / e2e-scenarios.md / 设计文档 R5 / CHANGELOG 双语 |

