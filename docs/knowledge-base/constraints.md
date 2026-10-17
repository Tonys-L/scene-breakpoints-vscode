# 约束 (Constraints)

> ⚠️ **必读文档**：任何任务都必须阅读本文档。约束不可被绕过。

---

## 设计原则

优先级裁决（冲突时按此顺序）：

```text
业务优先 > 职责优先 > 变更成本 > 简单优先 > 扩展优先
```

核心哲学：业务优先于技术，职责优先于分层，简单优先于复杂。

---

## 架构约束

### 四层+展示隔离架构 (Clean Architecture & Presentation Separation)

```text
通用工具与纯算法 (src/shared/*)     ：【通用算法与纯文本处理】(100% 纯 TS，无业务概念，零依赖，纯 Function I/O)
开发者交互展示层 (src/ui/*)         ：【人机界面与交互命令】(TreeView 侧边栏、StatusBar 状态栏、CodeLens、InlayHints、Commands 交互命令)
    ↓ (调用应用层用例，调度 Manager / Service)
应用用例层 (src/application/*)      ：【业务用例怎么做？】(纯 TS，实体状态维护与流程编排，受单写者串行队列 SerialQueue 保护)
    ↓ (调度领域层充血模型能力，依赖抽象端口契约)
核心领域层 (src/domain/*)           ：【业务本质与规则】(100% 纯 TS，零外部依赖，定义充血实体 models、领域服务 services 与端口 ports)
    ↑ (实现领域层端口契约)
基础设施层 (src/infra/*)            ：【外部技术驱动与持久化】(出站技术适配器：storage 磁盘持久化、vscode 原生断点桥接与宿主监听器)
```

#### 架构命名与职责治理：Manager vs Service 判定法则

| 命名后缀 | 本质特征 | 核心职责 | 典型应用 |
|---|---|---|---|
| **Manager（管理器）** | **面向实体/状态主权**（持有或维护生命周期状态） | 1. 负责具体实体或资源集合的生命周期管理（CRUD、增删查改、启闭状态）<br>2. 维持实体数据一致性与持久化同步 | `SceneManager`<br>`BreakpointManager`<br>`SceneStateManager` |
| **Service（服务）** | **面向无状态流程/跨模块协同**（算法计算、外部管道流） | 1. 负责跨多个模块的无状态工作流、算法管道或外部输入同步<br>2. 不私有独占实体数据主权，纯以输入参数驱动处理 | `AgentSyncService`<br>`AgentSkillService`<br>`HashService`<br>`HealingEngine` |

#### 依赖方向与职责边界

| 层 | 模块 | 职责定位 | 依赖方向 | 禁止事项 |
|---|---|---|---|---|
| **展示层 (UI)** | `src/ui/*` | 人机交互界面与宿主命令控制器 | 依赖 Application 层与 Domain 纯类型 | **禁止跨层调用 Infra（严禁绕过应用层直连底座）**；持有业务主状态 |
| **应用层 (Application)** | `src/application/*` | 实体生命周期管理与用例编排，内置 `SerialQueue` 串行保护 | 仅依赖领域层契约与纯数据接口 | 依赖具体 VS Code 宿主 API 或硬依赖 Infra 具体实现（必须通过 DIP 注入） |
| **领域层 (Domain)** | `src/domain/*` | 业务本质契约（Ports）、充血模型（`models/*`）与无状态领域服务（`services/*`） | 零外部环境依赖（100% 纯 TypeScript） | 依赖任何外部 UI、框架或文件 I/O |
| **基础设施层 (Infra)** | `src/infra/*` | 外部技术适配器（存储持久化、DAP 桥接、宿主监听器） | 实现领域层端口契约（Ports），适配宿主环境 | **反向依赖 UI 层**；直接定义或篡改全局业务主状态 |

---

### 目录拓扑与分层结构映射

#### 1. 源码架构分层拓扑 (`src/`)

