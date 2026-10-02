# 系统架构全景 (System Architecture)

> **文档定位**：系统宏观架构全景图。展示整洁架构分层、模块依赖方向与装配拓扑。

---

## 总体架构全景图

```mermaid
graph TD
    %% 1. 顶层：VS Code 宿主平台
    subgraph VSCode_Host["VS Code 宿主运行环境 (Host Platform)"]
        direction TB
        Host_UI["VS Code UI 交互界面<br/>(侧边栏树视图 / 底部状态栏 / 编辑器 CodeLens 与 InlayHints)"]
        Host_Core["VS Code 底层核心服务<br/>(DAP 调试会话总线 / 原生断点池 / 工作区 .vscode 文件系统)"]
    end

    %% 2. 启动装配根
    ExtEntry["启动与组装根: src/extension.ts (activate)"]

    %% 3. 展示层：独立人机交互与命令
    subgraph UI_Layer["开发者交互展示层 (UI Layer - src/ui/)"]
        direction TB
        Cmds["命令控制器 (commands/ & utils/)<br/>• runWithWorkspace (命令执行上下文脱水)<br/>• sceneCommands / treeCommands<br/>• clipboardCommands / menuCommands / skillCommands"]
        Views["视图渲染与透视 (views/)<br/>• SceneTreeDataProvider (树视图: 响应EventBus)<br/>• StatusBarView (状态栏)<br/>• SceneCodeLens / SceneInlayHints"]
    end

    %% 4. 应用服务与生命周期管理层
    subgraph App_Layer["应用用例层 (Application Layer - src/application/)"]
        direction TB
        SceneMgr["SceneManager (单例)<br/>(场景生命周期 CRUD / 激活 / 导出 / SerialQueue)"]
        BpMgr["BreakpointManager (单例)<br/>(断点增删 / 即刻点亮 / 拖拽重排 / 启闭)"]
        AgentSvc["AgentSyncService (单例)<br/>(AI声明式激活 / 拓扑比对 / 外部变更同步)"]
        StateManager["SceneStateManager (单例)<br/>(状态机 SSOT / 拓扑指纹比对 / 脏状态管理)"]
        EventBus["ApplicationEventBus (单例)<br/>(状态变更与UI自动刷新解耦事件总线)"]
    end

    %% 5. 领域核心层：纯内聚无依赖 (零宿主概念污染)
    subgraph Domain_Layer["领域模型层 (Domain Layer - src/domain/ 纯内聚·零外部依赖)"]
        direction TB
        subgraph Domain_Upper["核心实体与算法服务"]
            Domain_Models["核心实体与聚合根<br/>• Scene (场景实体: 查重覆盖/先到先得)<br/>• Breakpoint (充血实体: 指纹自愈/匹配)<br/>• SceneCatalog (场景目录聚合根: 权威SSOT)<br/>• Fingerprint (三行上下文指纹值对象)"]
            Domain_Services["领域服务与算法<br/>• HealingEngine (两阶段动态自愈)<br/>• ScenePayloadCodec (负载编解码清洗)<br/>• ActiveScenesDiffResolver (激活变动与Diff推导)"]
        end
        Domain_Ports["能力契约端口 (Ports)<br/>• ISceneRepository (存储端口)<br/>• IBreakpointBridge (调试断点桥接端口)<br/>• ILineReader (源码行读取端口)<br/>• IHashService (哈希计算端口)"]
    end

    %% 6. 基础设施层：外部技术适配器
    subgraph Infra_Layer["基础设施层 (Infrastructure Layer - src/infra/)"]
        direction TB
        Listeners["事件监听协同 (listeners/)<br/>• breakpointSyncListener (断点变动)<br/>• configFileWatcherListener (文件变动)<br/>• debugLifecycleListener (调试会话/命中)<br/>• launchBindingResolver (启动项绑定推导)"]
        Storage["存储与桥接适配器 (storage & bridge)<br/>• ISelfHealingStore (通用自愈存储机制契约)<br/>• AtomicFileJsonStore (原子写入/灾难自愈/碎片净化)<br/>• jsonFileSceneRepository (仓储实现)<br/>• echoLoopGuard (防回环守卫)<br/>• fileLineReader (行提取)<br/>• vscodeBreakpointBridge (DAP 桥接)"]
    end

    %% 核心控制与依赖关系
    Host_UI <-->|双向绑定与事件监听| Views
    Host_Core <-->|断点同步与文件写盘| Storage
    Host_Core -->|抛出系统级变动事件| Listeners

    ExtEntry -->|生命周期挂载与注册| UI_Layer
    ExtEntry -->|生命周期挂载与注册| Infra_Layer
    ExtEntry -->|DIP 组装注入依赖| App_Layer

    Cmds -->|调度管理器/服务| SceneMgr
    Cmds -->|调度断点操作| BpMgr
    Listeners -->|调度外部变更同步| AgentSvc
    Views -->|读取激活与脏状态| StateManager

    SceneMgr -->|更新活动投影| StateManager
    BpMgr -->|调度实体行为| Domain_Models
    SceneMgr -->|调度实体与聚合根| Domain_Models
    AgentSvc -->|调度拓扑比对服务| Domain_Services
    App_Layer -->|依赖端口抽象契约| Domain_Ports

    Storage -.->|实现端口契约| Domain_Ports

    %% 模块与节点配色
    style VSCode_Host fill:#1c1033,stroke:#a855f7,stroke-width:2px,color:#d8b4fe;
    style UI_Layer fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#c7d2fe;
    style Infra_Layer fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#7dd3fc;
    style App_Layer fill:#082f49,stroke:#0ea5e9,stroke-width:2px,color:#7dd3fc;
    style Domain_Layer fill:#052e16,stroke:#22c55e,stroke-width:2px,color:#86efac;
    style Domain_Upper fill:#064e3b,stroke:#047857,stroke-width:1px,color:#a7f3d0;
```

