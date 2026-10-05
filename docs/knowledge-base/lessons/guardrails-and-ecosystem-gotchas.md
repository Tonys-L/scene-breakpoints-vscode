# 架构质量硬门禁与宿主生态踩坑 (Guardrails & Ecosystem Gotchas)

> **TL;DR**: 记录架构重构、VS Code 宿主版本适配、命令总线绑定与持久化状态机中的深层踩坑与应对策略。

---

## 1. 业务逻辑与状态机陷阱

### 1.1 对象原地变异导致持久化变更判定失效 (KDD-HEALING-LOOP-001)

**问题**:
在场景激活阶段，自愈引擎明明计算出了代码行号自然漂移并打印了自愈日志，但 E2E 测试断言磁盘 `debug-scenes.json` 中的行号并未更新，导致测试红灯。

**原因**:
自愈算法在内存执行时，直接在内存中的断点实例上调用了 `updateLine(healed.line)`。后续在应用层持久化检测时，检测逻辑比对 `this.line !== healed.line`，由于对象行号已被提前就地变异为最新值，导致比对返回 `false`，应用层错误判定为“无变更”跳过了原子写盘。

**解决方案**:
应用层坚守“自愈即事实”不变量（INV-003, INV-010）：只要自愈管道报告 `healedCount > 0 || enrichedCount > 0`，不依赖浅层属性 diff，强制触发原子落盘闭环 `loopGuard.markInternalSaving(); sceneRepository.saveScenesConfig(...)`。

**影响文件**: `src/application/sceneManager.ts`
**日期**: 2026-09-30

---

## 2. 宿主生态与版本适配陷阱

### 2.1 engines.vscode 与 @types/vscode 版本错位引发跨版本崩溃

**问题**:
`package.json` 的 `engines.vscode` 声明支持最低 `^1.85.0`，但 `devDependencies` 中误引入了 `@types/vscode: ^1.138.0`。

**原因**:
在高版本类型定义下，调用较新版本引入的 VS Code API 可以在本地编译通过；但低版本（如 1.85）用户运行插件时，宿主环境缺少对应 API 函数，将直接抛出 `TypeError: undefined is not a function` 导致插件崩溃。

**解决方案**:
严格锁定 `@types/vscode: ~1.85.0` 与 `engines.vscode` 主次版本 100% 对齐。通过 TypeScript 编译器在编译期形成“天然硬防线”，凡使用 1.85 不支持的 API 直接报错。并在代码级门禁中建立版本对齐强校验（INV-022）。

**影响文件**: `package.json`, `scripts/verify-guardrails.mjs`
**日期**: 2026-09-30

---

## 3. 代码异常与规范陷阱

### 3.1 空 catch 静默吞错掩盖配置与异步灾难

**问题**:
在文件监听或后台静默同步过程中，个别兜底读取使用了 `catch {}` 空块。

**原因**:
原本初衷是为了容灾不中断主流程，但在真实运行中，若配置文件被操作系统占有、权限受限或编码损坏，空 catch 会导致关键报错彻底失联，让排查变成黑盒。

**解决方案**:
坚守约束禁令（严禁空 catch 静默吞错）：所有 catch 块必须显式捕获 `(err)` 并通过 `console.warn` 记录语义化上下文。在门禁脚本中建立全工程语法扫描守卫，0 容忍空 catch。

**影响文件**: `src/infra/vscode/listeners/configFileWatcherListener.ts`, `src/application/agentSyncService.ts`
**日期**: 2026-09-30

### 3.2 VS Code 弹窗 Thenable 悬空 Promise 与 unhandledRejection 隐患

**问题**:
在代码中裸写 `vscode.window.showInformationMessage(...)`、`showWarningMessage` 或直接触发无 `await` 的异步刷新，在常规语法扫描器下绿灯，但在开启 TypeScript-ESLint 类型感知规则后出现多处警告。

**原因**:
VS Code 宿主交互 API 返回的是 `Thenable<T | undefined>`（Promise 兼容对象）。如果未 `await` 且未捕获错误，一旦在底层被取消、销毁或抛出异步异常，会形成 Node.js 未捕获 rejection 隐患；同时破坏了代码对于“这是并发后台执行还是忘记 await”的语义表达。

