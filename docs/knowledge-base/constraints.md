# 约束 (Constraints)

> ⚠️ **必读文档**：任何任务都必须阅读本文档。约束不可被绕过。

---

## 设计原则

优先级裁决（冲突时按此顺序）：

```text
业务优先 > 职责优先 > 变更成本 > 简单优先 > 扩展优先
```

核心哲学：

```text
业务优先于技术
职责优先于分层
变更成本优先于开发速度
简单优先于复杂
扩展优先于修改
```

---

## 架构约束

### 三层隔离 (DDD / Clean Architecture)

本项目遵循严密的领域驱动三层隔离分层，业务内聚、流程串行、变更隔离、依赖单向：

```text
应用用例层 (src/application/*) ：回答【业务流程怎么做？】(纯 TS，面向用户用例编排，受单写者串行互斥队列保护)
    ↓ (调度领域层能力，依赖端口契约)
领域层 (src/domain/*)          ：回答【业务本质是什么？规则是什么？】(100% 纯 TS，零外部依赖，定义领域实体、不变量与能力契约)
    ↑ (实现领域层端口契约)
基础设施层 (src/infra/*)       ：回答【具体技术如何完成？】(VS Code 宿主接入、磁盘存储、UI 呈现)
```

#### 架构状态

- 当前状态：**已实施**
- 未隔离的模块：无（全局严格收敛至 domain、application、infra 三大体系，extension.ts 仅作为唯一装配根 Composition Root）

| 架构状态 | AI 代码定位能力 | 文档策略 | 说明 |
|----------|----------------|----------|------|
| 已实施 | 精准：领域层内聚，AI 可直接定位 | 只记录负空间 | 遵循三层隔离后，领域业务规则内聚在 domain 层，用例编排内聚在 application 层，技术实现内聚在 infra 层。AI 通过代码结构即可精准定位，知识库只需记录代码无法表达的内容：约束、不变量、边界条件与禁止事项。 |

---

### 依赖方向与职责边界

| 层 | 模块 | 职责定位 | 依赖方向 | 禁止出现 |
|---|---|---|---|---|
| **应用用例层 (Application Layer)** | `src/application/*`<br>（`sceneService.ts`, `payloadSerializer.ts`） | 回答【业务流程怎么做？】纯业务流程编排，调度领域模型与端口契约，**内置单写者串行队列保护（防并发交错），零 VS Code 宿主 API 依赖** | 仅依赖领域层契约与纯数据接口 | 依赖具体 VS Code 宿主 API（如 `vscode.window`、`vscode.commands` 等） |
| **领域层 (Domain Layer)** | `src/domain/*`<br>（`ports/*`, `sceneStateManager.ts`, `healingEngine.ts`, `sceneOperations.ts`, `activationResolver.ts`, `launchResolver.ts`, `skillLifecycleResolver.ts`, `types.ts`） | 回答【业务本质是什么？规则是什么？】零外部依赖，定义业务能力契约（Ports）、运行时活动场景内存投影、自愈打分算法与场景领域纯运算 | 零外部环境依赖（绝对禁止依赖 VS Code API 或任何外部框架） | 依赖应用层、基础设施层或任何具体 UI / 文件 I/O |
| **基础设施层 (Infra Layer)** | `src/infra/*`<br>（`vscode/commands/*`, `vscode/listeners/*`, `vscode/providers/*`, `storage/*`） | 回答【具体如何完成？】VS Code 原生命令（`commands/*`）、宿主事件监听器（`listeners/*`）、原生断点桥接（`vscodeBreakpointBridge`）、树视图（`sceneTreeProvider`）、状态栏（`statusBarView`）、磁盘持久化（`jsonFileSceneRepository`） | 实现领域层定义的端口契约（Ports），调用应用服务编排，适配宿主输入与输出 | 直接定义或篡改全局业务主状态 |

---

### 目录拓扑与分层结构映射

#### 1. 源码架构目录拓扑 (`src/`)