```text
src/
├── shared/utils/                   # [通用纯技术工具] 相似度、文本清洗、数组去重；零业务概念，纯 Function I/O
├── domain/                         # [核心领域层] 100% 纯业务规则，零外部环境依赖
│   ├── models/                     # 纯充血领域实体与聚合根 (SceneCatalog, Scene, Breakpoint, Fingerprint, AgentRuleAsset)
│   ├── services/                   # 无状态领域服务与算法 (HealingEngine, ScenePayloadCodec, ActiveScenesDiffResolver)
│   └── ports/                      # 业务能力契约端口 (IBreakpointBridge, ISceneRepository, ILineReader, IHashService)
├── application/                    # [应用用例层] 纯 TS 实体管理器与流程服务，受 SerialQueue 保护
│   └── (sceneManager: 场景CRUD, breakpointManager: 断点管理, agentSyncService: AI/Diff协同, agentSkillService: 规则/技能运维, sceneStateManager: 会话状态机)
├── ui/                             # [开发者展示层] 视觉交互与宿主命令控制器 (commands/, views/, locators/)
├── infra/                          # [基础设施层] 外部技术适配器 (storage 原子写盘与 echoLoopGuard, vscode DAP断点桥接与监听器)
└── extension.ts                    # [组装根 Composition Root] 唯一胶水入口，专职适配器实例化与依赖倒置注入
```

#### 2. 代码范式硬约束：Stateful Object vs Stateless Function

| 范式维度 | 适用形态 | 判定标准 | 落地规范 |
|---|---|---|---|
| **有状态实体 / 资源持有者** | `class + new` 单例导出 | 持有可变状态、专属并发原语（`SerialQueue`）或生命周期资源 | 构造函数注入依赖，文件底部 `new` 导出首字母小驼峰单例。**严禁全静态空壳类**。 |
| **充血领域模型** | `class + new` 按需实例化 | 业务领域实体与聚合根（`Scene`, `Breakpoint`），数据与业务行为内聚 | 杜绝贫血 getter/setter 类。聚合根管理内部实体，值对象不可变。 |
| **无状态纯计算 / 工具库** | 独立纯函数 (`export function`) | 零副作用、零可变状态、纯输入输出映射 | 统一声明为独立导出纯函数，**严禁将无状态函数硬塞入纯静态工具类**。 |

#### 3. 测试架构硬约束：1:1 绝对物理镜像

- **物理拓扑对齐**：单元测试严格与生产源码拓扑 1:1 镜像对齐（`src/path/to/module.ts` 对应 `test/unit/path/to/module.test.mjs`）。
- **真实源码导入**：单测必须通过 `#src/*` 导入真实生产源码，严禁私有假绿测试副本与中间解构代理。
- **分层立体覆盖**：全量自动化测试（`test/run-all.mjs`）覆盖工具、领域、应用、存储、UI 与 E2E 真实宿主沙箱。

#### 4. 架构防摇摆与深浅模块裁决工程规范 (ADR-004)

为杜绝 AI 助手在多轮扫描中陷入“过度合并为上帝对象”与“过度拆散为碎片”的摆锤震荡，所有重构、合并与抽取必须强制通过以下 5 步客观裁决协议：

1. **测试一：变更节拍与性能热点隔离测试 (Cadence & Hotpath Isolation Test)**：高频只读热点（如每毫秒被 InlayHints / DAP 命中检索的内存投影 `ActiveBreakpointIndex`）与低频写事务（用户交互、磁盘原子落盘 `SceneManager`），**物理强制隔离**。严禁以“减少小文件”为由强行合并。
2. **测试二：依赖层级与框架边界测试 (Dependency Level & Framework Boundary Test)**：直接依赖外部平台 API / 宿主协议（Node `fs`、VS Code API、DAP 协议）的基础设施代码，严禁与纯领域规则、纯应用编排或纯 UI 逻辑混在一个文件。
3. **测试三：充血实体主权与防上帝对象测试 (Sovereign Entity vs. God Object Test)**：领域实体与聚合根（`Scene`、`Breakpoint`、`SceneCatalog`）拥有数据与操作自治主权。管理器专职跨实体生命周期编排，**严禁将实体的业务方法掏空并平铺到外层 Manager 中制造上帝对象**。
4. **测试四：共变性与删除测试 (Co-variation & Deletion Test)**：删除/合并一个模块若未消除固有复杂度，而是导致单文件行数逼近/超过硬门禁（GR-013: 400 行）或圈复杂度剧增（触发 CRAP 立方惩罚），则**拆分完全正当**，严禁逆向合体。
5. **测试五：伪中间人与正当门面判定 (Middleman vs. Legitimate Facade Test)**：无任何参数转换、防御校验或逻辑聚合的**纯空壳透传桩（Hollow Stubs）坚决剔除**，调用方直接对接真实单例；保留具有统一子系统交互与降噪价值的高阶门面。