**解决方案**:
1. 不需要等待用户点击结果的提示通知统一显式前缀 `void` 运算符（如 `void vscode.window.showInformationMessage(...)`），向编译器与阅读者明确传达“有意不阻塞当前流程”；
2. 在 `.eslintrc.json` 中接入 `@typescript-eslint/parser` 与 `project: ["./tsconfig.json"]`，将 `@typescript-eslint/no-floating-promises` 升格为 `error` 级别硬阻断；
3. 将 ESLint 检查挂载到 `scripts/verify-guardrails.mjs` 中形成第 15 大代码级硬门禁。

**影响文件**: `src/ui/commands/*`, `src/infra/storage/jsonFileSceneRepository.ts`, `.eslintrc.json`
**日期**: 2026-09-30

### 3.3 函数行数检测收敛至 ESLint AST 与零特权逃逸原则 (GR-013)

**问题**:
原先在架构单测中手写了 70 余行基于正则与花括号配对的代码行数扫描器，逻辑脆弱且经常无法准确识别包含嵌套对象/回调函数的真实函数体；而部分长函数为了掩盖问题，私自添加了 `/* eslint-disable max-lines-per-function */` 特权逃逸注释。

**原因**:
脆弱的手写正则与特权逃逸违背了 KISS 与防御性设计原则，降低了工程代码可维护性。

**解决方案**:
1. 将单函数 $\le 80$ 行检测全面收敛至业界标准的 ESLint `max-lines-per-function` 规则，由成熟的 TypeScript AST 解析，彻底废除脆弱的手写正则扫描；
2. 坚决拔除全工程所有 `/* eslint-disable max-lines-per-function */` 注释，对长函数实施彻底的纯结构 Extract Method 提取，使所有函数物理收敛至 80 行以内；
3. ESLint 零警告、零报错直接纳入 `npm run lint` 与 `npm run verify` 硬门禁。

**影响文件**: `.eslintrc.json`, `test/unit/architecture/architecture_guard.test.mjs`, `src/**/*`
**日期**: 2026-10-02

### 3.4 Clean Architecture 与展示/基础设施物理硬隔离 (UI & Infra Strict Decoupling)

**问题**:
在功能演进中，UI 命令或辅助工具容易绕过应用层直连外部基础设施（如 UI 直接调用 Node `node:fs` 探测文件、直接操纵 DAP 适配器或通过克隆 `workspaceRoot.ts` 逃避分层门禁）。

**原因**:
缺乏层级边界自检意识，追求局部敏捷而破坏了单向依赖与分层隔离约束。

**解决方案**:
1. 严格落实依赖倒置原则（DIP）：UI 层严禁直接导入 `node:fs` 或 Infra 底座，统一通过 Application 深度服务（如 `AgentSkillService`）或宿主文档抽象进行安全 I/O；
2. 精准化架构门禁（`.dependency-cruiser.cjs`），消除为了绕过规则而克隆辅助工具的坏味道；
3. UI 视图纯粹作为被动观察者，通过 `ApplicationEventBus` 监听状态自刷新，严禁直接持有或篡改主业务状态。

**影响模块**: `src/ui/commands/*`, `src/application/*`, `src/infra/*`, `.dependency-cruiser.cjs`

---

### 3.5 深模块设计与假想接缝/空壳类清除 (Deep Modules & Class Ceremony Elimination)

**问题**:
滥用面向对象仪式，为单一实现的接口提取假想接缝（如只有单个实现的 `ISelfHealingStore`）、创建只有静态方法的空壳工具类、或在模块间建立无附加价值的浅层透传桩。

**原因**:
盲目套用传统重型设计模式，导致文件碎片化（浅模块），增加调用跳跃成本并稀释内聚性。

**解决方案**:
1. 践行“深模块（Deep Modules）”原则：接口尽量极简，内部封装尽量充分；单一实现的存储契约直接内聚于具体实现中，拒绝过度假想抽象；
2. 无状态纯计算全面回归函数式导出（`export function`），彻底废除纯静态空壳类；
3. 坚决执行“删除测试（Deletion Test）”：清除无参数转换或防御聚合的空壳透传桩与死接口，调用方直连真实业务单例。

**影响模块**: `src/infra/storage/*`, `src/shared/utils/*`, `src/application/*`

---

### 3.6 统一单写者变异管道与 SSOT 持久化一致性 (Single-Writer Mutation Pipeline)

