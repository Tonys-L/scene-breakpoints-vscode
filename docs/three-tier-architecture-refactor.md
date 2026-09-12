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

### 2. 基础设施层 (Infra Layer) — `src/infra/`
- **定位**：可替换、具体技术与外部系统实现。
- **职责**：用具体技术实现领域层定义的端口（Ports），对接 VS Code 宿主 API、本地磁盘文件系统与 UI 呈现。基础设施层可替换（如换成 JetBrains 或 SQLite，领域层与应用层代码零改动）。
- **文件结构**：
  ```text
  src/infra/
  ├── vscode/                     # VS Code 宿主具体技术实现
  │   ├── controllers/            # [Driving Adapters] 入站命令交互适配器 (applyScene, addBreakpoint, clearAll 等)
  │   ├── listeners/              # [Event Listeners] 宿主事件监听器 (configFileWatcher, breakpointSync, debugLaunch 等)
  │   ├── vscodeBreakpointBridge.ts # 实现 IBreakpointBridge (封装 vscode.debug.breakpoints)
  │   ├── sceneTreeProvider.ts      # 实现 vscode.TreeDataProvider (侧边栏树视图渲染与跟随)
  │   ├── sceneCodeLensProvider.ts  # 实现 vscode.CodeLensProvider (debug-scenes.json 透镜)
  │   ├── templateContentProvider.ts# 实现 vscode.TextDocumentContentProvider (Skill 虚拟文档)
  │   └── statusBarView.ts          # 底部状态栏控件渲染
  └── storage/                    # 存储基础设施实现
      ├── jsonFileSceneRepository.ts# 实现 ISceneRepository (基于 Node.js fs 的权威持久化 SSOT 读写)
      └── saveLoopGuard.ts        # 内部写盘时间窗与指纹防回环守卫
  ```

---

### 3. 应用用例层 (Application Layer) — `src/application/`
- **定位**：面向用户用例、回答“业务流程怎么做”。
- **职责**：纯业务用例编排（Use Cases），协调领域层算法与端口契约，**受单写者串行队列保护（消除并发交错竞态），0 处 VS Code 宿主依赖**。
- **文件结构**：
  ```text
  src/application/
  ├── useCaseQueue.ts            # 并发控制：单写者串行互斥队列 (彻底阻断多源并发用例交错)
  ├── activateScene.ts           # 纯用例：存在性校验 ➔ 合并断点 ➔ 落盘权威 SSOT ➔ 装配 DAP ➔ 刷新内存投影
  ├── addBreakpoint.ts           # 纯用例：upsert 断点到场景 ➔ 落盘权威 SSOT ➔ 激活态即刻点亮
  ├── clearAll.ts                # 纯用例：清空配置 activeScenes ➔ 清空宿主断点 ➔ 复位内存投影
  ├── exportScene.ts             # 纯用例：抓取断点 ➔ 落盘写入权威 SSOT 指定场景
  ├── handleExternalChange.ts    # 纯用例：比对差异 ➔ 调度激活/清空 ➔ 会话保护与核心拓扑 Diff
  └── payloadSerializer.ts       # 纯工具：场景断点数据序列化与剪贴板 Payload 清洗
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
