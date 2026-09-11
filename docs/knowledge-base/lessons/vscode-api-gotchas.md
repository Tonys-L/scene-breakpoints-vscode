# VS Code 原生 API 与打包踩坑经验

### 1.1 QuickPickItem 不支持 `$(icon~color)` 语法泄露字符串

**问题**: 在状态栏弹出的菜单项中，试图使用 `$(circle-filled~charts-green)` 给激活场景加上绿点，但界面直接将原始字符串打印了出来。
**原因**: VS Code 的 `StatusBarItem` 支持 `$(icon~color)` 扩展语法，但 `QuickPickItem`（选择列表）的 `label` 和 `description` 不支持波浪号修饰颜色，会导致纯文本泄露。
**解决方案**: 在 `QuickPick` 中改用系统原生彩色 Emoji（如 `🟢` 代表激活，`⚪` 代表未激活），并配合 `quickPick.activeItems = [activeItem]` 赋予整行高亮选中背景。
**影响文件**: `src/commands/showMenu.ts`
**日期**: 2026-09-07

### 1.2 批量下发断点时清空阶段触发 `onDidChangeBreakpoints` 竞态闪烁

**问题**: 切换场景时，状态栏偶尔会闪烁一下 `(None)` 然后再变回目标场景。
**原因**: 在 `applySceneBreakpoints` 内部，第一步调用了 `removeBreakpoints(all)`。在全部清除完成但尚未注入新断点的瞬间，VS Code 抛出 `onDidChangeBreakpoints`，全局监听器看到当前断点数为 0，误触发了重置。
**解决方案**: 引入 `SceneStateManager.isApplyingScene()` 原子状态锁，在下发断点的 `try...finally` 期间加锁，事件监听器检测到加锁时静默忽略清空重置。
**影响文件**: `src/sceneStateManager.ts`, `src/breakpointAdapter.ts`, `src/extension.ts`
**日期**: 2026-09-07

### 1.3 正则剥离 JSONC 注释时的字符串字面量误吞陷阱

**问题**: 用户在断点描述或 URL 字段中包含 `/*` 或类似注释路径（如 `http://localhost/auth/*key*`）时，`JSON.parse` 报错 `SyntaxError: Unterminated string in JSON`。
**原因**: 粗暴的正则 `/\/\*[\s\S]*?\*\//` 会越过双引号，将双引号内部的文本误当成注释剥离，破坏字符串闭合引号。
**解决方案**: 必须采用**双引号字符串字面量优先匹配保护机制**：`replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (_match, str) => str || "")`，捕获组 $1 命中的双引号字符串完整原样保留，仅剥离外部裸露注释。
**影响文件**: `src/configManager.ts`
**日期**: 2026-09-08

### 1.4 场景追加导出时的原子去重契约

**问题**: 用户将当前断点追加导出至已有场景时，如果已有场景中已有同行号断点，简单数组拼接会导致出现多条重复断点记录。
**原因**: 追加导出未走断点唯一性契约校验（文件+行号 或 函数名）。
**解决方案**: 场景导出追加统一调用 `upsertBreakpointToScene`，同行断点覆盖更新属性（条件/命中数/描述），异行断点平滑追加，确保持久化数组严格去重。
**影响文件**: `src/commands/exportScene.ts`
**日期**: 2026-09-08

### 1.5 TreeView 节点 ThemeIcon 选中高亮变灰与 16x16 容器尺寸等比压缩陷阱

**问题 1**: 用户点击选中某个断点树节点高亮时，无论该断点是启用还是禁用，断点图标均被 VS Code 强行冲刷成死灰色。
**原因**: `ThemeIcon` 底层为 Codicon 字体图标，VS Code 的全局样式规则 `.monaco-list-row.selected.focused .codicon { color: inherit !important; }` 会强行覆盖行内所有字体颜色为选中文本前景色。
**解决方案**: 采用纯净矢量 SVG 图片路径（`vscode.Uri.file(...)`）渲染。SVG 作为图片通道加载，宿主 CSS `color` 无法对其产生任何冲刷影响，红点永远鲜红饱和、灰圈永远纯灰。

**问题 2**: 为实现断点图标与复选框排版，制作了 `34x16` 的组合 SVG，结果界面渲染时图标被等比压小了一半多，变得极其微缩。
**原因**: VS Code 树视图节点图标容器 `.monaco-tl-icon` 在 CSS 中被宿主严格硬性限制为 `16px x 16px`（`background-size: contain`）。宽 34 高 16 的图片塞入 16x16 容器后，被强制等比缩小了 53%（高度仅剩 7.5px）。
**解决方案**: 将所有断点图标严格设计为标准 `16x16` 居中饱满矢量 SVG（中心圆/菱形直径 10.5px，1:1 匹配原生红点），复选框使用 VS Code 树视图原生 `TreeItem.checkboxState` 控制。
**影响文件**: `src/sceneTreeProvider.ts`, `media/icons/*.svg`
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
**影响文件**: `src/sceneTreeProvider.ts`, `src/configManager.ts`, `src/breakpointAdapter.ts`, `src/extension.ts`
**日期**: 2026-09-08

### 1.7 调试启动配置联动推导必须验证场景真实存在性（防幽灵激活）

**问题**: 启动配置（`launch.json` 或 `.env` 中的 `DEBUG_SCENE`）中写了不存在的场景名时，状态栏居然被染成绿色并显示为该不存在场景，但实际并未激活任何场景，且原有断点可能被误清空。
**原因**: `resolveLaunchBoundScenes` 解析环境变量与 `bindings` 映射时，直接将字符串透传返回，未与 `config.scenes` 的有效场景清单进行校验；`applySceneCommand` 也未做校验，直接执行了 `setActiveScenes`。
**解决方案**: 在推导层与激活命令层建立双重存在性强校验守卫，严格核对场景名是否在 `config.scenes` 中存在（支持大小写不敏感容错）。未定义的场景坚决不予返回与激活，并在命令层立即弹出错误提示中断执行。
**影响文件**: `src/configManager.ts`, `src/commands/applyScene.ts`
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
**影响文件**: `src/configManager.ts`
**日期**: 2026-09-08

