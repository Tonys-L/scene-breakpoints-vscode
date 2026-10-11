# 业务流程与状态机 (Flows & State Machine)

> **TL;DR**: 核心流程：**场景断点激活装配流**（引用展开 → 清理杂散 → 自愈探测 → DAP 装配 → 回写配置 → 驱动视图）、**反向导出流**。核心状态机：**全局场景状态机**（None ↔ Active(SceneName)）。⚠️ 关键状态约束：下发阶段必须全程持有原子执行锁，禁止被断点变更事件打断；场景引用成环必须在任何写盘/DAP 下发前中止（INV-030），磁盘零污染。

---

## 业务流程

### 1. 场景激活与自愈装配主流程

**触发条件**: 
- 用户点击底部状态栏菜单选择场景；
- 在 `.vscode/debug-scenes.json` 中点击 CodeLens `▶ Apply Scene`；
- 在命令面板执行 `sceneBreakpoints.applyScene`；
- `launch.json` 启动前通过 `"env": { "DEBUG_SCENE": "xxx" }` 预先注入。

```mermaid
flowchart TD
    Start([开始激活场景]) --> CheckConfig[从 debug-scenes.json 读取目标场景列表]
    CheckConfig --> ValidateExist{场景在配置中是否存在?}
    ValidateExist -->|全部不存在| ShowError[弹出错误提示并中止 (幽灵拦截 INV-009)]
    ValidateExist -->|有效场景列表| ExpandRefs[sceneResolver.expandScenes 深度优先展开场景引用 (INV-030)]
    ExpandRefs --> CycleHit{引用成环?}
    CycleHit -->|是| AbortCycle[抛出 CircularReferenceError 中止激活 (携带完整环路径, 状态机零污染)]
    CycleHit -->|否| RefWarn{存在悬空或禁用引用?}
    RefWarn -->|是| SkipRefs[降级警告并跳过对应引用子树 (不阻断其余断点)]
    RefWarn -->|否| MergeBps[Scene.merge 聚合多场景断点 (先到先得排重 INV-011)]
    SkipRefs --> MergeBps
    AbortCycle --> EndAbort([激活中止, 磁盘零污染])

    MergeBps --> HealPipeline[执行前置自愈与指纹补齐管道 (enrichAndHealBreakpoints)]
    HealPipeline --> FastPath{快路径: 当前代码行文本完全一致?}
    FastPath -->|是| Matched[状态标记为 matched (原行号保持)]
    FastPath -->|否| Phase1[阶段一: 原址双向滑动窗口辐射探测 ±30 行]

    Phase1 --> Phase1Pass{软相似度 >= 70% 且 动态置信度 >= 60%?}
    Phase1Pass -->|是| Healed1[状态标记为 healed (校准行号)]
    Phase1Pass -->|否| Phase2[阶段二: 作用域巡航大跨度重锚定 (最大 150 行)]

    Phase2 --> Phase2Pass{作用域内存在本体特征 且 置信度 >= 60%?}
    Phase2Pass -->|是| Healed2[状态标记为 healed (校准行号)]
    Phase2Pass -->|否| Unmatched[安全标记为 unmatched (脱靶保持原行号)]

    Unmatched --> WarnState[向状态机登记脱靶失联警告 (sceneStateManager.setUnmatchedBreakpoints)]
    Matched --> CheckActiveDisk
    Healed1 --> CheckActiveDisk
    Healed2 --> CheckActiveDisk
    WarnState --> CheckActiveDisk

    CheckActiveDisk{activeScenes 是否改变?}
    CheckActiveDisk -->|改变| SaveActive[权威 SSOT 优先落盘 (INV-010)]
    CheckActiveDisk -->|未变| ApplyDiff
    SaveActive --> ApplyDiff

    ApplyDiff[调度 breakpointBridge.applySceneBreakpoints (INV-002, INV-005)]
    ApplyDiff --> SetLock[加持原子锁 withApplyingLock (isApplying = true)]
    SetLock --> CalcDiff[computeDapDiff 计算工作区断点与目标拓扑差量]
    CalcDiff --> DiffExec[原地 0 闪烁装配: removeBreakpoints(toRemove) + addBreakpoints(toAdd)]
    DiffExec --> ReleaseLock[释放原子锁 isApplying = false]

    ReleaseLock --> UpdateState[更新会话状态机 sceneStateManager.setActiveScenes]
    UpdateState --> CheckHealedSave{healedCount > 0 或 enrichedCount > 0?}
    CheckHealedSave -->|是| BackfillSave[回填自愈校准行号与伴随指纹并持久化落盘]
    CheckHealedSave -->|否| EmitBus
    BackfillSave --> EmitBus

    EmitBus[appEventBus.emit 广播 scene:activated 事件]
    EmitBus --> RenderUI[驱动 TreeView、StatusBar 与 InlayHints 响应式自刷新]
    RenderUI --> End([激活与装配完成])
```

