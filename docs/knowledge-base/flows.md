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