```text
src/
├── domain/                         # [领域层 Domain Layer] 100% 纯 TS，零外部依赖
│   ├── ports/                      # [能力契约端口 Ports]
│   │   ├── breakpointBridge.ts     # IBreakpointBridge: 操作宿主断点的能力契约
│   │   └── sceneRepository.ts      # ISceneRepository: 场景配置持久化存取的能力契约
│   ├── types.ts                    # [领域模型与类型契约]
│   ├── sceneStateManager.ts        # 运行时活动场景只读内存投影 (Active Scenes Runtime Projection)
│   ├── healingEngine.ts            # 双向滑动窗口加权自愈评分纯算法 (零外部宿主依赖)
│   ├── sceneOperations.ts          # 场景合并、Diff、先到先得去重、拓扑哈希纯函数
│   ├── activationResolver.ts       # 场景激活差异比对与调度决策纯函数
│   ├── launchResolver.ts           # 启动项三级优先级推导纯函数
│   └── skillLifecycleResolver.ts   # Skill 正文哈希反查与生命周期状态机
├── application/                    # [应用用例层 Application Layer] 纯 TS 流程编排，0 宿主依赖
│   ├── sceneService.ts             # 高内聚场景服务：内置单写者串行队列，防并发交错竞态
│   ├── payloadSerializer.ts        # 纯工具：场景断点数据序列化与剪贴板 Payload 清洗
│   └── index.ts                    # 统一导出中枢
├── infra/                          # [基础设施层 Infra Layer] 技术适配与宿主接入
│   ├── storage/                    # 持久化存储适配
│   │   ├── jsonFileSceneRepository.ts # 实现 ISceneRepository (基于 Node.js fs 的权威持久化 SSOT)
│   │   └── saveLoopGuard.ts         # 内部写盘时间窗与指纹防回环守卫
│   └── vscode/                     # VS Code 宿主适配器
│       ├── commands/               # 命令交互中枢 (sceneCommands, clipboardCommands, treeCommands, skillCommands)
│       ├── listeners/              # 宿主事件监听器 (debugLifecycle, configFileWatcher, breakpointSync, treeInteraction, chatSkill)
│       ├── vscodeBreakpointBridge.ts # 实现 IBreakpointBridge (封装 vscode.debug)
│       ├── sceneTreeProvider.ts       # 实现 vscode.TreeDataProvider (调试侧边栏树视图)
│       ├── statusBarView.ts           # 底部状态栏控件渲染
│       ├── sceneCodeLensProvider.ts   # 实现 vscode.CodeLensProvider (debug-scenes.json 透镜)
│       └── templateContentProvider.ts # 实现 vscode.TextDocumentContentProvider (Skill 虚拟文档)
└── extension.ts                    # [装配中枢 Composition Root] 唯一胶水入口，专职实例化与依赖注入
```

#### 2. 测试架构镜像拓扑 (`test/` & `test-e2e/`)

与三层架构心智模型 100% 镜像对齐：

```text
test/
├── unit/                                # 极速轻量单元测试分层 (纯 Node.js，200ms+ 极速反馈)
│   ├── domain/                          # 纯领域模型与算法测试 (healing, config_operations, state_projection, activation_resolver, skill_lifecycle)
│   ├── application/                     # 应用服务与串行互斥队列测试 (scene_service)
│   └── infra/                           # 基础设施与宿主适配测试 (commands_registry, storage_guard_and_sync, storage_atomic_queue, treeview_provider, bridge_and_codelens)
├── integration/                         # 集成与一致性测试 (roundtrip_and_edge, i18n)
└── run-all.mjs                          # 统一测试引导调度器 (13 大全维套件)

test-e2e/                                # 真实宿主端到端沙箱测试 (@vscode/test-electron)
└── suite/                               # 43 大全量 E2E 真实行为用例 (DAP, Multi-Scene, TreeView, Healing, Guard 等)
```

---

## 业务不变量