---

## 业务不变量

| 编号 | 不变量描述 | 检查与保障位置 |
|------|-----------|--------------|
| **INV-001** | **断点场景内局部唯一性 (Upsert)**：同场景中相同文件+行号或函数名仅保留一条记录，后录入安全覆盖先前配置。 | `src/domain/models/scene.ts` (`upsertBreakpoint`) |
| **INV-002** | **场景激活纯净隔离性 (Zero-Flicker Diff)**：激活目标场景时，通过增量 Diff 算法精准移除工作区非目标场景的差量残留断点，原地保留重合断点，杜绝无关断点残留与闪烁。 | `src/infra/vscode/vscodeBreakpointBridge.ts` |
| **INV-003** | **自愈算法置信度门禁与本体守卫**：候选行软相似度 $\ge 70\%$ 且置信度 $\ge 60\%$；严禁跨函数作用域漂移。未达标安全标记为 `unmatched`。 | `src/domain/services/healingEngine.ts` |
| **INV-004** | **权威持久化 SSOT 与状态机投影**：磁盘 `debug-scenes.json` 为跨会话与 AI 协同唯一静态持久化 SSOT；`SceneStateManager` 与 `ActiveBreakpointIndex` 为运行时易失会话状态与活动断点内存投影。 | `src/application/sceneStateManager.ts` 与 `src/application/activeBreakpointIndex.ts` |
| **INV-005** | **场景切换原子防竞态 (Race Guard)**：装载/切换断点期间原子锁 `isApplying` 为 `true`，拦截监听器误置空，杜绝状态栏闪烁。 | `src/infra/vscode/vscodeBreakpointBridge.ts` 与 `breakpointSyncListener.ts` |
| **INV-006** | **防御性输入与容灾守卫**：处理外部配置、非法对象或无工作区模式时，建立类型守卫与空值兜底，严禁未捕获运行时异常。 | `src/domain/services/scenePayloadCodec.ts` 与 `src/infra/storage/jsonFileSceneRepository.ts` |
| **INV-007** | **启动项推导优先级与幂等守卫**：启动推导遵循 `env` > `bindings` > 同名推导；推导结果一致时幂等静默放行。 | `src/domain/services/launchBindingResolver.ts` |
| **INV-008** | **断点全双工同步与防回环 (Echo Loop Guard)**：反向同步受 `markInternalSaving` 守卫保护，阻断死循环；仅同步当前激活态场景。 | `src/infra/storage/echoLoopGuard.ts` 与 `breakpointSyncListener.ts` |
| **INV-009** | **幽灵场景拦截守卫**：目标场景必须在配置中真实存在；未定义场景强行拦截，严禁写盘与清空断点。 | `src/domain/models/sceneCatalog.ts` 与 `src/application/sceneManager.ts` |
| **INV-010** | **单向回写时序与串行化保证**：写盘标记 $\rightarrow$ 磁盘落盘 $\rightarrow$ DAP 装配 $\rightarrow$ 刷新内存投影；应用层受 `SerialQueue` 与 `mutateCatalog` 事务管道串行保护。 | `src/application/mutateCatalog.ts` 与 `src/application/serialQueue.ts` |
| **INV-011** | **多场景合并先到先得**：首个声明的断点生效；`enabled: false` 显式参与去重，后出现的同位置断点直接忽略。 | `src/domain/models/scene.ts` (`Scene.merge`) 与 `src/domain/models/sceneCatalog.ts` |
| **INV-012** | **调试会话保护与拓扑 Diff 防线**：调试进行中外部改动断点挂起调度；核心哈希未变时阻断 DAP 重刷，会话结束补发。 | `src/application/agentSyncService.ts` |
| **INV-013** | **Skill 正文指纹唯一性**：基于剥离 Frontmatter 后纯净正文的标准 SHA-256 (FIPS 180-4) 判定版本（纯 TS 实现 `pureSha256` 已对齐上游 geraintluff/sha256 素数筛上限 313，可与 node:crypto 交叉验证，见 ADR-006）；指纹必须经 `AgentRuleAsset.computeFingerprint()` 领域管线生成，严禁绕过归一化语义直算；覆写前自动生成 `.bak` 备份。 | `src/domain/models/agentRuleAsset.ts` |
| **INV-027** | **冷启动自愈与崩溃隔离守卫 (Disaster Self-Healing Guard)**：物理持久化写入采用动态并发临时文件 (`tmp.${pid}.${ts}.${rand}`) + 原子覆盖 (`renameSync`)；主文件 0 字节或损坏时，优先从合法临时候选副本自愈恢复，严禁中断扩展生命周期。 | `src/infra/storage/atomicFileJsonStore.ts` |
| **INV-028** | **应用事件总线弱耦合守卫 (Application Event Bus Guard)**：领域与应用层数据状态变更、调试暂停、恢复与会话终止统一由 `ApplicationEventBus` 广播事件驱动 UI 响应式自刷新（含 v1.3.0 画布 Live 点亮与命中轨迹累积）；严禁基础设施监听器与命令层跨层强依赖或持有 UI 视图实例。 | `src/application/eventBus.ts` 与 `src/application/debugTraceBuffer.ts` |
| **INV-030** | **场景引用解析不变量 (Scene Reference Resolution)**：① 含引用场景激活必先经 `sceneResolver` 展开为纯断点流，方可进入合并/自愈/DAP 管道（`getSteps(): SceneStep[]` 与 `Breakpoint[]` 类型隔离在编译期强制，禁止绕过收窄点）；② 展开严格保持声明时序（深度优先、按序穿插）；③ 成环必须在任何写盘/DAP 下发前抛 `CircularReferenceError`（携带完整环路径），状态机零中间态、磁盘零污染；④ 悬空引用降级为警告并跳过，不中断其余断点激活；⑤ `enabled: false` 引用整棵子树跳过；⑥ 自愈回写按 `ownerScene`（断点定义场景）路由，同源多引用至多回写一次，引用节点自身永不接收回写；⑦ 引用条目在 codec 清洗往返中保真，非法引用（空 name）清洗阶段丢弃。 | `src/domain/services/sceneResolver.ts` 与 `src/application/sceneActivationPipeline.ts` |
| **INV-031** | **外部编辑指纹冲突显式裁决守卫 (External Edit Fingerprint Conflict Guard)**：外部编辑重锚定断点行号与指纹自愈结论冲突时（门控 = watcher 显式标记 ∨ 磁盘内容相对内部写盘基线漂移，且自愈判定漂移），严禁静默回滚用户行号并回写旧指纹；必须经裁决回调交由用户决策（`disk` 保留磁盘行号并作废旧指纹按磁盘行重提取 / `fingerprint` 维持自愈回滚），用户关闭弹窗缺省磁盘行号优先。裁决回调缺失时维持现状静默自愈（向后兼容）。冷启动必须以磁盘现状播种基线（`seedBaseline`），保证 Git Pull 漂移静默自愈不被误弹窗。 | `src/application/sceneActivationPipeline.ts`（门控与裁决）、`src/infra/storage/echoLoopGuard.ts`（基线播种与漂移判定）、`src/infra/vscode/listeners/configFileWatcherListener.ts`（显式标记） |
| **INV-032** | **分层配置守卫 (Layered Config Guard)**：`.vscode/debug-scenes.json` 为团队公共层（入 Git），`.vscode/debug-scenes.local.json` 为个人私有层（扩展激活时自动幂等写入 `.gitignore`）。读取链路一律返回合并视图（同名场景 local 覆盖 team）；UI 新建场景（手动新建/导出/调用栈固化）缺省落 local 层；`activeScenes` 激活态仅存团队主文件；echoLoopGuard 写盘基线按文件键控隔离（team/local 双基线，默认键向后兼容单文件语义），watcher 同时监听 `debug-scenes*.json` 双文件。 | `src/infra/storage/jsonFileSceneRepository.ts`（分层读写与合并视图）、`src/application/mutateCatalog.ts`（写入路由：新增场景缺省 local）、`src/infra/storage/echoLoopGuard.ts`（键控基线）、`src/extension.ts`（gitignore 引导） |
| **INV-033** | **变量监视求值只读降级守卫 (Watch Evaluation Fail-Safe)**：断点命中触发的 DAP evaluate 请求必须显式声明只读安全上下文（`context: "watch"`）；对外部 DAP 求值施加 300ms 熔断超时（`Promise.race`）；求值超时或异常静默降级为 `<error>`，绝不阻塞断点命中呈现与主调试流程；`watch`/`expected` 字段不纳入上下文指纹计算，确保自愈零漂移。 | `src/infra/vscode/dapWatchEvaluator.ts` 与 `src/infra/vscode/listeners/debugLifecycleListener.ts` |

