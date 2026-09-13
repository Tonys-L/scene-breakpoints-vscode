# 能力边界 (Boundaries)

> **TL;DR**: 核心能力：**场景隔离断点装配**、**代码行号漂移加权自愈**、**断点反向批量导出**。系统边界：本插件仅负责断点元数据的编排下发与声明式持久化，不控制底层调试器（Debugger）的启动与进程生命周期。⚠️ 断点下发不等于调试器启动。

---

## 核心能力

### 场景隔离下发能力 (Scene Activation)

**能力定义**: 激活目标场景时，基于 DAP 增量 Diff 引擎智能下发断点，共有且属性完全一致的断点原地保留（0 闪烁），仅增删差量断点；在当前激活场景新增断点时即刻注入编辑器 DAP 运行时点亮红点。

**业务规则**:
- **增量 Diff 引擎**：下发前比对编辑器当前断点与目标场景断点，共有节点原地保留，仅移除过期断点与追加新断点，彻底消除重绘红点闪烁；
- **即刻点亮 (Immediate Highlight)**：向当前处于激活状态的场景添加断点时，保存配置的同时立即调用 `applySingleBreakpointToEditor` 注入编辑器，并刷新激活场景基准总数；
- **模糊寻道短期路径缓存**：单次装配期间对 `findFiles` 全盘扫描结果维护 `pathCache`，消除同文件重复全盘 I/O 检索；
- 支持 5 类断点（行断点、条件断点、命中计数断点、日志断点、函数断点）；
- 若断点配置为 `enabled: false`，下发时必须保持禁用（灰点）状态；
- 下发过程受原子锁保护，防止状态栏产生 `(None)` 竞态闪烁。

**变化点**:
- 无（多场景组合由动态叠加激活全面覆盖，不再支持 includes 配置级继承）。

**对应代码**:
- `src/domain/ports/breakpointBridge.ts` (`IBreakpointBridge`)
- `src/infra/vscode/vscodeBreakpointBridge.ts` (`applySceneBreakpoints`, `applySingleBreakpointToEditor`)
- `src/application/sceneService.ts` (`SceneService.activateScene`, `addBreakpoint`)
- `src/infra/vscode/commands/sceneCommands.ts`

---

### 代码行号漂移自愈能力 (Self-Healing)

**能力定义**: 当源码发生增删行或分支变动时，根据录入时的伴随代码指纹，自动探测并修正为最新的真实行号。

**业务规则**:
- 快路径：目标行文本完全吻合时，0ms 极速放行；
- 慢路径两阶段引擎：
  - **阶段一（近距原址辐射）**：双向滑动探测 $\pm 30$ 行，结合当前行精确/软相似度、穿透空行的非空拓扑伴随行（Non-empty Topological Window）、缩进深度与语言无关几何父结构（Indentation Tree）综合加权打分；
  - **阶段二（作用域巡航大跨度重锚定）**：若阶段一未达标且记录了 `scopeAnchor`（函数名），全文件检索定位该函数声明行，以函数体（最大 150 行）为基准展开二次扫描打分，突破 30 行限制，即使漂移 50~500 行仍可精准找回；
- 具备强韧的空行免疫性与控制流关键字（if/for/while/switch/catch 等）穿透能力，全语言通用；
- 命中判定：当前行 100% 精确一致且上下文/缩进/父结构有佐证命中（得分 $\ge 12.5$），或总分比率 $\ge 60\%$ 时判定自愈成功；
- **自愈持久化闭环 (Self-Healing Persistence Loopback)**：自愈成功后，`applyScene` 自动将自愈断点回写更新至 `.vscode/debug-scenes.json`（支持多场景反向映射精准回写），完成闭环；
- **单次装配文件行内存缓存池 (fileLinesCache)**：自愈期间对同文件多断点维护内存文本行集合，消除重复磁盘读取与字符串切行开销；
- **脱靶失联检测与告警 (Unmatched Warning & Visual Flag)**：当代码发生破坏性重构或被删除导致两阶段均未达标时，判定为 `unmatched` 脱靶状态。平滑回退至原行号的同时，激活完成时立即弹出 VS Code 警告通知并提供一键定位代码，侧边栏断点树节点实时呈现 `⚠️ 未匹配 (脱靶)` 视觉警告与悬浮释义；
- **缺失自愈指纹自动补齐能力 (Missing Fingerprint Auto-Enrichment)**：当装配的断点条目（如 AI 生成或手动编写）缺失 `contextSnippet` 时，自动读取目标源码调用纯领域函数提取三行指纹，并在激活成功后原子持久化回写至 `.vscode/debug-scenes.json`，使断点后续无缝具备漂移自愈能力；
- 判定失败时，优雅回退至原始行号，严禁胡乱漂移。