| 编号 | 不变量描述 | 检查与保障位置 |
|------|-----------|--------------|
| **INV-001** | **断点在场景内的局部唯一性 (Upsert 语义)**：在同一场景中，相同文件+行号，或相同函数名，必须只有一条记录。后录入的配置安全覆盖先前配置。 | `src/domain/sceneOperations.ts` (`upsertBreakpointToScene`) |
| **INV-002** | **场景激活的纯净隔离性**：激活目标场景时，必须先清除工作区内现存的所有断点（无论散落断点还是其他场景断点），确保无无关调试断点残留。 | `src/infra/vscode/vscodeBreakpointBridge.ts` (`applySceneBreakpoints`) |
| **INV-003** | **自愈算法的两阶段全维协同、大跨度重锚定、当前行本体守卫与性能安全**：必须保留前导缩进（支持 Python/Go 语义），仅压缩非行首连续空白为单空格（抵御 Prettier/ESLint 格式化）；采用**两阶段自愈引擎**：阶段一以原行号为中心执行双向交替辐射探测（±30行），阶段二当位移超出视距时利用 `scopeAnchor` 全文定位函数声明行，以函数体（最大 150 行）为基点展开作用域巡航动态重锚定；结合当前行（10分/剥离注释9分）、非空拓扑伴随行（各5分）、作用域/几何父节点（5分，延迟计算+局部缓存杜绝 $O(n^2)$ 卡顿）、缩进深度（3分）全维评分；建立**当前行本体守卫 (Target Existence Guard)**：候选行必须具备当前行本体证据（精确匹配、剥离注释吻合、软相似度 $\ge 70\%$ 或双侧上下文强闭环夹逼），严禁仅凭单侧上下文将断点误挂于相异代码行；采用动态满分置信度比率 $\ge 60\%$ 作为通过门槛，未达标安全标记为 `unmatched` 脱靶并平滑回退原行。 | `src/domain/healingEngine.ts` (`resolveHealedLine`) |
| **INV-004** | **权威持久化 SSOT 与运行时活动场景投影**：磁盘配置文件 `debug-scenes.json` 是跨会话、跨工具与外部 AI 协同的**唯一权威持久化 SSOT**。内存状态机 `SceneStateManager` 是其运行时的只读内存投影与响应式事件总线，状态栏与树视图仅作为被动观察者（View），绝不直接持有全局激活场景主状态。 | `src/domain/sceneStateManager.ts` 与 `src/infra/vscode/statusBarView.ts` |
| **INV-005** | **场景切换过程的原子防竞态 (Race Guard)**：在 `applySceneBreakpoints` 移除旧断点并装载新断点期间，原子锁 `isApplying` 必须为 `true`。在此期间，`onDidChangeBreakpoints` 监听器严禁误将全局激活场景置为 `(None)`，杜绝状态栏闪烁。 | `src/infra/vscode/vscodeBreakpointBridge.ts` 与 `src/infra/vscode/listeners/breakpointSyncListener.ts` |
| **INV-006** | **防御性输入守卫 (Defensive Barrier)**：处理任意外部输入（读取用户手写的 `debug-scenes.json`、非合法对象、单文件无工作区模式）时，必须建立类型守卫，不可抛出未捕获的 `TypeError` 或 `NullPointer`。 | `src/infra/storage/jsonFileSceneRepository.ts` 与 `src/infra/vscode/vscodeBreakpointBridge.ts` |
| **INV-007** | **启动项联动的三级优先级匹配与幂等拦截守卫**：调试启动配置推导场景必须严格遵循三级优先级（`env.DEBUG_SCENE` > `bindings` > 智能同名匹配），大小写不敏感；若推导出的场景集合与当前已激活场景集合一致，必须幂等静默放行，0 冗余下发开销；装配过程必须受 `isApplying` 原子锁保护，杜绝打断调试器启动流程。 | `src/domain/launchResolver.ts` 与 `src/infra/vscode/listeners/debugLifecycleListener.ts` |
| **INV-008** | **断点全双工同步与死循环防回环守卫 (Echo Loop Guard)**：断点启用/禁用状态在编辑器 DAP、树视图与 JSON 文件间实时同步时，必须受 `isApplyingScene` 原子锁与内部保存时间戳（`markInternalSaving`）隔离保护，杜绝“改断点 $\rightarrow$ 刷文件 $\rightarrow$ 文件监听 $\rightarrow$ 重新装配”的恶性死循环；反向同步仅允许更新当前正处于激活态的场景，严禁污染未激活场景中的配置条目。 | `src/infra/storage/saveLoopGuard.ts`、`src/infra/vscode/listeners/breakpointSyncListener.ts` 与 `src/infra/vscode/listeners/configFileWatcherListener.ts` |
| **INV-009** | **幽灵场景存在性推导校验与拦截守卫 (Ghost Scene Guard)**：调试启动配置推导（`resolveLaunchBoundScenes`）或命令激活时，推导出的场景名必须在 `config.scenes` 中真实存在（大小写容错）。未在场景字典中定义的虚假/拼写错误场景必须被强行拦截，绝不作为当前激活状态写入状态机投影，杜绝状态栏误染绿与断点误清空。 | `src/domain/activationResolver.ts` 与 `src/application/sceneService.ts` |
| **INV-010** | **`activeScenes` 严格回写时序与权威 SSOT 锁死**：执行场景切换时，必须严格遵循“先落盘权威持久化 SSOT `activeScenes`，后装配 DAP 断点，成功后刷新内存投影”的时序（`markInternalSaving` $\rightarrow$ 磁盘落盘 $\rightarrow$ DAP 装配 $\rightarrow$ 内存投影刷新 $\rightarrow$ 释放安全窗）。绝不可颠倒为先装配后落盘，确保磁盘始终为权威 SSOT，杜绝装配异常或崩溃导致磁盘与内存状态分叉。同时所有业务用例受私有串行化队列保护，消除并发交错竞态。 | `src/application/sceneService.ts` 与 `src/infra/storage/saveLoopGuard.ts` |
| **INV-011** | **多场景断点合并先到先得（First-Declared-Wins）与 `enabled: false` 显式覆盖规范**：以 `${file}:${line}` 或 `fn:${functionName}` 为唯一键，断点首次出现即存入合并字典；`enabled: false` 严格参与先到先得去重，后出现的同物理位置断点直接忽略，确保与代码实现 100% 确定性保真。 | `src/domain/sceneOperations.ts` (`mergeScenesBreakpoints`) |
| **INV-012** | **调试会话保护（挂起策略 A）与核心拓扑 Diff 防线**：调试会话进行中（`activeDebugSession` 存在）外部修改断点拓扑时，绝不强制打断开发者心流，标记 `pendingTopologyUpdate = true` 并在会话终止时平滑补发；比对“磁盘新拓扑 vs `lastAppliedTopologyHash`”，若核心断点字段（`file+line+type+condition+hitCondition+logMessage+enabled`）未变，坚决阻断 DAP 重刷。快照在会话终止、清空命令及插件重启时显式失效。 | `src/domain/activationResolver.ts`、`src/application/sceneService.ts` 与 `src/infra/vscode/listeners/debugLifecycleListener.ts` |
| **INV-013** | **Skill 核心正文指纹唯一性与生命周期判定纯净性**：跨平台 Agent Skill/Rules 的版本判定必须先剥离宿主平台特定的 Frontmatter 元数据头部并对换行符（CRLF/LF）及行末空白执行标准化归一化，基于纯净正文 SHA-256 哈希进行 `O(1)` 反查。未匹配官方历史哈希且正文不一致时，严格判定为用户已自定义修改（`CustomModified`），杜绝不可靠的文本自动合并，必须依托 VS Code 原生 `vscode.diff` 并排比对由用户自主裁决，并在任意覆写操作前强制在同目录下生成带时间戳的 `.bak` 物理备份副本。 | `src/domain/skillLifecycleResolver.ts`、`src/infra/vscode/commands/skillCommands.ts` 与 `src/infra/vscode/templateContentProvider.ts` |
| **INV-014** | **分发包极致轻量与媒体隔离约束 (Package Slimming Guard)**：VSIX 安装包体积必须严格控制在 500 KB 以内（当前仅 118 KB）。严禁将高清动图（GIF）、测试用例、临时配置（`.trae/`）、知识库（`docs/knowledge-base/`）及构建脚本（`scripts/`）打入 VSIX。README 中的所有动图与截图必须严格引用 GitHub 官方 Raw CDN 绝对地址。 | `.vscodeignore`、`README.md`、`README_zh.md` 与 `scripts/verify-guardrails.mjs` |
| **INV-015** | **CI/CD 运行环境与原生 Type Stripping 兼容性约束 (Node 22 Runtime Guard)**：单测采用 Node.js 原生 TypeScript Type Stripping 特性（`--experimental-transform-types`），该特性于 Node.js 22.7.0+ 引入。本地与 GitHub Actions 所有工作流（`ci.yml`、`release.yml`）必须统一锁定 `node-version: 22.x`，严禁遗留 Node 20.x 或更低版本。 | `.github/workflows/ci.yml`、`.github/workflows/release.yml` 与 `scripts/verify-guardrails.mjs` |
| **INV-016** | **版本发布单一真实来源（SSOT）与多源一致性校验守卫 (Release SSOT Consistency Guard)**：`package.json` 中的 `version` 是版本生命周期的唯一事实来源。其必须与 `src/domain/skillLifecycleResolver.ts` 的 `LATEST_SKILL_VERSION`、`CHANGELOG.md` 最新版本标题及 `CHANGELOG_zh.md` 最新版本标题保持 100% 绝对一致。Release Notes 必须由流水线自动化脚本从 CHANGELOG 中提取注入，禁止在 Tag 注解中手动手写维护重复冗长内容。 | `package.json`、`CHANGELOG.md`、`CHANGELOG_zh.md` 与 `scripts/verify-guardrails.mjs` |