---

## 工程物理质量硬门禁 (Engineering Guardrails)

> 由 `scripts/verify-guardrails.mjs`、ESLint、c8 覆盖率与 CI/CD 物理绊线自动强制校验，提交与构建时阻断任何退化：

| 门禁代号 | 质量守卫项 | 验证工具与保障机制 | 阻断阈值 / 契约指标 |
|---|---|---|---|
| **GR-001 (INV-014)** | **分发包极致轻量与媒体隔离** | `.vscodeignore` 与验证脚本 | VSIX 体积严格限制在 1.5 MB (1536 KB) 以内（ADR-008：引入 G6 v5 企业级图引擎，保持零生产运行时依赖），README 图片统一外链 CDN |
| **GR-002 (INV-015)** | **CI/CD 原生 Type Stripping 运行环境** | `.github/workflows/*.yml` | 统一锁定 Node 22.x，依托原生 TS Type Stripping 特性 |
| **GR-003 (INV-016)** | **版本发布单一事实来源 (Release SSOT)** | `package.json` 与验证脚本 | `package.json` 的 `version` 是唯一版本 SSOT，与规则及 CHANGELOG 100% 对齐 |
| **GR-004 (INV-017)** | **TypeScript 静态类型健全性硬门禁** | `tsconfig.json` (`tsc --noEmit`) | 全工程源码、单测、沙箱 0 errors、0 warnings |
| **GR-005 (INV-018)** | **国际化多语言与配置占位符对称守卫** | `bundle.l10n.*` 与验证脚本 | 中英文键集 100% 对称；`package.json` 所有 `%key%` 占位符必须在 NLS 中显式声明 |
| **GR-006 (INV-019)** | **KDD 场景断点地图物理保鲜守卫** | `.vscode/debug-scenes.json` 与验证脚本 | 所有声明的源文件必须真实存在，目标行号必须严格落在文件物理行号区间内（v1.1.0 起 `type: "scene"` 引用条目无 file/line 属合法形态，跳过物理校验，仅要求 name 非空） |
| **GR-007 (INV-020)** | **JSON Schema 契约与领域模型同步守卫** | `schema.json` 与验证脚本 | 完整声明断点核心字段（含 `contextSnippet` 指纹等），与领域模型严格同步（v1.1.0 起 items 为 oneOf 双分支：断点分支 + 场景引用分支，引用分支对齐 `SceneRefItem` 且强制 `additionalProperties: false`、`name minLength: 1`） |
| **GR-008 (INV-021)** | **核心代码测试覆盖率硬门禁** | `.c8rc.json` 与测试套件 | 全工程行覆盖率 $\ge 85\%$、函数 $\ge 85\%$、分支 $\ge 75\%$，退化自动阻断提交 |
| **GR-009 (INV-022)** | **VS Code 引擎与 API 版本对齐守卫** | `package.json` 与验证脚本 | `engines.vscode` 与 `@types/vscode` 主次版本严格一致（`1.85.x`），杜绝跨版本 API 缺失 |
| **GR-010 (INV-023)** | **VS Code 命令总线 1:1 双向一致性守卫** | `package.json` 与验证脚本 | 声明的命令与代码实现 1:1 全匹配；快捷键与菜单命令关联 100% 存在，0 悬空命令 |
| **GR-011 (INV-024)** | **严禁空 catch 静默吞错守卫** | 验证脚本 AST 扫描 | 全工程禁止空 `catch {}`，异常必须显式上下文记录或重新抛出，杜绝黑盒故障 |
| **GR-012 (INV-025)** | **Git 冲突标记与私有路径防泄漏守卫** | 验证脚本文本扫描 | 严禁残留冲突标记（`<<<<<<<` 等）或私有绝对路径，确保分发包绝对纯净 |
| **GR-013 (INV-026)** | **ESLint 工业级静态代码规范硬门禁** | `.eslintrc.json` 与验证脚本 | 语法规范与类型安全 0 errors、0 warnings；单文件 $\le 400$ 行 (`max-lines`)，单函数 $\le 80$ 行 (`max-lines-per-function`) AST 物理硬门禁 |
| **GR-014 (INV-029)** | **CRAP 变更风险反模式硬门禁** | `scripts/verify-guardrails.mjs` 与 `compute-crap.mjs` | 全工程平均 CRAP $\le 5.0$；严重反模式函数 ($> 16.4$) 严禁净增；物理阻断 AI 引入高复杂度未测盲区 |


