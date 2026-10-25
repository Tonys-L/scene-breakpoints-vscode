# VS Code 原生 API 与打包踩坑经验

### 1.1 QuickPickItem 不支持 `$(icon~color)` 语法泄露字符串

**问题**: 在状态栏弹出的菜单项中，试图使用 `$(circle-filled~charts-green)` 给激活场景加上绿点，但界面直接将原始字符串打印了出来。
**原因**: VS Code 的 `StatusBarItem` 支持 `$(icon~color)` 扩展语法，但 `QuickPickItem`（选择列表）的 `label` 和 `description` 不支持波浪号修饰颜色，会导致纯文本泄露。
**解决方案**: 在 `QuickPick` 中改用系统原生彩色 Emoji（如 `🟢` 代表激活，`⚪` 代表未激活），并配合 `quickPick.activeItems = [activeItem]` 赋予整行高亮选中背景。
**影响文件**: `src/ui/commands/menuCommands.ts` (原 `src/commands/showMenu.ts`)
**日期**: 2026-09-07

### 1.2 批量下发断点时清空阶段触发 `onDidChangeBreakpoints` 竞态闪烁

**问题**: 切换场景时，状态栏偶尔会闪烁一下 `(None)` 然后再变回目标场景。
**原因**: 在 `applySceneBreakpoints` 内部，第一步调用了 `removeBreakpoints(all)`。在全部清除完成但尚未注入新断点的瞬间，VS Code 抛出 `onDidChangeBreakpoints`，全局监听器看到当前断点数为 0，误触发了重置。
**解决方案**: 引入 `SceneStateManager.isApplyingScene()` 原子状态锁，在下发断点的 `try...finally` 期间加锁，事件监听器检测到加锁时静默忽略清空重置。
**影响文件**: `src/application/sceneStateManager.ts`, `src/infra/vscode/vscodeBreakpointBridge.ts`, `src/extension.ts`
**日期**: 2026-09-07

### 1.3 正则剥离 JSONC 注释时的字符串字面量误吞陷阱

**问题**: 用户在断点描述或 URL 字段中包含 `/*` 或类似注释路径（如 `http://localhost/auth/*key*`）时，`JSON.parse` 报错 `SyntaxError: Unterminated string in JSON`。
**原因**: 粗暴的正则 `/\/\*[\s\S]*?\*\//` 会越过双引号，将双引号内部的文本误当成注释剥离，破坏字符串闭合引号。
**解决方案**: 必须采用**双引号字符串字面量优先匹配保护机制**：`replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (_match, str) => str || "")`，捕获组 $1 命中的双引号字符串完整原样保留，仅剥离外部裸露注释。
**影响文件**: `src/infra/storage/jsonFileSceneRepository.ts` (原 `src/configManager.ts`)
**日期**: 2026-09-08

### 1.4 场景追加导出时的原子去重契约

**问题**: 用户将当前断点追加导出至已有场景时，如果已有场景中已有同行号断点，简单数组拼接会导致出现多条重复断点记录。
**原因**: 追加导出未走断点唯一性契约校验（文件+行号 或 函数名）。
**解决方案**: 场景导出追加统一调用 `upsertBreakpointToScene`，同行断点覆盖更新属性（条件/命中数/描述），异行断点平滑追加，确保持久化数组严格去重。
**影响文件**: `src/ui/commands/sceneCommands.ts` (原 `src/commands/exportScene.ts`)
**日期**: 2026-09-08

### 1.5 TreeView 节点 ThemeIcon 选中高亮变灰与 16x16 容器尺寸等比压缩陷阱

**问题 1**: 用户点击选中某个断点树节点高亮时，无论该断点是启用还是禁用，断点图标均被 VS Code 强行冲刷成死灰色。
**原因**: `ThemeIcon` 底层为 Codicon 字体图标，VS Code 的全局样式规则 `.monaco-list-row.selected.focused .codicon { color: inherit !important; }` 会强行覆盖行内所有字体颜色为选中文本前景色。
**解决方案**: 采用纯净矢量 SVG 图片路径（`vscode.Uri.file(...)`）渲染。SVG 作为图片通道加载，宿主 CSS `color` 无法对其产生任何冲刷影响，红点永远鲜红饱和、灰圈永远纯灰。

**问题 2**: 为实现断点图标与复选框排版，制作了 `34x16` 的组合 SVG，结果界面渲染时图标被等比压小了一半多，变得极其微缩。
**原因**: VS Code 树视图节点图标容器 `.monaco-tl-icon` 在 CSS 中被宿主严格硬性限制为 `16px x 16px`（`background-size: contain`）。宽 34 高 16 的图片塞入 16x16 容器后，被强制等比缩小了 53%（高度仅剩 7.5px）。
**解决方案**: 将所有断点图标严格设计为标准 `16x16` 居中饱满矢量 SVG（中心圆/菱形直径 10.5px，1:1 匹配原生红点），复选框使用 VS Code 树视图原生 `TreeItem.checkboxState` 控制。
**影响文件**: `src/ui/views/sceneTreeProvider.ts`, `media/icons/*.svg`
**日期**: 2026-09-08

### 1.6 树视图闪烁根因：多重重绘风暴与单节点局部刷新治理

**问题**: 点击复选框或内联按钮启用/禁用断点时，整棵树出现刺眼的白屏跳动闪烁。
**原因**:
1. **未区分全局刷新与单节点局部刷新**：复选框变化后调用了无参 `treeDataProvider.refresh()`。无参调用会触发 `_onDidChangeTreeData.fire(undefined)`，导致 VS Code 强制从 Root 根节点重新请求 `getChildren()`，整树所有场景及断点被全量重新构建；
2. **基于定时器的防抖极其脆弱**：使用 500ms 定时器的 `isInternalSaving` 无法对抗 Windows 文件系统（或 Defender 杀毒扫描）长达上千毫秒的写盘事件延迟，导致 `fileWatcher` 漏网并在数百毫秒后触发二次重刷整树及重新应用断点；
3. **断点就地同步缺乏异步保护窗**：`syncBreakpointEnabledToEditor` 移除并添加断点是异步的，在 `finally` 瞬间释放 `isApplying` 后，宿主分发的 `onDidChangeBreakpoints` 事件被误判为外部手动修改，再次触发脏状态检查与状态机整树重绘；
4. **场景节点折叠状态重置**：每次构造 `new SceneNode` 时简单使用 `isActive ? Expanded : Collapsed`，重刷时会强制重置用户手动展开的场景折叠状态，产生 UI 跳动。
**解决方案**:
1. **单节点精准微更新（Targeted Element Refresh）**：复选框点击仅调用受影响节点的 `node.updateAppearance()` 并传入 `treeDataProvider.refresh(node)`，VS Code 仅就地替换该节点的 SVG 图标，整树根节点与其他节点纹丝不动，0 闪烁；
2. **文件内容哈希指纹守卫（Content Hash Guard）**：`configManager` 写盘时记录内容哈希，`fileWatcher` 接收到磁盘变动时比对内容指纹，若与内部写入完全一致则 100% 物理阻断，彻底免疫系统延迟；
3. **断点异步事件保护窗**：为 `syncBreakpointEnabledToEditor` 补齐 `await` 并设置 150ms 延时保护释放，确保事件分发期间 `isApplyingScene()` 保持有效；
4. **场景折叠状态持久化记忆**：`SceneNode` 记录用户展开集合 `expandedScenes`，防止刷新导致展开折叠跳动。
**影响文件**: `src/ui/views/sceneTreeProvider.ts`, `src/infra/storage/jsonFileSceneRepository.ts`, `src/infra/vscode/vscodeBreakpointBridge.ts`, `src/extension.ts`
**日期**: 2026-09-08

### 1.7 调试启动配置联动推导必须验证场景真实存在性（防幽灵激活）

**问题**: 启动配置（`launch.json` 或 `.env` 中的 `DEBUG_SCENE`）中写了不存在的场景名时，状态栏居然被染成绿色并显示为该不存在场景，但实际并未激活任何场景，且原有断点可能被误清空。
**原因**: `resolveLaunchBoundScenes` 解析环境变量与 `bindings` 映射时，直接将字符串透传返回，未与 `config.scenes` 的有效场景清单进行校验；`applySceneCommand` 也未做校验，直接执行了 `setActiveScenes`。
**解决方案**: 在推导层与激活命令层建立双重存在性强校验守卫，严格核对场景名是否在 `config.scenes` 中存在（支持大小写不敏感容错）。未定义的场景坚决不予返回与激活，并在命令层立即弹出错误提示中断执行。
**影响文件**: `src/infra/storage/jsonFileSceneRepository.ts`, `src/ui/commands/sceneCommands.ts`
**日期**: 2026-09-08

### 1.8 树节点内存实体与反序列化持久化实体的双向同步陷阱（复选框瞬间弹回）

**问题**: 用户在树节点未选中状态下直接点击复选框尝试禁用断点时，复选框刚取消勾选，瞬间又被弹回自动勾选上（看似“必须选中后才能勾选”）。
**原因**:
1. 点击复选框触发 `onDidChangeCheckboxState` 时，代码通过 `loadScenesConfig` 读盘并反序列化出了一个**全新的** `config` 配置对象；
2. 代码修改了该新对象中的断点状态 `targetBp.enabled = false` 并保存；
3. 但当前内存中常驻的 `BreakpointNode` 实例仍然持有旧的 `item.breakpoint` 引用（其 `enabled` 仍为 `true`）；
4. 紧随其后调用的 `node.updateAppearance()` 重新读取 `this.breakpoint.enabled`，误以为仍为 `true`，直接将 `this.checkboxState` 强行覆写为 `Checked`；
5. `treeDataProvider.refresh(node)` 发送给宿主后，VS Code 遵从指令将复选框重新绘制为勾选。
**解决方案**:
在 `onDidChangeCheckboxState` 循环处理中，必须同时对内存中树节点引用的断点实体进行双向赋值：
`targetBp.enabled = newEnabled; item.breakpoint.enabled = newEnabled;`
确保 `node.updateAppearance()` 读到最新状态，彻底解决未选中状态下点击即生效且绝不回弹。
### 1.9 高频并发写盘的文件锁竞争与原子队列防抖保护

**问题**: 用户在侧边栏连续快速点击切换多个断点复选框或快捷键快速操作时，可能由于 Windows 杀毒软件（Defender）或系统 I/O 延迟抛出 `EBUSY: resource busy or locked` 写入冲突，或覆盖写入丢失。
**原因**: 每次操作直接触发同步 `fs.writeFileSync`，在微任务队列密集重叠执行时，前一次写盘句柄尚未完全释放，后一次写盘紧随其后并发冲击。
**解决方案**:
在 `saveScenesConfig` 中引入并发互斥锁 `isWriting` 与待处理缓存 `pendingSave`：
当写盘处于进行中时，后续请求合并暂存于 `pendingSave`；当前写盘完成（`finally` 块）后立即原子续写最新缓存，确保串行互斥写入且永不丢配置。
**影响文件**: `src/infra/storage/jsonFileSceneRepository.ts`
**日期**: 2026-09-08

### 1.10 esbuild 外部依赖排除模式下模块漏写 vscode 导入引发运行时 ReferenceError

**问题**: 用户执行 `sceneBreakpoints.exportScene` 命令时，VS Code 抛出 `Error running command sceneBreakpoints.exportScene: vscode is not defined`。
**原因**: 项目采用 esbuild 单文件打包并配置了 `--external:vscode`。源码模块中若直接使用 `vscode.xxx` 却未显式声明 `import * as vscode from "vscode"`，esbuild 不会执行 TS 类型检查，而是将其视为全局自由变量直接输出在 bundle 中。在 VS Code 运行期，CommonJS 执行上下文中不存在全局 `vscode` 对象，导致在命令执行时报 `ReferenceError: vscode is not defined`。
**解决方案**: 源码中任何调用宿主 API 的模块均必须严格声明 `import * as vscode from "vscode";`，esbuild 会将其安全映射为 `require("vscode")` 的命名空间局部引用。
**影响文件**: `src/ui/commands/sceneCommands.ts`
**日期**: 2026-09-11