---

## 禁止事项

### 架构禁止
- 领域核心层（`src/domain/*`）禁止依赖任何文件写操作、VS Code API 或第三方平台 SDK。
- 应用用例层（`src/application/*`）禁止直接依赖 VS Code 宿主 API，必须保持 100% 纯用例编排与并发串行保护。
- 基础设施层（`src/infra/*`）禁止反向依赖应用层或定义领域规则，禁止直接定义或修改全局业务主状态。
- 视图层（`src/infra/vscode/*`）仅作为被动观察者，绝不直接持有全局激活场景主状态。

### 设计禁止
- 禁止为未知变化提前设计多层无用抽象（YAGNI），保持纯原生 TypeScript 敏捷性。
- 抽象后如果文件更多、调用链更长、理解成本更高，则禁止过度抽象。

### 编码禁止
- 严禁空 `catch` 静默吞掉错误（必须记录错误并弹出本地化错误提示）。
- 禁止在没有检查对象或属性存在性时强行进行深层链式调用。
- 禁止魔法数字（滑动窗口大小 30、得分阈值等关键常量必须具备自解释性）。
- **禁止在要求高饱和度/状态保真的 TreeView 节点中使用 `ThemeIcon`**：VS Code 的 `.monaco-list-row.selected.focused .codicon` 会强制将字体图标冲刷为继承前景色（死灰色），必须采用矢量 SVG（`vscode.Uri.file`）以确保选中高亮时色彩 100% 真实不被冲刷。
- **禁止在断点配置中使用 `type: "conditional"`**：VS Code DAP 契约与本项目严格使用名词缩写 `"condition"` 执行分支匹配。若大模型受惯性输出 `"conditional"`，会导致条件表达式被底层静默丢失、退化为普通行断点。
- **禁止在领域层或生命周期检测中硬编码散落版本号（版本 SSOT 铁律）**：扩展自身与内置 Skill 的版本号必须以 `package.json` 的 `version` 为单一事实来源（SSOT），严禁在多个不同模块中硬编码散落的版本常量，防止发版升级时遗漏同步导致新版本升级探测与本地定制改动巡检被 `workspaceState` 缓存静默短路拦截。

