# 术语表 (Glossary)

> **TL;DR**: 核心术语：**场景 (Scene)**（一组按业务命名的断点集合）、**场景引用 (Scene Reference)**（`{type:"scene"}` 声明组合另一场景的全部断点，激活时深度优先展开）、**自愈指纹 (Context Snippet)**（记录断点上下三行的代码特征）、**DAP (Debug Adapter Protocol)**（VS Code 原生调试协议）。⚠️ 易混淆：**原生断点 ≠ 场景断点**（原生断点是编辑器运行期的临时红点，场景断点是版本化保存在 JSON 中的声明式配置）。

---

## 核心概念

### B

#### 断点自愈 (Breakpoint Self-Healing / Line Drift Self-Healing)
当底层源码因 Git 分支合并、代码编辑或注释增删导致目标行号发生上下位移时，插件基于断点保存时记录的“三行伴随指纹”，通过双向滑动窗口探测自动找回最新正确代码行并无缝重新下发的过程。

---

### C

#### 能力契约 (Capability Contract)
核心层定义的业务能力接口，表达"能做什么"。示例：自愈探测能力 `HealingEngine.heal`、配置清洗与读写能力 `loadScenesConfig`。

#### 调用栈固化 (Capture Call Stack)
调试暂停态下将当前线程 DAP 堆栈帧逆向固化为场景断点的一键能力：过滤工作区源码帧并按 file+line 去重，帧名沉淀为断点描述，自动提取三行上下文指纹后以追加 upsert（INV-001）落入新场景（缺省 local 私有层）。捕获上下文随 `stopped` 登记、`continued`/`terminated` 清除。

#### 上下文伴随指纹 (Context Snippet / Context Triple)
在保存断点时自动抓取的目标代码行核心文本（`current`），以及可选的前一行（`prev`）和后一行（`next`）文本。用于在行号漂移时进行高置信度的上下文协同验证。

#### 核心断点拓扑 Diff (Core Breakpoints Topology Diff)
基于断点运行期关键字段（`file+line+type+condition+hitCondition+logMessage+enabled`）计算拓扑 Hash，外部文件变更时比对新旧拓扑，若仅修改说明备注（`desc`）或闲置未激活场景，则阻断重刷。

#### 循环引用 (Circular Reference)
场景引用链 A→B→A 形成的环（含自引用 A→A）。激活含环场景时，`sceneResolver` 在任何写盘/DAP 下发之前抛出 `CircularReferenceError`（携带完整环路径），激活中止且磁盘零污染（INV-030.3）。

---

### D

#### 调试适配协议 (DAP - Debug Adapter Protocol)
微软统一的调试器抽象通信协议。本项目通过 VS Code 的 `vscode.debug.addBreakpoints` 和 `vscode.debug.removeBreakpoints` 与 DAP 交互，原生支持 5 类断点装配。

#### DOM Diff 节点复用 (DOM Diff & In-Place Update)
在 VS Code 树视图扩展开发中，为每个 `TreeItem` 赋予稳定且唯一的不变 `id`。当 `onDidChangeTreeData` 刷新时，宿主依据 `id` 精准识别前后节点同一性，执行原地属性更新（Diff），保留用户折叠展开与选中态，杜绝整树 DOM 销毁重建与白屏跳动闪烁。

#### 声明态与展开态 (Declared World vs Expanded World)
v1.1.0 场景组合引擎的核心概念对。**声明态**：磁盘配置中的原始步骤序列（`SceneStep[]`，断点与场景引用穿插共存）；**展开态**：激活时经 `sceneResolver` 深度优先展开引用后的纯断点流。两者由激活管道收窄点隔离，编译期以 `SceneStep` / `Breakpoint` 类型强制（INV-030.1）。

#### 悬空引用 (Dangling Reference)
引用的 `name` 在 `scenes` 字典中不存在的场景引用条目。激活时降级为警告并跳过该引用，不中断其余断点的正常下发（INV-030.4）。

---

### G