**变化点**:
- 未来支持模糊相似度算法（如 Levenshtein 距离）。

**对应代码**:
- `src/domain/healingEngine.ts` (`resolveHealedLine`, `extractContextSnippet`, `extractContextSnippetFromLines`)
- `src/infra/vscode/vscodeBreakpointBridge.ts`
- `src/application/sceneService.ts`
- `src/infra/vscode/commands/sceneCommands.ts` (`applySceneCommand`)

---

### 反向批量导出能力 (Export Scene)

**能力定义**: 将当前编辑器内所有活跃断点（包括高级属性与上下文三行代码特征）一键抓取并固化存储为新场景。

**业务规则**:
- 遍历 `vscode.debug.breakpoints`，区分 `SourceBreakpoint` 与 `FunctionBreakpoint`；
- 路径必须相对化（相对于工作区根目录）；
- 自动抓取源码提取 `contextSnippet`；
- 遇到同名场景时，提示用户选择“覆盖”或“追加”。

**对应代码**:
- `src/domain/types.ts`
- `src/application/sceneService.ts` (`SceneService.exportScene`)
- `src/infra/vscode/commands/sceneCommands.ts` (`exportSceneCommand`)

### 可视化树视图管理能力 (Scene TreeView)

**能力定义**: 在 VS Code 调试侧边栏 (Run & Debug) 中渲染 `Scene Breakpoints` 原生树视图，支持场景折叠展开、状态感知与单点点击跳转源码。

**业务规则**:
- 根节点渲染场景列表，区分激活场景（带绿色高亮徽标并默认展开）与普通场景；
- 叶子节点展示场景内断点（类型图标、文件行号、条件/描述）；
- 单击断点条目调用 `vscode.open` 并在编辑器中精准选中该行；
- 支持行内快捷操作：激活、重命名、删除场景，移除单点，切换断点启用/禁用状态；
- 状态机变更与文件变动时响应式自动重绘；
- **16x16 矢量 SVG 矩阵与色彩保真**：全类型断点使用标准 16x16 矢量 SVG，绝对免疫 VS Code 列表选中时的 CSS 字体前景色冲刷（永不变灰）；
- **零闪烁 DOM Diff 复用契约**：所有节点实现稳定唯一的 `TreeItem.id`，宿主复用已有 DOM 仅做局部属性 Diff，避免整树销毁重绘；内部保存写盘时拦截冗余刷新；
- **场景批量控制与克隆副本能力**：支持场景右键菜单“一键启用全部断点”、“一键禁用全部断点”及“克隆场景副本”，批量修改时就地内存同步且微任务合并写盘。

**对应代码**:
- `src/infra/vscode/sceneTreeProvider.ts`
- `src/infra/vscode/commands/treeCommands.ts`
- `src/domain/sceneOperations.ts` (`setAllBreakpointsEnabledInScene`, `duplicateSceneInConfig`, `renameSceneInConfig`)
- `src/application/sceneService.ts`

---

### 场景剪贴板秒级共享与导入导出能力 (Clipboard Sync)

**能力定义**: 将指定场景的全部断点序列化为标准轻量 JSON Payload 复制到剪贴板，或从剪贴板防御性解析、清洗并合并导入场景断点。

**业务规则**:
- 序列化自动将文件相对路径转为 POSIX 规范斜杠（`/`），保留自愈代码指纹；
- 解析具备严格防灾守卫（INV-006）：限制最大尺寸 1MB，自动剥离 Markdown 代码块（```json ... ```），剥离注释（JSONC），逐条清洗非法对象与破损行号；
- 兼容三种输入格式：标准 Schema Payload、scenes 字典、裸断点数组；
- 校验诊断与格式指引：解析失败时提供友好诊断并提供交互式“查看支持的格式”模板示例引导；
- 同名冲突保护：提供覆盖、追加合并（基于 INV-001 upsert 去重）、重命名导入三种决策。