---

### 2. 反向批量导出流程

**触发条件**: 在状态栏菜单选择 `Export Active Breakpoints as Scene...` 或右键执行导出命令。

```mermaid
flowchart TD
    A[执行 Export 命令] --> B{编辑器中是否存在断点?}
    B -->|否| Warn[提示先设置断点并终止]
    B -->|是| InputName[弹出 InputBox 输入新场景名称]
    InputName --> Traverse[遍历当前 vscode.debug.breakpoints]
    Traverse --> Snippet[打开源文件提取上下三行 contextSnippet 指纹]
    Snippet --> CheckExist{该场景是否已存在?}
    CheckExist -->|是| PromptChoice[提示用户: 覆盖还是追加?]
    CheckExist -->|否| WriteNew[新建场景条目]
    PromptChoice --> WriteNew
    WriteNew --> Save[调用 saveScenesConfig 写入 debug-scenes.json]
    Save --> UpdateActive[调用 sceneStateManager.setActiveScenes([sceneName]) 更新激活态]
    UpdateActive --> Done([导出完成])
```

---

### 3. 外部编辑与指纹自愈冲突裁决流程 (INV-031)

**触发条件**：
- 外部修改 `.vscode/debug-scenes.json` 重锚定断点行号后触发激活（watcher 路径：文件监听 → `handleExternalChange` → `activateScene`，显式携带 `conflictDetection: "enabled"` 标记）；
- 命令路径手动激活时磁盘内容相对扩展最近一次内部写盘基线发生漂移（`isExternalPendingEdit` 门控信号）。

```mermaid
flowchart TD
    Start([激活管道进入自愈探测]) --> Gate{冲突门控开启? watcher 显式标记 或 磁盘漂移信号}
    Gate -->|否| SilentHeal[静默自愈回滚, 零打扰<br>Git Pull 漂移保护锚定]
    Gate -->|是| Healed{自愈判定行号漂移? isHealed = true}
    Healed -->|否| NoDrift[行号未漂移, 零打扰放行]
    Healed -->|是| Resolver{裁决回调存在?}
    Resolver -->|否| Legacy[维持现状静默自愈<br>向后兼容, 测试注入用]
    Resolver -->|是| Prompt[弹窗裁决: 保留我编辑的行 / 自动自愈至指纹行]
    Prompt -->|用户选择自愈| FP["fingerprint: 回滚至指纹匹配行 (现状语义)"]
    Prompt -->|选择保留 / 直接关闭弹窗| Disk["disk (缺省): 保留磁盘声明行号<br>作废旧指纹 → 按磁盘行重提取"]
    Disk --> Reenrich[enrichedCount 计入 → 随既有溯源回写落盘<br>用户行号 + 新指纹持久化]
    SilentHeal --> EndDone([激活继续])
    NoDrift --> EndDone
    Legacy --> EndDone
    FP --> EndDone
    Reenrich --> EndDone
```

**关键约束**：
- 冷启动（扩展激活最前）必须以磁盘现状播种 `echoLoopGuard` 基线，保证 Git Pull / 环境漂移静默自愈不被误弹窗；
- watcher 路径必须显式下发标记：`autoEnrichEmptyFingerprints` 先行落盘会刷新 `lastSavedContent` 基线"洗白"磁盘漂移信号，仅凭漂移判定会失真；
- 磁盘优先裁决的落盘复用既有 `persistHealedBackfill` 溯源回写通道（重提取计入 `enrichedCount`），不新增写盘路径。

---

### 4. 调用栈一键固化流程 (Capture Call Stack, v1.2.0)

**触发条件**：调试器暂停（`stopped` 事件登记捕获上下文）后，用户在编辑器右键菜单或命令面板执行 `sceneBreakpoints.captureCallStack`。

