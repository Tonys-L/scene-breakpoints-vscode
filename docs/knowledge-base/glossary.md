# 术语表 (Glossary)

> **TL;DR**: 核心术语：**场景 (Scene)**（一组按业务命名的断点集合）、**自愈指纹 (Context Snippet)**（记录断点上下三行的代码特征）、**DAP (Debug Adapter Protocol)**（VS Code 原生调试协议）。⚠️ 易混淆：**原生断点 ≠ 场景断点**（原生断点是编辑器运行期的临时红点，场景断点是版本化保存在 JSON 中的声明式配置）。

---

## 核心概念

### B

#### 断点自愈 (Breakpoint Self-Healing / Line Drift Self-Healing)
当底层源码因 Git 分支合并、代码编辑或注释增删导致目标行号发生上下位移时，插件基于断点保存时记录的“三行伴随指纹”，通过双向滑动窗口探测自动找回最新正确代码行并无缝重新下发的过程。

---

### C

#### 能力契约 (Capability Contract)
核心层定义的业务能力接口，表达“能做什么”。示例：自愈探测能力 `resolveHealedLine`、配置清洗与读写能力 `loadScenesConfig`。

#### 上下文伴随指纹 (Context Snippet / Context Triple)
在保存断点时自动抓取的目标代码行核心文本（`current`），以及可选的前一行（`prev`）和后一行（`next`）文本。用于在行号漂移时进行高置信度的上下文协同验证。

#### 核心断点拓扑 Diff (Core Breakpoints Topology Diff)
基于断点运行期关键字段（`file+line+type+condition+hitCondition+logMessage+enabled`）计算拓扑 Hash，外部文件变更时比对新旧拓扑，若仅修改说明备注（`desc`）或闲置未激活场景，则阻断重刷。

---

### D

#### 调试适配协议 (DAP - Debug Adapter Protocol)
微软统一的调试器抽象通信协议。本项目通过 VS Code 的 `vscode.debug.addBreakpoints` 和 `vscode.debug.removeBreakpoints` 与 DAP 交互，原生支持 5 类断点装配。

#### DOM Diff 节点复用 (DOM Diff & In-Place Update)
在 VS Code 树视图扩展开发中，为每个 `TreeItem` 赋予稳定且唯一的不变 `id`。当 `onDidChangeTreeData` 刷新时，宿主依据 `id` 精准识别前后节点同一性，执行原地属性更新（Diff），保留用户折叠展开与选中态，杜绝整树 DOM 销毁重建与白屏跳动闪烁。

---

### G

#### 幽灵场景拦截守卫 (Ghost Scene Guard)
在调试启动配置推导（`resolveLaunchBoundScenes`）或命令激活（`applySceneCommand`）时，对输入的目标场景名称进行真实存在性双向审计（存在性过滤与大小写容错匹配）。未在 `debug-scenes.json` 中定义的虚假场景将被强行拦截，绝不作为当前激活状态写入状态机。

---

### F

#### 函数断点 (Function Breakpoint)
不绑定具体文件和物理行号，仅按函数/方法名称进行全局拦截的断点类型。

---

### H

#### 命中计数断点 (Hit Count Breakpoint)
仅当代码执行到指定次数或满足频次条件（例如 `> 5`, `% 10 === 0`）时才暂停执行的断点。

---

### I

#### 接口契约 (API Contract / Command Contract)
对外暴露的命令调用入口，表达“如何调用”。示例：`sceneBreakpoints.applyScene`、`sceneBreakpoints.showMenu`。

---

### L

#### 日志断点 (Logpoint)
命中时不暂停程序执行，而是在调试控制台动态输出带有 `{var}` 变量插值日志消息的高级断点。

---

### P

#### 能力契约端口 (Ports / Capability Contract Ports)
由领域驱动设计（DDD）领域层显式定义的一组抽象能力接口，表达“能做什么”（如 `IBreakpointBridge` 操作原生断点契约、`ISceneRepository` 场景持久化存储契约）。领域层与应用用例层仅依赖端口契约，由基础设施层（`src/infra/`）具体适配器完成技术实现，彻底实现业务规则与宿主技术框架的反转解耦。

#### 挂起拓扑更新 / 调试会话保护 (Pending Topology Update / Debug Session Guard)
当 VS Code 调试会话正在运行时，将外部断点拓扑变更挂起暂存（`pendingTopologyUpdate = true`），避免打断调试现场，待会话结束后自动补偿装配。

---

### S

#### 单写者串行队列 (Single-Writer Serial Queue)
应用用例层（`src/application/sceneService.ts`）内置的私有任务队列调度机制。将所有针对场景主状态的写操作（如场景激活、新增断点、清除重置、外部变更调度、剪贴板导入等）严格约束进串行化互斥管道，前序任务完成（无论成功还是失败）方才出队执行后续任务，从根源上杜绝异步并发交错造成的读写脏覆盖与竞态死锁。

#### 场景 (Scene)
一个用业务语义命名的断点集合（例如 `user-login`、`order-pay-flow`），声明式保存在 `.vscode/debug-scenes.json` 中，可一键整体激活或反向导出。

#### 场景状态机 (Scene State Machine / SceneStateManager)
系统全局唯一的激活场景状态管理者（Single Source of Truth），负责发射状态变动通知事件，驱动底部状态栏被动更新，并维护防止竞态闪烁的执行锁。

---

### U

#### 断点脱靶 / 失联断点 (Unmatched Breakpoint)
当断点所依赖的目标源码发生破坏性重构、代码被彻底删除、或行号位移超出搜索视距导致加权置信度低于安全阈值时，自愈算法判定为无法精准锚定的断点。系统将其状态标记为 `unmatched` 并平滑回退至原行号，同时向开发者发出可视化警告通知并提供源码一键定位。

---

## 缩写表

| 缩写 | 全称 | 说明 |
|------|------|------|
| **DAP** | Debug Adapter Protocol | 调试适配协议 |
| **SRP** | Single Responsibility Principle | 单一职责原则 |
| **SSOT** | Single Source of Truth | 单一事实来源原则 |
| **KDD** | Knowledge Driven Development | 知识库驱动开发 |
| **ADR** | Architecture Decision Record | 架构决策记录 |
| **BP** | Breakpoint | 断点 |

---

## 变更记录

| 日期 | 变更内容 | 变更人 | 关联变更 |
|------|----------|--------|----------|
| 2026-09-08 | 初始版本 | Tony.L | KDD-INIT-001 |
| 2026-09-08 | 补充 DOM Diff 节点复用与幽灵场景拦截守卫术语定义 | Tony.L | KDD-GLOSSARY-002 |
| 2026-09-12 | 新增断点脱靶/失联断点 (Unmatched Breakpoint) 术语定义 | Tony.L | KDD-UNMATCHED-WARN-001 |
| 2026-09-12 | 补充核心断点拓扑 Diff 与挂起拓扑更新/调试会话保护术语定义 | Tony.L | KDD-SKILL-MIGRATE-001 |
| 2026-09-13 | 补充能力契约端口 (Ports) 与单写者串行队列 (Single-Writer Serial Queue) 术语定义 | Tony.L | #TASK-ARCH-PATH-SYNC-001 |
