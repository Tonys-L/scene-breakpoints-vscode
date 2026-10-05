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