---

## 项目约束

### 技术与工具约束
- **语言**：TypeScript 5.x，严格开启类型检查。
- **打包器**：基于原生 `esbuild` 极速单文件打包，严禁引入臃肿的运行时依赖。
- **构建规范**：`main` 指向根目录 `extension.js`，无外部 `node_modules` 运行时。

### 国际化约束 (i18n)
- 所有面向用户的命令标题、错误提示、弹窗、占位符必须包裹在 `vscode.l10n.t(...)` 中；
- 必须保证 `l10n/bundle.l10n.json`（英文）与 `l10n/bundle.l10n.zh-cn.json`（中文）双向对齐。

### 测试约束
- 核心算法层（自愈引擎）、数据管理层（配置解析/Git冲突/Upsert/启动推导/反向同步）与状态机层（SSOT/脏状态）必须具备独立的自动化单元测试；
- **禁止测试代码使用私有镜像副本（杜绝假绿铁律）**：所有单元测试必须真实直接导入生产源码模块，严禁在测试文件内手工复制/粘贴生产函数或数据结构副本。生产代码修改后测试必须能够即时感知并直接验证，彻底杜绝生产代码失效而测试代码因私有副本继续报绿的“假绿”欺骗陷阱；
- **1:1 镜像对齐规范（Mirroring Pattern）**：单元测试严格与生产代码模块一一对应（如 `sceneCodeLensProvider.ts` 对应 `codelens_provider.test.mjs`），严禁在测试文件名中使用 `_and_` 拼凑测试多个不同职责的生产模块，消灭名实不符与拼盘测试坏味道；
- **原生 Subpath Imports 导入规范**：测试代码统一采用 Node.js 原生子路径别名（`#src/*` 与 `#test/*`），严禁使用跨层多级 `../../../` 相对路径地狱；
- 每次算法与领域状态逻辑修改后，必须运行 `npm test`（`node test/run-all.mjs`）确保全量 20 大测试套件 100% 通过；
- 测试用例必须覆盖缩进倍率解耦、跨函数作用域隔离、软相似度上下文门禁防误判、以及异常语法容错；
- **真实宿主端到端 (E2E) 测试约束**：核心用户交互（扩展激活、命令调用、DAP 真实断点注入与清空、侧边栏 TreeView、状态栏联动、CodeLens）必须具备由 `@vscode/test-electron` 驱动的真实隔离沙箱 E2E 测试，运行 `npm run test:e2e` 保证真实运行环境 0 运行时未定义错误；
- **E2E 用例与文档双向同步铁律**：后续任何新增业务能力、修改现有功能、调整 UI 或重构交互命令时，必须同步在 `docs/knowledge-base/e2e-scenarios.md` 中更新测试场景规范，并同步在 `test-e2e/suite/` 编写对应自动化测试用例。未同步用例与文档的代码严禁合并发布。