### 1.11 Content Hash Guard 拦截内部写盘后业务命令层必须主动触发树视图刷新

**问题**: 用户从剪贴板成功导入新场景后，调试侧边栏（Scene Breakpoints 视图）没有立即显示新导入的场景，必须手动点击刷新按钮。
**原因**: 工程为防止写盘被系统防病毒软件/文件系统延迟触发二次整树闪烁，在 `fileWatcher` 中设计了 `Content Hash Guard`。内部写盘的内容与最近保存指纹一致时会被 `fileWatcher` 直接拦截放行，不触发 `treeDataProvider.refresh()`。若导入的场景未处于激活态，状态机不会变更，导致树视图完全未收到重绘信号。
**解决方案**: 任何通过 `saveScenesConfig` 新增或修改配置的命令层逻辑（如剪贴板导入、导出场景），在写盘持久化后必须主动调度 `await vscode.commands.executeCommand("sceneBreakpoints.refreshView");` 显式驱动树视图更新。
**影响文件**: `src/ui/commands/clipboardCommands.ts`, `src/ui/commands/sceneCommands.ts`
### 1.12 类方法正则误捕获控制流关键字导致作用域回溯中断与得分不足

**问题**: 用户在断点上方插入空行和代码后激活场景，自愈算法未触发，断点依然停留在旧行号。
**原因**: `extractScopeAnchor` 中的类方法通用正则 `/^\s*([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*[{:]/` 将 JS/TS/Python 的控制流语句（如 `if (cond) {`、`while (x):`、`for (...)`）中的关键字当成了方法名提取并立即返回。导致算法提前终止向上扫描，误判当前作用域为 `"if"`，无法匹配到真实外层函数名，白白丢失 5 分加权，得分跌破置信门槛而安全回退。
**解决方案**: 在提取作用域正则前，显式拦截并排除通用控制流保留字黑名单（`UNIVERSAL_CONTROL_FLOW_KEYWORDS`：`if`, `for`, `while`, `switch`, `catch`, `with` 等），强制穿透控制流直达真正的外层函数定义行。
**影响文件**: `src/domain/services/healingEngine.ts` (原 `src/healingAdapter.ts`)
**日期**: 2026-09-12

### 1.13 纯物理相邻行匹配在代码间插入空行时失效，演进为非空拓扑窗口

**问题**: 开发者或 AI 在断点上方或下方插入单个空行或格式化换行时，断点伴随上下文匹配分数大幅跌落。
**原因**: 原自愈算法死板比对物理绝对相邻行 `lines[i - 1]` 与 `lines[i + 1]`。一旦中间插入空行，`lines[i - 1]` 变为纯空白文本 `""`，导致原有的 `prev` 代码行在 `lines[i - 2]` 被直接无视，错失 5 分拓扑加分。
**解决方案**: 引入语言无关的“非空拓扑伴随窗口”机制（`findPrevNonEmptyLine` 与 `findNextNonEmptyLine`），在提取指纹与计算自愈时均自动穿透空白行，寻找最近的有效代码行进行拓扑锚定，彻底免疫任意数量空行、格式化空行的干扰。
**影响文件**: `src/domain/services/healingEngine.ts`
**日期**: 2026-09-12

### 1.14 模块调用 Node.js 内置模块（如 path）未显式导入在 esbuild 下静默打包但在运行时触发 ReferenceError

**问题**: 用户执行 `sceneBreakpoints.applySceneItem` 激活场景时，VS Code 抛出 `Error running command sceneBreakpoints.applySceneItem: path is not defined`。
**原因**: 项目采用 esbuild 单文件打包且未在打包配置中强制开启 TypeScript 类型检查。若源码模块内部直接调用了 `path.basename` 或 `path.isAbsolute`，但文件顶部忘记显式写 `import * as path from "node:path"`，esbuild 会将其作为自由全局变量输出。而在 VS Code 宿主运行期，模块闭包作用域中并没有全局 `path` 对象，导致在触发该代码分支（如断点脱靶告警）时抛出 `ReferenceError: path is not defined`。
**解决方案**: 任何模块只要使用了 Node.js 核心库（`path`、`fs`、`os` 等），必须严格在文件顶部显式声明 `import * as path from "node:path";`。
**影响文件**: `src/ui/commands/sceneCommands.ts`
### 1.15 领域层误引 VS Code 宿主 API 破坏分层并在 esbuild 打包运行时抛 ReferenceError

**问题**: 执行断点自愈装配（如 `TC-HEAL-01 ~ 04`）时，VS Code 抛出 `ReferenceError: vscode is not defined at resolveHealedLine`。
**原因**: `src/domain/healingEngine.ts` 属于纯领域层，本应保持 100% 纯 TS 零宿主依赖，但在实现中硬编码调用了 `vscode.workspace.textDocuments.find(...)`。由于领域层未（且不应）导入 `vscode` 命名空间，esbuild 单文件打包时将其视为全局自由变量直接输出，运行期在 CommonJS 模块闭包中找不到全局 `vscode` 对象。
**解决方案**: 严守三层隔离架构约束，纯领域层只定义计算模型与纯逻辑（如 `resolveHealedLineFromLines`）。若需获取宿主打开文档的源码行，必须在基础设施层（`vscodeBreakpointBridge.ts`）通过回调函数（`getDocumentLines`）依赖注入，领域层绝不直接引用任何宿主 API。
**影响文件**: `src/domain/healingEngine.ts`, `src/infra/vscode/vscodeBreakpointBridge.ts`
**日期**: 2026-09-13

### 1.16 领域层严禁接收或声明宿主特定数据类型（如 vscode.TextDocument）

**问题**: 领域层核心函数（如 `extractContextSnippet`）若将参数声明为 `doc: vscode.TextDocument`，不仅破坏 DDD 纯领域边界，而且使得脱离 VS Code 的离线纯单元测试必须构造沉重复杂的宿主 mock，并在打包下引入潜在类型污染。
**原因**: 领域层关注的是代码文本的伴随拓扑、几何缩进与作用域锚点，本质上仅需要纯行文本列表（`string[]`），与宿主的文档对象完全解耦。
**解决方案**: 领域层统一使用原生纯 TS 数据结构（`lines: string[]`）或最小充分鸭子接口（`{ lineAt(i): { text }, lineCount }`）。基础设施层负责把宿主文档对象自然匹配传参，单元测试可直接传入简单的原生数组，实现领域层 100% 宿主解耦与单测极致轻量。
**影响文件**: `src/domain/healingEngine.ts`, `test/unit/domain/healing.test.mjs`
**日期**: 2026-09-13

### 1.17 多线程 Worker DAP continued 误杀与后台 stackTrace 响应覆盖导致断点命中高亮闪退陷阱

**问题**: 用户在实际调试命中断点后，TreeView 视图中的场景断点节点高亮与 `[PAUSED]` 标签瞬间闪烁一下又立刻恢复原样（或者有的入口断点正常、有的业务流断点闪退），无法稳定维持断点暂停指示状态。
**原因**:
1. **DAP 多线程 / 多会话 stackTrace 响应冲刷**：VS Code 在断点命中时，会向所有存活线程（包括后台 `RUNNING` 状态的 WorkerThread、loader 辅助会话）轮询堆栈。由于原全局 Tracker 拦截所有 `stackTrace` 响应并未校验会话暂停状态，Worker 线程紧随其后返回的堆栈（非断点代码）在几十毫秒内无脑覆写了 `_pausedLocation`，瞬间抹杀了主线程断点的高亮；
2. **非场景断点位置盲目冲刷已有高亮**：原 `revealPausedLocation` 缺乏场景断点存在性校验，外部库代码、Worker 代码或非断点光标只要传入，就会直接覆写 `_pausedLocation`，将已经命中的场景断点高亮冲刷为普通状态；
3. **DAP 多线程 Continued 致命误杀**：后台 Worker 线程的 `event: "continued"` 或多 Session 之间共享全局 `pausedThreadId` 导致跨会话误杀；
4. **VS Code 焦点移动与树聚焦震荡**：`treeView.reveal` 导致 `onDidChangeActiveStackItem` 短暂派发 `item = undefined` 时误触发清空。
**解决方案**:
1. **Session 级独立闭包隔离（Session-Affinity Guard）**：每个 `createDebugAdapterTracker(session)` 独立持有内部私有 `sessionPausedThreadId`，仅当该会话明确处于 `stopped` 暂停状态时才转发 `stackTrace`，彻底阻断运行中（RUNNING）的后台 Worker 线程的堆栈响应；
2. **场景断点真实性存在守卫（Target Breakpoint Guard）**：`revealPausedLocation` 在设置 `_pausedLocation` 前强校验 `(file, line)` 必须属于当前已激活场景中的断点。任何外界（非断点堆栈、Worker 代码、外部库代码）传入的非断点位置绝对不覆写 `_pausedLocation`，彻底免疫冲刷；
3. **精准过滤 continued 事件与剔除 undefined 误杀**：仅当全线程恢复或命中线程恢复时才清空高亮，会话存活期间焦点震荡不执行清空。
**影响文件**: `src/infra/vscode/listeners/debugLifecycleListener.ts`, `src/infra/vscode/sceneTreeProvider.ts`, `test/unit/infra/listeners_registry.test.mjs`
**日期**: 2026-09-13

### 1.19 UI 命令控制器深度与交互样板代码收敛 (Declarative Action Controller & Locators Separation)

**问题**: 在 `sceneCommands.ts` 与 `treeCommands.ts` 等宿主命令模块中，混入了长达数十行的活动编辑器向上逆序文本扫描逻辑（在 `debug-scenes.json` 中匹配场景键名），并且各命令重复编写非空校验、空白字符修剪（`validateInput`）与模态警告弹窗（`modal: true`）样板代码，导致模块过浅（Shallow）且职责泄露。
**原因**: UI 命令层兼顾了入参推导、文本物理定位、输入校验弹窗与用例调用等多重职责，缺乏专职的定位器（Locator）与交互辅助模块。
**解决方案**:
1. **提取专职定位器**：创建 `src/ui/locators/sceneEditorLocator.ts`，将逆向行文本匹配提取为纯函数 `findEnclosingSceneName`（支持原生 `string[]` 与 `lineAt` 鸭子类型，脱离 VS Code 进行 100% 纯单测），宿主集成接口封装为 `detectSceneFromActiveEditor`；
2. **提取统一交互对话框**：创建 `src/ui/utils/promptHelpers.ts`，导出 `promptSceneName`（内置非空与修剪校验）、`confirmModalAction`（内置模态警告）与 `promptSelectScenes`（多选面板）；
3. **命令处理器声明式编排**：各命令收敛为“解析/输入 -> 调用 Application Manager -> 提示 Feedback”的极简动作编排。
**影响文件**: `src/ui/locators/sceneEditorLocator.ts`, `src/ui/utils/promptHelpers.ts`, `src/ui/commands/sceneCommands.ts`, `src/ui/commands/treeCommands.ts`
### 1.20 无头测试环境下命令参数空数组 [] 误判为 falsy 导致唤起模态 QuickPick 挂起超时 (Headless QuickPick Timeout on Empty Array Parameter)

**问题**: 在 CI 或无头（Headless）E2E 测试中执行取消多场景勾选（如 `TC-MUL-03`）或传入空数组 `[]` 调用 `sceneBreakpoints.applyScene` 时，测试出现 30 秒超时挂起并报错。
**原因**: `parseSceneParameter` 在历史实现中采用了 `if (!sceneParam) return undefined` 且在 `uniqueStrings(sceneParam)` 长度为 0 时返回 `undefined`。由于返回了 `undefined`，命令推导逻辑误认为“调用方未传入参数”，从而降级弹出交互式多选面板 `promptSelectScenes`。在无头测试环境下无人工交互，导致命令无限等待用户选框输入直至超时。
**解决方案**: 显式区分“未传参（`undefined`/`null`）”与“显式传入空目标列表（`[]`）”。当入参为 `Array.isArray(sceneParam)` 时严格保留为 `string[]`；在 `resolveTargetScenes` 中仅当 `targetScenes === undefined` 时才回退至弹窗；若解析得到 `[]`，则立即将其作为“清空所有激活断点”的合法语义执行 `sceneManager.clearAll`。
**影响文件**: `src/ui/commands/sceneCommands.ts`
**日期**: 2026-10-05