#### 幽灵场景拦截守卫 (Ghost Scene Guard)
在调试启动配置推导（`LaunchBindingResolver.resolveScenes`）或命令激活（`applySceneCommand`）时，对输入的目标场景名称进行真实存在性双向审计（存在性过滤与大小写容错匹配）。未在 `debug-scenes.json` 中定义的虚假场景将被强行拦截，绝不作为当前激活状态写入状态机。

#### 图快照 (GraphSnapshot)
v1.3.0 可视化画布的只读投影数据契约（`buildGraphSnapshot` 产出）：泳道（GraphLane，按场景分层 team/local）、节点（GraphNode，`{ownerScene}#{index}` 稳定 id，kind 区分断点/场景引用）、警告（GraphWarning，悬空/禁用引用）与目录全量场景选项（`availableScenes`，Scope Selector 数据源）的纯字段拷贝。节点与泳道均携带 `registered` 纯推导标注（ownerScene/sceneName ∈ activeScenes），供 webview 渲染未激活态；展开失败泳道以 `expandError`（circular-ref + 环路径）结构化透出。画布渲染、Live 点亮与 Mermaid 导出均以其为唯一数据源，禁止实体引用回写。

#### 场景范围选择器 (Scope Selector)
v1.3.0 画布顶部场景多选条（webview checkbox chips，team/local 分层着色）：用户勾选决定可见场景集 `visibleScenes`（缺省 = 当前激活集），经 `set-scope` 协议消息回传宿主重建快照。"看什么"（visibleScenes）与"什么在生效"（activeScenes）正交解耦——未激活场景可被查看（未激活态渲染），激活集零影响；Scope 为纯视图状态（面板生命周期内有效，随面板销毁重置），不入业务主状态。轨迹跨 Scope 切换保留（nodeId 稳定）。

---

### F

#### 函数断点 (Function Breakpoint)
不绑定具体文件和物理行号，仅按函数/方法名称进行全局拦截的断点类型。

---

### H

#### 命中计数断点 (Hit Count Breakpoint)
仅当代码执行到指定次数或满足频次条件（例如 `> 5`, `% 10 === 0`）时才暂停执行的断点。

#### 命中轨迹时间线 (Hit Trace Timeline)
v1.3.0 画布第二视图（与执行流 DAG tab 切换）：调试会话内每次 `debug:paused` 追加一条 `TraceRecord`（seq 单调递增、nodeId 经活动断点索引匹配），横向时间轴呈现命中顺序与循环轮次折返模式；`debug:resumed` 保留累积、`debug:terminated` 全量清空。会话级易失，零持久化（不落盘、不入 JSON Schema）。

---

### I

#### 接口契约 (API Contract / Command Contract)
对外暴露的命令调用入口，表达“如何调用”。示例：`sceneBreakpoints.applyScene`、`sceneBreakpoints.showMenu`。

#### 行末注解与幽灵文本 (Inlay Hints)
VS Code 原生语言提示特性。当场景激活时，在涉及断点的代码行末尾渲染浅色半透明胶囊标签（如 `💡 [场景名 #序号] 备注`），提供不用悬浮鼠标即可一眼洞察所属场景与步骤的视觉透视能力，并挂载富文本 Markdown 悬浮卡片。

---

### L

#### 日志断点 (Logpoint)
命中时不暂停程序执行，而是在调试控制台动态输出带有 `{var}` 变量插值日志消息的高级断点。

#### 个人私有层 (Local Layer / debug-scenes.local.json)
分层配置体系（INV-032）中面向开发者个人的私有场景文件 `.vscode/debug-scenes.local.json`：扩展激活时自动幂等写入 `.gitignore`，杜绝临时调试断点污染 Git。读取链路一律返回合并视图（同名场景 local 覆盖团队层）；UI 新建场景缺省落此层；激活态 `activeScenes` 仅存团队主文件。

---

### N

