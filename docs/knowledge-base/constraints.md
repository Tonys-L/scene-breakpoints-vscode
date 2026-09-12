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

### 三层隔离

本项目遵循严密的三层逻辑分层，业务内聚、变更隔离、依赖单向：

```text
策略与协同调度层 (src/commands/*, src/coordinators/*, src/codeLensProvider.ts)
    ↓
核心状态与纯领域层 (src/sceneStateManager.ts, src/configManager.ts, src/healingAdapter.ts, src/types.ts)
    ↑
技术与宿主适配层 (src/breakpointAdapter.ts, src/statusBar.ts)
```

#### 架构状态

- 当前状态：**已实施**
- 未隔离的模块：无（已消除所有反向依赖与循环引用，副作用协同调度上浮至 coordinators 独立管理）

| 架构状态 | AI 代码定位能力 | 文档策略 | 说明 |
|----------|----------------|----------|------|
| 已实施 | 精准：核心层内聚，AI 可直接定位 | 只记录负空间 | 代码结构足够清晰，无需文档补充定位 |

---

### 依赖方向与职责边界

| 层 | 模块 | 职责定位 | 依赖方向 | 禁止出现 |
|---|---|---|---|---|
| **策略与调度层** | `src/commands/*`<br>`src/coordinators/*`<br>`src/codeLensProvider.ts` | 处理用户交互输入，监听外部变更并协调状态机、领域层与适配层执行副作用流 | 依赖核心层与适配层 | 包含底层文件去重遍历细节、直接操作 VS Code DAP 接口 |
| **核心状态层** | `src/sceneStateManager.ts` | 维护全局激活场景、核心拓扑快照与防竞态锁（100% SSOT），事件广播驱动 UI | 仅依赖 VS Code 基础 EventEmitter | 依赖任何具体 UI 控件或文件系统 I/O |
| **核心算法层** | `src/healingAdapter.ts` | 伴随特征指纹提取、双向滑动窗口加权打分算法 | 纯算法输入输出（可无缝移植） | 依赖任何外部文件 I/O 或命令交互 |
| **数据管理与领域层** | `src/configManager.ts`<br>`src/config/*` | JSON 配置路径推导、防御性数据清洗、纯领域断点拓扑 Diff (`computeBreakpointsTopologyHash`)、幽灵场景校验与合并 | 依赖 Node 文件系统与类型契约（100% 纯逻辑） | 依赖 commands 策略层命令、UI 状态或断点装配下发逻辑 |
| **宿主适配层** | `src/breakpointAdapter.ts`<br>`src/statusBar.ts`<br>`src/sceneTreeProvider.ts` | 对齐 VS Code DAP 原生断点协议，状态栏响应式视图渲染，调试面板专属树视图渲染 | 依赖核心层契约 | 直接执行文件持久化回写（消除隐式 I/O 副作用） |

---

## 业务不变量