```mermaid
flowchart TD
    Start([DAP stopped 事件]) --> Register[debugLifecycleListener 登记捕获上下文 session + threadId]
    Register --> Cmd[用户执行 captureCallStack 命令]
    Cmd --> Paused{捕获上下文存在?}
    Paused -->|否| InfoPause[info 提示仅在暂停态可用并终止]
    Paused -->|是| Root{工作区存在?}
    Root -->|否| WarnRoot[警告并终止]
    Root -->|是| Stack["customRequest(stackTrace) 读取堆栈帧 (≤ 20)"]
    Stack --> Filter[过滤: 无 source / 工作区外 / 行号非法; 同 file+line 去重]
    Filter --> Empty{存在可固化帧?}
    Empty -->|否| WarnEmpty[warning 提示并终止]
    Empty -->|是| Input[InputBox 输入场景名; 取消则零写盘]
    Input --> Save["importScene append-upsert (INV-001)<br>新场景缺省落 local 私有层 (INV-032)"]
    Save --> Notify[成功通知固化帧数与场景名]
    Resumed([continued / terminated 事件]) --> Clear[即刻清除捕获上下文, 杜绝陈旧堆栈]
```

**关键约束**：
- 捕获上下文状态实体存于应用层 `debugPauseContext`（`ui → application ← infra` 依赖方向合规），infra 监听器仅在 DAP 事件驱动下写入/清除；
- 堆栈帧固化复用既有 `importScene` 串行管道，零新增写盘路径；帧名沉淀为断点描述，指纹经既有 `extractContextSnippet` 管线提取。

---

### 5. 可视化画布事件驱动刷新流程 (Visual Graph Canvas, v1.3.0)

**触发条件**：用户执行 `sceneBreakpoints.showGraph`（命令面板 / 状态栏菜单 / 树视图场景节点右键）打开画布；此后由 `ApplicationEventBus` 调试事件与场景状态事件驱动响应式刷新（INV-028）。

```mermaid
flowchart TD
    Open([用户执行 showGraph]) --> Create[graphCanvasController 创建 WebviewPanel]
    Create --> Ready["webview 就绪 (ready)"]
    Ready --> Render["buildGraphSnapshot 只读投影 → render 全量渲染<br>含 getRecords() 轨迹全量回放"]
    PausedEvt([appEventBus debug:paused]) --> Dual{面板已打开?}
    Dual -->|是| Pulse["live-pulse + trace-append 同事件双消费<br>nodeId 经 createNodeIdResolver 匹配 (未匹配记 null)"]
    Dual -->|否| BufOnly[debugTraceBuffer 后台独立累积]
    ResumedEvt([debug:resumed]) --> ClearLive[live-clear 熄灭脉冲, 轨迹保留]
    TermEvt([debug:terminated]) --> TraceClear["trace-clear 全量清空 (buffer.clear())"]
    SceneEvt([scenes:changed / scene:activated]) --> Rebuild{面板已打开?}
    Rebuild -->|是| ReRender[重建快照 → render, 轨迹保留]
    Rebuild -->|否| Noop[零开销: 无面板即无渲染]
    Click([用户点击节点 / 轨迹标记]) --> OpenSrc["open-source → findNodeById 命中 {file, line}<br>revealRange(Center) + 一次性装饰高亮"]
    Close([用户关闭面板]) --> Dispose[dispose 成对退订事件, 置空面板引用]
    BufOnly --> EndX([轨迹由 debugTraceBuffer 独立持有])
    Pulse --> EndX
    ClearLive --> EndX
    TraceClear --> EndX
    ReRender --> EndX
    OpenSrc --> EndX
    Dispose --> EndX
```

**关键约束**：
- 快照与轨迹缓存均为只读投影，不构成业务主状态（INV-028）；画布零实体回写、零新增持久化路径；
- `debugTraceBuffer` 订阅/退订随 `init()`/`dispose()` 成对（控制器打开面板时 init、扩展卸载时 dispose），轨迹会话级易失；
- nodeId 匹配经 `createNodeIdResolver` 单点权威，快照 id（`{ownerScene}#{index}`）稳定性保证场景变更后轨迹重映射不漂移；
- 场景合并读取经 `sceneManager.loadMergedCatalog` 分层门面（UI → application 合规，规避 UI→infra 违规）。