### 1.21 跨激活生命周期的全局 LineReader 单例未及时失效导致自愈管道读取过期源码脏缓存 (LineReader Cache Invalidation Across Scene Activations)

**问题**: 在测试源码行号自然漂移自愈与持久化回写（如 `TC-HEAL-01`, `TC-HEAL-03`, `TC-HEAL-04`）时，首次装配场景正常，但开发者或测试向源文件插入注释/代码后再次装配场景，断点未漂移到最新真实行，仍然停留在初始行号。
**原因**: `vscodeLineReader` 作为全局单例适配器在内存中常驻，内部持有的 `cache: Map<string, string[]>` 在首次激活时缓存了文件行。后续即便磁盘文件或 VS Code 文档发生编辑，自愈引擎在调用 `readLines` 时仍然优先命中了内存旧缓存，导致自愈匹配算法基于过期的旧文件代码计算，无法感知源码已下移的客观现实。
**解决方案**:
1. **端口契约增强**：在 `ILineReader` 端口中增加 `clearCache?(): void` 契约规范；
2. **激活与富化管道主动重置**：在 `executeSceneActivation` 与 `autoEnrichEmptyFingerprints` 执行起点，主动调用 `lineReader?.clearCache?.()` 保证每次操作均使用全新的代码视图；
3. **VS Code 文档变更联动**：在 `createVsCodeLineReader` 中监听 `vscode.workspace.onDidChangeTextDocument` 事件，一旦活动文档发生编辑立即清空缓存。
**影响文件**: `src/domain/ports/lineReader.ts`, `src/application/sceneActivationPipeline.ts`, `src/application/agentSyncService.ts`, `src/infra/vscode/vscodeLineReader.ts`
**日期**: 2026-10-05

### 1.22 新增断点后 Inlay Hints 渲染延迟与输入框焦点失脱陷阱 (Inlay Hints Deferred Rendering on Modal Focus Loss)

**问题**: 开发者在代码中使用 `Ctrl+Alt+B` 或右键添加断点后，红点已点亮且断点已入库，但该行行末的 Inlay Hints 注解（`💡 [scene #x] ...`）未即刻呈现，直到在侧边栏双击该断点（重新调用 `vscode.open` 激活编辑器）后才出现。
**原因**:
1. **输入框关闭与通知弹窗导致的焦点失脱**：添加断点过程中经历了 QuickPick 和 InputBox 弹窗，编辑器失去焦点；保存后由于右下角信息气泡弹出，编辑器仍未完全重新取得活动焦点。VS Code 装饰/注解管线在编辑器失焦期可能延迟或推迟 `provideInlayHints` 拉取；
2. **DAP 注入完成后缺乏二次通知**：`breakpointManager.addBreakpoint` 中先通过 `mutateCatalog` 写盘并广播事件，但此时底层 DAP 原生断点尚未执行 `applySingleBreakpointToEditor`；而在断点成功点亮后，未再次触发 `breakpoints:changed`，导致外部状态机与 UI 产生微小感知时差。
**解决方案**:
1. **焦点主动平滑归还**：在 `addBreakpointCommand` 完成后，显式调用 `vscode.window.showTextDocument(editor.document, { preserveFocus: false })`，将活动焦点平滑归还当前文本编辑器，触发宿主 Inlay Hints 自动重算；
2. **DAP 注入闭环双向通知**：在 `breakpointManager.addBreakpoint` 的 `isSuccess !== false` 分支中，即刻点亮后追加派发 `appEventBus.emit("breakpoints:changed")`；
3. **DAP 监听双重保底**：在 `SceneInlayHintsProvider` 中追加对 `vscode.debug.onDidChangeBreakpoints` 的监听，确保原生断点集变动时 100% 自动触发 `refresh()`。
**影响文件**: `src/application/breakpointManager.ts`, `src/ui/commands/addBreakpointCommand.ts`, `src/ui/views/sceneInlayHintsProvider.ts`
**日期**: 2026-10-05

### 1.23 场景激活与取消激活 Inlay Hints 渲染竞态与旧态复活陷阱 (Inlay Hints Deferred Refresh and State Resurrection on Scene Toggle)

**问题**: 用户在侧边栏 TreeView 点击场景激活时，可见编辑器行末的 Inlay Hints 没有即刻显示，必须点击断点或编辑器才显示；在点击取消激活时，Inlay Hints 同样没有即刻清除消失，直到点击断点后才消失。
**原因**:
1. **DAP 阶段未加锁导致中间态过早触发事件（Premature DAP Event Fire）**：`executeSceneActivation` 中装配断点至 DAP 时调用了 VS Code 的 `addBreakpoints` / `removeBreakpoints`；`SceneInlayHintsProvider` 监听了 `onDidChangeBreakpoints` 但未检查 `isApplyingScene()`，在断点下发期间过早触发了 `_onDidChangeInlayHints.fire()`。此时状态机与 `ActiveBreakpointIndex` 尚未更新，VS Code 调度了一次拉取（拉取到旧状态/空状态），并在微任务周期内将后续事件拦截（VS Code 内部 `if (!scheduler.isScheduled())` 直接忽略后续通知），导致界面直到下一次手动点击断点触发新的 DAP 事件时才被动刷新；
2. **状态与索引时序倒置（Out-of-Order Execution in Pipeline）**：在 `sceneActivationPipeline.ts` 中先执行 `setActiveScenes`，后执行 `activeBreakpointIndex.sync`；`setActiveScenes` 同步触发 `_onDidChangeState`，此时索引处于脏标记状态；
3. **取消激活时旧状态复活（State Resurrection Bug in Deactivation）**：在 `SceneInlayHintsProvider.provideInlayHints` 中，冷启动降级判定 `if (activeScenes.length === 0)` 误把运行期主动取消激活判定为冷启动，从而从磁盘残留配置中读取出旧的 `activeScenes` 赋给提示提供者，导致取消激活时 Inlay Hints 纹丝不动；且 `clearAll` 调用 `mutateCatalog` 时未传递 `syncActive: false`，导致 `syncActiveBreakpointsIfNeeded` 在 `catalog.getActiveScenes()` 为 0 时退回到旧 activeScenes；
4. **侧边栏失焦防抖延迟补偿（Blurred Window Refresh Guarantee）**：用户在侧边栏点击时编辑器失焦，VS Code `InlayHintsController` 对后台编辑器有节流与丢帧倾向。
**解决方案**:
1. **装配加锁静默屏蔽**：在 `executeSceneActivation` 与 `clearAll` 期间加锁 `sceneStateManager.setApplyingState(true)`；`SceneInlayHintsProvider` 的 `onDidChangeBreakpoints` 监听中检测到 `isApplyingScene()` 时静默返回，彻底阻断装配中途的半生事件；
2. **时序校准与最新聚合根投影**：在 `sceneActivationPipeline.ts` 中调整时序，在发射状态机事件前先完成 `activeBreakpointIndex.sync(...)`；
3. **引入显式状态区分与阻断复活**：在 `SceneStateManager` 中记录 `hasExplicitActiveState` 与 `resetState()`；当显式清空场景后，`provideInlayHints` 绝不退回磁盘旧配置；在 `clearAll` 中传递 `syncActive: false`，并在 `mutateCatalog` 中若 `catalog.getHasExplicitActiveScenes() && catalog.getActiveScenes().length === 0` 时阻断断点复活；
4. **尾随补偿与全局生命周期订阅**：在 `SceneInlayHintsProvider.refresh()` 中加入 50ms 尾随轻量补偿（Trailing Flush），并订阅 `scene:activated` 与 `scenes:changed` 全局终态事件。
**影响文件**: `src/application/sceneStateManager.ts`, `src/application/sceneActivationPipeline.ts`, `src/application/mutateCatalog.ts`, `src/application/sceneManager.ts`, `src/domain/models/sceneCatalog.ts`, `src/ui/views/sceneInlayHintsProvider.ts`
**日期**: 2026-10-05

### 1.24 Monaco 文本编辑器失焦节流屏障、IPC 竞态踩踏与 Inlay Hints 渲染穿透 (Monaco InlayHintsController Background Throttling and Viewport Penetration)

**问题**: 用户在侧边栏 TreeView 点击场景激活按钮时，可见文本编辑器行末的 Inlay Hints 注解无法立即绘制；用户必须点击编辑器内部或点击断点条目后，提示才突然浮现。同样，在侧边栏取消激活（清空场景）时，行末注解未消失，必须点击断点条目或编辑器后才消失；再次激活又不显示。
**原因**:
1. **Monaco InlayHintsController 失焦抑制与节流机制 (Background Editor Throttling)**：当焦点位于侧边栏（TreeView DOM）时，VS Code 的代码编辑器处于失焦（blurred/unfocused）状态。Monaco 内核的 `InlayHintsController` 为防止高刷后台编辑器卡顿，对失焦编辑器的装饰图层施加了惰性节流策略；
2. **Monaco RunOnceScheduler IPC 往返窗口期监听器卸载漏洞**：在 Monaco 内部，每次 `scheduler` 执行时首先调用 `cancellationStore.reset()`，这会**立刻 dispose 对 provider.onDidChangeInlayHints 的监听器**；随后进入 `await InlayHintsFragments.create(...)` 跨进程 IPC 调用。在此 IPC 往返期间，若插件端因多次事件广播或定时器再次 `.fire()`，此时 Monaco 端**没有任何监听器存在**，导致事件被静默吞掉（Drop）；同时正在处理的前一个 Token 被标记 Cancelled，直接 `return` 放弃更新；
3. **`showTextDocument` 伪唤醒的副作用**：原先试图通过带 `preserveFocus: true` 的 `vscode.window.showTextDocument` 穿透节流，但 Monaco 检测到 selection 未变直接视作 No-op；同时在某些版本下跨进程唤起编辑器反而中断了 Inlay Hints 的计算管线；
4. **单次操作触发多重冗余事件风暴**：场景激活和清空同时触发了 `sceneStateManager.onDidChangeState`、`appEventBus.emit("scene:activated")`、`appEventBus.emit("scenes:changed")`，在几毫秒内多次调用 `refresh()`，加剧了 Monaco 内部的 Token 竞态取消。
**解决方案**:
1. **无感微触唤醒管线 (Non-intrusive Decoration Wake-up / `flushVisibleEditors`)**：
   抛弃侵入性的 `showTextDocument`，改用轻量级空装饰触碰：通过 `editor.setDecorations(dummyDecorationType, [])`。这会触发 Monaco 底层的 `deltaDecorations` 逻辑，在完全不抢占侧边栏焦点、不触碰选区、微秒级开销下，强制唤醒失焦编辑器的重绘计算；
2. **清除尾随双发定时器与事件去重**：
   彻底移除 `refresh()` 内部的 50ms 尾随双重 `.fire()` 定时器。去除 `scene:activated` 对 `refresh()` 的冗余绑定，确保一次场景操作仅发出单次精准、干净的 `_onDidChangeInlayHints.fire()`，彻底消除 IPC 往返窗口期的踩踏与丢事件；
3. **工作区根路径大小写标准化比对**：
   在 `ActiveBreakpointIndex.isUpToDate` 中引入 `normalizeFsPath`，解决 Windows 盘符（如 `D:` 与 `d:`）因大小写严格比对导致缓存命中失败的隐蔽问题；
4. **文档选择器标准化规范**：将 `registerInlayHintsProvider` 的选择器限定为 `[{ scheme: "file" }, { scheme: "untitled" }]`。
**影响文件**: `src/ui/views/sceneInlayHintsProvider.ts`, `src/application/activeBreakpointIndex.ts`, `src/ui/commands/sceneCommands.ts`, `test-e2e/suite/06_inlay_hints.test.ts`
**日期**: 2026-10-05

### 1.25 从被动拉取（Pull）到主动推送（Push）：以 TextEditorDecorationType 根治失焦侧边栏交互下行末注解不刷新 (Push-based Decoration Pipeline for Scene Annotations)