**对应代码**:
- `src/application/payloadSerializer.ts` (`serializeScenePayload`, `parseScenePayload`)
- `src/infra/vscode/commands/clipboardCommands.ts`
- `src/infra/vscode/commands/sceneCommands.ts` (`showMenuCommand`)

---

### 多场景自由多选与叠加激活能力 (Layered Activation)

**能力定义**: 支持在快捷菜单中自由勾选任意多个场景或在侧边栏树视图中单点独立开关（Toggle），将多个场景的断点按照断点图层逻辑动态叠加注入 VS Code DAP，无需修改 JSON 配置。

**业务规则**:
- 叠加聚合时遵循 **INV-001** 局部唯一性契约（`mergeScenesBreakpoints`）：后勾选的场景断点覆盖先前场景中的相同位置断点；
- 全局场景状态机升级为持久管理 `activeScenes: string[]` 集合（**INV-004 SSOT**），状态栏实时呈现多场景复合徽标（如 `[auth + order]`）；
- 下发过程全程受原子执行锁保护（**INV-005**），防止触发瞬态 `(None)` 闪烁；
- 取消全部勾选时自动引导进入清空流程，安全复位为 `None`。

**对应代码**:
- `src/domain/sceneOperations.ts` (`mergeScenesBreakpoints`)
- `src/domain/sceneStateManager.ts` (`activeScenes`, `toggleScene`)
- `src/application/sceneService.ts` (`SceneService.activateScene`)
- `src/infra/vscode/statusBarView.ts`
- `src/infra/vscode/sceneTreeProvider.ts`

### 调试启动配置自动联动激活能力 (Launch.json Binding Hook)

**能力定义**: 捕获 VS Code 启动调试生命周期（`resolveDebugConfiguration`），在调试进程拉起前，智能推导对应的场景断点并自动静默激活装配。

**业务规则**:
- 推导遵循三级优先级（**INV-007**）：
  1. 环境变量显式指定 `env.DEBUG_SCENE`（最高优先级，支持逗号分隔多场景）；
  2. `debug-scenes.json` 顶层 `bindings` 字段声明式映射；
  3. 智能同名推导（启动配置名称与场景名大小写不敏感匹配）。
- **虚假场景存在性拦截守卫（INV-009）**：推导出的场景名必须在 `config.scenes` 中真实存在（支持大小写容错）。若不存在，严禁返回幽灵场景，命令层立即拦截报错，杜绝状态栏误染绿与断点误清空；
- 幂等性守卫（Idempotency Guard）：若计算出的目标场景与当前已激活场景集合一致，跳过重装配，0 冗余开销；
- 状态栏与树视图协同：自动静默切换状态栏与侧边栏高亮徽标为目标场景；
- 全局配置受控：提供 `sceneBreakpoints.autoActivateOnLaunch` 开关，支持用户自由开启或停用该自动化能力。

**对应代码**:
- `src/domain/launchResolver.ts` (`resolveLaunchBoundScenes`)
- `src/infra/vscode/listeners/debugLifecycleListener.ts` (`resolveDebugConfiguration`)
- `src/application/sceneService.ts`

### 断点状态全双工实时同步能力 (Full-Duplex Breakpoint State Synchronization)

**能力定义**: 打通【侧边栏树视图】、【编辑器原生断点 (DAP)】与【本地 JSON 配置文件】三者之间的断点启用/禁用状态，实现毫秒级双向无感同步与自动重载。

**业务规则**:
- **正向同步（树视图 $\rightarrow$ 编辑器）**：在树视图切换断点启用/禁用时，若该断点所属场景处于激活状态，通过 `syncBreakpointEnabledToEditor` 实施就地原子断点替换；
- **反向同步（编辑器 $\rightarrow$ JSON 文件）**：用户在源码行号或 VS Code 原生断点面板切换启用/禁用时，`onDidChangeBreakpoints` 捕获 `event.changed`，将对应断点状态反向回写至当前激活场景中，并受内部保存防抖锁保护；
- **文件保存响应（JSON 文件 $\rightarrow$ 编辑器与树视图）**：用户手动编辑并保存 `debug-scenes.json` 时，若当前有激活场景，自动静默重新装配当前激活图层，使编辑器与最新配置文件保持严格一致；
- **防回环死循环保护（INV-008）**：通过 `isApplyingScene` 与内部写入防抖时间戳（`markInternalSaving`）区分插件内部操作与外部人为操作，杜绝“改断点 $\rightarrow$ 写文件 $\rightarrow$ 文件监听 $\rightarrow$ 改断点”的回声震荡。