#### 收窄点 (Narrowing Point)
声明世界（`SceneStep`）向展开世界（`Breakpoint`）转换的唯一合法通道，位于 `sceneActivationPipeline`（INV-030.1）。编译期以返回类型隔离强制：`Scene.getSteps(): SceneStep[]` 保留声明态，只有经收窄点展开后的纯断点流才可进入合并/自愈/DAP 管道。

---

### O

#### 断点定义场景 (ownerScene)
某条断点在 `scenes` 字典中最初声明的宿主场景。自愈回写按 `ownerScene` 路由落盘：即使该场景未被激活、仅被其他场景引用，校准行号仍回写至定义处；同源多引用至多回写一次，引用节点自身永不接收回写（INV-030.6）。

---

### P

#### 能力契约端口 (Ports / Capability Contract Ports)
由领域驱动设计（DDD）领域层显式定义的一组抽象能力接口，表达“能做什么”（如 `IBreakpointBridge` 操作原生断点契约、`ISceneRepository` 场景持久化存储契约）。领域层与应用用例层仅依赖端口契约，由基础设施层（`src/infra/`）具体适配器完成技术实现，彻底实现业务规则与宿主技术框架的反转解耦。

#### 挂起拓扑更新 / 调试会话保护 (Pending Topology Update / Debug Session Guard)
当 VS Code 调试会话正在运行时，将外部断点拓扑变更挂起暂存（`pendingTopologyUpdate = true`），避免打断调试现场，待会话结束后自动补偿装配。

---

### S

#### 单写者串行队列 (Single-Writer Serial Queue)
应用用例层全局唯一的单写者可重入串行互斥队列（`applicationSerialQueue`，实现于 `src/application/serialQueue.ts`）。依托 Node.js 原生 `AsyncLocalStorage` 赋予队列同调用链安全可重入特性，将所有针对场景主状态的写操作（如场景激活、新增断点、清除重置、外部变更调度、剪贴板导入等）严格约束进全局唯一的串行化互斥管道，前序任务完成方才出队执行后续任务，既杜绝并发写脏覆盖，又彻底免疫嵌套调用的自死锁。

#### 场景 (Scene)
一个用业务语义命名的断点集合（例如 `user-login`、`order-pay-flow`），声明式保存在 `.vscode/debug-scenes.json` 中，可一键整体激活或反向导出。

#### 场景状态机 (Scene State Machine / SceneStateManager)
系统全局唯一的激活场景状态管理者（Single Source of Truth），负责发射状态变动通知事件，驱动底部状态栏被动更新，并维护防止竞态闪烁的执行锁。

---

#### 场景目录聚合根 (SceneCatalog Aggregate Root)
领域驱动设计（DDD）核心聚合根，对应单个工作区中 `.vscode/debug-scenes.json` 权威 SSOT 配置文档。负责管控全量场景字典、当前激活场景集合、先到先得断点拓扑合并、幽灵防御与全场景静默加固，是断点业务持久化交互的唯一入口。

#### 场景局部实体 (Scene Entity)
断点的领域聚合容器实体，隶属于 `SceneCatalog`。负责单个业务场景内部断点序列的有序排列、同位置查重覆盖（INV-001）、位置调整（上下移动、置顶置底、拖拽重排）与批量启闭控制。

#### 场景引用 (Scene Reference / SceneRefItem)
以 `{ "type": "scene", "name": "..." }` 声明的组合条目，表示在当前位置组合另一场景的全部断点。激活时经 `sceneResolver` 深度优先展开，声明顺序即执行顺序；支持 `desc`（树视图说明）与 `enabled: false`（临时摘除整棵子树）。仅限同文件内按 name 解析，禁止成环；树视图中呈现为只读嵌套节点。

#### 断点充血实体 (Breakpoint Entity)
封装 VS Code 5 类断点物理属性的充血领域实体。内聚了代码伴随指纹提取（`enrich`）、自愈结果吸收校准（`applyHealed`）、多态查重匹配（`matches`）与纯数据序列化契约。

---

### U