**问题**: 用户在侧边栏 TreeView 中点击激活场景时，可见文本编辑器行末的 Inlay Hints 注解不能即刻呈现；在侧边栏取消激活（清空）时，行末注解也未即刻消除；后续再次激活依旧不显示，直到用户在编辑器里点一下鼠标或者点击侧边栏的具体断点条目后，提示才突然同步。
**原因**:
1. **被动拉取模型 (Pull Model) 的物理局限**：VS Code 原生 `InlayHintsProvider` 主要服务于 LSP 语言服务器（如 TypeScript 类型提示、参数名提示），其重绘周期由 Monaco 内核的 `InlayHintsController` 驱动。Monaco 的设计对处于失焦（blurred/unfocused）状态的编辑器具有严格的降频与挂起策略，单纯触发 `_onDidChangeInlayHints.fire()` 无法强行击穿失焦屏障；
2. **点击断点条目与侧边栏激活的物理差异**：用户点击侧边栏断点条目时，底层执行了 `vscode.open` 并在参数中携带了 `selection: Range`，这不仅移动了光标，而且强制将焦点带入了编辑器内部，唤醒了 Monaco 的 `onDidFocusEditorText` 与光标监听器；而侧边栏激活/取消激活仅在 TreeView 上操作，焦点仍在侧边栏，Monaco 编辑器持续处于睡眠状态。
**解决方案**:
1. **采用主动推送装饰管线 (Push-based TextEditorDecorationType Pipeline)**：
   遵循业界顶级插件（GitLens、ErrorLens、Bookmarks 等）的最佳实践，使用 `vscode.window.createTextEditorDecorationType` 建立权威视图推送图层。`editor.setDecorations(decorationType, decorations)` 是 Extension Host 对 Monaco 视图层的直接主动推送机制，**完全不受编辑器失焦、后台或分屏节流影响**，在激活场景的当前微任务周期内即刻完成渲染；在取消激活或清空场景时，直接调用 `editor.setDecorations(decorationType, [])` 瞬间全清（0ms 响应）；
2. **像素级视觉对齐与 Markdown 悬停富文本保真**：
   在 `DecorationOptions` 中通过 `after: { contentText, color: new vscode.ThemeColor("editorInlayHint.foreground"), backgroundColor: new vscode.ThemeColor("editorInlayHint.background") }` 实现与原生 Inlay Hints 完全一致的视觉呈现；并通过 `hoverMessage` 挂载包含场景名、步骤序号、断点类型、触发条件、命中计数以及代码漂移自愈状态的丰富 Markdown 提示卡片；
3. **状态记录与可见编辑器生命周期全景同步**：
   由 `SceneInlayHintsProvider` 统一记录与同步状态：在 `sceneStateManager.onDidChangeState`、`appEventBus.on("breakpoints:changed")`、`appEventBus.on("scenes:changed")`、`vscode.window.onDidChangeVisibleTextEditors`、`vscode.window.onDidChangeActiveTextEditor` 等全量生命周期切面中统一调用 `updateDecorations()`；
4. **核心逻辑提炼消除重复与 CRAP 立方惩罚**：
   提炼 `getGroupedBreakpointsForDocument` 私有方法，统一承接活跃场景校验、断点索引同步、文档断点过滤与按行聚合步骤，消除 `updateDecorations` 与 `provideInlayHints` 之间的重复代码，将单函数圈复杂度控制在安全阈值，保障全工程平均 CRAP <= 3.5。
**影响文件**: `src/ui/views/sceneInlayHintsProvider.ts`, `src/application/activeBreakpointIndex.ts`, `src/application/sceneStateManager.ts`
**日期**: 2026-10-05

### 1.26 showInformationMessage 用户关闭提示返回 undefined 与哨兵动作相等比较导致误触发更新分支 (Dismissed Prompt Returns undefined Misfiring Action Branch)

**问题**: Skill 更新提示弹窗中，用户不点击任何按钮直接关闭提示（Esc / 点击弹窗外区域）时，流程仍走入"立即更新"分支：显示"Successfully updated 0 Skill(s)"的成功提示；当单个目标 Skill 存在自定义修改时，还可能误触发 View Diff 视图。
**原因**: `vscode.window.showInformationMessage` 在用户直接关闭提示时返回 `undefined`（而非拒绝 Promise）。修复前的分支判定采用 `const selected = await showInformationMessage(...); if (selected === updateAction) {...}`，而 `updateAction` 作为 `MessageItem` 哨兵值恰为 `undefined` 时，`undefined === undefined` 判定为 `true`，用户"什么都不选"被语义污染为"选择了更新动作"。
**解决方案**: 在比较前增加显式 `undefined` 守卫——用户关闭提示时立即安全返回，严禁让"无选择"落入任何动作分支的相等比较；推广规则：所有基于 `showInformationMessage`/`showWarningMessage` 返回值驱动的分支，必须先处理 `selected === undefined`（用户关闭）路径，再进行动作匹配，且动作哨兵值禁止为 `undefined`。
**影响文件**: `src/ui/commands/skillCommands.ts`, `test/unit/ui/commands/skill_commands.test.mjs`
**关联变更**: #91d125b（新增 skill_commands 测试套件 9 场景，CRAP 极端函数 13 -> 12）
**日期**: 2026-10-06

### 1.27 外部编辑指纹冲突被静默回滚：内部落盘"洗白"磁盘漂移信号与依赖注入断链 (External Edit Silently Overwritten by Fingerprint Self-Healing)

**问题**: 用户（或 AI）外部编辑 `debug-scenes.json` 重锚定断点行号但保留旧 `contextSnippet` 时，激活管道经 `HealingEngine.heal` 判定 `isHealed` 后直接 `updateLine(旧行号)` 静默回滚用户编辑，并经 `persistHealedBackfill` 落盘固化旧行号与旧指纹，全程零提示。
**原因**: 两个叠加缺陷——① 自愈管道只认指纹结论，无外部编辑门控信号；② watcher 路径中 `autoEnrichEmptyFingerprints` 先行落盘会刷新 `echoLoopGuard.lastSavedContent` 基线，把"磁盘内容 ≠ 内部写盘基线"的外部编辑信号"洗白"为 false，仅凭漂移判定会失真。此外 `handleExternalChange` 收到的注入 `lineReader` 未透传至 `sceneManager.activateScene`（生产依赖全局默认依赖所以未暴露），测试注入即断链。
**解决方案**: 新增 INV-031 双通道门控——watcher 路径显式下发 `conflictDetection: "enabled"` 标记（绕过基线洗白时序坑）；命令路径以 `isDiskContentModifiedSinceLastSave`（冷启动 `seedBaseline` 播种防误伤）作为门控信号。冲突命中时经裁决回调弹窗决策（`disk` 保留磁盘行号并作废旧指纹按磁盘行重提取 / `fingerprint` 维持回滚），用户关闭弹窗缺省 `disk`；回调缺失维持现状（向后兼容）。同时修复 `activateScene` 透传 `lineReader`。
**影响文件**: `src/application/sceneActivationPipeline.ts`, `src/application/agentSyncService.ts`, `src/application/sceneManager.ts`, `src/infra/storage/echoLoopGuard.ts`, `src/infra/vscode/listeners/configFileWatcherListener.ts`, `src/extension.ts`, `src/ui/utils/promptHelpers.ts`
**关联变更**: #TASK-EXT-CONFLICT（INV-031）
**日期**: 2026-10-07

### 1.28 Webview 画布架构重构：Preact 声明式组件化与 Cytoscape CSS 变量 Canvas 渲染陷阱 (Preact Webview Componentization & Cytoscape CSS Variables Trap)

**问题**: 
1. 初始版本的 Webview 画布视图在 TS 代码中拼接大段 HTML 字符串，配合原生命令式 DOM 操作（`document.createElement` / `appendChild` / `innerHTML`），当增加工具栏、标签页切换、单节点脉冲动画、悬停卡片与轨迹时，状态流转与 DOM 节点更新极其散乱，交互扩展与维护成本急剧攀升；
2. Cytoscape.js 在 HTML5 Canvas 图层中绘制复合节点文字（如泳道场景标题）时，文字颜色若直接使用 CSS 变量（如 `var(--vscode-editor-foreground)`），Canvas 无法解析 CSS 变量表达式，静默降级（fallback）为纯黑色 `#000000`，在深色主题下完全不可见；
3. 未激活状态的断点卡片如果直接使用外层容器全局 `opacity: 0.65`，深色背景透出冲淡了卡片内文字，导致弱光或低对比度主题下断点文件路径与行号模糊难辨。

**原因**:
1. 命令式拼装 HTML 缺乏单向数据流与虚拟 DOM 局部补丁机制，随着交互组件增多必然演化为意大利面条式代码；
2. HTML5 `<canvas>` 的 2D 绘图上下文（`CanvasRenderingContext2D.fillText`）仅接受标准十六进制/RGB/HSL 色值，不受浏览器 CSS 样式引擎的变量计算器驱动；
3. 全局透明度会级联作用于所有子元素文本的 alpha 通道，在深底浅字的高对比度要求下严重损害可读性。

**解决方案**:
1. **轻量引入 Preact 声明式组件化**：将 Preact 作为 `devDependency`（零生产运行时依赖，生产 `dependencies` 保持为空），在构建期通过 esbuild 打包至 `media/graph/graphWebview.js`（压缩后仅 24.3 KB，VSIX 体积 330 KB，远低于 GR-001 500 KB 刚性上限）。基于组件树（`App` -> `TabBar` / `ScopeBar` / `FlowView` / `TraceView` / `BreakpointCard` / `Tooltip`）声明式管理状态与渲染；
2. **宿主真实颜色计算提取注入**：在渲染前通过 `window.getComputedStyle(document.body).getPropertyValue("--vscode-...")` 动态提取解析后的真实十六进制或 RGB 颜色字符串，以纯色值传递给 Cytoscape 的 `style` 配置字典；
3. **分层状态与局部高对比度样式**：取消卡片外层容器全局 `opacity`，改为通过边框虚线（`border-style: dashed`）、灰度状态徽标（`pill badge`）与半透明背景来表达未激活状态，确保卡片文本始终以 100% 不透明度呈现，文字清晰锐利。

**影响文件**: `src/ui/views/graphCanvas/webview/*`, `scripts/build-graph-bundle.mjs`, `package.json`
**日期**: 2026-10-07

### 1.29 Webview 激活状态双向闭环、CSS Border 简写覆盖陷阱与防焦点夺取交互设计 (Webview State Sync, CSS Border Shorthand Pitfall, and Non-Intrusive Card Interactions)

**问题**:
1. 用户在 Webview 画布上点击激活场景，或者外部修改场景激活状态时，画布未实时更新，卡片仍持续显示为“未激活”；且无激活场景时画布陷入空白状态；
2. 卡片左侧的断点类别强调色条（如条件断点黄条、命中计数绿条、标准行断点蓝条等）在未激活时莫名消失，只显示灰框；
3. 界面中混杂 Emoji 图标，不同操作系统下渲染风格怪异且不符合 VS Code 设计系统；
4. 用户在画布中查看节点时，任何单击都会直接触发跳转到源码并夺取活动编辑器焦点（Focus Hijacking），打断了宏观结构审视的心流；
5. 场景数量增多时，顶部场景列表出现横向滚动条，严重破坏整体界面的规整性与紧凑度。

**原因**:
1. **单向事件流断链**：`GraphCanvasController` 原先只监听了 `appEventBus` 的 `scenes:changed` 与 `scene:activated`，但忽略了核心状态机权威单例 `sceneStateManager.onDidChangeState`；同时未向 Webview 暴露激活当前选定场景的闭环通信信道（`activate-scene`）；
2. **CSS `border-color` 简写陷阱**：CSS 中子类 `.bp-card.bp-inactive` 写了 `border-color: var(--bp-border-muted)`，这等价于同时设置了 `top/right/bottom/left` 四个方向，将 `.bp-card` 原本设置的 `border-left-color: var(--bp-accent)` 强行覆盖冲刷；
3. **Emoji 缺乏设计自适应性**：Emoji 依赖操作系统字体库，缺乏原生 IDE 的矢量缩放、`currentColor` 自适应与专业感；
4. **宏观浏览与微观编辑的认知冲突 (Cognitive Friction)**：用户查看拓扑图属于高层宏观认知，直接单击跳代码强制切换到微观源码视图，属于反模式（Focus Hijacking）；
5. **平铺水平排列的扩展性硬伤 (Scalability Bottleneck)**：水平平铺标签只适合 2~3 个固定项，当场景达到 5 个以上时出现水平滚动条属于典型 Overwhelm Upfront 设计坏味道。