**对应代码**:
- `src/infra/vscode/vscodeBreakpointBridge.ts` (`syncBreakpointEnabledToEditor`)
- `src/infra/vscode/listeners/breakpointSyncListener.ts`
- `src/infra/storage/saveLoopGuard.ts`
- `src/application/sceneService.ts`

---

### AI 声明式免 MCP 场景激活与 Agent 矩阵分发能力 (Declarative AI Orchestration & Multi-Agent Matrix)

**能力定义**: AI Agent 无需借助外部 MCP Server，直接通过声明式读写工作区 `.vscode/debug-scenes.json` 的 `activeScenes` 根级字段驱动插件响应式激活；支持跨主流 VS Code AI Agent 环境的一键 Skill/Rules 矩阵分发与全维集成诊断。

**业务规则**:
- **根级 `activeScenes` 字段语义**：支持 `string[]` 或单个 `string`（防御性自动装箱），设置为空数组 `[]` 或删除该字段时安全卸载工作区断点并复位状态为 None；
- **自愈指纹 `contextSnippet` 推荐缺省策略**：AI 生成新场景断点时，强烈推荐缺省不填 `contextSnippet`，只需提供 `type`、`file`、`line` 及业务意图 `desc`。插件底层具备原样信任行号的平滑降级支持，并在场景激活、断点微调或反向同步时由插件自动读取磁盘真实源码反向提取并持久化补齐指纹闭环，消除 Token 浪费与模型格式化幻觉；
- **严格先到先得与 enabled 覆盖规范 (INV-011)**：多场景叠加激活时以 `${file}:${line}` 或 `fn:${functionName}` 为唯一键，首个声明该位置的断点生效，其 `enabled: false` 同样优先锁定，后声明的同位置断点直接忽略；
- **双重保护防线 (INV-012)**：调试会话进行中（`activeDebugSession`）修改断点拓扑时采用挂起策略（策略 A），待会话终止后自动平滑补偿；核心断点拓扑 Diff (`computeBreakpointsTopologyHash`) 阻断无实质断点变动（如仅改 `desc`、`bindings` 或未激活闲置场景）的 DAP 重刷；
- **8 大主流 VS Code AI Agent 集成矩阵一键分发**：支持将断点编排 Skill 一键分发至工作区：
  1. Cursor：`.cursor/rules/scene-breakpoints.mdc`（含 YAML Frontmatter 契约）
  2. Windsurf：`.windsurf/rules/scene-breakpoints.md`
  3. Cline：`.clinerules/scene-breakpoints.md`
  4. Roo Code：`.roorules/scene-breakpoints.md`
  5. Continue：`.continue/prompts/scene-breakpoints.prompt`
  6. VS Code / GitHub Copilot：`.github/skills/scene-breakpoints/SKILL.md`
  7. Trae IDE：`.trae/skills/scene-breakpoints/SKILL.md`
  8. Antigravity：`.agents/skills/scene-breakpoints/SKILL.md`
- **VS Code Chat Skill Provider 宿主动态注入**：检测宿主 `vscode.chat.registerSkillProvider` 能力，支持内存动态虚拟挂载，无需落盘物理文件；
- **全维集成状态诊断 (`diagnoseAiIntegration`)**：集中诊断 `allowAiFileActivation` 授权开关、当前激活场景列表与 8 大 Agent 路径部署状态，并提供交互式一键修复与安装；
- **Skill 全生命周期感知与无损升级更新**：基于统一核心正文指纹反查（Hash 作为 Key，`O(1)` 秒查），剥离 MDC/YAML 等平台 Frontmatter 并归一化换行符；三态生命周期判定（`UpToDate` 最新、`CleanOutdated` 官方可平滑升级、`CustomModified` 用户已自定义）；对自定义文件调起 VS Code 原生 `vscode.diff` 并排对比由用户自主合并，覆写前强制自动生成同目录 `.bak` 时间戳物理备份副本。