**问题**:
多个管理器（如 `SceneManager`、`BreakpointManager`）各自手写落盘、防回环标记与事件广播样板代码，不仅产生重复逻辑，更易导致活跃断点变更时与 VS Code DAP 桥接器失步（如删除断点后红点残留）。

**原因**:
缺乏统一的变异事务管道，各管理器直接暴露写操作，打破了 INV-010 单向回写时序保证。

**解决方案**:
1. 建立统一的原子写事务管道 `mutateCatalog`，统一收敛磁盘落盘、防回环守卫标记与应用事件广播；
2. 管道内集成活跃场景拓扑变更感知（`computeTopologyHash`）：一旦当前激活场景的断点发生增删、启闭或排序，自动调度桥接器执行原地 0 闪烁增量 Diff 同步，并刷新状态机内存投影；
3. 依托 `SerialQueue` 与 `AsyncLocalStorage` 赋予变异管道同调用链安全可重入能力，彻底消除并发写覆盖与自死锁。

**影响模块**: `src/application/mutateCatalog.ts`, `src/application/serialQueue.ts`, `src/application/breakpointManager.ts`

---

### 3.7 活动断点内存索引投影与应用事件总线弱耦合 (Active Breakpoint Index & Event Bus)

**问题**:
源码行末注解（InlayHints）与调试命中监听等高频操作（每毫秒多次）直接扫描磁盘或遍历全量配置，造成严重性能瓶颈；同时底层监听器直接持有 UI 视图实例，导致底层反向依赖上层视图。

**原因**:
混淆了“静态持久化权威 SSOT”与“运行期高性能内存投影”的职责边界，且缺乏解耦事件中枢。

**解决方案**:
1. 建立专职高频只读内存投影 `ActiveBreakpointIndex`，毫秒级快速响应文档断点检索与命中判定，物理隔离低频写事务；
2. 建立轻量 `ApplicationEventBus`：领域与应用层数据状态变更、调试暂停与恢复统一广播事件，UI 视图响应式自刷新，彻底根除 Infra 到 UI 的逆向依赖。

**影响模块**: `src/application/activeBreakpointIndex.ts`, `src/application/eventBus.ts`, `src/ui/views/*`

---

### 3.8 树节点呈现模型纯化与可变状态解耦 (TreeNodes Presentation State Decoupling)

**问题**:
树节点类挂载静态可变状态（如 `SceneNode.expandedScenes = new Set()`），且构造函数直连全局单例状态计算图标与失配状态，破坏了视图层的纯渲染约束，导致单测困难与隐式副作用。

**原因**:
为快速实现功能而引入全局静态容器与隐式依赖。

**解决方案**:
1. 提取显式 `TreeViewState` 容器统一管理树展开/折叠状态；
2. 纯函数化图标计算（`resolveBreakpointIconFileName`），使图标逻辑具备 100% 确定性；
3. 解耦树节点构造器，通过显式参数注入呈现数据，使树节点彻底回归无副作用的纯呈现模型。

**影响模块**: `src/ui/views/treeNodes.ts`, `src/ui/views/sceneTreeProvider.ts`

---

### 3.9 AI 架构摆锤效应与深浅模块裁决防线 (AI Architectural Thrashing & Anti-Churn Protocol)

**问题**:
AI 在多轮架构扫描中容易陷入“摆锤效应”：一轮提议将细分模块合并为上帝对象，下一轮又提议拆散，造成无意义的代码反复横跳与架构震荡。

**原因**:
缺乏业务无关、正交客观的架构裁决硬标准。局部扫描仅凭浅层行数或调用层级做推导，忽视了“高频热点与低频事务的物理隔离”、“外部生态与内部规则的依赖边界”以及“充血实体的数据与行为主权”。

**解决方案**:
正式确立 ADR-004“防架构摇摆五步裁决协议”并作为不可逾越的架构硬约束：
1. **测试一：变更节拍与性能热点隔离测试 (Cadence & Hotpath Isolation Test)**
2. **测试二：依赖层级与框架边界测试 (Dependency Level & Framework Boundary Test)**
3. **测试三：充血实体主权与防上帝对象测试 (Sovereign Entity vs. God Object Test)**
4. **测试四：共变性与删除测试 (Co-variation & Deletion Test)**
5. **测试五：伪中间人与正当门面判定 (Middleman vs. Legitimate Facade Test)**
对空壳透传桩坚决修剪，对正当的高频投影、领域实体与物理分层实施刚性保护。