**解决方案**:
1. **全生命周期状态监听与闭环激活**：
   - 控制器接入 `sceneStateManager.onDidChangeState(() => this.resendAll())`，确保任意途径的场景激活变动实时全量推送到画布；
   - 协议扩充 `{ type: "activate-scene", sceneName: string }`，用户在画布中选中未激活场景时，在 TabBar 提供一键激活按钮驱动宿主 `sceneBreakpoints.applyScene`；
2. **精准定向覆写与 `!important` 边框锚定**：
   - 卡片核心边框样式使用 `border-left: 4px solid var(--bp-accent) !important;`；
   - 未激活态仅定向覆盖其余三边：`border-top-color: ...; border-right-color: ...; border-bottom-color: ...;`，誓死捍卫左侧强调色条；
3. **全面升级 VS Code 官方高精矢量 SVG 图标库**：
   - 编写 `icons.tsx`，以 `currentColor` 内联 SVG 替换全部 Emoji（Line, Cond, Log, Hit, Func, Ref, Warning, OpenExternal, Zap），完全自适应 VS Code 主题色；
4. **渐进披露式交互分级 (Progressive Disclosure)**：
   - 区分操作意图：卡片单击为高亮选中（`onSelect` 聚焦上下文并驱动轨迹联动），双击（`onOpenSource`）或点击右上角独立直达按钮（`[↗]`）方跳转源码；
5. **收敛为 Combobox + Popover 下拉选择面板**：
   - 移除粗暴的平铺水平栏，收敛为标准 `SceneSelector` 下拉组件：集成搜索框、场景状态分组（“● 激活中” / “○ 预览中”）、单选聚焦、多选对比，彻底清除横向滚动条，释放 34px 垂直空间。

**影响文件**: `src/ui/views/graphCanvas/GraphCanvasController.ts`, `src/ui/views/graphCanvas/graphMessageProtocol.ts`, `src/ui/views/graphCanvas/webview/*`, `docs/knowledge-base/flows.md`
**日期**: 2026-10-07

### 1.30 Webview 伴随分屏（Companion Mode）调度防遮挡与零依赖高精 Canvas 鹰眼小地图 (Companion Mode ViewColumn Resolution and Zero-Dep Canvas Minimap)

**问题**:
1. 用户在查看画布时，点击节点跳转到源码文件，代码文件直接覆盖了画布所在的 Editor Tab，导致画布消失，用户必须频繁切换 Tab，体验极度割裂；
2. 只能通过右键上下文菜单或命令面板打开画布，操作路径长且不易发现；
3. 大规模场景拓扑下，滚轮缩放迟缓（默认 `wheelSensitivity: 0.2` 过小），且缺乏全局视口感（不知道当前身处全图何处）。

**原因**:
1. **单一 ViewColumn.Active 独占冲突**：`GraphCanvasController.createPanel` 原先直接使用 `vscode.ViewColumn.Active`，而代码文件也是通过 `showTextDocument` 在同一列打开，导致代码与 Webview 争抢同一个编辑组；
2. **菜单入口层级过深**：未在 VS Code 的 `view/title` 侧边栏标题栏暴露顶级常驻命令；
3. **第三方鹰眼插件体积庞大**：市面上 Cytoscape 导航小地图扩展多包含大量 DOM 节点和臃肿样式，引入会严重突破 GR-001（零生产运行时依赖、VSIX <= 500 KB）硬限制。

**解决方案**:
1. **伴随分屏智能决策（Companion Mode ViewColumn Resolution）**：
   - 提取纯函数 `resolveCanvasColumn`：若当前已有打开的活动编辑器，画布优先在右侧分屏（`ViewColumn.Beside`）打开，天然形成左侧看代码、右侧看拓扑的并排伴随视图；
   - 提取纯函数 `resolveTargetSourceColumn`：当在画布中跳转源码时，若画布位于右侧分屏（`>= ViewColumn.Two`），代码强制在左侧主屏（`ViewColumn.One`）激活；若画布位于主屏，代码在分屏打开。**代码与画布永不争抢同一编辑器组**，实现真正的沉浸式双屏联动；
2. **侧边栏顶栏常驻图标**：在 `package.json` 的 `view/title` 配置 `sceneBreakpoints.showGraph`（`navigation@0`），使用 `$(workflow)` 图标，一键直达；
3. **零依赖原生 HTML5 Canvas 鹰眼小地图 (Minimap)**：
   - 手写 `Minimap.tsx`（压缩后不足 3 KB，支持 DPR 视网膜高清），实时双向映射节点全景包围盒与当前视口矩形（Viewfinder）；
   - 支持点击/拖拽视口快速平移，提供一键收起/展开，不引入任何第三方 npm 依赖；
4. **缩放灵敏度调优与视口控制栏**：
   - 调整 `wheelSensitivity: 0.8`（提升 4 倍跟手度）；
   - 提供悬浮视口控制栏（`+` / `−` / `⤢ 适配全屏` / `1:1`），并支持双击画布空白处自动全屏居中。

**影响文件**: `package.json`, `src/ui/views/graphCanvas/GraphCanvasController.ts`, `src/ui/views/graphCanvas/webview/*`, `test/unit/ui/views/graph_canvas/graph_canvas_controller.test.mjs`
**日期**: 2026-10-07

### 1.31 复合节点拖拽子代联动、卡片坐标 RAF 节流对齐与视口记忆恢复 (Compound Node Drag-Descendants Sync and Viewport Preservation)

**问题**:
1. 用户在画布中点击节点跳转到源码文件时，由于焦点切换触发重发，画布缩放（Pan/Zoom）被强制复位重置，打断了浏览心流；
2. 拖拽场景泳道外框（`.lane` 复合父节点）时，外框移动了但里面的断点节点与卡片完全没有跟着动；
3. 场景选择栏多选时使用“N 个场景对比中”，产生在做 Diff 比较的语义歧义。

**原因**:
1. **视口无记忆重建 (State Reset on Rebuild)**：在 `FlowView` 中，每次接收到 `snapshot` 重建 Cytoscape 实例时，未保存并恢复上一次的视口坐标，`dagre` 布局自动将其重置到默认初始视口；
2. **Cytoscape 复合父节点与 HTML 浮层双重脱节**：
   - Cytoscape 原生规范中，拖动复合父节点（Compound Parent）并不会自动带动子节点（Descendants）；
   - 同时，HTML 断点卡片的坐标更新原先仅绑定在 `layoutstop` 事件上；在节点被直接拖拽（`drag`/`position`）时没有更新卡片 `positions`，导致 HTML DOM 卡片与 Cytoscape 占位框严重脱节。

**解决方案**:
1. **视口状态记忆（Viewport Preservation）**：
   - 在 `FlowView` 中引入 `savedViewportRef`，在销毁旧实例前捕获 `cy.pan()` 与 `cy.zoom()`；并在新实例 `layoutstop` 时通过 `cy.viewport(...)` 自动恢复用户的缩放与平移状态；
2. **复合节点子代拖拽联动（以 e.position 鼠标真实物理坐标为基准）**：
   - ⚠️ **严防父节点包围盒坐标正反馈死循环**：Cytoscape 复合父节点（Compound Node）的位置是根据子节点包围盒计算的纯函数推导值，严禁用 `e.target.position()` 算位移增量（否则修改子节点会瞬间改变父节点自身，导致位移量指数级翻倍飞移出屏幕！）；
   - 正确做法：在 `cy.on("grab", "node:parent")` 中记录 `lastMousePos = { x: e.position.x, y: e.position.y }`；在 `drag` 中以 `e.position`（鼠标在 Cytoscape 坐标系中的真实物理位置）计算 $(dx, dy)$ 增量，通过 `e.target.descendants().not(":parent").positions(...)` 逐帧同步平移其所有子孙节点；
3. **RAF 节流卡片实时吸附**：
   - 在节点 `drag` 事件中通过 `requestAnimationFrame` 节流调度 `updatePositions()`，确保 HTML 卡片与图形引擎 100% 像素级吸附对齐；
4. **多选语义修正**：
   - 将“对比中”修改为自然直观的“已展示 N 个场景”，彻底清除语义歧义。

**影响文件**: `src/ui/views/graphCanvas/webview/components/FlowView.tsx`, `src/ui/views/graphCanvas/webview/components/SceneSelector.tsx`
**日期**: 2026-10-07

### 1.32 Webview retainContextWhenHidden、Dagre 同步布局错失事件与 Minimap 物理 Pan 坐标映射 (Webview retainContextWhenHidden, Synchronous Layout Timing, and Minimap Physical Pan Coordinates)

**问题**:
1. 用户在画布双击断点卡片跳转源码时，画布缩放（Zoom/Pan）仍然被强制重置回初始视图；
2. 鹰眼小地图（Minimap）中的蓝色视口矩形（Viewfinder）用鼠标拖拽完全不会动。

**原因**:
1. **Dagre 同步布局错失 layoutstop 监听时机**：
   在 `FlowView` 中，Cytoscape 初始化配置了 `layout: { name: "dagre", animate: false }`。同步布局在 `cytoscape({...})` 构造函数内部就已经同步完成并触发了 `layoutstop` 事件！代码在构造函数执行完毕后才注册 `cy.on("layoutstop", ...)`，导致初次布局的视口恢复回调根本没有被触发；同时控制器未配置 `retainContextWhenHidden: true`，在焦点切换至文本编辑器时 Webview 上下文面临被 VS Code 卸载重建风险；
2. **非法 API 调用导致 Minimap 蓝框无法平移**：
   在 `Minimap` 中原先调用了 `cy.center({ x: targetX, y: targetY })`。然而 Cytoscape 官方的 `cy.center(eles)` **仅接受 Collection 元素集合参数，根本不接受坐标对象**！传坐标对象直接被静默忽略为 No-op，导致主画布的 `pan` 从未改变，小地图自然无法联动；同时原先采用 `mouse` 事件而非 `pointer` 事件，鼠标稍微移出 180×120px 视窗就丢失拖拽流。

**解决方案**:
1. **即刻恢复视口与后台上下文保活**：
   - 在 `FlowView` 中，于 `cytoscape({...})` 构造完毕后，立即无缝执行 `if (savedViewportRef.current) cy.viewport(...)`，消除对异步 `layoutstop` 事件的时序依赖；
   - 在 `GraphCanvasController` 中设置 `retainContextWhenHidden: true`，确保失焦时 DOM 树与 Canvas 上下文不被丢弃；
2. **正确解算视口中心平移物理公式**：
   - 目标模型坐标 $(X_m, Y_m)$ 对齐主视口中心 $(\frac{W}{2}, \frac{H}{2})$ 的物理公式：
     $$\text{newPanX} = \frac{\text{cy.width()}}{2} - X_m \times \text{cy.zoom()}$$
     $$\text{newPanY} = \frac{\text{cy.height()}}{2} - Y_m \times \text{cy.zoom()}$$
     通过合法的 `cy.pan({ x: newPanX, y: newPanY })` 驱动平移；
   - 采用 Pointer Events 并配合 `setPointerCapture` / `releasePointerCapture`，确保鼠标在任意速度与移出小地图边界时均能平滑拖拽。

**影响文件**: `src/ui/views/graphCanvas/GraphCanvasController.ts`, `src/ui/views/graphCanvas/webview/components/FlowView.tsx`, `src/ui/views/graphCanvas/webview/components/Minimap.tsx`
**日期**: 2026-10-07

### 1.33 衍生 IDE 中 ThemeColor 解析断层与树节点本地 SVG 兼容性实践 (ThemeColor Breakdown in Forked IDEs and Resilient Local SVG Tree Icons)