- **节点交互模型（防焦点夺取）**：节点由原单击直接跳转重构为渐进披露交互：单击高亮选中节点上下文（`selectedNodeId`），双击或点击卡片右上角直达按钮（`[↗]`）触发 `open-source` 跳转源码，杜绝宏观浏览时的焦点夺取；
- **原生矢量图标**：全量采用 VS Code 设计系统原生高精矢量 SVG 图标（Line/Cond/Log/Hit/Func/Ref/Warning/OpenExternal/Zap），彻底消除 Emoji 视觉噪音与平台不一致性；
- **伴随分屏模式与跨分屏跳转（消灭视图割裂）**：
  - 画布创建（`resolveCanvasColumn`）：若当前存在活动代码编辑器，优先在右侧分屏（`ViewColumn.Beside`）打开，天然形成左侧代码编辑、右侧架构拓扑的并排伴随视图；
  - 源码跳转（`resolveTargetSourceColumn`）：画布位于右侧分屏时，跳转源码始终在左侧主屏（`ViewColumn.One`）呈现；画布位于主屏时，在右侧分屏呈现。代码与画布永不共占同一编辑器组，彻底消除“点击跳转后画布被代码挤掉/覆盖”的割裂感；
- **纯原生 HTML5 Canvas 鹰眼小地图 (Minimap)**：右下角提供轻量小地图，实时双向映射主画布节点拓扑与视口选框（Viewfinder），支持点击与拖拽快速定位，可一键展开/折叠（零外部运行时依赖，GR-001 合规）；
- **视口缩放与跟手度调优**：优化 Cytoscape `wheelSensitivity: 0.8`（消除滚轮卡顿感），提供悬浮缩放控制栏（`+` / `−` / `⤢ 适配全屏` / `1:1`），并支持双击画布空白处自动全屏居中复位；
- **常驻快捷入口**：侧边栏 `Scene Breakpoints` 视图标题栏常驻 `$(workflow)` 图标（`view/title navigation@0`），一键直达画布。