**对应代码**:
- `src/domain/activationResolver.ts` (`resolveActiveScenesDiff`, `computeBreakpointsTopologyHash`)
- `src/domain/skillLifecycleResolver.ts` (`resolveSkillLifecycleState`, `stripSkillFrontmatter`, `normalizeSkillContent`, `computeSkillFingerprint`)
- `src/application/sceneService.ts` (`handleExternalScenesFileChange`)
- `src/infra/vscode/commands/skillCommands.ts` (`installSkillCommand`, `diagnoseAiIntegrationCommand`)
- `src/infra/vscode/templateContentProvider.ts` (`TemplateContentProvider`)
- `src/infra/vscode/listeners/configFileWatcherListener.ts`
- `src/infra/vscode/listeners/chatSkillListener.ts`

---

## 外部依赖能力

| 依赖 | 用途 | 替换/解耦成本 |
|------|------|-------------|
| `vscode.debug` (VS Code DAP API) | 接收与下发断点、监听原生断点变动、注册调试启动配置提供者 | 中（若移植至 JetBrains，需替换为 `XDebuggerManager`） |
| `vscode.window.createTreeView` | 调试面板原生树视图渲染 | 中（若移植至其他 IDE，需对齐树视图控件接口） |
| `vscode.env.clipboard` | 读写系统原生剪贴板内容 | 低（标准宿主剪贴板接口） |
| `vscode.window.showQuickPick / InputBox` | 交互式输入与多选菜单展示 (`canPickMany: true`) | 中（若移植至独立 CLI，需替换为命令行参数解析） |
| `node:fs` / `node:path` | 本地 `.vscode/debug-scenes.json` 文件持久化 | 极低（标准 Node.js 原生模块） |

---

## 系统边界

### 系统内（插件负责）
- 断点类型配置的合法性校验与清洗（`loadScenesConfig`）；
- 场景内同代码位置的去重与合并（`upsertBreakpointToScene`）；
- 多场景动态叠加聚合去重（`mergeScenesBreakpoints`）；
- 调试启动项（Launch.json）三级匹配推导、幽灵场景过滤与幂等预拦截激活（`resolveLaunchBoundScenes`）；
- 断点启用/禁用状态在编辑器、树视图与配置文件间的全双工双向同步与防回环保护；
- 侧边栏树视图稳定唯一 `TreeItem.id` 与原生 DOM Diff 就地更新（零闪烁渲染）；
- 三行代码指纹的提取与行号漂移计算；
- 状态机单向数据流与状态栏响应式渲染；
- 调试侧边栏原生树视图层级编排与跳转指令下发；
- 剪贴板 Payload 标准化序列化与外部输入防御性清洗过滤；
- 跨 Agent 环境 Skill 与 Rules 资产一键部署分发及全维状态诊断（`sceneBreakpoints.installSkill`、`sceneBreakpoints.diagnoseAiIntegration`，支持 Cursor, Windsurf, Cline, Roo Code, Continue, Copilot, Trae, Antigravity）。

### 系统外（宿主与调试器负责）
- 实际断点命中的暂停控制、调用栈回溯与变量查看（由语言特定 Debug Adapter 负责，如 Python debugpy、Node.js inspector）；
- 调试进程的拉起与关闭（由 VS Code launch.json 调度，插件仅在拉起前提供预注入拦截）。

---

## 变更记录