**问题**:
1. Antigravity IDE 中场景树（TreeView）的子场景引用节点前面图标不显示（空白透明），而在 Trae 中能显示；
2. 子场景引用断点后面的内联操作图标与普通断点的“在配置文件中定位”图标（`$(go-to-file)`）完全重叠混淆，操作意图不清晰。

**原因**:
1. **衍生 IDE ThemeColor 变量映射缺失**:
   在 `treeNodes.ts` 中原先使用了 `new vscode.ThemeIcon("git-branch", new vscode.ThemeColor("charts.blue"))`。在 VS Code 衍生 IDE（如 Antigravity IDE、Trae、Cursor）中，宿主自带的主题调色板与 Codicon CSS 变量并不完全同构。当宿主未暴露 `charts.blue` 调色板变量时，Trae 内部做了降级容错，而 Antigravity IDE 会因颜色规则解析失效直接导致图标容器透明或丢弃渲染；
2. **命令图标语义冲突**:
   普通断点的 inline 按钮 `sceneBreakpoints.revealInConfigFile`（在 `debug-scenes.json` 定位）配置为 `$(go-to-file)`；子场景引用的断点 inline 按钮 `sceneBreakpoints.revealRefSource`（定位源场景定义）同样配置为 `$(go-to-file)`，导致同一树视图中相同图标承载了两种不同的语义动作。

**解决方案**:
1. **本地高精矢量 SVG 消除宿主依赖**:
   - 在 `media/icons/` 中引入专用的 `scene-ref-enabled.svg`（高对比主色）与 `scene-ref-disabled.svg`（低饱和置灰）矢量图标文件；
   - 在 `SceneRefTreeItem` 中支持通过 `vscode.Uri.file(...)` 加载本地磁盘 SVG 图标，彻底摆脱对宿主 IDE CSS 变量与 `ThemeColor` 的运行期解析依赖；
   - 若未透传 `extensionPath`，安全降级回退至无附加色的纯净 Codicon `new vscode.ThemeIcon("references")`；
2. **精准区分操作图标语义**:
   - 在 `package.json` 中将 `sceneBreakpoints.revealRefSource` 的图标重构为标准 Codicon `$(references)`（指向源引用的书本箭头），与 `$(go-to-file)`（跳转配置文件）形成显著语义区隔。

**影响文件**: `package.json`, `src/ui/views/treeNodes.ts`, `src/ui/views/sceneRefProjection.ts`, `media/icons/scene-ref-enabled.svg`, `media/icons/scene-ref-disabled.svg`
**日期**: 2026-10-07

### 1.34 Webview Payload 序列化浅拣选漏透传与 i18n 多语言硬编码回退陷阱 (Webview Payload Shallow Picking and i18n Fallback Trap)

**问题**:
在场景可视化画布中切换到“命中轨迹”时，空状态错误展示为硬编码英文 `"No trace records."`，未能展示语言包已翻译的本地化文案 `"本次调试会话暂无断点命中记录。"`。

**原因**:
1. **HTML 注入 Payload 浅拣选漏字段**：
   在 `graphWebviewDocument.ts` 的 `buildGraphWebviewDocument` 中，向 `<script id="sb-payload">` 注入数据包时，手动挑选了 `labels: { sceneInactive: ..., laneCircular: ... }`，遗漏了 `traceEmpty`、`flowEmpty` 等标签的展开；
2. **Webview 组件静默回退硬编码默认值**：
   `TraceView.tsx` 依赖 `{labels.traceEmpty || "No trace records."}`。当字段为 `undefined` 时静默吞掉真实国际化配置并降级为英文，使得 i18n 测试难以在运行时直接感知。

**解决方案**:
1. **全量展开透传（Forward All Labels）**：
   在 `buildGraphWebviewDocument` 中使用 `labels: { ...labels }`，确保宿主经由 `vscode.l10n.t` 计算的所有标签 100% 完整流入 Webview 数据契约；
2. **规范化组件兜底文案**：
   将 `TraceView.tsx` 中的回退默认字符串与规范主英文词条 `"No hit records in this debug session yet."` 严格对齐，并在单元测试中新增全量 label 序列化注入断言保护。

**影响文件**: `src/ui/views/graphCanvas/graphWebviewDocument.ts`, `src/ui/views/graphCanvas/webview/components/TraceView.tsx`, `test/unit/ui/views/graph_canvas/graph_webview_document.test.mjs`
**日期**: 2026-10-08

### 1.35 编辑器选区监听自激回流风暴、DAP 内部栈帧穿透与 TraceView 滚动防跳实践 (Editor Selection Self-Triggering Loop, DAP Internal Frame Penetration, and Scroll Jitter Prevention)

**问题**:
1. 用户在 TraceView 时间轴上点击断点卡片定位源码时，界面偶发红框脉冲闪烁（`live-pulse`），且刚选中的卡片蓝框焦点被强行抢夺跳回；
2. 命中跟踪列表中偶发出现 `<node_internals>/internal/modules/esm/module_job:303` 等非源码帧，抢占真实业务断点，点击定位抛错失效；
3. 点击断点卡片定位源码时，TraceView 面板自身的滚动条会突兀地向下一跳，产生明显的抽搐感。

**原因**:
1. **编辑器选区监听自激回流 (Self-triggering Loop)**：
   `debugLifecycleListener` 的 `createEditorCheckListener` 监听了 `onDidChangeTextEditorSelection`，在有调试会话时，若光标落在场景断点行就直接派发 `debug:paused`。当用户在 TraceView 中点击定位源码时，宿主主动移动编辑器光标，被该监听器误判为“运行时又命中了断点”，触发了假的 `debug:paused` 广播，导致 Webview 收到 `live-pulse` 红框闪烁，同时轨迹流压入重复新记录，强制夺走了前端卡片选中态；
2. **DAP 栈帧机械抓取 Frame 0 穿透内部模块**：
   在 Node.js ESM 启动或调度时，Frame 0 为 Node 内部虚拟帧 `<node_internals>`，真实业务断点位于后续帧。直接取 `stackFrames[0]` 导致虚拟内部路径污染轨迹，且点击时本地磁盘无对应物理文件导致定位失败；
3. **TraceView 自动贴底机制被伪记录误触发**：
   `TraceView.tsx` 原逻辑仅依赖 `isAtBottom`，在假记录压入导致组件重绘时，强制执行了 `el.scrollTop = el.scrollHeight`，造成容器滚动条突兀跳动。

**解决方案**:
1. **导航抑制锁 (Navigation Guard)**：
   在应用层 `debugPauseContext.ts` 引入 `setSourceNavigationLock` 瞬态锁；在宿主 `revealSource` 执行期间加锁并在 350ms 窗口期内完全屏蔽 `checkEditor`，彻底斩断事件自激回流闭环；
2. **DAP 栈帧过滤与真实源码优先 (selectBestUserSourceFrame)**：
   在 DAP 堆栈解析中过滤 `<node_internals>`、`node:*`、`internal/` 等内部虚拟路径，优先选取匹配当前激活场景断点的物理帧，兜底取首个用户物理源码帧；
3. **TraceView 交互视角锁定与单向贴底**：
   引入 `prevRecordsLengthRef`，仅在真正有新断点到达且此前处于底部时才跟随贴底；用户主动点击任意卡片时立即设置 `setIsAtBottom(false)` 并锁定当前滚动视角，彻底根除任何滚动条跳动。

**影响文件**: `src/infra/vscode/listeners/debugLifecycleListener.ts`, `src/application/debugPauseContext.ts`, `src/ui/views/graphCanvas/graphCanvasController.ts`, `src/ui/views/graphCanvas/webview/components/TraceView.tsx`, `test/unit/infra/vscode/listeners/listeners_registry.test.mjs`
**日期**: 2026-10-10

### 1.36 DAP 堆栈多次响应重复上报、单次暂停幂等防抖与 TraceView 滚动条 0 像素锁定实践 (DAP Multi-stackTrace Dedup, Single-pause Idempotency, and Zero-jitter Scrollbar Lock)

**问题**:
1. 调试断点命中时，时间轴轨迹中偶尔会出现两步一模一样的命中（例如 `#1 cli.ts:27 00:01:24.383` 与 `#2 cli.ts:27 00:01:24.488 +105ms`），且被算法折叠成了“🔁 [CLI 进程入口] 循环 2 次 (2 步) 🔴 当前停在循环中”，形成伪循环假象；
2. 在 TraceView 中点击断点卡片定位源码文件时，画布面板中的滚动条经常会突兀地向下一跳/抽搐。

**原因**:
1. **DAP 协议的多阶段 stackTrace 响应与编辑器跟随双重击穿**：
   - 当 DAP 发出 `stopped` 事件后，VS Code 调试面板为了渲染调用栈、局部变量及监视表达式，会在约 100ms 左右连续返回多次 `stackTrace` 响应。若调试生命周期监听器每次收到 `stackTrace` 都机械地调用 `revealPausedBreakpoint`，同一次物理暂停就会被上报多次；
   - 此外，VS Code 在断点命中后会自动打开该文件并将光标定位至断点行，`checkEditor` 监听到光标在场景断点行，若没有单次暂停捕获状态保护，也会在 105ms 左右补发一次 `debug:paused`；
   - 两条相隔 105ms 的相同命中记录被压入 `DebugTraceBuffer`，时间线折叠算法将其识别为循环，卡片由普通单步卡片剧烈重组为循环折叠块，DOM 高度产生瞬间变化；
2. **记录增加触发自动贴底与点击事件未锁视口**：
   - 伪重复记录写入触发了 `trace-append`，`records.length` 变大导致 `TraceView` 执行了 `el.scrollTop = el.scrollHeight`，将滚动条猛烈向下拉扯；
   - 用户在点击卡片时，未对滚动容器的 `scrollTop` 做瞬态锁定与事件冒泡隔离，组件选区重新渲染与浏览器原生焦点重绘导致了像素级位移。

**解决方案**:
1. **DAP 适配器单次暂停捕获锁（`hasCapturedThisPause`）**：
   - 在 `createDapTrackerFactory` 中为每个调试会话维护 `hasCapturedThisPause` 标志：收到 `stopped` 时置 `false`；首个合法的用户源码帧成功解析并上报后立即置 `true`；后续所有的 `stackTrace` 响应直接跳过；直到收到 `continued` 或 `terminated` 事件后才复位；
2. **模块级 DAP 暂停捕获状态拦截（`isCurrentPauseCapturedByDap`）**：
   - 在 DAP 处于暂停且已捕获状态期间，`createEditorCheckListener` 的 `checkEditor` 直接静默返回，彻底隔绝编辑器光标跟随定位引起的二次触发；
3. **应用层 TraceBuffer 物理防抖终极底线（Idempotency Guard）**：
   - 在 `DebugTraceBuffer.append(file, line)` 入口处增加物理防抖：若最后一条记录满足 `last.file === file && last.line === line && (now - last.wallTime < 500)`，直接返回 `last`，坚决不追加重复记录；
4. **TraceView 交互 0 像素位移锁定**：
   - 在 `handleStepClick` 与 `toggleLoop` 中增加 `e.stopPropagation()` 隔离事件；同时捕获触发前的 `currentScrollTop`，在 `requestAnimationFrame` 中确保 `el.scrollTop === currentScrollTop`，实现绝对 0 像素跳动。

**影响文件**: `src/infra/vscode/listeners/debugLifecycleListener.ts`, `src/application/debugTraceBuffer.ts`, `src/ui/views/graphCanvas/webview/components/TraceView.tsx`, `test/unit/infra/vscode/listeners/listeners_registry.test.mjs`, `test/unit/application/debug_trace_buffer.test.mjs`
**日期**: 2026-10-11

### 1.37 G6 HTML 节点原生事件遮挡导致滚轮缩放失效、层级视觉降噪与国际化沉淀 (G6 HTML Node Wheel Event Piercing, Layer Noise Reduction, and UI Internationalization)

