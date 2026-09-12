# Scene Breakpoints 严格三层隔离架构重构方案

> **状态**：已完成 / 100% 验证通过 (VSIX 打包成功)  
> **分支**：`refactor/clean-three-tier-architecture`  
> **基线**：全量 12 大测试套件 100% 绿灯 (204ms)，真实 VSIX 安装包打包成功  
> **指导思想**：知识库驱动开发 (KDD) 核心三层隔离规范

---

## 一、重构背景与核心目标

### 1. 现状痛点
在前期特性快速验证阶段，代码演进未严格遵循三层隔离契约：
- **核心层不够纯粹**：缺乏显式能力契约（Ports），内部模块直接依赖具体技术框架（如 VS Code API 与文件 I/O）；
- **技术层渗透了业务逻辑**：断点适配器既做 VS Code 接口交互，又混杂断点自愈与拓扑比对；
- **策略层与服务层概念模糊**：命令与事件监听分散在 commands 与 services，缺少清晰的策略职责边界；
- **命名遮蔽业务领域**：大量充斥 Manager、Adapter、Storage 等技术后缀，淹没了 Scene、Breakpoint、Healing 等核心领域。

### 2. 终极目标
彻底重构为标准的 **“应用用例层（流程编排） ➔ 领域层（纯净规则与契约） 🠄 基础设施层（可替换适配器）”** DDD / Clean Architecture 经典体系：

```text
应用用例层 (Application Layer)  ：回答【业务流程怎么做？】(面向用户用例编排，受单写者串行队列保护，0 外部宿主依赖)
    ↓ (调度领域层能力，依赖端口契约)
领域层 (Domain Layer / 稳定)    ：回答【业务本质与规则是什么？】(零外部依赖，定义实体模型、自愈算法与端口能力契约)
    ↑ (实现领域层端口契约)
基础设施层 (Infra Layer / 可替换) ：回答【具体技术如何完成？】(VS Code API、本地 JSON 文件存储、UI 视图呈现)
```

---

## 二、架构分层与职责映射规范

### 1. 领域层 (Domain Layer) — `src/domain/`
- **定位**：稳定、高内聚、纯领域、**零外部环境/框架依赖**（100% 纯 TypeScript，脱离 VS Code 亦可独立运行测试）。
- **职责**：定义领域模型、业务规则不变量、核心纯算法及**能力契约端口 (Ports)**。
- **文件结构**：
  ```text
  src/domain/
  ├── ports/                      # [能力契约端口]
  │   ├── breakpointBridge.ts     # IBreakpointBridge: 操作宿主断点的能力契约
  │   └── sceneRepository.ts      # ISceneRepository: 场景配置持久化存取的能力契约
  ├── types.ts                    # [领域模型与类型契约]
  ├── sceneStateManager.ts        # 运行时活动场景只读内存投影 (Active Scenes Runtime Projection)
  ├── healingEngine.ts            # 双向滑动窗口加权自愈评分纯算法 (零外部依赖)
  ├── sceneOperations.ts          # 场景合并、Diff、先到先得去重、拓扑哈希纯函数
  ├── activationResolver.ts       # 场景激活差异比对与调度决策纯函数
  ├── launchResolver.ts           # 启动项三级优先级推导纯函数
  └── skillLifecycleResolver.ts   # Skill 正文哈希反查与生命周期状态机
  ```

---

### 2. 应用服务层 (Application Layer) — `src/application/`
- **定位**：面向用户用例、回答“业务流程怎么做”。
- **职责**：高内聚业务服务（Application Service），编排业务流程，调度领域模型与端口契约，**内置单写者串行队列保护（消除并发交错竞态），0 处 VS Code 宿主依赖**。
- **文件结构**：
  ```text
  src/application/
  ├── sceneService.ts            # 高内聚场景服务：内置单写者串行队列，聚合 activateScene、addBreakpoint、clearAll、exportScene、handleExternalChange
  ├── payloadSerializer.ts       # 纯工具：场景断点数据序列化与剪贴板 Payload 清洗
  └── index.ts                   # 统一导出中枢
  ```

---

### 3. 基础设施层 (Infra Layer) — `src/infra/`
- **定位**：技术适配、回答“具体如何完成”。
- **职责**：用具体技术实现领域层定义的端口（Ports），对接 VS Code 宿主 API、本地磁盘文件系统与 UI 呈现。基础设施层可替换（如换成 JetBrains 或 SQLite，领域层与应用层代码零改动）。
- **文件结构**：
  ```text
  src/infra/
  ├── storage/                   # 持久化存储适配
  │   ├── jsonFileSceneRepository.ts# 实现 ISceneRepository (基于 Node.js fs 的权威持久化 SSOT 读写)
  │   └── saveLoopGuard.ts        # 内部写盘时间窗与指纹防回环守卫
  └── vscode/                    # VS Code 宿主适配器
      ├── commands/              # 命令交互中枢 (4 大高内聚命令模块)
      │   ├── sceneCommands.ts       # 场景生命周期命令 (applyScene, clearAll, addBreakpoint, exportScene, showMenu)
      │   ├── clipboardCommands.ts   # 剪贴板快速流转与团队共享
      │   ├── treeCommands.ts        # 调试侧边栏树节点交互
      │   ├── skillCommands.ts       # AI Agent 技能安装与诊断
      │   └── index.ts               # 表驱动集中注册
      ├── listeners/             # 宿主事件监听器 (5 大高内聚监听模块)
      │   ├── debugLifecycleListener.ts     # 调试启动前推导、运行时命中断点高亮、会话终止清理
      │   ├── configFileWatcherListener.ts  # 配置文件变化监听与外部变更/AI激活调度
      │   ├── breakpointSyncListener.ts     # 编辑器原生断点事件反向同步
      │   ├── treeInteractionListener.ts    # 树视图折叠展开与勾选
      │   ├── chatSkillListener.ts          # VS Code 1.90+ Chat API 技能
      │   └── index.ts
      ├── vscodeBreakpointBridge.ts # 实现 IBreakpointBridge (封装 vscode.debug.breakpoints)
      ├── sceneTreeProvider.ts      # 实现 vscode.TreeDataProvider (侧边栏树视图渲染与跟随)
      ├── statusBarView.ts          # 底部状态栏控件渲染
      ├── sceneCodeLensProvider.ts  # 实现 vscode.CodeLensProvider (debug-scenes.json 透镜)
      └── templateContentProvider.ts# 实现 vscode.TextDocumentContentProvider (Skill 虚拟文档)
  ```