---

## 禁止事项

1. **架构禁止**：领域层严禁依赖宿主 API 或外部 SDK；应用层严禁直接调用宿主 API（必须通过端口抽象）；展示层绝不直接持有业务主状态。
2. **设计禁止**：禁止为未知变化提前设计多层无用抽象（KISS/YAGNI），保持纯原生 TypeScript 敏捷性。
3. **编码禁止**：
   - 严禁空 `catch` 静默吞掉错误；严禁魔法数字。
   - **禁止在 TreeView 中使用 `ThemeIcon`**：强制使用原生高保真矢量 SVG（`vscode.Uri.file`）确保高饱和度不被冲淡变灰。
   - **禁止在断点配置中使用 `type: "conditional"`**：VS Code DAP 契约标准字段为 `"condition"`。
   - **禁止中转站式重导出纯工具**：底层纯工具统一从 `#src/shared/utils/*` 源头导入。
   - **禁止测试代码使用私有镜像副本**：单测必须直接导入生产源码模块，杜绝“假绿”。

---

## 工程与构建约束

- **语言与构建**：TypeScript 5.x 纯原生开发，开启 `strict: true`；基于原生 `esbuild` 极速单文件打包，`main` 指向 `extension.js`，零外部生产运行时依赖。
- **路径与导入规范**：统一使用 Package Subpath Imports（`#src/*` 与 `#test/*`），严禁跨层级 `../*` 相对路径导入。
- **国际化 (i18n)**：所有用户界面文案强制通过 `vscode.l10n.t(...)` 本地化，中英文语言包实时双向对齐。