| 编号 | 不变量描述 | 检查与保障位置 |
|------|-----------|--------------|
| **INV-001** | **断点在场景内的局部唯一性 (Upsert 语义)**：在同一场景中，相同文件+行号，或相同函数名，必须只有一条记录。后录入的配置安全覆盖先前配置。 | `src/configManager.ts` (`upsertBreakpointToScene`) |
| **INV-002** | **场景激活的纯净隔离性**：激活目标场景时，必须先清除工作区内现存的所有断点（无论散落断点还是其他场景断点），确保无无关调试断点残留。 | `src/breakpointAdapter.ts` (`applySceneBreakpoints`) |
| **INV-003** | **自愈算法的两阶段全维协同、大跨度重锚定、当前行本体守卫与性能安全**：必须保留前导缩进（支持 Python/Go 语义），仅压缩非行首连续空白为单空格（抵御 Prettier/ESLint 格式化）；采用**两阶段自愈引擎**：阶段一以原行号为中心执行双向交替辐射探测（±30行），阶段二当位移超出视距时利用 `scopeAnchor` 全文定位函数声明行，以函数体（最大 150 行）为基点展开作用域巡航动态重锚定；结合当前行（10分/剥离注释9分）、非空拓扑伴随行（各5分）、作用域/几何父节点（5分，延迟计算+局部缓存杜绝 $O(n^2)$ 卡顿）、缩进深度（3分）全维评分；建立**当前行本体守卫 (Target Existence Guard)**：候选行必须具备当前行本体证据（精确匹配、剥离注释吻合、软相似度 $\ge 70\%$ 或双侧上下文强闭环夹逼），严禁仅凭单侧上下文将断点误挂于相异代码行；采用动态满分置信度比率 $\ge 60\%$ 作为通过门槛，未达标安全标记为 `unmatched` 脱靶并平滑回退原行。 | `src/healingAdapter.ts` (`resolveHealedLine`) |
| **INV-004** | **单一事实来源 (SSOT) 与视图被动响应性**：状态栏仅作为视图观察者（View），绝不直接持有全局激活场景主状态。全局场景状态机由 `SceneStateManager` 统一定义，通过事件单向流驱动 UI。 | `src/sceneStateManager.ts` 与 `src/statusBar.ts` |
| **INV-005** | **场景切换过程的原子防竞态 (Race Guard)**：在 `applySceneBreakpoints` 移除旧断点并装载新断点期间，原子锁 `isApplying` 必须为 `true`。在此期间，`onDidChangeBreakpoints` 监听器严禁误将全局激活场景置为 `(None)`，杜绝状态栏闪烁。 | `src/breakpointAdapter.ts` 与 `src/extension.ts` |
| **INV-006** | **防御性输入守卫 (Defensive Barrier)**：处理任意外部输入（读取用户手写的 `debug-scenes.json`、非合法对象、单文件无工作区模式）时，必须建立类型守卫，不可抛出未捕获的 `TypeError` 或 `NullPointer`。 | `src/configManager.ts` 与 `src/breakpointAdapter.ts` |
| **INV-007** | **启动项联动的三级优先级匹配与幂等拦截守卫**：调试启动配置推导场景必须严格遵循三级优先级（`env.DEBUG_SCENE` > `bindings` > 智能同名匹配），大小写不敏感；若推导出的场景集合与当前已激活场景集合一致，必须幂等静默放行，0 冗余下发开销；装配过程必须受 `isApplying` 原子锁保护，杜绝打断调试器启动流程。 | `src/configManager.ts` 与 `src/extension.ts` |
| **INV-008** | **断点全双工同步与死循环防回环守卫 (Echo Loop Guard)**：断点启用/禁用状态在编辑器 DAP、树视图与 JSON 文件间实时同步时，必须受 `isApplyingScene` 原子锁与内部保存时间戳（`markInternalSaving`）隔离保护，杜绝“改断点 $\rightarrow$ 刷文件 $\rightarrow$ 文件监听 $\rightarrow$ 重新装配”的恶性死循环；反向同步仅允许更新当前正处于激活态的场景，严禁污染未激活场景中的配置条目。 | `src/breakpointAdapter.ts`、`src/configManager.ts` 与 `src/extension.ts` |
| **INV-009** | **幽灵场景存在性推导校验与拦截守卫 (Ghost Scene Guard)**：调试启动配置推导（`resolveLaunchBoundScenes`）或命令激活时，推导出的场景名必须在 `config.scenes` 中真实存在（大小写容错）。未在场景字典中定义的虚假/拼写错误场景必须被强行拦截，绝不作为当前激活状态写入状态机，杜绝状态栏误染绿与断点误清空。 | `src/configManager.ts` 与 `src/commands/applyScene.ts` |
| **INV-010** | **`activeScenes` 严格回写时序与 SSOT 锁死**：执行场景切换时，必须严格遵循“先落盘 `activeScenes`，后装配 DAP 断点”的时序（`markInternalSaving` $\rightarrow$ 磁盘落盘 $\rightarrow$ DAP 装配 $\rightarrow$ 释放安全窗）。绝不可颠倒为先装配后落盘，确保磁盘始终为权威 SSOT，杜绝装配异常或崩溃导致磁盘与内存状态分叉。 | `src/commands/applyScene.ts` 与 `src/coordinators/syncCoordinator.ts` |
| **INV-011** | **多场景断点合并先到先得（First-Declared-Wins）与 `enabled: false` 显式覆盖规范**：以 `${file}:${line}` 或 `fn:${functionName}` 为唯一键，断点首次出现即存入合并字典；`enabled: false` 严格参与先到先得去重，后出现的同物理位置断点直接忽略，确保与代码实现 100% 确定性保真。 | `src/config/sceneOperations.ts` (`mergeScenesBreakpoints`) |
| **INV-012** | **调试会话保护（挂起策略 A）与核心拓扑 Diff 防线**：调试会话进行中（`activeDebugSession` 存在）外部修改断点拓扑时，绝不强制打断开发者心流，标记 `pendingTopologyUpdate = true` 并在会话终止时平滑补发；比对“磁盘新拓扑 vs `lastAppliedTopologyHash`”，若核心断点字段（`file+line+type+condition+hitCondition+logMessage+enabled`）未变，坚决阻断 DAP 重刷。快照在会话终止、清空命令及插件重启时显式失效。 | `src/config/aiActivationResolver.ts` |