---

### 4. 装配中枢 (Composition Root) — `src/extension.ts`
- **定位**：唯一的顶层胶水。
- **职责**：专职负责实例化技术层组件 ➔ 注入核心层/策略层 ➔ 挂载 VS Code 生命周期监听，**0 业务计算与策略细节**。

---

### 5. 单元与集成测试分层 (Test Architecture) — `test/`
- **定位**：与三层架构心智模型 100% 镜像对齐，秒级自包含极速反馈。
- **文件结构**：
  ```text
  test/
  ├── unit/                                # 单元测试分层
  │   ├── domain/                          # 1. 纯领域模型与算法 (healing, config_operations, state_projection, activation_resolver, skill_lifecycle)
  │   ├── application/                     # 2. 应用服务与串行互斥 (scene_service)
  │   └── infra/                           # 3. 基础设施与 VS Code 适配 (commands_registry, storage_guard_and_sync, storage_atomic_queue, treeview_provider, bridge_and_codelens)
  ├── integration/                         # 集成与一致性测试 (roundtrip_and_edge, i18n)
  └── run-all.mjs                          # 统一测试引导调度器 (13 大套件)
  ```

---

### 4. 装配中枢 (Composition Root) — `src/extension.ts`
- **定位**：唯一的顶层胶水。
- **职责**：专职负责实例化技术层组件 ➔ 注入核心层/策略层 ➔ 挂载 VS Code 生命周期监听，**0 业务计算与策略细节**。

---

## 三、严格分步重构与测试验证计划

重构严格遵循 **“每前进一步，必须运行 `npm test` 保证 100% 测试通过”** 的铁律：

| 步骤 | 重构内容 | 依赖与隔离检查 | 验证方式 |
| :--- | :--- | :--- | :--- |
| **Step 1: 核心能力契约化 (Ports)** | 在 `src/core/ports/` 定义 `IBreakpointBridge` 与 `ISceneRepository` 接口契约；规整 `types.ts` 领域模型 | 核心层零外部依赖检查 | 运行 `npm test` (确保编译与全量测试绿灯) |
| **Step 2: 核心算法与模型纯化** | 将 `healingAdapter.ts` 正名为 `healingEngine.ts`，彻底剥离残存的 `vscode` 引用；纯化 `sceneActivationState.ts` | 验证 core 目录内 `grep vscode` 结果为 0 | 运行 `npm test` (验证自愈算法极限套件 33 大场景通过) |
| **Step 3: 基础设施层收敛 (Infra)** | 建立 `src/infra/`，由 `jsonFileSceneRepository.ts` 实现 `ISceneRepository`，由 `vscodeBreakpointBridge.ts` 实现 `IBreakpointBridge`，视图层收敛进 `src/infra/vscode/` | 基础设施层单向依赖核心层接口 | 运行 `npm test` (验证配置存储互斥队列与适配器套件) |
| **Step 4: 策略层规整** | 建立 `src/policy/`，将命令与自动化调度器统一归入 policy，消除 Coordinator 杂糅命名，对齐领域动词 | 策略层禁止直接写文件或直接调底层 DAP，必须通过接口 | 运行 `npm test` (验证命令注册与调度全场景通过) |
| **Step 5: 入口装配连线与端到端闭环** | 重构 `src/extension.ts` 执行依赖注入与连线；清理所有废弃旧目录 | 检查 `src/` 根目录仅留 `extension.ts` | 运行 `npm test` 与 `npm run package` (生成最终 VSIX) |
| **Step 6: 知识库对齐** | 更新 `docs/knowledge-base/constraints.md`，将架构状态正式切换为【已实施】，更新架构图与不变量保障位置 | 检查文档联动规则 | 文档健康度检查通过 |

---

## 四、回滚与避险保障

- 本次重构在专属独立分支 `refactor/clean-three-tier-architecture` 上实施；
- 每一步均提交独立的原子 Git commit（如 `refactor(step1): define core ports and domain models`）；
- 若任何一步出现不可调和的逻辑冲突，可随时回滚至上一个通过测试的原子 commit；
- 验收无误后，再通过标准流程合并回 `main` 分支。