**问题**:
1. 在流程图画布（FlowView）中，当鼠标悬停在断点卡片（`.bp-card`）或子场景卡片（`.sc-scene-card`）上时，滚动鼠标滚轮无法触发画布缩放；
2. 场景选择器下拉列表中每个场景后方均机械显示大写的 `TEAM` 标签，个人/独立开发者在单人开发场景下感到困惑与违和，且全部贴标造成了视觉噪点；
3. 卡片类型徽章为纯英文缩写（`Line`、`Cond`、`Log`、`Hit`、`Func`、`Ref`），Tooltip 为 `● Line` 等，且宿主未配置语言包时出现 `Not Active` 英文。

**原因**:
1. G6 v5 的 `ZoomCanvas` behavior 默认仅向底层的 `<canvas>` 视口挂载了 wheel 监听。当图节点配置为 `node: { type: "html" }` 时，各卡片为脱离 canvas 渲染树的原生 DOM `div` 元素。鼠标悬停在卡片上触发的原生 `wheel` 事件直接派发到该 DOM 节点，未能被底层 canvas 捕获，导致缩放交互被阻断；
2. 业务模型中的 `team` 仅代表 Git 跟踪的工程标准场景（`.vscode/debug-scenes.json`），`local` 代表本地私有草稿（`.vscode/debug-scenes.local.json`）。默认工程场景无需过度强调，仅当处于本地私有场景时方需特殊提示；
3. 部分组件徽章使用了未经本地化的类型大写缩写。

**解决方案**:
1. **容器级 Wheel 事件精准桥接与原点传递**：
   - 在 `#flow-view` 外层容器绑定原生 `onWheel` 事件监听；
   - 当检测到鼠标目标命中卡片（`target.closest(".bp-card, .sc-scene-card")`）时，拦截默认滚动行为（`e.preventDefault()`），以鼠标在画布中的相对视口坐标 `[e.clientX - rect.left, e.clientY - rect.top]` 作为 `origin` 原点参数，平滑驱动 `g6.zoomBy(ratio, { duration: 80 }, origin)`，实现卡片悬停无缝丝滑缩放；
2. **场景分层视觉降噪与心智收敛**：
   - 彻底移除 `team` 默认标签，普通项目场景保持纯净无噪音；
   - 仅当 `sc.layer === "local"` 时渲染小巧精致的 `[本地]` 徽章，悬停明确提示本地私有场景；
3. **卡片徽章与浮窗动态国际化与纯英文 Fallback**：
   - `cardHtml.ts` 与 `Tooltip.tsx` 杜绝任何中文硬编码，静态字典统一回退标准英文（`Line`, `Cond`, `Log`, `Hit`, `Func`, `Ref`）；
   - 所有展示文案与类型标题完全由宿主下发的 `labels` 动态驱动，通过 `vscode.l10n.t` 实现 100% 国际化无缝覆盖。

**影响文件**: `src/ui/views/graphCanvas/webview/components/FlowView.tsx`, `src/ui/views/graphCanvas/webview/components/SceneSelector.tsx`, `src/ui/views/graphCanvas/webview/components/cardHtml.ts`, `src/ui/views/graphCanvas/webview/components/Tooltip.tsx`
**日期**: 2026-10-11

### 1.38 异步写盘防回环安全窗在测试集中运行器中的跨用例状态污染与单文件覆盖率穿透 (EchoLoopGuard Cross-Test State Leakage and Per-File Coverage Transparency)

**问题**:
1. 单独运行 `config_file_watcher_listener.test.mjs` 测试 100% 成功通过，但在集中运行器 `test/run-all.mjs` 中批量执行时，其在测试外部磁盘修改时发生断言失败，导致后续测试套件被截断退出；
2. 全工程整体测试覆盖率虽然高达 95.70%，但个别底层适配器（如 `vscodeLineReader.ts`）在单测中因未触发真实 API 而存在覆盖率盲区（63.15%），被全局大数法则掩盖。

**原因**:
1. **写盘防回环异步延时窗口污染**：
   `echoLoopGuard.markInternalSaving(600)` 在前序测试（如 `json_file_scene_repository.test.mjs`）写盘后会启动 600ms 的保护窗口。在集中运行器中，紧随其后的 watcher 单测在 600ms 窗口内触发外部变更，被误判为“扩展自身的内部写盘行为”，从而直接 `return` 阻断了变更广播；
2. **全局聚合平均 vs 单文件独立阈值**：
   `c8 check-coverage` 默认按所有文件的聚合平均值判定，大模块的高覆盖率容易掩盖小模块的未测分支。

**解决方案**:
1. **基础设施守卫显式暴露 `reset()` 契约**：
   在 `EchoLoopGuard` 中新增 `public reset(): void`，不仅清除内容指纹 Map，更显式取消挂起的 `internalSavingTimer` 定时器并将 `_isInternalSaving` 复位为 `false`；在监听器单测的 setup 和关键步骤前调用 `echoLoopGuard.reset()`，确保测试用例 100% 环境隔离；
2. **单测盲区针对性补齐与双层互补验证**：
   - 为 `vscodeLineReader.ts`、`jsonFileSceneRepository.ts`、`skillDiagnostic.ts` 补充专职单测，将单文件覆盖率从 56%~84% 全量拉升至 90%~100%；
   - 结合 E2E 真实宿主测试采集综合覆盖率，验证底层 VS Code 适配器在真实运行时的完整闭环。

**影响文件**: `src/infra/storage/echoLoopGuard.ts`, `src/infra/vscode/vscodeLineReader.ts`, `test/unit/infra/vscode/listeners/config_file_watcher_listener.test.mjs`, `test/unit/infra/vscode/vscode_line_reader.test.mjs`
**日期**: 2026-10-11

### 1.39 WebviewView 副侧边栏伴随仪表盘与 WebviewPanel 全屏双模协同架构 (WebviewView Secondary Side Bar Companion and Dual-Host Lifecycle Coordination)

**问题**:
1. 调试运行时，VS Code 在断点命中时强制在当前活动编辑器组打开源码文件，与原先处于编辑器 Tab 的画布（`WebviewPanel`）发生激烈的 Tab 竞争与遮挡，破坏“看图伴随看代码”的沉浸式体验；
2. 若仅将画布机械改为 WebviewView，当排查复杂大规模链路需要全景横向扩展时，缺乏大屏全景分析的逃生门；
3. 双宿主（WebviewView 与 WebviewPanel）并存时，应用事件总线（`appEventBus`）生命周期难以判定何时订阅与何时销毁，容易发生泄漏或过早退订。

**原因**:
`WebviewPanel` 始终驻留在编辑器组，编辑器内的所有文件打开行为（DAP 单步调试跳转、用户点击文件）都不可避免地与其争夺空间。而 `WebviewView` 属于独立的侧边栏或副侧边栏（Secondary Side Bar），其在物理结构上完全位于编辑器组之外，结构性消灭了 Tab 污染。

**解决方案**:
1. **双模宿主架构设计（Dual-Host Architecture）**:
   `GraphCanvasController` 实现 `vscode.WebviewViewProvider` 契约，统一持有 `webviewView?: vscode.WebviewView` 与 `panel?: vscode.WebviewPanel`；
2. **副侧边栏常驻伴随优先**:
   在 `package.json` 注册 `viewsContainers.activitybar`（`sceneBreakpointsCanvasContainer`）与 `views`（`sceneBreakpointsGraphView`，`type: "webview"`），支持用户随时将画布一键拖拽至副侧边栏，作为单步调试时永不遮挡的拓扑仪表盘；
3. **保留全屏分析逃生门**:
   视图标题栏配置 `sceneBreakpoints.openGraphInEditor`（“在编辑器标签页中打开”），按需在分栏以 `WebviewPanel` 弹出全屏拓扑大屏；
4. **统一分发与空闲回收机制**:
   `post` 与 `resendAll` 统一按需广播至当前活跃的宿主（单视图或双宿主并存）；只有当 WebviewView 与 WebviewPanel 两者均被销毁（或未被挂载）时，才执行 `disposeBusIfIdle()`，杜绝事件泄漏与早退；
5. **分栏决策解耦**:
   副侧边栏模式跳转源码直接在主编辑器 `ViewColumn.One` 呈现；全屏模式则继续执行 `resolveTargetSourceColumn` 跨分栏防遮挡，彻底实现随处可看、永不遮挡。

**影响文件**: `package.json`, `src/ui/views/graphCanvas/GraphCanvasController.ts`, `src/ui/commands/graphCommands.ts`, `src/ui/commands/index.ts`, `src/extension.ts`
**日期**: 2026-10-16

### 1.40 树视图关键标记前置布局与 DAP 绝对物理路径 vs 相对路径归一化匹配 (TreeItem Front-loading and Path-Tolerant Watch Cache Matching)

**问题**:
1. **关键标记末尾截断陷阱**：断点配置了变量监视锚点（`[👁️ n]`），原先将标记拼接在用户描述文字末尾。在 VS Code 狭窄的侧边栏中，一旦用户描述较长，宿主会在末尾直接打出省略号（`...`）并紧邻内联操作按钮，导致关键的眼睛监视图标被完全遮挡截断；
2. **调试命中求值缓存脱靶**：运行时断点暂停时，DAP 栈帧（`stackFrame.source.path`）返回的是带盘符的大写/小写绝对物理路径（如 `D:\project\...`），而场景配置中记录的是相对路径（如 `packages/agent/...`）。树视图与 InlayHints 用相对路径直接作为 Map 字符串键去取求值结果，产生脱靶（返回 `undefined`），导致树视图 Tooltip 降级显示未求值的静态列表，未能弹出求值结果表格。

**原因**:
1. VS Code 树视图原生 `TreeItem.description` 在可用空间不足时，采用 CSS `text-overflow: ellipsis` 强制截断右侧文本；
2. 跨平台（Windows 反斜杠 vs POSIX 正斜杠、盘符大小写）及工作区相对/绝对路径形态不同，直接通过字符串全等匹配必然失效。

**解决方案**:
1. **语义标记绝对前置协议 (Front-Loaded Semantic Badges)**：
   在 `treeNodes.ts` 中组装 `description` 时，将状态标签（`▶ [PAUSED]`、`[Unmatched]`、`[👁️ n]`）统一部署在前排最左侧，用户自定义长文本描述退居后排。当容器宽度受限时，优先牺牲长文本末尾（省略号），确保核心状态与监视标记 100% 显眼可见；
2. **智能路径归一化匹配缓存 (Path-Tolerant Cache Matching)**：
   在 `debugPauseContext.ts` 中引入多态存储与查询机制，查询时通过 `pathUtils.isFilePathMatch(cachedPath, queryPath, workspaceRoot)` 进行跨平台（大小写、反斜杠、绝对/相对、Monorepo 跨子目录）模糊归一化匹配，彻底解决 DAP 绝对路径与配置相对路径的错位脱靶；
3. **编辑器行末（Inlay Hints）同步呈现**：
   在 `SceneInlayHintsProvider` 监听 `debug:watch-evaluated` 事件，在代码断点行末即时打出 `| 👁️ count=5 ✅, status="REJECTED" ❌`，并在编辑器悬停 Tooltip 呈现完整 Markdown 评估表格，无需将视线切回侧边栏即可获取追踪结果。

**影响文件**: `src/application/debugPauseContext.ts`, `src/ui/views/treeNodes.ts`, `src/ui/views/sceneInlayHintsProvider.ts`
**日期**: 2026-10-17

### 1.41 原生调试悬停抢焦与全行 HoverProvider 兜底治理 (Native Debug Hover Preemption and Whole-Line HoverProvider Guard)

**问题**:
1. **行首/行内悬停原生 `undefined` 抢焦**：调试模式下，VS Code 宿主内置了调试悬停特性（Debug Hover），当鼠标悬停在断点行首或未初始化的变量/语法 token 上时，VS Code 会自动对其求值并在浮窗中显示原生 `undefined`，覆盖或干扰了插件 Inlay Hint 提示卡片，导致用户感觉“只有光标在当前行、小心翼翼去行末瞄准 InlayHint 时才显示，稍一偏离就显示 undefined”；
2. **DAP 变量监视错误黑盒**：求值发生错误（如 `ReferenceError: text is not defined`）时，表格与行末只粗暴显示 `<error>`，隐藏了具体报错原因；
3. **单步调试（Step Over）栈帧漏捕获**：原先采用一次性布尔值 `hasCapturedThisPause`，单步调试进入下一行断点时，因处于同一暂停生命周期被提前忽略，导致第 296 行未能触发监视求值。