**影响模块**: `docs/knowledge-base/adr/004-architectural-anti-churn-standard.md`, `docs/knowledge-base/constraints.md`, `src/application/sceneStateManager.ts`

---

## 4. 命令总线与清单一致性陷阱






### 4.1 package.json 命令声明与代码实现 1:1 双向一致性

**问题**:
VS Code 插件容易在 `package.json` 配置了 `contributes.commands`，但在代码中命令 ID 拼错或漏注册；或者快捷键绑定了不存在的命令 ID，导致用户在命令面板触发时报 `command 'xxx' not found`。

**解决方案**:
在自动化门禁脚本中建立双向静态比对：强制 `package.json` 中的 25 个命令与代码中注册的命令 ID 100% 吻合，并严格校验 `keybindings` 和 `menus` 关联命令的有效性（INV-023）。

**影响文件**: `src/ui/commands/index.ts`, `src/ui/commands/treeCommands.ts`, `scripts/verify-guardrails.mjs`
**日期**: 2026-09-30

## 5. 门禁与知识库治理陷阱

### 5.1 纯文档维护任务教条执行全量代码硬门禁 (No Cargo Culting)

**问题**:
在对知识库文档（如 `constraints.md`）进行文字脱水与结构重构后，机械教条地执行 `npm run verify` 与全量测试套件，耗费大量等待时间与计算 Token。

**原因**:
混淆了“代码交付门禁”与“文档维护边界”。纯 Markdown 文档的变更未触碰任何 `src/` 生产逻辑、`test/` 单测或工程配置文件，物理上绝不可能导致类型编译、覆盖率或运行时出现逻辑回归。盲目触发重型验证是典型的过度工程与防御性教条主义（Cargo Culting）。

**解决方案**:
1. 明确界定验证边界：纯文档、知识库与注释维护归入 `AGENTS.md` 的【纯文档轻量门禁 (Doc-Only Light Gate)】，仅执行文本一致性与链接有效性自检，立刻交付；
2. 唯有在改动生产代码、单元测试或工程构建配置（`package.json`、`schema.json`、`tsconfig.json`）时，才触发对应单测或全量硬门禁；
3. 知识库坚守 AI-Native 高信噪比第一性原理，禁止将 CI 工具脚本条目冒充为业务不变量。

**影响文件**: `AGENTS.md`, `docs/knowledge-base/README.md`, `docs/knowledge-base/constraints.md`
**日期**: 2026-10-02

---

### 5.2 CRAP 变更风险指标在高质量代码库中的敏感度校准 (KDD-CRAP-RADAR-001)


**问题**:
在引入 Uncle Bob 的 CRAP (Change Risk Anti-Patterns) 变更风险反模式指标时，若直接照搬业界通用的 16.4 作为危险警报阈值，雷达在高质量代码库中会严重失真、迟钝失效。

**原因**:
业界 16.4 阈值的数学推导假设是 $10^2 \times (1 - 0.6)^3 + 10 = 16.4$，其容忍圈复杂度高达 10 且允许测试覆盖率仅为 60%（普通平庸项目的及格线）。而在经过严格 Clean Architecture 分层与治理的高质量工程中，单函数受 GR-013 限制通常 $\le 80$ 行（全工程平均复杂度仅 3.13），核心代码受 GR-008 限制行覆盖率 $\ge 85\%$（CRAP 均分达到 3.51）。若继续使用 16.4 作为预警线，超过 97% 的函数都会通过，错失大量在 6 ~ 10 分区间的复杂度膨胀与微小测试盲区。

**解决方案**:
1. 基于工程自身的不变量与门禁指标推导本土化阈值：以容许复杂度 $\text{comp} \le 8$、单测覆盖率 $\text{cov} \ge 80\%$ 为基准，推导出项目专属告警敏感线为 6.0 ~ 8.5；
2. 建立 6.0（关注警戒线）与 10.0（高危红线）的阶梯式双阈值雷达，并以 7 级金字塔分布直方图监控全项目 76% 代码维持在 $\le 4.0$ 的健康区间；
3. 将计算固化为 `scripts/compute-crap.mjs` 并注册 `npm run check:crap`，实现 100% 物理真实 AST 提取与覆盖率对齐。

**影响文件**: `scripts/compute-crap.mjs`, `package.json`
**日期**: 2026-10-04

---