### 1.10 esbuild 外部依赖排除模式下模块漏写 vscode 导入引发运行时 ReferenceError

**问题**: 用户执行 `sceneBreakpoints.exportScene` 命令时，VS Code 抛出 `Error running command sceneBreakpoints.exportScene: vscode is not defined`。
**原因**: 项目采用 esbuild 单文件打包并配置了 `--external:vscode`。源码模块中若直接使用 `vscode.xxx` 却未显式声明 `import * as vscode from "vscode"`，esbuild 不会执行 TS 类型检查，而是将其视为全局自由变量直接输出在 bundle 中。在 VS Code 运行期，CommonJS 执行上下文中不存在全局 `vscode` 对象，导致在命令执行时报 `ReferenceError: vscode is not defined`。
**解决方案**: 源码中任何调用宿主 API 的模块均必须严格声明 `import * as vscode from "vscode";`，esbuild 会将其安全映射为 `require("vscode")` 的命名空间局部引用。
**影响文件**: `src/commands/exportScene.ts`
**日期**: 2026-09-11

### 1.11 Content Hash Guard 拦截内部写盘后业务命令层必须主动触发树视图刷新

**问题**: 用户从剪贴板成功导入新场景后，调试侧边栏（Scene Breakpoints 视图）没有立即显示新导入的场景，必须手动点击刷新按钮。
**原因**: 工程为防止写盘被系统防病毒软件/文件系统延迟触发二次整树闪烁，在 `fileWatcher` 中设计了 `Content Hash Guard`。内部写盘的内容与最近保存指纹一致时会被 `fileWatcher` 直接拦截放行，不触发 `treeDataProvider.refresh()`。若导入的场景未处于激活态，状态机不会变更，导致树视图完全未收到重绘信号。
**解决方案**: 任何通过 `saveScenesConfig` 新增或修改配置的命令层逻辑（如剪贴板导入、导出场景），在写盘持久化后必须主动调度 `await vscode.commands.executeCommand("sceneBreakpoints.refreshView");` 显式驱动树视图更新。
**影响文件**: `src/commands/clipboardSync.ts`, `src/commands/exportScene.ts`
### 1.12 类方法正则误捕获控制流关键字导致作用域回溯中断与得分不足

**问题**: 用户在断点上方插入空行和代码后激活场景，自愈算法未触发，断点依然停留在旧行号。
**原因**: `extractScopeAnchor` 中的类方法通用正则 `/^\s*([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*[{:]/` 将 JS/TS/Python 的控制流语句（如 `if (cond) {`、`while (x):`、`for (...)`）中的关键字当成了方法名提取并立即返回。导致算法提前终止向上扫描，误判当前作用域为 `"if"`，无法匹配到真实外层函数名，白白丢失 5 分加权，得分跌破置信门槛而安全回退。
**解决方案**: 在提取作用域正则前，显式拦截并排除通用控制流保留字黑名单（`UNIVERSAL_CONTROL_FLOW_KEYWORDS`：`if`, `for`, `while`, `switch`, `catch`, `with` 等），强制穿透控制流直达真正的外层函数定义行。
**影响文件**: `src/healingAdapter.ts`
**日期**: 2026-09-12

### 1.13 纯物理相邻行匹配在代码间插入空行时失效，演进为非空拓扑窗口

**问题**: 开发者或 AI 在断点上方或下方插入单个空行或格式化换行时，断点伴随上下文匹配分数大幅跌落。
**原因**: 原自愈算法死板比对物理绝对相邻行 `lines[i - 1]` 与 `lines[i + 1]`。一旦中间插入空行，`lines[i - 1]` 变为纯空白文本 `""`，导致原有的 `prev` 代码行在 `lines[i - 2]` 被直接无视，错失 5 分拓扑加分。
**解决方案**: 引入语言无关的“非空拓扑伴随窗口”机制（`findPrevNonEmptyLine` 与 `findNextNonEmptyLine`），在提取指纹与计算自愈时均自动穿透空白行，寻找最近的有效代码行进行拓扑锚定，彻底免疫任意数量空行、格式化空行的干扰。
**影响文件**: `src/healingAdapter.ts`
**日期**: 2026-09-12

### 1.14 模块调用 Node.js 内置模块（如 path）未显式导入在 esbuild 下静默打包但在运行时触发 ReferenceError

**问题**: 用户执行 `sceneBreakpoints.applySceneItem` 激活场景时，VS Code 抛出 `Error running command sceneBreakpoints.applySceneItem: path is not defined`。
**原因**: 项目采用 esbuild 单文件打包且未在打包配置中强制开启 TypeScript 类型检查。若源码模块内部直接调用了 `path.basename` 或 `path.isAbsolute`，但文件顶部忘记显式写 `import * as path from "node:path"`，esbuild 会将其作为自由全局变量输出。而在 VS Code 宿主运行期，模块闭包作用域中并没有全局 `path` 对象，导致在触发该代码分支（如断点脱靶告警）时抛出 `ReferenceError: path is not defined`。
**解决方案**: 任何模块只要使用了 Node.js 核心库（`path`、`fs`、`os` 等），必须严格在文件顶部显式声明 `import * as path from "node:path";`。
**影响文件**: `src/commands/applyScene.ts`
**日期**: 2026-09-12






