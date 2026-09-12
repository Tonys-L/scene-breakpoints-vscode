# 端到端测试全量场景规范 (E2E Test Scenarios)

> ⚠️ **核心质量基线**：本文档是 Scene Breakpoints 插件的端到端（E2E）测试唯一事实来源（SSOT）。
> **铁律**：后续任何新增业务能力、修改现有功能、重构交互命令或调整 UI 时，**必须同步在本文档中更新用例规范，并同步在 `test-e2e/suite/` 编写对应自动化测试用例**。未经 E2E 验证的功能禁止合并发布。

---

## 目录

- [1. 测试环境与架构体系](#1-测试环境与架构体系)
- [2. 全量 34 大 E2E 测试场景矩阵](#2-全量-34-大-e2e-测试场景矩阵)
  - [维度一：DAP 原生断点装配与运行时生命周期 (TC-DAP)](#维度一dap-原生断点装配与运行时生命周期-tc-dap)
  - [维度二：多场景选择、叠加激活与动态组合 (TC-MUL)](#维度二多场景选择叠加激活与动态组合-tc-mul)
  - [维度三：调试侧边栏 TreeView 视口与全按钮交互 (TC-TREE)](#维度三调试侧边栏-treeview-视口与全按钮交互-tc-tree)
  - [维度四：底部常驻状态栏 StatusBarItem 响应式渲染 (TC-STAT)](#维度四底部常驻状态栏-statusbaritem-响应式渲染-tc-stat)
  - [维度五：配置文件 CodeLens 行内交互 (TC-LENS)](#维度五配置文件-codelens-行内交互-tc-lens)
  - [维度六：场景反向导出与剪贴板防御性流转 (TC-CLIP)](#维度六场景反向导出与剪贴板防御性流转-tc-clip)
  - [维度七：代码自愈持久化闭环与脱靶失联告警 (TC-HEAL)](#维度七代码自愈持久化闭环与脱靶失联告警-tc-heal)
  - [维度八：AI 声明式免 MCP 编排与文件监听协同 (TC-AI)](#维度八ai-声明式免-mcp-编排与文件监听协同-tc-ai)
  - [维度九：调试生命周期联动与会话保护 (TC-SESS)](#维度九调试生命周期联动与会话保护-tc-sess)
  - [维度十：配置项开关与无工作区防御性守卫 (TC-CONF)](#维度十配置项开关与无工作区防御性守卫-tc-conf)
- [3. 用例维护与演进规范](#3-用例维护与演进规范)
- [4. 变更记录](#4-变更记录)

---

## 1. 测试环境与架构体系

| 属性 | 规范要求 |
| :--- | :--- |
| **测试驱动器** | `@vscode/test-electron`（拉取无污染的独立官方 VS Code 隔离实例） |
| **测试运行器** | `mocha` (TDD 模式) |
| **测试沙箱** | `test-fixtures/sample-workspace`（完全与开发环境隔离） |
| **执行命令** | `npm run test:e2e`（先编译扩展与测试套件，后在沙箱中拉起运行） |
| **套件目录** | `test-e2e/suite/*.test.ts` |

---

## 2. 全量 34 大 E2E 测试场景矩阵

### 维度一：DAP 原生断点装配与运行时生命周期 (TC-DAP)

| 编号 | 场景名称 | 操作与触发步骤 | 预期断言与验证要求 | 关联约束 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-DAP-01** | **5 类断点真实注入** | 调用 `sceneBreakpoints.applyScene` 激活包含 5 类断点的场景 | `vscode.debug.breakpoints` 中真实注入：普通行断点、条件断点（`condition`）、命中计数断点（`hitCondition`）、日志断点（`logMessage`）、函数断点（`functionName`） | INV-002 |
| **TC-DAP-02** | **全局清空断点** | 调用 `sceneBreakpoints.clearAll` | DAP 真实断点全部卸载（length 为 0），状态栏复位为 `(None)`，树视图高亮复位 | INV-002 |
| **TC-DAP-03** | **增量 Diff 装配与 0 闪烁** | 从场景 A 切换至包含共有断点的 `[A, B]` | 共有且属性一致的断点对象原地保留（无 delete $\rightarrow$ add 抖动），仅增删差量断点 | KDD-DAP-DIFF-001 |
| **TC-DAP-04** | **当前行快捷添加断点** | 光标置于源码某行，执行 `sceneBreakpoints.addBreakpoint` (`Ctrl+Alt+B`) | 立即在当前激活场景中增加断点并点亮 DAP 红点，自动回写 JSON 并提取代码指纹，状态机总数自增 | KDD-ARCH-002 |

---

### 维度二：多场景选择、叠加激活与动态组合 (TC-MUL)

| 编号 | 场景名称 | 操作与触发步骤 | 预期断言与验证要求 | 关联约束 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-MUL-01** | **多场景正向叠加激活** | 依次激活场景 A 和场景 B（或传入数组 `["A", "B"]`） | 状态机 `activeScenes` 集合为 `[A, B]`，DAP 断点为两场景断点去重并集 | INV-004 |
| **TC-MUL-02** | **多场景动态单点剔除** | 当前激活 `[A, B]`，调用场景 A 上的 `toggleSceneActivation` | 场景 A 断点被从 DAP 卸载，保留场景 B 断点，状态机平滑降级为 `[B]` | KDD-MULTI-ACTIVATE-001 |
| **TC-MUL-03** | **多场景取消复位清空** | 当前激活 `[B]`，再次调用场景 B 上的 `toggleSceneActivation` | 全部场景取消激活，状态机复位为 `(None)`，DAP 彻底卸载断点 | KDD-MULTI-ACTIVATE-001 |
| **TC-MUL-04** | **冲突断点先到先得与 enabled 覆盖** | 场景 A 声明行 3 禁用 (`enabled: false`)，场景 B 声明行 3 启用 | 激活 `[A, B]` 时保留 A 的禁用状态；激活 `[B, A]` 时保留 B 的启用状态（严格首发声明胜出） | INV-001<br>INV-011 |
| **TC-MUL-05** | **多场景状态栏自适应折叠** | 叠加激活 3 个及以上长名称场景 | 总字符 $\le 28$ 完整展示 `[a + b + c]`；超长时折叠为 `[a + b, +1]`，Tooltip 保留全名列表 | KDD-MULTI-ACTIVATE-001 |

---

### 维度三：调试侧边栏 TreeView 视口与全按钮交互 (TC-TREE)

| 编号 | 场景名称 | 操作与触发步骤 | 预期断言与验证要求 | 关联约束 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-TREE-01** | **切换调试面板与聚焦视图** | 执行 `workbench.view.debug` 并聚焦 `sceneBreakpointsView` | 侧边栏平滑切换至调试视图容器，`sceneBreakpointsView` 展现并获取焦点 | KDD-TREEVIEW-001 |
| **TC-TREE-02** | **场景根节点渲染与展开状态** | 激活场景后获取树视图根节点 | 正确列出场景节点，展示断点计数，激活场景 `contextValue = "activeSceneItem"` 且默认展开 | KDD-TREE-002 |
| **TC-TREE-03** | **断点叶子节点与 16x16 矢量 SVG** | 获取场景下的断点子节点 | 格式化展示行号与条件/说明；图标采用标准 16x16 矢量 SVG，永不被 VS Code 冲刷变灰 | KDD-UI-003 |
| **TC-TREE-04** | **单点断点跳转源码并高亮选中** | 触发断点节点的 `command` (`vscode.open`) | 编辑器成功打开目标文件，光标选区范围精确落在该断点物理行号 | KDD-TREEVIEW-001 |
| **TC-TREE-05** | **原生 Checkbox 勾选全双工同步** | 触发 `checkboxChangeListener` 切换断点复选框 | 断点状态在树节点（checked/unchecked）、DAP 与 JSON 配置中三向毫秒级同步 | KDD-SYNC-001 |
| **TC-TREE-06** | **标题栏按钮：新建场景** | 执行 `sceneBreakpoints.createNewScene` | 创建新场景空容器，树视图即刻出现新场景节点 | KDD-ARCH-002 |
| **TC-TREE-07** | **标题栏按钮：刷新视图** | 执行 `sceneBreakpoints.refreshView` | 触发 `onDidChangeTreeData` 事件，执行 DOM Diff 原地更新 | KDD-TREE-002 |
| **TC-TREE-08** | **场景行内按钮：激活单场景** | 传入未激活节点执行 `sceneBreakpoints.applySceneItem` | 该场景被立即激活，点亮 DAP 断点与状态栏高亮 | KDD-TREEVIEW-001 |
| **TC-TREE-09** | **场景行内按钮：重命名场景** | 执行 `sceneBreakpoints.renameSceneItem` | 更新场景标识符，配置文件与树节点 Key 同步更新 | KDD-DEFENSE-001 |
| **TC-TREE-10** | **场景行内按钮：删除场景** | 执行 `sceneBreakpoints.deleteSceneItem` | 从 JSON 剔除该场景，若该场景处于激活态则同步卸载 DAP 断点并复位 | KDD-DEFENSE-001 |
| **TC-TREE-11** | **场景右键按钮：批量启用全部** | 执行 `sceneBreakpoints.enableAllBreakpointsInScene` | 场景内全部断点 `enabled` 设为 `true`，DAP 与树图标就地同步 | KDD-ARCH-002 |
| **TC-TREE-12** | **场景右键按钮：批量禁用全部** | 执行 `sceneBreakpoints.disableAllBreakpointsInScene` | 场景内全部断点 `enabled` 设为 `false`，DAP 与树图标就地同步 | KDD-ARCH-002 |
| **TC-TREE-13** | **场景右键按钮：克隆场景副本** | 执行 `sceneBreakpoints.duplicateScene` | 生成同名 `-copy` 副本场景，完整复制断点数组与代码指纹 | KDD-ARCH-002 |
| **TC-TREE-14** | **断点行内按钮：单个开关切换** | 执行 `sceneBreakpoints.toggleBreakpointItem` | 该断点 `enabled` 取反，图标在启用态与禁用态 SVG 间切换 | KDD-SYNC-001 |
| **TC-TREE-15** | **断点行内按钮：移除单断点** | 执行 `sceneBreakpoints.removeBreakpointItem` | 从场景数组中剔除该点，DAP 同步拔除对应红点 | KDD-TREEVIEW-001 |

---

### 维度四：底部常驻状态栏 StatusBarItem 响应式渲染 (TC-STAT)

| 编号 | 场景名称 | 操作与触发步骤 | 预期断言与验证要求 | 关联约束 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-STAT-01** | **状态栏三态色彩与文字联动** | 分别处于无激活、正常激活、临时断点未保存（Dirty）状态 | - 无激活：`$(circle-outline) Scene: (None)`（无色）<br>- 激活态：`$(circle-filled) Scene: [xxx]`（主题绿 `#49c998`）<br>- 脏状态：`$(circle-filled) Scene: [xxx]*`（黄色高亮 `#cca700`） | INV-004 |
| **TC-STAT-02** | **状态栏点击呼出主菜单** | 点击状态栏（触发绑定的 `sceneBreakpoints.showMenu`） | 调出 QuickPick 主菜单，展示场景列表与功能动作入口 | KDD-MULTI-ACTIVATE-001 |

---

### 维度五：配置文件 CodeLens 行内交互 (TC-LENS)

| 编号 | 场景名称 | 操作与触发步骤 | 预期断言与验证要求 | 关联约束 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-LENS-01** | **debug-scenes.json 动态 CodeLens 呈现** | 编辑器打开 `debug-scenes.json`，触发 `vscode.executeCodeLensProvider` | 兼容 JSONC 注释；未激活场景上方呈现 `▶ Apply Scene (X bps)`，已激活呈现 `✔ Active (X bps)` | KDD-CODELENS-CLIP-001 |
| **TC-LENS-02** | **CodeLens 点击一键激活** | 触发 CodeLens 对象携带的激活命令 | 真实调度 `applyScene` 激活对应场景，DAP 完成下发 | KDD-CODELENS-CLIP-001 |

---

### 维度六：场景反向导出与剪贴板防御性流转 (TC-CLIP)

| 编号 | 场景名称 | 操作与触发步骤 | 预期断言与验证要求 | 关联约束 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-CLIP-01** | **反向批量导出编辑器散落断点** | 编辑器中任意设置散落断点，执行 `sceneBreakpoints.exportScene` | 遍历 DAP 抓取断点，自动读取磁盘源码提取 `contextSnippet` 指纹并保存新场景 | KDD-INIT-001 |
| **TC-CLIP-02** | **场景一键复制到剪贴板** | 执行 `sceneBreakpoints.copySceneToClipboard` | 写入剪贴板标准 JSON Payload，相对路径转为 POSIX 斜杠（`/`） | KDD-CLIPBOARD-001 |
| **TC-CLIP-03** | **剪贴板导入与 Markdown/JSONC 清洗** | 将包裹在 ````json ... ```` 代码块中的内容导入 | 自动剥离 Markdown 围栏与注释，清洗非法字段，同名支持覆盖/追加/重命名 | INV-006<br>KDD-CLIP-FORMAT-001 |

---

### 维度七：代码自愈持久化闭环与脱靶失联告警 (TC-HEAL)

| 编号 | 场景名称 | 操作与触发步骤 | 预期断言与验证要求 | 关联约束 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-HEAL-01** | **代码行号漂移自愈与持久化回写** | 源码断点前插入 5 行注释，重新装配场景 | 自愈引擎双向加权探测命中新行号，DAP 命中最新真实行号，并自动反向回写 `debug-scenes.json` 闭环 | INV-003<br>KDD-HEALING-LOOP-001 |
| **TC-HEAL-02** | **破坏性修改未匹配脱靶告警** | 彻底删除断点所在目标代码块，重新装配场景 | 判定为 `unmatched` 脱靶，平滑回退原行；弹出警告通知，树节点展示专属矢量警告图标与 `[未匹配]` 标签 | INV-003<br>KDD-UNMATCHED-WARN-001 |

---

### 维度八：AI 声明式免 MCP 编排与文件监听协同 (TC-AI)

| 编号 | 场景名称 | 操作与触发步骤 | 预期断言与验证要求 | 关联约束 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-AI-01** | **外部修改 activeScenes 响应式装配** | 外部写入 `"activeScenes": ["target-scene"]` 到 JSON 文件 | 真实 `fileWatcher` 防抖捕获变更，自动完成旧断点卸载与新场景装配，状态栏与树视图自动响应 | INV-008<br>INV-010 |
| **TC-AI-02** | **幽灵场景拦截守卫 (Ghost Scene Guard)** | 外部向 `activeScenes` 填入未在 `scenes` 字典中定义的伪造场景名 | 领域层强行拦截，绝不作为激活场景写入状态机，杜绝虚假绿色与断点误清空 | INV-009 |
| **TC-AI-03** | **核心拓扑 Diff 防线 (Topology Diff Guard)** | 外部仅修改断点 `desc`、`bindings` 映射或未激活闲置场景 | 比对 `lastAppliedTopologyHash` 无变动，坚决阻断调用 `applySceneBreakpoints` 重刷 DAP | INV-012 |
| **TC-AI-04** | **反向同步防回环死循环 (Echo Loop Guard)** | 编辑器原生断点面板切换断点启用/禁用状态 | 触发 `onDidChangeBreakpoints` 反向回写配置，时间戳锁拦截后续 `fileWatcher`，杜绝死循环 | INV-008 |

---

### 维度九：调试生命周期联动与会话保护 (TC-SESS)

| 编号 | 场景名称 | 操作与触发步骤 | 预期断言与验证要求 | 关联约束 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-SESS-01** | **调试会话保护（策略 A 挂起与补发）** | 调试会话正在运行时（`activeDebugSession` 存在），外部修改断点拓扑 | 绝不强制打断当前调试心流，标记 `pendingTopologyUpdate = true`，状态栏温和提示；调试终止后平滑补偿装配 | INV-012 |
| **TC-SESS-02** | **Launch.json 调试启动项联动与幂等放行** | 调度 `debugConfigProvider.resolveDebugConfiguration` | 按三级优先级推导场景并激活；若场景已激活，静默放行（0 冗余开销） | INV-007 |

---

### 维度十：配置项开关与无工作区防御性守卫 (TC-CONF)

| 编号 | 场景名称 | 操作与触发步骤 | 预期断言与验证要求 | 关联约束 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-CONF-01** | **autoActivateOnLaunch 开关受控** | 将 `sceneBreakpoints.autoActivateOnLaunch` 设为 `false` 后启动调试 | 启动钩子静默跳过场景推导与激活，尊重用户配置 | INV-007 |
| **TC-CONF-02** | **allowAiFileActivation 开关受控** | 将 `sceneBreakpoints.allowAiFileActivation` 设为 `false` 后外部改写 JSON | 外部修改被静默忽略，绝不擅自下发断点，保障开发者绝对控制权 | INV-008 |
| **TC-CONF-03** | **未保存临时断点脏状态（Dirty）切换保护** | 在激活场景中手动增加断点（进入 Dirty 态）后尝试切换场景 | 弹出警告弹窗，提供“保存并追加”与“放弃临时断点”两个明确选项，防止误丢断点 | KDD-ARCH-002 |
| **TC-CONF-04** | **单文件无工作区防御性守卫 (INV-006)** | 未打开文件夹时直接触发扩展交互命令 | 拦截并弹出“需打开工作区”温和提示，绝不抛未捕获的空指针异常 | INV-006 |
| **TC-CONF-05** | **Git 合并冲突标记防御性容灾** | `debug-scenes.json` 写入 `<<<<<<< HEAD` 冲突标记后读取配置 | 防御性清洗并平滑降级，记录警告，绝不引发宿主崩溃 | INV-006 |

---

## 3. 用例维护与演进规范

为了确保测试资产与项目演进绝对同步，建立以下铁律：

1. **新功能准入原则**：
   - 任何新增命令、新增配置项、新增 UI 按钮或新增视图交互，必须先在本文档中登记 `TC-xxx` 场景编号、操作步骤与预期断言，方可进入代码开发；
2. **重构回归原则**：
   - 任何核心逻辑重构，必须运行 `npm run test:e2e`，确保 34 大全量场景 100% 绿灯通过；
3. **CI/CD 硬门禁**：
   - 本地提交前必须通过离线单元测试（`npm test`）与真实宿主 E2E 测试（`npm run test:e2e`）。

---

## 4. 变更记录

| 日期 | 变更内容 | 变更人 | 关联变更 |
| :--- | :--- | :--- | :--- |
| 2026-09-12 | 初始版本：建立 Scene Breakpoints 全量 10 大维度、34 大端到端 (E2E) 测试场景规范矩阵 | Tony.L | KDD-E2E-SPEC-001 |
| 2026-09-12 | 自动化套件落地：完成 Suite 01~04 全量自动化 E2E 用例补齐（31 个核心测试 100% 绿灯通过），修复 `loadScenesConfig` 遗漏解析 `activeScenes` 的核心契约缺陷 | Tony.L | #TASK-E2E-AUTO |