**原因**:
1. Inlay Hint 只作为行末虚拟文本存在，命中热区极其狭小；
2. 调试器暂停状态在连续单步时不会频繁收发 `continued`，单纯布尔标志位无法感知行号已变更。

**解决方案**:
1. **编辑器全行原生 HoverProvider 覆盖**：
   实现 `SceneHoverProvider` 并向宿主注册全量文件方案（`{ scheme: "file" }`）。只要当前物理行命中了已激活场景断点，将 Hover 的 `range` 显式声明为整行范围（`0` 到 `lineLength`）。无论鼠标悬停在行首、行中还是变量上，**宿主均优先弹出场景断点富文本卡片**，彻底消灭原生 `undefined` 抢焦困扰；
2. **错误明细透视 (Transparent Error Reporting)**：
   提取报错的第一行错误信息（如 `<error: ReferenceError: xxx is not defined>`）透传展示到 Tooltip 表格与行末 Inlay Hint 摘要中，一眼看清报错原因；
3. **连续单步动态位置键 (Location Key Tracking)**：
   采用 `lastCapturedLocation = "${file}:${line}"` 替代布尔标志，单步调试跳转到新行断点时即刻触发变量求值；并在用户光标选中断点行时增加缺失求值自动补测。

**影响文件**: `src/ui/views/sceneHoverProvider.ts`, `src/ui/views/breakpointTooltipFormatter.ts`, `src/ui/views/sceneInlayHintsProvider.ts`, `src/ui/views/treeNodes.ts`, `src/infra/vscode/listeners/debugLifecycleListener.ts`
**日期**: 2026-10-18
### 1.42 DAP 分页调用栈 (Pagination) Caller 帧回弹与防抖单测假绿陷阱 (DAP StackTrace Pagination Caller Rebound and Anti-False-Positive Test Guard)

**问题**: 用户命中断点暂停时，界面原本正确跳到了目标断点行（如 `main.ts:997`），但瞬间又倒挂跳回了外层调用者断点（如 `cli.ts:27`），断点高亮与定位严重漂移。
**原因**:
1. **DAP 调用栈分页加载导致二次覆盖**：VS Code 在断点命中时，会分批发起 `stackTrace` 请求。第 1 次获取栈顶帧（`main.ts:997`），第 2 次分页请求外层调用栈（`cli.ts:27`，`startFrame: 1`）。若调试监听器移除了单次暂停锁 `hasCapturedThisPause`，第 2 次响应携带外层 Caller 帧再次进入选择器，直接抹杀了真正的栈顶；
2. **堆栈选择器违背第一性原理**：原 `selectBestUserSourceFrame` 在堆栈中向下循环搜寻“属于当前激活场景的断点”。当栈顶为普通代码或其它场景断点、而外层 Caller 恰好在激活场景中时，算法错误越级将 Caller 选为暂停点，造成断点倒挂；
3. **单测数据同质化产生“假绿”**：原有防抖单测在模拟重复 `stackTrace` 时，前后两次输入的帧数据完全相同（都是 `cli.ts:20`）。因此即便删除了单次暂停锁、改用位置对比，单测依然全部通过，未能暴露异帧 Caller 分页回弹的真实缺陷。

**解决方案**:
1. **栈顶物理帧作为唯一准绳 (SSOT Topmost Only)**：
   `selectBestUserSourceFrame` 严格以过滤内部虚拟模块后的首个用户物理帧 `userFrames[0]` 作为当前暂停位置，物理禁止向下遍历 Caller 帧，杜绝断点倒挂；
2. **恢复单次暂停原子锁 (`hasCapturedThisPause`)**：
   在单次 `stopped` 周期内只允许首次有效栈顶派发，物理阻断后续分页 stackTrace 请求对栈顶的篡改；
3. **测试防假绿对抗性断言**：
   单元测试在第 2 次 `stackTrace` 中刻意注入不同的 Caller 帧数据，并针对 Callee/Caller 嵌套调用栈进行反倒挂硬断言，确保即使面对真实 VS Code 分页与复杂多层调用栈也坚如磐石。

**影响文件**: `src/infra/vscode/listeners/debugLifecycleListener.ts`, `src/ui/views/sceneTreeProvider.ts`, `test/unit/infra/vscode/listeners/listeners_registry.test.mjs`
**日期**: 2026-10-18

### 1.43 Node.js 多会话 (Parent-Child Session) 并发冲刷与全局活跃会话主权锁实践 (Multi-Session Launcher Race and Active Pause Authority Guard)

**问题**: 用户使用 `node --import tsx packages/coding-agent/src/cli.ts -p 你好` 调试代码时，断点命中在 `main.ts:997`，但侧边栏树视图依然错位停在 `cli.ts:27 [PAUSED]`；即使单测强化了单会话防 Caller 倒挂，现场依然发生“先跳到正确位置又跳回 `cli.ts:27`”。

**原因**:
1. **多调试会话并发到达 (Parent-Child Multi-Session Race)**：
   在 VS Code 中调试 Node 脚本时，通常存在父会话（启动包装进程，停在 `cli.ts:27` 等待子任务）与子会话（实际执行子进程，停在 `main.ts:997`）。
   `createDebugAdapterTracker` 针对所有会话分别创建 Tracker，子会话命中栈顶 `main.ts:997` 后，父会话的 `stackTrace` 紧随其后到达（只含入口 `cli.ts:27`），由于缺乏全局会话主权约束，父会话发出的事件在 50ms 内覆写了子会话的断点位置；
2. **旁路监听器伪触发**：
   `createEditorCheckListener` 与 `stackItemListener` 在编辑器切换或调用栈帧变更时被触发，在没有权威暂停锁定的情况下误发伪 `debug:paused` 广播；
3. **File URI 前缀未清洗**：
   在某些 Node.js ESM 调试器下，返回路径带有 `file:///` 前缀，导致路径规范化算法误判为跨盘符不匹配。

**解决方案**:
1. **全局活跃会话主权锁 (Active Pause Authority Guard)**：
   在应用层 `debugPauseContext.ts` 引入 `ActivePauseAuthority`，记录当前处于真正断点暂停态的 `sessionId` 与 `threadId`；其余会话（如父包装会话、Worker 线程）发来的 `stackTrace` 一律被阻断，严禁覆写；
2. **旁路监听器防御式降级**：
   在已有 DAP 权威暂停或主权锁定时，完全屏蔽 `checkEditor` 与 `stackItemListener` 的伪触发；
3. **路径标准化剥离 `file://` / `file:///` 协议头**：
   `pathUtils.normalizeFsPath` 自动清洗 URI 前缀，确保 100% 精准匹配。

**影响文件**: `src/application/debugPauseContext.ts`, `src/infra/vscode/listeners/debugLifecycleListener.ts`, `src/shared/utils/pathUtils.ts`, `test/unit/infra/vscode/listeners/listeners_registry.test.mjs`, `test/unit/shared/utils/path_utils.test.mjs`
**日期**: 2026-10-18

### 1.44 调试暂停态下 `DebugHoverWidget` 抢占 `HoverProvider` 与行首 `undefined` 根因治理 (DebugHoverWidget Preemption and EvaluatableExpressionProvider Fallback)

**问题**: 在调试暂停态（`Stopped`）下，即便已经注册了覆盖整行的 `SceneHoverProvider`，当鼠标移入断点行行首（如缩进空白、`let`/`const` 关键字或本行尚未执行的声明左值变量）时，行首第 1 列（Column 1）上方依然会抢先弹出一个原生的 `undefined` 调试小浮窗，并死死屏蔽掉 `SceneHoverProvider` 的场景断点卡片。

**原因**:
1. **VS Code 调试悬停优先级高于普通 `HoverProvider`**：
   在 `DebugEditorContribution.showHover` 中，只要当前处于调试暂停态，宿主会首先调用 `this.preventDefaultEditorHover()` 锁死普通 `HoverProvider`，随后调用 `hoverWidget.showAt`；仅当 `showAt` 返回 `1`（`NOT_AVAILABLE`）时，才会回退调用 `this.showEditorHover` 展示 `SceneHoverProvider`；
2. **无 `EvaluatableExpressionProvider` 时宿主的 `{ start: 0, end: 0 }` 钳位漏洞**：
   在 VS Code 内核 `getEvaluatableExpressionAtPosition`（`WEa`）中，当 `evaluatableExpressionProvider.has(model)` 为 `false`（TS/JS 默认未注册提供者）时，进入 `else` 分支调用词法提取器 `Jeh`。当鼠标停在行首缩进空白、`=`、`;` 等位置时，`Jeh` 返回 `{ start: 0, end: 0 }`，而 `new Range(lineNumber, 0, lineNumber, 0)` 会将列号钳位为 `Column 1`，返回非空 `{ matchingExpression: "", range: (line, 1, line, 1) }`！随后 `js-debug` 在第 1 列对 `let` 声明语句或空表达式求值返回 `undefined`，导致 `DebugHoverWidget` 在行首第 1 列弹出 `undefined` 并阻止 `SceneHoverProvider` 回退。

**解决方案**:
1. **注册 `SceneEvaluatableExpressionProvider` 接管求值提取闭环**：
   向 `vscode.languages.registerEvaluatableExpressionProvider([{ scheme: "file" }], ...)` 注册提供者，使 `evaluatableExpressionProvider.has(model)` 为 `true`，彻底绕开宿主 `else` 分支的 `{ start: 0, end: 0 }` 钳位缺陷；
2. **行首空白、关键字、未执行左值与已监视变量返回 `undefined` 触发原生回退**：
   当鼠标位于行首空白、语言关键字（`let`/`const`/`async`/`await`/`return` 等）、注释、赋值等号 `=` 左侧的声明左值/TS 类型注解，或断点行上的函数调用名/已纳入 `watch` 表格的变量时，`provideEvaluatableExpression` 严格返回 `undefined`。此时宿主 `WEa` 返回 `null` → `showAt` 返回 `1` (`NOT_AVAILABLE`) → 自动无缝触发 `showEditorHover` 弹出 `SceneHoverProvider` 场景断点卡片与 Watch 追踪表格。

**影响文件**: `src/ui/views/sceneHoverProvider.ts`, `src/extension.ts`, `test/unit/ui/views/scene_hover_provider.test.mjs`
**日期**: 2026-10-25

### 1.45 树视图 `revealPausedLocation` 异步展开序列号守卫与宿主已安装扩展目录同步 (Async Reveal Sequence Guard and Installed Extension Sync)

**问题**:
1. 当多次 `revealPausedLocation` 并发触发且涉及未展开场景节点的 `await treeView.reveal(parentNode, { expand: true })` 时，早期慢速异步展开恢复后可能执行 `treeView.reveal(oldPausedNode, { select: true })`，将树视图选中高亮拉回旧断点；
2. 在本地直接用宿主 IDE 主窗口（而非 F5 Extension Development Host）验证时，宿主加载的是用户目录下的已安装扩展包（如 `~/.antigravity-ide/extensions/tony-l.scene-breakpoints-vscode-x.y.z/extension.js`），若仅构建源码仓产物而未同步覆盖至已安装扩展目录，修改在宿主中不会生效。

**解决方案**:
1. **异步定位序列号守卫 (`_revealSeq`)**：
   在 `SceneTreeDataProvider` 中维护递增序列号 `_revealSeq`，每次 `revealPausedLocation` 或 `clearPausedLocation` 时递增；在每个 `await` 恢复点校验 `seq === this._revealSeq`，一旦过期立即中止，物理杜绝异步展开竞态导致的高亮跳回；
2. **宿主已安装扩展目录同步核验**：
   本地构建验证时，除编译源码仓 `extension.js` 外，需检查并同步更新宿主实际加载的扩展目录产物，提醒重载窗口（`Developer: Reload Window`）以确保新代码真正生效。

**影响文件**: `src/ui/views/sceneTreeProvider.ts`, `test/unit/ui/views/scene_tree_provider.test.mjs`
**日期**: 2026-10-25
