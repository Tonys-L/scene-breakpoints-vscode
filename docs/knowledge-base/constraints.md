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
| **Service（服务）** | **面向无状态流程/跨模块协同**（算法计算、外部管道流） | 1. 负责跨多个模块的无状态工作流、算法管道或外部输入同步<br>2. 不私有独占实体数据主权，纯以输入参数驱动处理 | `AgentSyncService`<br>`HashService`<br>`HealingEngine` |

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
│   └── (sceneManager: 场景CRUD, breakpointManager: 断点管理, agentSyncService: AI/Diff协同, sceneStateManager: 会话状态机)
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

---

## 业务不变量

| 编号 | 不变量描述 | 检查与保障位置 |
|------|-----------|--------------|
| **INV-001** | **断点场景内局部唯一性 (Upsert)**：同场景中相同文件+行号或函数名仅保留一条记录，后录入安全覆盖先前配置。 | `src/domain/models/scene.ts` (`upsertBreakpoint`) |
| **INV-002** | **场景激活纯净隔离性 (Zero-Flicker Diff)**：激活目标场景时，通过增量 Diff 算法精准移除工作区非目标场景的差量残留断点，原地保留重合断点，杜绝无关断点残留与闪烁。 | `src/infra/vscode/bridge/dapDiffApplier.ts` |
| **INV-003** | **自愈算法置信度门禁与本体守卫**：候选行软相似度 $\ge 70\%$ 且置信度 $\ge 60\%$；严禁跨函数作用域漂移。未达标安全标记为 `unmatched`。 | `src/domain/services/healingEngine.ts` |
| **INV-004** | **权威持久化 SSOT 与状态机投影**：磁盘 `debug-scenes.json` 为跨会话与 AI 协同唯一静态持久化 SSOT；`SceneStateManager` 为运行时易失会话状态管理中心（内存投影）。 | `src/application/sceneStateManager.ts` |
| **INV-005** | **场景切换原子防竞态 (Race Guard)**：装载/切换断点期间原子锁 `isApplying` 为 `true`，拦截监听器误置空，杜绝状态栏闪烁。 | `src/infra/vscode/bridge/dapHelpers.ts` 与 `breakpointSyncListener.ts` |
| **INV-006** | **防御性输入与容灾守卫**：处理外部配置、非法对象或无工作区模式时，建立类型守卫与空值兜底，严禁未捕获运行时异常。 | `src/infra/storage/jsonFileSceneRepository.ts` |
| **INV-007** | **启动项推导优先级与幂等守卫**：启动推导遵循 `env` > `bindings` > 同名推导；推导结果一致时幂等静默放行。 | `src/domain/services/launchBindingResolver.ts` |
| **INV-008** | **断点全双工同步与防回环 (Echo Loop Guard)**：反向同步受 `markInternalSaving` 守卫保护，阻断死循环；仅同步当前激活态场景。 | `src/infra/storage/echoLoopGuard.ts` 与 `breakpointSyncListener.ts` |
| **INV-009** | **幽灵场景拦截守卫**：目标场景必须在配置中真实存在；未定义场景强行拦截，严禁写盘与清空断点。 | `src/domain/models/sceneCatalog.ts` 与 `src/application/sceneManager.ts` |
| **INV-010** | **单向回写时序与串行化保证**：写盘标记 $\rightarrow$ 磁盘落盘 $\rightarrow$ DAP 装配 $\rightarrow$ 刷新内存投影；应用层受 `SerialQueue` 串行保护。 | `src/application/sceneManager.ts` 与 `src/application/serialQueue.ts` |
| **INV-011** | **多场景合并先到先得**：首个声明的断点生效；`enabled: false` 显式参与去重，后出现的同位置断点直接忽略。 | `src/domain/models/scene.ts` (`Scene.merge`) 与 `src/domain/models/sceneCatalog.ts` |
| **INV-012** | **调试会话保护与拓扑 Diff 防线**：调试进行中外部改动断点挂起调度；核心哈希未变时阻断 DAP 重刷，会话结束补发。 | `src/application/agentSyncService.ts` |
| **INV-013** | **Skill 正文指纹唯一性**：基于剥离 Frontmatter 后的纯净正文 SHA-256 判定版本；覆写前自动生成 `.bak` 备份。 | `src/domain/models/agentRuleAsset.ts` |
| **INV-027** | **冷启动自愈与崩溃隔离守卫 (Disaster Self-Healing Guard)**：物理持久化写入采用动态并发临时文件 (`tmp.${pid}.${ts}.${rand}`) + 原子覆盖 (`renameSync`)；主文件 0 字节或损坏时，优先从合法临时候选副本自愈恢复，严禁中断扩展生命周期。 | `src/infra/storage/atomicFileJsonStore.ts` |
| **INV-028** | **应用事件总线弱耦合守卫 (Application Event Bus Guard)**：领域与应用层数据状态变更统一由 `ApplicationEventBus` 广播事件驱动 UI 响应式自刷新；禁止命令层跨模块强依赖视图的内部私有刷新方法。 | `src/application/eventBus.ts` |