| 日期 | 变更内容 | 变更人 | 关联变更 |
|------|----------|--------|----------|
| 2026-09-08 | 初始版本 | Tony.L | KDD-INIT-001 |
| 2026-09-08 | 新增可视化树视图管理能力 (Scene TreeView) | Tony.L | KDD-TREEVIEW-001 |
| 2026-09-08 | 新增场景剪贴板秒级共享能力 (Clipboard Sync) | Tony.L | KDD-CLIPBOARD-001 |
| 2026-09-08 | 落地多场景动态多选叠加激活能力 (Layered Activation) | Tony.L | KDD-MULTI-ACTIVATE-001 |
| 2026-09-08 | 新增调试启动配置自动联动激活能力 (Launch.json Binding Hook) | Tony.L | KDD-LAUNCH-HOOK-001 |
| 2026-09-08 | 建立断点状态全双工实时同步与文件变动联动能力 (Full-Duplex Sync) | Tony.L | KDD-SYNC-001 |
| 2026-09-08 | 确立 16x16 矢量 SVG 矩阵色彩保真规范 (v1.0.0) | Tony.L | KDD-UI-003 |
| 2026-09-08 | 确立幽灵场景存在性推导校验与拦截守卫 (INV-009, v1.0.0) | Tony.L | KDD-DEFENSE-001 |
| 2026-09-08 | 确立树节点稳定 id 契约与 DOM Diff 零闪烁规范 (v1.0.0) | Tony.L | KDD-TREE-002 |
| 2026-09-08 | 落地 DAP 增量 Diff 装配引擎、即刻点亮与模糊寻道缓存 (v1.0.0) | Tony.L | KDD-DAP-DIFF-001 |
| 2026-09-08 | 落地自愈持久化闭环 (Self-Healing Loopback)、文件行内存缓存与文件监听防抖 (v1.0.0) | Tony.L | KDD-HEALING-LOOP-001 |
| 2026-09-08 | CodeLens 兼容 JSONC 注释与激活态感知、剪贴板导入多场景保真 DAP 注入与状态栏自适应 (v1.0.0) | Tony.L | KDD-CODELENS-CLIP-001 |
| 2026-09-11 | 剪贴板导入增强：Markdown 代码块自动剥离与交互式支持格式指引 | Tony.L | KDD-CLIP-FORMAT-001 |
| 2026-09-12 | 自愈引擎升级：穿透空行的非空拓扑伴随窗口与语言无关几何缩进父结构 (v1.0.1) | Tony.L | KDD-HEALING-TOPO-001 |
| 2026-09-12 | 新增断点脱靶失联探测、激活警告弹窗与侧边栏视觉标记 (v1.0.1) | Tony.L | KDD-UNMATCHED-WARN-001 |
| 2026-09-12 | 确立两阶段自愈引擎：近距辐射 + 作用域巡航大跨度重锚定 (突破 30 行限制, v1.0.1) | Tony.L | KDD-SCOPE-CRUISE-001 |
| 2026-09-12 | 完善插件市场文档在线绝对链接、分发包放行使用指南并增强树节点热重载空值安全守卫 (v1.0.2) | Tony.L | KDD-DOCS-PKG-001 |
| 2026-09-12 | 落地 AI 免 MCP 声明式场景激活 (activeScenes) 与多端 Skill 一键分发体系 (v1.1.0) | Tony.L | KDD-AI-SKILL-001 |
| 2026-09-12 | 扩充主流 VS Code AI Agent 集成矩阵至 8 大基于 VS Code 平台，剔除 CLI 终端工具 (v1.1.0) | Tony.L | KDD-AI-AGENT-EXPAND-001 |
| 2026-09-12 | 架构解耦：建立 coordinators 协同调度层，根治循环依赖并统一状态机 SSOT (v1.1.0) | Tony.L | KDD-ARCH-DECOUPLE-001 |
| 2026-09-12 | 沉淀 skill_design.md 规范至能力边界：明确 contextSnippet 推荐缺省策略、严格先到先得及 8 大 Agent 矩阵细则 | Tony.L | KDD-SKILL-MIGRATE-001 |
| 2026-09-13 | 落地基于核心正文哈希反查的 Skill 生命周期三态判定、VS Code 原生 Diff 与自动备份机制 (v1.0.3) | Tony.L | KDD-SKILL-LIFECYCLE-001 |
| 2026-09-13 | 全量对齐能力边界至 DDD 三层隔离架构代码路径 (domain/application/infra) | Tony.L | #TASK-ARCH-PATH-SYNC-001 |
| 2026-09-13 | 移除多场景组合/继承 (includes) 扩展点规划，全面收敛至动态叠加激活体系 | Tony.L | #TASK-REMOVE-INCLUDES-001 |
| 2026-09-13 | 落地场景激活时缺失自愈指纹自动提取补齐与持久化回写闭环 (Auto-Enrich Fingerprint) | Tony.L | #TASK-AUTO-ENRICH-001 |