**场景下拉选择器 (Scene Selector, #SCENE-SELECTOR)**：
- 画布顶部场景紧凑下拉选择器（`SceneSelector` Combobox + Popover 交互模型，收纳于 `TabBar`）：数据源 `snapshot.availableScenes`，彻底消除场景增多时的横向滚动条；
- **状态分组与检索**：支持场景名称实时模糊搜索，区分“● 激活中”与“○ 预览中”状态分组；支持单选快速聚焦、多选对比以及“仅看激活场景/查看全部”快捷过滤；
- **画布内闭环激活**：当选中的单场景未激活时，TabBar 显式呈现 `[⚡ 激活此场景]` 快捷按钮，触发 `activate-scene` 驱动宿主 `sceneBreakpoints.applyScene` 并下发断点到调试器；
- **"看什么"与"什么在生效"正交解耦**：`visibleScenes`（用户选择，缺省 = 激活集）× `registered`（ownerScene ∈ activeScenes，纯推导标注）；未激活场景节点/泳道以未激活态渲染（半透明 + 角标），Live 脉冲/轨迹天然只命中已登记节点；
- 展开失败场景（成环）→ 警告泳道（`expandError` 列出环路径），同批其他可见场景互不拖垮（逐场景隔离展开降级）；
- Scope 为纯视图状态：panel 生命周期内保持，面板关闭重置为跟随激活集；Mermaid 导出经 `controller.getVisibleScenes()` 对齐所见即所得。

---

## 状态机

### 全局场景激活状态机 (Scene State Machine)

**初始状态**: `None`（未激活任何场景）

```mermaid
stateDiagram-v2
    [*] --> None: 插件初始化
    None --> Active_Clean: 激活场景 (applyScene / exportScene)
    Active_Clean --> Active_Dirty: 用户在编辑器中手动添加/删除临时断点
    Active_Dirty --> Active_Clean: 追加保存到当前场景 (exportScene / applyScene时追加)
    Active_Dirty --> Active_Clean: 放弃临时断点并重新装载场景
    Active_Clean --> Active_Clean: 切换到另一个场景 (applyScene)
    Active_Dirty --> Active_Clean: 经用户确认后切换到另一个场景
    Active_Clean --> None: 用户清空所有断点 (clearAll 或手动全部删除)
    Active_Dirty --> None: 用户清空所有断点
    None --> [*]
```

### 状态说明

| 状态 | 含义 | 状态栏显示 | 允许的操作 |
|------|------|------------|------------|
| `None` | 工作区未锁定任何场景断点 | `⚪ Scene: (None)` | 激活场景、导出断点、打开配置 |
| `Active(Clean)` | 当前工作区断点与指定场景 100% 同步 | `🟢 Scene: [sceneName]` | 切换场景、追加断点、清空断点、导出更新 |
| `Active(Dirty)` | 当前工作区存在未保存到场景的临时断点 | `🟢 Scene: [sceneName*]` (醒目橙黄) | 切换前保护弹窗（追加保存/放弃/取消）、导出更新、清空 |

### 转换规则

| 当前状态 | 目标状态 | 触发事件 | 副作用 |
|----------|----------|----------|--------|
| `None` | `Active(Clean)` | 成功执行 `applyScene(A)` 或 `exportScene(A)` | 记录基线断点数，广播 `onDidChangeState`，状态栏变绿 |
| `Active(Clean)` | `Active(Dirty)` | 用户手动在编辑器增删临时断点 | 广播 `isDirty: true`，状态栏变橙黄色并增加星号 `*` |
| `Active(Dirty)` | `Active(Clean)` | 执行重新激活并选择“放弃”或“追加保存” | 同步持久化（若选追加），重置基线断点数，复位星号 |
| `Active(Dirty)` | `Active(B)` | 切换到场景 B 并在弹窗中选择放弃或保存 | 保护用户临时断点，切换到目标场景 B |
| `Active(*)` | `None` | 执行 `clearAll` 或编辑器内原生断点数归零（非下发中） | 广播 `activeScene: undefined`，状态栏复位为灰色 (None) |

### 禁止的转换

| 当前状态 | 目标状态 | 禁止原因 | 防护手段 |
|----------|----------|----------|----------|
| `Active(A)` 切换中 | `None` (瞬态) | 在下发场景断点清除旧断点期间，严禁向外暴露未激活状态 | `sceneStateManager.isApplying` 原子锁保护 |
| `Active(Dirty)` | `Active(B)` (无提示直接清除) | 严禁在未询问用户意愿的前提下直接暴力清除用户手动打下的临时断点 | `applySceneCommand` 模态保护弹窗（放弃/追加保存/取消） |
| `None` / 任意状态 | `Active(不存在场景)` | 严禁将 `debug-scenes.json` 中不存在的幽灵场景设为主状态，防止状态栏虚假染绿与断点误清空 | `applySceneCommand` 存在性强校验守卫与 `LaunchBindingResolver.resolveScenes` 防御性过滤 |

---

## 变更记录

| 日期 | 变更内容 | 变更人 | 关联变更 |
|------|----------|--------|----------|
| 2026-10-06 | 场景激活主流程新增 expandScenes 引用展开步骤与成环中止/悬空禁用降级分支（INV-030） | GLM-5.3-Flash | v1.1.0 批次5 同步更新 constraints.md / boundaries.md / glossary.md / adr/005 / e2e-scenarios.md |
| 2026-10-07 | 新增「外部编辑与指纹自愈冲突裁决流程」（INV-031）：门控判定、弹窗裁决与磁盘优先缺省语义 | GLM-5.3-Flash | #TASK-EXT-CONFLICT 同批次 constraints.md / glossary.md / lessons / e2e-scenarios.md / CHANGELOG 双语 |
| 2026-10-07 | 新增「调用栈一键固化流程」（v1.2.0 Capture Call Stack）：DAP 暂停登记捕获上下文、堆栈过滤去重与 local 层固化 | GLM-5.3-Flash | v1.2.0 同批次 constraints.md / boundaries.md / glossary.md / e2e-scenarios.md / roadmap / CHANGELOG 双语 |
| 2026-10-07 | 新增「可视化画布事件驱动刷新流程」（v1.3.0 Visual Graph Canvas）：ready→render、paused 双消费、terminated 清空与面板生命周期订阅成对 | GLM-5.3-Flash | v1.3.0 批次5 同步更新 constraints.md / boundaries.md / glossary.md / e2e-scenarios.md / adr/007 / CHANGELOG 双语 |
| 2026-10-07 | 画布流程新增「场景范围选择器 (Scope Selector)」：set-scope 协议分支、visibleScenes/activeScenes 正交解耦与成环警告泳道降级 | GLM-5.3-Flash | #SCOPE-SELECTOR 同步更新 boundaries.md / glossary.md / e2e-scenarios.md / 设计文档 R5 / CHANGELOG 双语 |