#### 断点脱靶 / 失联断点 (Unmatched Breakpoint)
当断点所依赖的目标源码发生破坏性重构、代码被彻底删除、或行号位移超出搜索视距导致加权置信度低于安全阈值时，自愈算法判定为无法精准锚定的断点。系统将其状态标记为 `unmatched` 并平滑回退至原行号，同时向开发者发出可视化警告通知并提供源码一键定位。

---

#### 指纹冲突 (Fingerprint Conflict)
外部编辑重锚定了断点的磁盘声明行号，但旧上下文指纹仍能在源码其他位置精准命中，导致「磁盘行号」与「指纹自愈结论」相互矛盾的情形。激活管道检测到冲突时必须弹窗交由用户裁决：`disk` 保留磁盘行号（缺省，尊重显式编辑）或 `fingerprint` 维持自愈回滚。见 INV-031。

---

#### 基线播种 (Baseline Seeding)
扩展冷启动时以磁盘 `debug-scenes.json` 现状播种 `echoLoopGuard` 的 `lastSavedContent` 基线，使 Git Pull / 环境漂移在启动后仍可静默自愈，不误判为外部编辑冲突。见 INV-031。

---

### W

#### 变量监视锚点 (Watch Anchors)
v1.5.0 新增的可观测性断点能力：允许开发者在断点配置中声明需观测的变量表达式列表（`watch: string[]`）及键值对期望值（`expected`）。当调试器命中断点暂停时，插件通过 DAP 只读求值（`context: "watch"`）异步读取最新值，自动与期望值比对并在树视图/悬浮卡片中直观呈现匹配状态（✅ 匹配、❌ Mismatch、⚠️ 异常）。求值具备 300ms 熔断保护，字段不参与上下文指纹计算。见 INV-033。

---

## 缩写表

| 缩写 | 全称 | 说明 |
|------|------|------|
| **DAP** | Debug Adapter Protocol | 调试适配协议 |
| **DDD** | Domain-Driven Design | 领域驱动设计 |
| **SRP** | Single Responsibility Principle | 单一职责原则 |
| **SSOT** | Single Source of Truth | 单一事实来源原则 |
| **KDD** | Knowledge Driven Development | 知识库驱动开发 |
| **ADR** | Architecture Decision Record | 架构决策记录 |
| **BP** | Breakpoint | 断点 |

---

## 变更记录

| 日期 | 变更内容 | 变更人 | 关联变更 |
|------|----------|--------|----------|
| 2026-10-06 | 新增术语：场景引用、声明态与展开态、收窄点、断点定义场景 (ownerScene)、悬空引用、循环引用 | GLM-5.3-Flash | v1.1.0 批次5 同步更新 constraints.md / boundaries.md / flows.md / adr/005 / e2e-scenarios.md |
| 2026-10-07 | 新增术语：指纹冲突 (Fingerprint Conflict)、基线播种 (Baseline Seeding) | GLM-5.3-Flash | #TASK-EXT-CONFLICT 同批次 constraints.md / flows.md / lessons / e2e-scenarios.md / CHANGELOG 双语 |
| 2026-10-07 | 新增术语：调用栈固化 (Capture Call Stack)、个人私有层 (Local Layer) | GLM-5.3-Flash | v1.2.0 同批次 constraints.md / boundaries.md / flows.md / e2e-scenarios.md / roadmap / CHANGELOG 双语 |
| 2026-10-07 | 新增术语：图快照 (GraphSnapshot)、命中轨迹时间线 (Hit Trace Timeline) | GLM-5.3-Flash | v1.3.0 批次5 同步更新 constraints.md / boundaries.md / flows.md / e2e-scenarios.md / adr/007 / CHANGELOG 双语 |
| 2026-10-07 | 扩写图快照（availableScenes/registered/expandError）；新增术语：场景范围选择器 (Scope Selector) | GLM-5.3-Flash | #SCOPE-SELECTOR 同步更新 boundaries.md / flows.md / e2e-scenarios.md / 设计文档 R5 / CHANGELOG 双语 |