### 约束代码级自动化执行硬门禁 (Automated Executable Guardrails)
- **脚本守卫 (`scripts/verify-guardrails.mjs`)**：将核心架构与发布约束固化为可执行代码，在 `npm test`、`vscode:prepublish` 与打包时自动运行；
- **版本 SSOT 守卫 (INV-016)**：自动比对 `package.json`、`skillLifecycleResolver.ts`、`CHANGELOG.md`、`CHANGELOG_zh.md` 四处版本一致性，一旦出现分叉立即抛错阻断；
- **媒体 CDN 外链守卫 (INV-014)**：静态扫描中英文 README，严禁出现本地相对图片路径，确保 VSIX 体积稳定维持在 120 KB 级（硬上限 500 KB）；
- **工作流运行环境守卫 (INV-015)**：扫描 `.github/workflows/*.yml` 严禁出现过期的 Node 20.x，确保原生 Type Stripping 环境 100% 具备。

---

## 变更记录

| 日期 | 变更内容 | 变更人 | 关联变更 |
|------|----------|--------|----------|
| 2026-09-08 | 初始版本（确立核心三层隔离架构、自愈算法与数据不变量约束，v1.0.0-rc） | Tony.L | KDD-INIT-001 |
| 2026-09-08 | 强化 INV-003：空格规范化、作用域延迟计算缓存与软容错上下文硬门禁 | Tony.L | KDD-HEALING-003 |
| 2026-09-08 | 建立工程化单元测试套件规范 (test/ & npm test) | Tony.L | KDD-TEST-006 |
| 2026-09-08 | 接入调试侧边栏专属树视图组件 (sceneTreeProvider.ts) | Tony.L | KDD-TREEVIEW-001 |
| 2026-09-08 | 补齐 MIT 协议、精简 .vscodeignore 忽略规则与 package 脚本 | Tony.L | KDD-PKG-001 |
| 2026-09-08 | 落地剪贴板场景共享能力、防御性数据清洗及 10 大配置边界测试 | Tony.L | KDD-CLIPBOARD-001 |
| 2026-09-08 | 升级全局状态机至多场景集合并落地动态多选叠加激活 (v1.0.0) | Tony.L | KDD-MULTI-ACTIVATE-001 |
| 2026-09-08 | 确立启动项联动三级匹配与幂等拦截守卫 (INV-007, v1.0.0) | Tony.L | KDD-LAUNCH-HOOK-001 |
| 2026-09-08 | 落地断点全双工同步与死循环防回环守卫 (INV-008, v1.0.0) | Tony.L | KDD-SYNC-001 |
| 2026-09-08 | 落地原生 1:1 矢量 SVG 断点与微型复选框体系，彻底根治焦点变灰 (v1.0.0) | Tony.L | KDD-UI-002 |
| 2026-09-08 | 优化标准 16x16 居中饱满矢量 SVG 图标 + 原生复选框，消除容器压缩导致的尺寸偏小 (v1.0.0) | Tony.L | KDD-UI-003 |
| 2026-09-08 | 修复无效/不存在场景名导致的状态栏虚假绿色激活，在推导层与激活层加入严格存在性校验守卫 (v1.0.0) | Tony.L | KDD-DEFENSE-001 |
| 2026-09-08 | 树节点注入稳定唯一 id 契约并拦截内部写盘冗余重刷，彻底根治启用禁用断点时的树视图重绘闪烁 (v1.0.0) | Tony.L | KDD-TREE-002 |
| 2026-09-08 | 实施领域分层 Facade 重构、SyncCoordinator 状态中枢聚合与场景批量控制/克隆增强 (v1.0.0) | Tony.L | KDD-ARCH-002 |
| 2026-09-08 | 落地 DAP 增量 Diff 装配引擎、即刻点亮与模糊寻道短期缓存约束 (v1.0.0) | Tony.L | KDD-DAP-DIFF-001 |
| 2026-09-08 | 确立自愈持久化闭环 (Self-Healing Loopback)、文件行内存缓存与监听防抖规范 (v1.0.0) | Tony.L | KDD-HEALING-LOOP-001 |
| 2026-09-08 | 确立 CodeLens 兼容 JSONC 注释与激活态感知、剪贴板导入多场景保真 DAP 注入规范 (v1.0.0) | Tony.L | KDD-CODELENS-CLIP-001 |
| 2026-09-12 | 确立自愈算法两阶段全维协同、大跨度 scopeAnchor 巡航动态重锚定与未匹配脱靶标记规范 (INV-003, v1.0.1) | Tony.L | KDD-SCOPE-CRUISE-001 |
| 2026-09-12 | 确立脱靶断点专属矢量 SVG 警告图标与 [未匹配] 标签前置规范，杜绝省略号截断与 emoji 滥用 (v1.0.1) | Tony.L | KDD-UNMATCHED-ICON-001 |
| 2026-09-12 | 确立当前行本体守卫 (Target Existence Guard)，拦截目标行被删时单侧上下文引发的误自愈 (INV-003, v1.0.1) | Tony.L | KDD-TARGET-EXIST-001 |
| 2026-09-12 | 完善插件市场文档在线绝对链接、分发包放行使用指南并增强树节点热重载空值安全守卫 (v1.0.2) | Tony.L | KDD-DOCS-PKG-001 |
| 2026-09-12 | 落地 AI 声明式 activeScenes 响应式监听与 Content Hash 防回环协作规范 (INV-008, v1.1.0) | Tony.L | KDD-AI-SKILL-001 |
| 2026-09-12 | 扩充主流 VS Code AI Agent 集成矩阵至 8 大基于 VS Code 平台及多端 Skill 资产分发 (v1.1.0) | Tony.L | KDD-AI-AGENT-EXPAND-001 |
| 2026-09-12 | 架构解耦：建立 services 协同服务层，根治循环依赖并统一状态机 SSOT (v1.1.0) | Tony.L | KDD-ARCH-DECOUPLE-001 |
| 2026-09-12 | 全面补齐命令中枢、同步协调器、并发互斥队列与即刻点亮单测，升级为 11 大全维自动化套件 (v1.1.0) | Tony.L | KDD-TEST-007 |
| 2026-09-12 | 沉淀 skill_design.md 规范至知识库：新增 INV-010 回写时序、INV-011 多场景合并先到先得、INV-012 会话保护与禁止 conditional 约束 | Tony.L | KDD-SKILL-MIGRATE-001 |
| 2026-09-12 | 落地 @vscode/test-electron 驱动的真实隔离宿主端到端 (E2E) 测试脚手架与用例闭环 | Tony.L | KDD-E2E-TEST-001 |
| 2026-09-12 | 确立 34 大全量 E2E 场景规范 (e2e-scenarios.md) 与功能演进必须同步更新用例的铁律 | Tony.L | KDD-E2E-SPEC-001 |
| 2026-09-13 | 落地基于核心正文哈希反查的 Skill 生命周期三态判定、VS Code 原生 Diff 与自动备份机制 (INV-013, v1.0.3) | Tony.L | KDD-SKILL-LIFECYCLE-001 |
| 2026-09-13 | 实施纯正 KDD 三层隔离架构重构，建立 core（纯领域零外部依赖）、infra（基础设施可替换）、policy（策略易变）三大体系，完成所有遗留过渡目录安全清场，架构状态宣布【已实施】 | Tony.L | KDD-CLEAN-THREE-TIER-001 |
| 2026-09-13 | 深度剥离 policy 层的 VS Code 宿主依赖（0 依赖），将命令交互（controllers）与事件监听（listeners）全量下沉至 infra/vscode/，提纯 policy 为纯用例编排层 | Tony.L | KDD-POLICY-PURIFY-002 |
| 2026-09-13 | 规范化架构为 DDD 经典体系：建立 domain（领域层）、application（应用用例层）、infra（基础设施层）；统一 SSOT 语义（磁盘为权威 SSOT，状态机为活动投影）；引入用例串行队列 useCaseQueue 杜绝并发交错 | Tony.L | KDD-DDD-STANDARDIZE-003 |
| 2026-09-13 | 高内聚聚合应用服务与命令体系：聚合 sceneService.ts（内置单写者串行队列）、正名并聚拢 infra/vscode/commands（4大高内聚模块）与 listeners（debugLifecycle/configFileWatcher 等），彻底消除历史过渡别名包袱与空壳文件 | Tony.L | KDD-COHESION-REFACTOR-004 |
| 2026-09-13 | 单元测试架构对齐重构：建立 test/unit/{domain,application,infra} 与 test/integration 分层；新增 scene_service 测试套件（6大核心维度）；消除历史废弃路径注释并根治内部调度重入死锁隐患 | Tony.L | KDD-TEST-RESTRUCTURE-005 |
| 2026-09-13 | 完整沉淀 DDD 三层分层目录树拓扑与测试镜像映射规范至架构约束 | Tony.L | #TASK-ARCH-PATH-SYNC-001 |
| 2026-09-13 | 治理单元测试拼盘测试坏味道：消除 _and_ 与名实不符文件，实施 1:1 镜像对齐重构（7大专职模块）；强化领域操作空值/全空格防灾守卫；清零全工程纯类型导入隐患（15 大单测套件 240ms + 45 个沙箱 E2E 100% 绿灯） | Tony.L | #TASK-TEST-MIRROR-002 |
| 2026-09-13 | 落地 Node.js 原生 Subpath Imports 规范（#src/* 与 #test/*）；补齐 payloadSerializer、templateContentProvider、listeners 3 大遗漏专职单测（全工程扩充至 18 大全维套件 260ms 100% 绿灯，实现生产模块 1:1 镜像覆盖闭环） | Tony.L | #TASK-IMPORT-ALIAS-003 |
| 2026-09-13 | 修复实际调试多线程（WorkerThread）/多会话 DAP continued 误杀与后台 stackTrace 响应覆盖导致断点命中高亮闪退 Bug；建立 Session 独立闭包隔离（Session-Affinity Guard）与场景断点真实性存在守卫（Target Breakpoint Guard）；18 大单元测试套件全绿 + 重新打成 VSIX 包 | Tony.L | #TASK-DEBUG-PAUSE-GUARD-004 |
| 2026-09-13 | 正式将“版本号 SSOT 绑定与发版探测（杜绝散落硬编码导致 workspaceState 缓存拦截）”与“单测禁止私有镜像副本（杜绝假绿铁律）”沉淀写入项目硬约束库；落地 CustomModified 本地改动提示与一键 View Diff 虚拟对比；重新打包发布 v1.0.4 | Tony.L | #TASK-SKILL-SSOT-GUARD-005 |
| 2026-09-13 | 补充分发包极致轻量与媒体隔离约束（INV-014，上限 500KB，当前 118KB）、CI/CD 统一锁定 Node 22 兼容性约束（INV-015）与版本多源一致性强校验（INV-016）；落地代码级自动化验证脚本 verify-guardrails.mjs 并挂载 prepublish 与单测门禁（扩充至 20 大全维套件 279ms 100% 绿灯，发布 v1.0.5） | Tony.L | #TASK-GUARDRAILS-AUTOMATION-006 |
| 2026-09-13 | 修正 README 中 JSON 示例条件断点规范（type: "condition"）与备注字段（desc），与底层领域模型、schema.json 及 AI 技能 100% 对齐；补齐 activeScenes 声明式注脚与 Living Code Tours 统一术语；发布补丁版本 v1.0.6 | Tony.L | #TASK-RELEASE-PATCH-1.0.6 |