---

## 架构分层简述

| 层次 | 目录 | 核心职责 | 依赖规则 |
|---|---|---|---|
| **开发者展示层 (UI)** | `src/ui/` | 负责 VS Code 原生界面交互（树视图、状态栏、CodeLens、InlayHints、Commands）。仅发起用例与消费只读投影，不持有主业务状态。 | 依赖 Application 与 Domain 纯类型 |
| **应用用例层 (Application)** | `src/application/` | 负责用例编排与并发控制。包含实体生命周期管理（`SceneManager`, `BreakpointManager`）、跨模块协同（`AgentSyncService`）与活动投影（`SceneStateManager`）。内置 `SerialQueue` 串行队列。 | 仅依赖 Domain 端口与纯类型，无宿主 API 依赖 |
| **核心领域层 (Domain)** | `src/domain/` | 负责业务规则与算法（100% 纯 TS）。包含充血聚合实体（`SceneCatalog`, `Scene`, `Breakpoint`）、两阶段自愈（`HealingEngine`）及端口契约（Ports）。 | 零外部依赖，严禁导入 `vscode` 或具体 Infra |
| **基础设施层 (Infra)** | `src/infra/` | 负责外部技术适配。包含磁盘原子持久化与防回环守卫（`storage/`）、VS Code DAP 断点桥接与宿主事件监听器（`vscode/`）。 | 实现 Domain 端口契约，适配外部宿主环境 |
| **装配根 (Composition Root)** | `src/extension.ts` | 负责单例实例化、依赖倒置注入（DIP）与 VS Code 生命周期钩子挂载。 | 插件唯一胶水入口 |

---

## 核心架构原则速查

1. **严格单向依赖与禁止跨层调用**：
   - 依赖流向：`UI 展示层` $\rightarrow$ `Application 应用层` $\rightarrow$ `Domain 领域层` $\rightarrow$ `Shared 通用层`。
   - **禁止跨层穿透 (No Layer-Skipping)**：UI 严禁绕过应用层直接依赖 Infra（如存储底层、DAP桥接等），所有底层能力必须通过应用层或端口调度。
   - **禁止反向依赖 (No Inverted Layering)**：Application 严禁依赖 Infra（遵循依赖倒置 DIP，仅依赖 Domain Ports）；Infra 严禁反向污染 UI；Domain 零外部依赖（严禁导入 `vscode`、平台 I/O 或其它层）。
2. **依赖倒置 (DIP)**：应用层仅依赖能力契约端口（`IBreakpointBridge`, `ISceneRepository`, `ILineReader`, `IHashService`），在启动装配根（`extension.ts`）完成适配器实现单例注入。
3. **权威 SSOT 与单向回写时序**：磁盘 `.vscode/debug-scenes.json` 为跨会话静态持久化唯一权威 SSOT；`SceneStateManager` 为运行时易失会话状态管理中心（内存投影）。
4. **单写者串行队列 (SerialQueue)**：应用层用例全部受私有串行队列保护，彻底杜绝多事件并发交错引发的写穿与竞态死锁。

---

## 自动化架构与代码健康度守护机制

项目将架构与代码质量验证完全纳入 CI/CD 与单测流水线，杜绝任何破窗效应：

| 守护维度 | 校验工具 | 规则与阈值 | 执行时机 |
|---|---|---|---|
| **分层依赖与跨层拦截** | `dependency-cruiser` (`.dependency-cruiser.cjs`) | • **禁止跨层**：UI 严禁跨层调用 Infra (`ui-no-infra`)<br>• **单向流动**：Application 严禁依赖 Infra / UI；Infra 严禁依赖 UI<br>• **领域提纯**：Domain 严禁外部依赖 / 宿主 API / 平台 I/O<br>• **循环依赖**：`no-circular` 严禁全工程循环依赖 | `npm test`<br>`npm run verify` |
| **代码克隆与重复度** | `jscpd` (`.jscpd.json`) | • 限制代码重复率硬上限 ≤ 3.5%<br>• 检测连续 8 行以上同构克隆 | `npm test`<br>`npm run verify` |
| **巨石函数与超大文件** | AST 语法扫描分析器 | • 常规业务函数硬上限 ≤ 80 行<br>• 单个源码文件物理行数 ≤ 400 行 | `npm test`<br>`npm run verify` |