---

## 工程物理质量硬门禁 (Engineering Guardrails)

> 由 `scripts/verify-guardrails.mjs`、ESLint、c8 覆盖率与 CI/CD 物理绊线自动强制校验，提交与构建时阻断任何退化：

| 门禁代号 | 质量守卫项 | 验证工具与保障机制 | 阻断阈值 / 契约指标 |
|---|---|---|---|
| **GR-001 (INV-014)** | **分发包极致轻量与媒体隔离** | `.vscodeignore` 与验证脚本 | VSIX 体积严格限制在 500 KB 以内（当前约 130 KB），README 图片统一外链 CDN |
| **GR-002 (INV-015)** | **CI/CD 原生 Type Stripping 运行环境** | `.github/workflows/*.yml` | 统一锁定 Node 22.x，依托原生 TS Type Stripping 特性 |
| **GR-003 (INV-016)** | **版本发布单一事实来源 (Release SSOT)** | `package.json` 与验证脚本 | `package.json` 的 `version` 是唯一版本 SSOT，与规则及 CHANGELOG 100% 对齐 |
| **GR-004 (INV-017)** | **TypeScript 静态类型健全性硬门禁** | `tsconfig.json` (`tsc --noEmit`) | 全工程源码、单测、沙箱 0 errors、0 warnings |
| **GR-005 (INV-018)** | **国际化多语言与配置占位符对称守卫** | `bundle.l10n.*` 与验证脚本 | 中英文键集 100% 对称；`package.json` 所有 `%key%` 占位符必须在 NLS 中显式声明 |
| **GR-006 (INV-019)** | **KDD 场景断点地图物理保鲜守卫** | `.vscode/debug-scenes.json` 与验证脚本 | 所有声明的源文件必须真实存在，目标行号必须严格落在文件物理行号区间内 |
| **GR-007 (INV-020)** | **JSON Schema 契约与领域模型同步守卫** | `schema.json` 与验证脚本 | 完整声明断点核心字段（含 `contextSnippet` 指纹等），与领域模型严格同步 |
| **GR-008 (INV-021)** | **核心代码测试覆盖率硬门禁** | `.c8rc.json` 与测试套件 | 全工程行覆盖率 $\ge 85\%$、函数 $\ge 85\%$、分支 $\ge 75\%$，退化自动阻断提交 |
| **GR-009 (INV-022)** | **VS Code 引擎与 API 版本对齐守卫** | `package.json` 与验证脚本 | `engines.vscode` 与 `@types/vscode` 主次版本严格一致（`1.85.x`），杜绝跨版本 API 缺失 |
| **GR-010 (INV-023)** | **VS Code 命令总线 1:1 双向一致性守卫** | `package.json` 与验证脚本 | 声明的命令与代码实现 1:1 全匹配；快捷键与菜单命令关联 100% 存在，0 悬空命令 |
| **GR-011 (INV-024)** | **严禁空 catch 静默吞错守卫** | 验证脚本 AST 扫描 | 全工程禁止空 `catch {}`，异常必须显式上下文记录或重新抛出，杜绝黑盒故障 |
| **GR-012 (INV-025)** | **Git 冲突标记与私有路径防泄漏守卫** | 验证脚本文本扫描 | 严禁残留冲突标记（`<<<<<<<` 等）或私有绝对路径，确保分发包绝对纯净 |
| **GR-013 (INV-026)** | **ESLint 工业级静态代码规范硬门禁** | `.eslintrc.json` 与验证脚本 | 语法规范与类型安全 0 errors、0 warnings；单文件 $\le 400$ 行 (`max-lines`)，单函数 $\le 80$ 行 (`max-lines-per-function`) AST 物理硬门禁 |

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