---

## 禁止事项

### 架构禁止
- 核心算法层（`healingAdapter.ts`）禁止依赖任何文件写操作或 VS Code UI 弹窗。
- 适配器层（`breakpointAdapter.ts`）禁止在内部直接调用 `saveScenesConfig` 回写文件（回写必须由命令层显式决策并调用）。
- 视图层（`statusBar.ts`）禁止定义或修改全局业务主状态。

### 设计禁止
- 禁止为未知变化提前设计多层无用抽象（YAGNI），保持纯原生 TypeScript 敏捷性。
- 抽象后如果文件更多、调用链更长、理解成本更高，则禁止过度抽象。

### 编码禁止
- 严禁空 `catch` 静默吞掉错误（必须记录错误并弹出本地化错误提示）。
- 禁止在没有检查对象或属性存在性时强行进行深层链式调用。
- 禁止魔法数字（滑动窗口大小 30、得分阈值等关键常量必须具备自解释性）。
- **禁止在要求高饱和度/状态保真的 TreeView 节点中使用 `ThemeIcon`**：VS Code 的 `.monaco-list-row.selected.focused .codicon` 会强制将字体图标冲刷为继承前景色（死灰色），必须采用矢量 SVG（`vscode.Uri.file`）以确保选中高亮时色彩 100% 真实不被冲刷。
- **禁止在断点配置中使用 `type: "conditional"`**：VS Code DAP 契约与本项目严格使用名词缩写 `"condition"` 执行分支匹配。若大模型受惯性输出 `"conditional"`，会导致条件表达式被底层静默丢失、退化为普通行断点。

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
- 每次算法与领域状态逻辑修改后，必须运行 `npm test`（`node test/run-all.mjs`）确保所有测试套件 100% 通过；
- 测试用例必须覆盖缩进倍率解耦、跨函数作用域隔离、软相似度上下文门禁防误判、以及异常语法容错。

### 架构与分层约束 (KDD-ARCH-002)
- **配置管理领域分层 (Facade Pattern)**：`configManager.ts` 纯粹扮演对外聚合门面角色，底层物理拆分为 `configStorage`（磁盘I/O/清洗/指纹）、`sceneOperations`（纯内存CRUD）、`payloadSerializer`（剪贴板DTO）与 `launchResolver`（启动绑定推导）；
- **并发写盘原子互斥队列**：`saveScenesConfig` 必须受 `isWriting` 与 `pendingSave` 互斥保护，高频连击时串行合并续写，杜绝文件锁冲突；
- **同步防抖状态聚合**：内部写盘标记、指纹拦截与安全防护窗统一收敛至 `SyncCoordinator` 中枢，严禁各层散落定时器；
- **DAP 增量 Diff 装配引擎与即刻点亮**：断点装配必须进行增量 Diff 计算，完全匹配的共有断点原地保留（0 闪烁）；添加断点到当前激活场景时立即注入编辑器 DAP 运行时，并同步刷新状态机断点总数基准；
- **自愈持久化闭环与文件缓存**：自愈探测修正漂移行号后，必须自动反向映射回写持久化至 `debug-scenes.json`，且装配期间对同文件断点复用 `fileLinesCache`，消除重复 I/O；
- **CodeLens 容错与剪贴板多场景保真**：CodeLens 提取必须先经过 `stripJsonComments` 清洗支持 JSONC；剪贴板导入处于激活态场景时必须保持多场景集合不退化，并即刻触发增量 Diff 注入编辑器。
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
| 2026-09-12 | 架构解耦：建立 coordinators 协同调度层，根治循环依赖并统一状态机 SSOT (v1.1.0) | Tony.L | KDD-ARCH-DECOUPLE-001 |
| 2026-09-12 | 全面补齐命令中枢、同步协调器、并发互斥队列与即刻点亮单测，升级为 11 大全维自动化套件 (v1.1.0) | Tony.L | KDD-TEST-007 |
| 2026-09-12 | 沉淀 skill_design.md 规范至知识库：新增 INV-010 回写时序、INV-011 多场景合并先到先得、INV-012 会话保护与禁止 conditional 约束 | Tony.L | KDD-SKILL-MIGRATE-001 |