---

## 变更记录

| 日期 | 变更内容 | 变更人 | 关联变更 |
|------|----------|--------|----------|
| 2026-10-06 | 新增 INV-030 场景引用解析不变量；GR-006/GR-007 适配场景引用条目形态 | GLM-5.3-Flash | v1.1.0 批次5 同步更新 boundaries.md / flows.md / glossary.md / adr/005 / e2e-scenarios.md |
| 2026-10-07 | INV-013 语义精确化为"标准 SHA-256 (FIPS 180-4)"并固化领域管线铁律（pureSha256 转写偏差修复，史表全量重生成） | GLM-5.3-Flash | 同批次 ADR-006 / lessons §6.1 / CHANGELOG 双语 |
| 2026-10-07 | 新增 INV-031 外部编辑指纹冲突显式裁决守卫（冲突弹窗，磁盘行号缺省优先；冷启动基线播种保留 Git Pull 静默自愈） | GLM-5.3-Flash | #TASK-EXT-CONFLICT 同批次 flows.md / glossary.md / lessons / e2e-scenarios.md / CHANGELOG 双语 |
| 2026-10-07 | 新增 INV-032 分层配置守卫（team/local 双层合并视图、新增场景缺省 local、activeScenes 仅主文件、键控防回环基线） | GLM-5.3-Flash | v1.2.0 同批次 boundaries.md / flows.md / glossary.md / e2e-scenarios.md / roadmap / CHANGELOG 双语 |
| 2026-10-07 | INV-028 语义扩展：广播事件覆盖调试暂停、恢复与会话终止（`debug:terminated`，v1.3.0 画布 Live 点亮与命中轨迹驱动），保障位置增补 `debugTraceBuffer` | GLM-5.3-Flash | v1.3.0 批次5 同步更新 boundaries.md / flows.md / glossary.md / e2e-scenarios.md / adr/007 / CHANGELOG 双语 |


