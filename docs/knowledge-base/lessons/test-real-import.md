# 测试基础设施教训 (Testing Infrastructure Lessons)

> **TL;DR**: 单元测试必须导入真实源码并 Mock 端口，严禁在测试中镜像复制业务逻辑；镜像副本会产生"假绿"并随源码演进静默腐化。

---

## 1.1 镜像副本测试的假绿陷阱

**问题**: `scene_service.test.mjs`、`storage_guard_and_sync.test.mjs`、`storage_atomic_queue.test.mjs` 早期版本在测试文件内**复制**了 `sceneService` / `SaveLoopGuard` / 拓扑哈希等业务逻辑进行"自嗨式"验证，测试全绿但真实源码从未被执行，且测试内手工复制的 `computeBreakpointsTopologyHash` 与真实实现字段口径不一致（`condition` / `hitCondition` / `logMessage` 序列化方式不同），哈希结果悄然分叉。

**原因**: TS 源码依赖 `vscode` 模块，Node.js 无法直接导入，早期图省事直接在测试里重写了一遍逻辑，测试从"验证源码"退化为"验证复制品"。

**解决方案**:
1. 建立 `test/mocks/vscode.mock.mjs` 提供 `vscode` API 的可重置 Mock（`debug` / `window` / `workspace` 等）；
2. 建立 `test/register.mjs` 通过 `registerHooks` 将 `vscode` 导入重定向到 Mock，并将 TS 风格无扩展名导入解析为 `.ts` / `/index.ts` 真实文件；
3. `package.json` 测试脚本统一走 `node --experimental-transform-types --import ./test/register.mjs`（要求 Node.js ≥ 22.6，CI 已升级 20.x → 22.x）；
4. 测试通过 Mock 端口（`MockSceneRepository` / `MockBreakpointBridge`）注入依赖，验证**真实** `sceneService` / `SaveLoopGuard` / `handleExternalChange` 逻辑。

```javascript
// test/register.mjs 核心：vscode 重定向 + TS 解析
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "vscode") {
      return { url: VSCODE_MOCK_URL, shortCircuit: true };
    }
    // ...失败后尝试 `${specifier}.ts` / `${specifier}/index.ts`
  },
});
```

**影响文件**: `test/mocks/vscode.mock.mjs`、`test/register.mjs`、`test/unit/application/scene_service.test.mjs`、`test/unit/infra/storage_guard_and_sync.test.mjs`、`test/unit/infra/storage_atomic_queue.test.mjs`、`package.json`、`.github/workflows/ci.yml`

**日期**: 2026-09-13

---

## 1.2 E2E 无法合成 onDidChangeBreakpoints 的 changed 事件

**问题**: TC-AI-04 需验证"编辑器原生断点面板切换启用/禁用触发反向同步"，但 VS Code 公开 API 无法直接产生 `event.changed` 语义的断点变更事件。

**原因**: `vscode.debug` API 仅暴露 `addBreakpoints` / `removeBreakpoints`；面板勾选产生的 `changed` 事件由宿主内部派发，测试无法合成。

**解决方案**: E2E 中用 `removeBreakpoints([target])` + `addBreakpoints([toggled])` 模拟等价语义，断言收敛为可测子集：断点 API 变动严禁引发配置文件回环写盘、严禁触发 DAP 反复重刷（引用保留断言）。`changed` 语义的精确回归由单元测试 `registerBreakpointSyncService`（真实导入 + Mock `vscode.debug.onDidChangeBreakpoints`）覆盖。

**影响文件**: `test-e2e/suite/11_system_guards.test.ts`、`test/unit/infra/storage_guard_and_sync.test.mjs`

**日期**: 2026-09-13

---

## 1.3 领域层与核心算法全量真实导入（批次一）

**问题**: `healing.test.mjs`（手写 350 行算法副本）、`config_operations.test.mjs`（手写清洗与合并副本）、`state_projection.test.mjs`（手写 Mock 状态机类）、`activation_resolver.test.mjs`（手写调度函数副本）、`roundtrip_and_edge.test.mjs`（手写 170 行副本）长期存在重复手写副本。

**危害暴露与重大战果**:
1. **暴露静默逻辑分叉**：`config_operations` 中的手写合并算法曾错误实现为"后到覆盖先到"，直接违反了 **INV-011（先到先得）** 不变量；真实导入后立即暴露出该断言分叉并予以校准；
2. **抓出隐藏防御漏洞**：真实运行 `healing.test.mjs` 时，立即抓出了生产代码 `resolveHealedLineFromLines` 对 `null` 输入未做防卫性检查的隐患（违反 **INV-006**），生产代码已立即补齐 `!item` 守卫；
3. **增强启动项推导鲁棒性**：针对 `bindings` 支持逗号分隔多场景字符串（如 `"auth,order"`），生产代码 `src/domain/launchResolver.ts` 补齐了与 `envScene` 行为一致的 `split(",")` 解析能力；
4. **消除近千行维护包袱**：5 大套件累计净删除 800+ 行重复手写算法与类定义，100% 直连 `src/domain/` 生产代码，测试耗时依然保持在 260ms 内。

### 1.4 批次二：基础设施层测试真实源码化与跨层防灾

在批次二中，彻底清除了剩余 3 大基础设施层测试套件中的手写镜像副本：
1. `commands_registry.test.mjs`：净删除手写 `MockCommandRegistry` 和 `registerAllCommandsMock`，直连真实 `src/infra/vscode/commands/index.ts`（23 大核心命令与树命令生命周期完全受控）；
2. `bridge_and_codelens.test.mjs`：净删除手写 `inferBreakpointTypeAndData`、`computeBreakpointDiff`、`stripJsonComments`，直连真实 `src/infra/vscode/vscodeBreakpointBridge.ts`、`src/infra/vscode/sceneCodeLensProvider.ts` 与 `src/application/sceneService.ts`；
3. `treeview_provider.test.mjs`：净删除 6 个配置操作函数副本与 `SafeBreakpointNode`、`deriveSvgIcon`、`isPausedAtBreakpoint`，直连真实 `src/domain/sceneOperations.ts` 与 `src/infra/vscode/sceneTreeProvider.ts`。

#### 捕获的真实隐患与教训
1. **Node.js Type Stripping 与 isolatedModules 规范**：
   在 `src/infra/vscode/commands/skillCommands.ts` 中，使用值导入了 `SkillStatus`（实际是纯类型 `export type SkillStatus`）。在 Node.js 22+ 的 `--experimental-transform-types` 下，由于未分析目标 AST，保留了运行时 import，导致运行时找不到导出值抛出 `SyntaxError`。
   **规约**：纯类型必须显式使用 `import { type X }` 或 `import type { X }`。
2. **领域入参防御缺失（全空格场景名称）**：
   `renameSceneInConfig` 原缺乏对全空白或空场景名称的防御校验，导致可能将场景破坏性重命名为空白键 `"   "`。接入真实源码后立即补齐 trim 及非空防灾守卫。
4. **全工程纯类型导入清零**：
   通过自动化 AST 扫描，清除了 `treeInteractionListener.ts` 与 `debugLifecycleListener.ts` 中残余的 `import { SceneTreeItem }` 值导入，统一规范为 `import { type SceneTreeItem }`，全工程类型值导入隐患彻底归零。
5. **领域操作全维空指针与边界防灾守卫**：
   全面排查并强化了 `src/domain/sceneOperations.ts`：
   - `duplicateSceneInConfig`：补齐目标名称 trim 校验，严防克隆产生全空格键名；
   - `upsertBreakpointToScene`：前置空配置、空场景名、空断点对象防御，杜绝写入空键或报 TypeError；
   - `removeBreakpointFromConfig`、`toggleBreakpointEnabledInConfig`、`setAllBreakpointsEnabledInScene`、`deleteSceneFromConfig`：统一引入可选链与 `Array.isArray` 数组守卫，彻底免疫残缺配置空指针崩溃。并在 `config_operations.test.mjs` 增设 Case 17 予以全覆盖固化。

### 1.5 批次三：基础设施层单测 1:1 镜像对齐重构与拼盘测试治理

**问题**:
1. **拼盘单测坏味道**：原测试文件名中包含 `_and_`（如 `bridge_and_codelens.test.mjs`、`storage_guard_and_sync.test.mjs`），一个测试文件内跨模块拼凑不同职责的生产代码验证，违背了单一职责原则（SRP）；
2. **名实不符**：`storage_atomic_queue.test.mjs` 名为 atomic_queue，实则混合了 `jsonFileSceneRepository` 落盘、`statusBarView` 响应式渲染与 `applySingleBreakpointToEditor` 点亮，极易产生认知偏差与维护死角。

**解决方案（Mirroring Pattern 1:1 镜像对齐）**：
将 `test/unit/infra/` 彻底重构为与 `src/` 生产模块 1:1 镜像对齐的 7 大纯正单测模块：
- `breakpoint_bridge.test.mjs`  <──> `src/infra/vscode/vscodeBreakpointBridge.ts`
- `codelens_provider.test.mjs`   <──> `src/infra/vscode/sceneCodeLensProvider.ts`
- `commands_registry.test.mjs`   <──> `src/infra/vscode/commands/index.ts`
- `save_loop_guard.test.mjs`     <──> `src/infra/storage/saveLoopGuard.ts`
- `scene_repository.test.mjs`    <──> `src/infra/storage/jsonFileSceneRepository.ts`
- `status_bar_view.test.mjs`     <──> `src/infra/vscode/statusBarView.ts`
- `treeview_provider.test.mjs`   <──> `src/infra/vscode/sceneTreeProvider.ts`

同时安全废除并删除了旧的 3 个混编测试文件，将全工程单元/集成测试套件升级扩充为 **15 大全维套件**（执行耗时依然保持在 240ms 内，沙箱 E2E 45 个用例 44s 全部绿灯）。

### 1.6 批次四：Node.js 原生 Subpath Imports 路径优雅化与全模块覆盖闭环

**问题**:
1. **相对路径地狱（Relative Import Hell）**：测试文件位于 `test/unit/infra/` 等较深目录，以往必须通过 `../../../src/domain/healingEngine.ts` 导入，冗长丑陋且文件移动时极易断链；
2. **生产代码单测盲区**：经全局源码排查，发现应用层 `payloadSerializer.ts`（场景 Payload 序列化与剪贴板清洗）、基础设施层 `templateContentProvider.ts`（虚拟只读文档协议）与 `listeners/`（5 大事件监听注册）缺少专职 1:1 单元测试。

**解决方案**:
1. **原生 Subpath Imports (`#src/*` 与 `#test/*`)**：
   在 `package.json` 中声明 `"imports"`，并在 `test/register.mjs` 中接入 Node 模块钩子，使全工程单测可直接使用现代原生语法糖：
   ```javascript
   import { resolveHealedLine } from "#src/domain/healingEngine";
   import { __resetMockVscodeState } from "#test/mocks/vscode.mock.mjs";
   ```
   无需构建工具打包，纯 Node 原生驱动，彻底告别 `../../../` 相对路径地狱。
2. **补齐 3 大专职单测套件**：
   - `payload_serializer.test.mjs`：覆盖 1MB 防爆截断、Markdown 代码块剥离、4 大剪贴板格式容错清洗与 Windows 路径反斜杠转斜杠；
   - `template_provider.test.mjs`：覆盖只读文档 scheme 协议、缓存读写与空文档降级；
   - `listeners_registry.test.mjs`：覆盖 5 大监听器生命周期 Disposable 收集、断点清空状态机联动、文件变更防抖与调试终止事件拓扑清空。
3. 全工程单元/集成测试升级扩充为 **18 大全维测试套件**，总耗时仅 260ms，实现生产代码核心模块 100% 1:1 镜像覆盖。

**影响文件**:
- `package.json`
- `test/register.mjs`
- `test/mocks/vscode.mock.mjs`
- `test/run-all.mjs`
- `test/unit/application/payload_serializer.test.mjs`
- `test/unit/infra/template_provider.test.mjs`
- `test/unit/infra/listeners_registry.test.mjs`
- `test/unit/infra/breakpoint_bridge.test.mjs`
- `test/unit/infra/codelens_provider.test.mjs`
- `test/unit/infra/scene_repository.test.mjs`
- `test/unit/infra/status_bar_view.test.mjs`
- `test/unit/infra/save_loop_guard.test.mjs`

**日期**: 2026-09-13

---

## 1.7 E2E 真实宿主沙箱文件系统一致性与现场隔离还原（Hermeticity）原则

**问题**:
1. E2E 沙箱测试中声明了不存在的源码路径（如 `src/calculator.ts`，实际工作区中为 `src/calculator.go` 与 `src/sample.ts`），导致外部文件监听器无法提取指纹行，使 `TC-ENRICH-01` 断言失败；
2. 跨 Suite 测试污染：前序用例（如 `TC-KEY-01`）通过命令直接写入了调试断点或覆盖了 `.vscode/debug-scenes.json`，在 teardown 中未完整还原原始磁盘文件，导致后续依赖空白/特定配置的用例（如 `TC-HINT-01` Inlay Hints 渲染）断言失败。

**解决方案**:
1. **沙箱物理路径强一致**：E2E 测试中构造的所有断点和场景，其 `file` 路径必须严密映射到 `test-fixtures/sample-workspace/` 中真实存在的文件，绝不可凭空编造不存在的文件扩展名；基础设施层 `fileLinesReader` 增设 `node:fs` 本地直接读取降级兜底；
2. **测试现场隔离与严格还原（Hermeticity Guard）**：所有对工作区公共文件（`.vscode/debug-scenes.json`、`.cursor` 等）产生写操作的用例或 Suite，必须在 `suiteSetup` 保存初始快照，并在 `teardown` / `suiteTeardown` 无论成功或失败均无条件将其完全还原回盘；
3. **模型充血方法别名对齐**：当聚合根充血方法（如 `toggleBreakpointEnabled`）重构更名时，在领域实体层声明清晰的别名（如 `toggleBreakpoint(index)`），防止遗留的调用端与 UI 动作断链。

---

## 1.8 VS Code 宿主事件监听器与 UI 命令层的高保真单测驱动与状态复位原则

**问题**:
1. **监听器“只注册未触发”导致覆盖率虚低**：`infra/vscode/listeners/` 和 `treeCommands.ts` 早期只有 20%~40% 的极低覆盖率。原因是单测仅调用了 `register*Service()` 验证能返回 Disposable，却未模拟宿主抛出真实事件，导致回调函数体内的几十行核心逻辑从未执行；
2. **Mock 状态污染导致的级联断言失败**：测试中若为了模拟分支覆写了 `vscode.window.showErrorMessage` 或 `showQuickPick`，如果 `__resetMockVscodeState()` 未将其复位回默认记录函数，会导致排在后面的其他单测套件丢失消息记录或类型不匹配（如 `canPickMany: true` 返回单一对象导致 `picked.map is not a function`）；
3. **Module Namespace 对象的不可扩展性**：在 ESM 规范下，`import * as vscode` 得到的命名空间对象不可动态挂载新属性（`Object.preventExtensions`），直接执行 `vscode.chat = ...` 会抛出 `TypeError: Cannot add property chat, object is not extensible`。

**解决方案**:
1. **事件驱动全链路触发**：在 Mock 中为各类监听器（`onDidChangeBreakpoints`、`createFileSystemWatcher`、`debug.registerDebugConfigurationProvider`、`treeView.onDidChangeCheckboxState` 等）提供可控的回调数组或 EventEmitter，单测中主动发射事件（如 changed 断点变动、文件变动、复选框点击），让业务反向同步与状态机调度走完真实执行路径；
2. **全面的全局 Mock 强重置机制**：在 `__resetMockVscodeState()` 中不仅清空数组和哈希，必须无条件将 `window.showErrorMessage`、`showWarningMessage`、`showQuickPick`、`showInputBox`、`createQuickPick` 等高频交互函数复位回初始 Mock，且在测试中重写这些方法时必须保留向 `window.messages` 推送的兜底逻辑；
3. **预导出实验性 API 属性**：在 `vscode.mock.mjs` 顶部预先声明导出 `export const chat = { registerSkillProvider: undefined }`，测试中通过修改其属性进行动态配置，避免对模块命名空间执行扩展操作；
4. **效果收益**：`infra/vscode` 整体单测覆盖率从 77% 大幅攀升至 **90.36%**，全代码库总覆盖率成功突破 **87.69%**，且保持在 340ms 内极速无挂起执行。

**影响文件**:
- `test/mocks/vscode.mock.mjs`
- `test/unit/infra/listeners_registry.test.mjs`
- `test/unit/infra/commands_execution.test.mjs`
- `test/unit/infra/treeview_provider.test.mjs`

**日期**: 2026-09-24

---

## 1.9 传统行覆盖率掩盖下的假绿陷阱与变异测试（Mutation Testing）破局

**问题**:
在 `healingEngine.ts`（自愈领域算法）中，传统的测试行覆盖率高达 **94.28%**，但在引入 Stryker 变异测试（Mutation Testing）进行断言强度审计时，真实变异得分竟然只有 **34.03%**（252 个变异体存活）。大量关键业务逻辑分支即使被篡改（如 `>=` 变异为 `<`、`&&` 变异为 `||`、加法变异为减法、除法变异为乘法），既有单测依然全部绿灯通过，存在严重的“假绿（False Green）”与弱断言现象。

**原因**:
1. **弱断言/宽泛断言**：测试仅验证最终返回结果是否存在或行号是否粗略符合预期，未对 `status`、`isHealed` 布尔标志、`confidence` 精确置信率等中间关键状态做严格等值断言；
2. **缺乏对抗性候选竞争**：在两阶段自愈算法中，用例总是提供唯一候选，缺少“伪候选（上下文高分但本体不匹配）”与“真候选（本体匹配但上下文平平）”的直接对抗，导致 `hasDirectMatch && score > bestScore` 被篡改为 `||` 时无法被既有用例捕获；
3. **过度工程与防御性冗余滋生等价变异体（Equivalent Mutants）**：
   - 生产代码中存在大量数学上恒成立的冗余检查（例如当 `targetIndent > 0` 且成倍数时，`candIndent > 0` 必然为真；阶段一 offsets 不含 0，命中即必然产生位移，却冗余编写了 `isHealed = newHealedLine !== targetLine` 的三元表达式）；
   - 这些过度防御代码会生成无法被任何有效测试杀死的等价变异体，直接拖累变异测试质量度量。

**解决方案**:
1. **引入 Stryker 变异测试工具链**：
   在工程中接入 `@stryker-mutator/core` 与 Command Runner，针对核心领域算法配置专职靶向变异测试任务，将变异得分（Mutation Score）作为衡量测试断言有效性的第一性指标；
2. **构建对偶竞争与单极达标靶向断言**：
   - **本体守卫对抗**：构造上下文相似度极高但本体不符的伪候选行，与本体完全匹配的真候选行同台打分，严格断言算法命中真候选，彻底斩杀 `&&` 变异为 `||` 的逻辑漏洞；
   - **单极独立达标**：精准构造 `score >= 12.5` 独立达标（ratio < 0.60）与 `confidenceRatio >= 0.60` 独立达标（score < 12.5）两组互斥边界用例，斩杀逻辑或 `||` 变异为 `&&`；
   - **两侧距离竞争**：在原断点行号两侧对称布局候选行，利用真实减法与变异加法的距离差异，精准击杀 `Math.abs(i - origIdx)` 变异为 `i + origIdx` 的算术变异体；
   - **置信度精度锁定**：对阶段一与阶段二的 `confidenceRatio` 实施精确容差断言，彻底阻断除法变异为乘法的隐患；
3. **贯彻 KISS 原则，消除过度防御冗余**：
   - 依据变异测试报告反哺生产代码，清除等价冗余条件（如冗余的 `candIndent > 0`、死变量 `hasContextMatch = true` 赋值、重复的双重空检查）；
   - 代码行数显著精简，从源头上根除等价变异体。
4. **效果收益**:
   自愈算法变异测试得分从 **34.03%** 跃升至 **80.00%**（击杀数达到 264 个），全代码库行覆盖率达到 **89.94%**，彻底终结了高覆盖率下的“虚假安全感”。

**影响文件**:
- `src/domain/services/healingEngine.ts`
- `test/unit/domain/healing.test.mjs`
- `stryker.config.json`
- `package.json`

**日期**: 2026-10-01

---

## 1.10 变异测试独立执行踩坑与编解码服务（ScenePayloadCodec）94%+ 斩杀实战

**问题**:
在向第二个核心领域模块 `scenePayloadCodec.ts`（编解码与清洗领域服务）推广变异测试时，遇到两大典型挑战：
1. **测试套件独立执行空转**：该单测在集中运行器 `test/run-all.mjs` 下可正常被动态 import 调用，但在 Stryker Command Runner 单独以子进程命令调用单测文件时，由于缺少文件末尾的自执行代码，导致测试进程 0ms 空转直接退出，Stryker 误判为 0 个断言并报 0% 分数；
2. **多格式与字符串清洗的高频弱断言**：在修复自执行入口后，首轮变异测试得分为 **57.69%**（110 个变异体存活）。大量针对字符串 `trim()`、空白字符串清洗转 `undefined`、枚举有效性校验等关键清洗分支处于“只跑过未严格断言”的假绿状态。

**原因**:
1. **测试架构缺乏双模态兼容**：模块化单测只导出了测试函数，未通过 `process.argv[1]?.endsWith(...)` 识别作为 Entrypoint 独立执行的场景；
2. **输入用例样本过于“干净”**：既有单测提供的输入数据大多本身就是规范修整好的对象，没有输入带空格的脏数据（例如 `"  src\\foo.ts  "`、纯空白字符串 `"   "`、浮点数行号 `12.9` 等），导致生产代码中的 `trim()`、`Math.floor()`、反斜杠替换等防御性逻辑即使被突变剔除，测试依然照常通过；
3. **枚举数组测试不完整**：生产代码中 `['condition', 'hitCount', 'logpoint', 'line'].includes(item.type)`，若测试未覆盖显式传递 `type: 'line'` 的场景，该项被 Stryker 变异为空字符串时无法被测试检出。

**解决方案**:
1. **标准化单测双模态自执行规范**：
   在单测末尾增加自执行检测：
   ```js
   if (process.argv[1]?.endsWith("scene_payload_codec.test.mjs")) {
       runScenePayloadCodecTests();
   }
   ```
   使得测试文件既能在 `run-all.mjs` 中作为函数模块运行，也能在 Stryker 单进程 Runner 中独立无损执行；
2. **构造脏数据边界用例，实施靶向属性断言**：
   - **空格与路径清洗断言**：传入首尾空白与反斜杠路径 `"  src\\utils\\calc.ts  "`，严格断言产物为干净正斜杠路径 `"src/utils/calc.ts"`，精准击杀 `trim()` 与 `replace` 突变体；
   - **纯空白字段安全转 undefined**：传入只有空格的 `"   "` 字段，断言清洗后严格等于 `undefined`；
   - **布尔值与对象类型防御**：向 `enabled` 传递非布尔非法值（如 `"invalid"`），向 `contextSnippet` 传递非对象，断言分别安全降级为默认 `true` 与 `undefined`；
   - **枚举全集闭环覆盖**：逐一覆盖 `condition`、`hitCount`、`logpoint` 与显式 `line`，断言枚举匹配与未知类型向 `line` 的降级；
   - **非对象 JSON 顶层防御**：针对传入纯数字、纯字符串的载荷，断言返回特定错误。
3. **收益效果**:
   `scenePayloadCodec.ts` 变异测试得分从初始的 **57.69%** 飙升至 **94.23%**（成功击杀 245 个变异体，仅剩 15 个等价变异体）。代码行覆盖率达到 **100%**，分支覆盖率达 **98.85%**，全工程 25 大测试套件与 16 大物理硬门禁 100% 保持全绿。

**影响文件**:
- `src/domain/services/scenePayloadCodec.ts`
- `test/unit/domain/scene_payload_codec.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

## 1.11 核心拓扑哈希与 AI 场景调度（ActiveScenesDiffResolver）98%+ 变异斩杀实战

**问题**:
`activeScenesDiffResolver.ts` 是负责 AI 场景激活、幽灵场景拦截与断点核心 DAP 拓扑哈希推导的纯计算领域服务。在引入 Stryker 变异测试基线评估时，初始变异得分仅为 **55.88%**（45 个变异体存活）。大量关于乱序集合排序、路径归一化、可选字段回退及调度参数默认值的突变体处于存活状态。

**原因**:
1. **拓扑 Hash 乱序未对抗验证**：生产代码中使用了 `tokens.sort().join("|")`，但既有用例仅输入了顺序一致的断点，导致 `sort()` 被突变删除或 `join("|")` 分隔符被突变为空串时，既有用例无法察觉；
2. **缺省字段空串回退未严格断言**：当断点缺少 `functionName` 或 `file` 路径时，代码回退为空串（如 `fn.functionName || ""`），Stryker 将其突变为 `"Stryker was here!"`，由于缺少缺省字段的特定断言，变异体全部存活；
3. **参数默认值未覆盖**：`allowAiActivation = true` 默认参数在测试中总是被显式传递，若突变将默认值改为 `false`，既有测试完全绿灯。

**解决方案**:
1. **乱序集合对偶输入对抗**：
   构造两组断点顺序完全相反的数组，断言计算出的核心拓扑 Hash 严格一致，并断言哈希包含竖线分隔符，精准斩杀 `sort()` 缺失与分隔符突变；
2. **缺省字段极限空载荷断言**：
   构造 `{ type: "function" }`（缺函数名）和 `{ type: "line", line: 15 }`（缺文件路径）的极限载荷，分别断言其格式化产物严格匹配 `"fn::::true"` 与 `"src::15:line::::true"`，彻底剿灭替代字符串突变体；
3. **参数默认值缺省调度测试**：
   不传 `allowAiActivation` 触发调度，断言其行为等同于允许调度（`apply`），成功击杀默认布尔值突变。
4. **收益效果**:
   `activeScenesDiffResolver.ts` 变异测试得分从 **55.88%** 飙升至 **98.04%**（击杀 100 个变异体，仅剩 2 个等价语义变异体），远超 **85%+** 指标。代码覆盖率达成 **语句 100% / 分支 100% / 函数 100% / 行 100%** 四大满贯，全工程 16 大物理硬门禁持续全绿通过。

**影响文件**:
- `src/domain/services/activeScenesDiffResolver.ts`
- `test/unit/domain/agent_declarative_engine.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

## 1.12 应用层 SSOT 状态机（SceneStateManager）98.97% 变异斩杀实战

**问题**:
`sceneStateManager.ts` 是整个插件运行时的状态中枢（SSOT），负责活动场景投影、断点装载原子锁、拓扑 Hash 缓存以及跨视图事件广播。在进行 Stryker 变异测试基线评估时，初始变异得分仅为 **42.27%**（56 个变异体存活，超过一半处于假绿状态）。

**原因**:
1. **事件发布-订阅模式缺乏端到端断言**：内部使用 `PureEventEmitter` 派发 `onDidChangeState` 事件，既有用例仅关注调用状态机后的属性变化，未实际注册订阅函数检验事件是否真的被触发、载荷结构是否完好以及 `dispose` 后是否停止派发；
2. **脱靶断点（Unmatched）键集未测试**：`setUnmatchedBreakpoints` 与 `isBreakpointUnmatched` 的全套逻辑在单测中为零调用，所有路径归一化与大小写容错分支全部假绿；
3. **缓存标志与生命周期清空未覆盖**：`lastAppliedTopologyHash`、`pendingTopologyUpdate` 以及 `dispose()` 级联销毁从未被测试断言；
4. **基线断点增量更新弱断言**：`incrementActiveBaseline()` 变异为自减 `--` 存活。

**解决方案**:
1. **构造发布订阅全生命周期断言**：
   在单测中注册事件监听器，断言场景切换与脏标记改变时事件 payload `{ activeScenes, isDirty }` 严格一致；断言相同状态不重复派发；调用 `subscription.dispose()` 后断言不再收到广播；
2. **脱靶断点路径标准化全集覆盖**：
   覆盖 Windows 反斜杠、全大写路径、首尾空格（验证 `trim()`）以及无效空入参（undefined / 空字符串 / 0 行号安全拦截）；
3. **状态机 dispose 反向安全断言**：
   在调用 `dispose()` 后断言缓存被清空、挂起标志被复位，并再次尝试触发场景流转，断言原有 listeners 已被彻底清空，无法再被唤醒；
4. **基线断点计数器读写自增闭环**：
   显式断言 `getBaselineBreakpointCount()`、`setBaselineBreakpointCount(10)`，并调用 `incrementActiveBaseline()` 严格断言增量为 `+1`（结果 11），击杀自减突变体。
5. **收益效果**:
   `sceneStateManager.ts` 变异测试得分从初始的 **42.27%** 飙升至 **98.97%**（击杀 96 个变异体，仅剩 1 个防御守卫等价变异体），远超 **85%+** 指标。覆盖率达成 **语句 100% / 分支 100% / 函数 100% / 行 100%** 四大满贯，全工程 16 大物理硬门禁持续 Exit 0 全绿。

**影响文件**:
- `src/application/sceneStateManager.ts`
- `test/unit/application/scene_state_manager.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

## 1.13 核心充血实体（Breakpoint）86.30% 变异斩杀实战

**问题**:
`breakpoint.ts` 是领域层的核心充血模型，封装了 5 类断点多态、同位置物理比对（INV-001）、上下文指纹提取与自愈匹配吸收。在对其执行 Stryker 变异测试初始评估时，得分仅为 **35.56%**，存活变异体高达 **174 个**。

**原因**:
1. **多态断点辅助方法测试盲区**：`resolveFullPath`（跨平台物理路径解析）、`matchesHealedTarget`（自愈指纹比对）和 `applyHealed`（吸收自愈校准）在既有单测中几乎未被调用，大量路径正则与比对分支处于假绿状态；
2. **弱断言与等价替代未阻断**：
   - `matchesHealedTarget` 中当双方具有指纹时，`current === healed.current` 被突变为 `return true;`，既有测试没有构造“同文件同行号但指纹不同”的对抗用例；
   - `applyHealed` 中仅改变行号时的 `changed = true` 未被断言其返回值；
   - `updateLine` 对 NaN、负数、零与相同行号的非法入参拦截未覆盖；
3. **序列化缺省字段污染未校验**：`toJSON()` 导出的纯 DTO 对象对缺省的 `condition`、`hitCondition`、`desc`、`logMessage` 是否污染未作 `in` 键名剔除断言。

**解决方案**:
1. **跨平台物理路径解析全矩阵断言**：
   覆盖 Windows 盘符绝对路径（`^[a-zA-Z]:\/`）、POSIX 根路径（`/usr/...`）、相对路径 + 带尾部斜杠 workspaceRoot 拼接，以及函数断点返回空串的全部分支；
2. **自愈目标对偶对抗与吸收返回值锁定**：
   - 构造同文件、同行号但指纹代码不同的候选断点，严格断言 `matchesHealedTarget` 返回 `false`，彻底斩灭变异为 `return true;` 的逻辑假绿；
   - 测试仅行号漂移、仅指纹代码漂移、两者均漂移及完全相同 4 种状态，验证 `applyHealed` 布尔返回值；
3. **充血实体更新严苛边界拦截**：
   针对 `updateLine` 传入 NaN、负数、零、相同行号，断言严格返回 `false` 且内部行号不受污染；
4. **序列化纯净度与空串缺省回退**：
   对空属性函数断点与源码断点断言导出对象不包含空 key，且缺少名称或文件时安全回退为空串（击杀替代字符串突变体）。
5. **收益效果**:
   `breakpoint.ts` 变异测试得分从初始的 **35.56%** 飙升至 **86.30%**（成功击杀 233 个变异体，直接斩灭 137 个假绿存活变异体），达到 **85%+** 指标。代码覆盖率达成 **语句 100% / 分支 95.49% / 函数 100% / 行 100%**，全工程 16 大物理硬门禁持续全绿通过。

**影响文件**:
- `src/domain/models/breakpoint.ts`
- `test/unit/domain/breakpoint_entity.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

## 1.14 场景聚合根（Scene）91.87% 变异斩杀实战

**问题**:
`scene.ts` 是管理断点生命周期的核心领域聚合根，承担了断点增删查改、物理顺序置顶/置底/微调/拖拽重排、自愈回填同步（INV-004、INV-011）、排重合并（`merge` / `mergeFrom`）以及宿主断点状态双向同步（`syncBreakpointEnabled`）等职责。在引入 Stryker 变异测试基线评估时，变异得分仅为 **49.12%**，存活变异体高达 **144 个**。

**原因**:
1. **聚合根边界极值拦截弱断言**：
   - `getBreakpoint`、`removeBreakpoint`、`moveBreakpoint`、`reorderBreakpoint` 中对 `index < 0` 或 `index >= length` 的边界防护在单测中缺少临界值测试（如刚好等于 `length`、`-1`），Stryker 将 `>=` 变异为 `>`，或将拦截后的 `return false` 变异为空块语句依然假绿；
2. **移动与重排布尔返回值与实际位置未双重校验**：
   - `moveBreakpoint` 的 `top`、`bottom`、`up`、`down` 返回 `true` 被突变为 `return false` 存活；
   - `reorderBreakpoint` 中从末尾拖拽至第 0 位（`targetIndex === 0`）没有单独用例覆盖，导致 `<=` 边界突变存活，且元素插入操作被突变移除后缺乏数组长度和元素位置保真校验；
3. **断点启用状态默认值与翻转语义未覆盖**：
   - 断点未显式传递 `enabled` 时（即 `undefined`），领域默认语义为激活（`true`），`toggleBreakpoint` 翻转后必须为 `false`，但 Stryker 将 `!(bp.enabled ?? true)` 变异为 `!(bp.enabled ?? false)` 存活；
4. **路径包含与子串匹配安全漏洞**：
   - `syncBreakpointEnabled` 在模糊匹配路径时使用 `normTarget.endsWith("/" + normBp)`，缺少对伪子路径的对抗测试（例如 `src/border.ts` 不应匹配 `src/order.ts`），导致将 `"/"` 变异为空串的突变体存活；
5. **排重合并先到先得策略未闭环**：
   - `mergeFrom` 吸收外部场景或断点数组时，排重判断 `this.breakpoints.some(it => it.matches(bp))` 未覆盖已存在断点场景，导致 `some` 变异为 `every` 存活；
6. **自愈吸收实质变更返回值弱校验**：
   - `backfillHealed` 在自愈后是否有实质性行号或指纹变更的布尔返回值未被检测。

**解决方案**:
1. **设计临界值靶向注入矩阵**：
   - 针对 `index === length`、`index === -1`、`sourceIndex === targetIndex`、`targetIndex === 0` 分别施加严苛断言，确保越界被拦截返回 `false`/`undefined`，合法拖拽保真返回 `true` 且数组长度恒定；
2. **undefined 默认布尔语义对偶校验**：
   - 构造无 `enabled` 字段的断点，断言 `toggleBreakpoint` 后严格变为 `false`；断言 `setAllEnabled(true)` 因状态无实质变化返回 `false`，而 `setAllEnabled(false)` 返回 `true`；
3. **路径归一化防混淆对抗断言**：
   - 构造 `src/border.ts` 与 `src/order.ts` 对抗用例，断言前者绝对无法匹配后者，精准斩杀前缀斜杠突变为 `""` 的高危变异体；
   - 覆盖只传 `file` 无 `line` 或只传 `line` 无 `file` 的空值分支；
4. **先到先得排重合并全链路断言**：
   - 覆盖包含同名/同位置重复断点与唯一断点的场景合并，断言重复断点被阻断、新断点被吸收，彻底击杀 `some` 变异为 `every` 与条件取反突变；
5. **基于上下文指纹的代码漂移自愈回填断言**：
   - 构造具备 `contextSnippet.current` 指纹特征的场景，验证行号从 42 漂移至 50 时 `backfillHealed` 成功更新并返回 `true`，二次调用相同目标幂等返回 `false`。
6. **收益效果**:
   `scene.ts` 变异测试得分从初始的 **49.12%** 飙升至 **91.87%**（成功击杀 260 个变异体，仅剩 23 个等价变异体），成功超越用户要求的 **85%+** 指标。覆盖率达成 **语句 100% / 分支 97.34% / 函数 100% / 行 100%**，全工程 25 大测试套件 100% 绿灯，16 大物理硬门禁持续 Exit 0 通过。

**影响文件**:
- `src/domain/models/scene.ts`
- `test/unit/domain/scene_and_catalog.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

## 1.15 指纹值对象（Fingerprint）86.18% 变异斩杀实战

**问题**:
`fingerprint.ts` 是自愈算法的核心基石值对象，负责伴随三行代码指纹提取、60 行作用域探测窗口管理、纯文本空白规范化清洗、多语言单行注释剥离以及词法单元相似度评分。在引入 Stryker 变异测试基线评估时，变异得分仅为 **60.53%**，存活变异体高达 **60 个**。

**原因**:
1. **切片越界与负数倒置高危隐患**：
   - 探测 60 行作用域代码时：`sampleLines = lines.slice(Math.max(0, lineZeroBased - 60), lineZeroBased + 1)`。Stryker 将 `Math.max` 变异为 `Math.min`，当处于文件前 60 行时产生负数切片（例如 `-46`），导致长文件中 `slice(-46, 15)` 因起始位置大于结束位置直接返回空数组，造成前序作用域锚点全面丢失假绿；
   - 若将切片变异为全量 `sampleLines = lines`，由于回溯起点取了末尾，导致断点之后声明的函数逆向渗透为当前断点的 `scopeAnchor`；
2. **越界入参缺省回退未断言**：
   - `extractContextSnippetFromLines` 对越界行号的空串回退（`?? ""`）在单测中未直接调用，被突变为 `?? "Stryker was here!"` 存活；
3. **值对象独立维度与空值防御弱断言**：
   - `equals` 方法比对 4 个属性，既有用例仅测试了“全部相同”与“粗粒度不同”，单个字段（如仅 `current` 或仅 `scopeAnchor` 不同）被变异为 `true` 时未被捕获；
   - `isValid` 与 `hasScope` 对纯空格字符串（如 `"   "`）的长度校验突变为 `length > 0`（空格长度为 3）依然假绿；
4. **序列化 DTO 纯净度未校验**：
   - `toJSON()` 在属性为 `undefined` 时不应导出该 key，Stryker 将条件变为 `if (true)` 依然假绿。

**解决方案**:
1. **作用域窗口正反向双向对抗断言**：
   - **逆向渗透拦截**：在当前断点后方注入函数声明，断言当前断点绝不可捕获该后置函数，精准击杀 `sampleLines = lines` 变异；
   - **负数切片倒置拦截**：构造 120 行长文本，断点位于第 15 行（$15 - 60 = -45$），断言必须成功提取第 2 行的函数声明，彻底剿灭 `Math.min` 导致的负数切片空数组漏洞；
2. **纯空值与越界回退靶向覆盖**：
   - 直接调用 `extractContextSnippetFromLines` 传入 999 越界行号，严格断言产物为 `""`，斩杀替代字符串突变；
3. **值对象 4 维独立对偶矩阵**：
   - 逐一构造仅 `current`、仅 `prev`、仅 `next`、仅 `scopeAnchor` 不同的两组指纹，分别断言严格返回 `false`；
4. **纯空格边界与 DTO 纯净度检测**：
   - 对纯空格 `current` 与 `scopeAnchor` 断言判定为无效或无 scope；
   - 对极简指纹断言 `toJSON()` 中绝对不包含 `prev`、`next`、`scopeAnchor` 与 `indent` 键名。
5. **收益效果**:
   `fingerprint.ts` 变异测试得分从初始的 **60.53%** 跃升至 **86.18%**（成功击杀 131 个变异体，仅剩 21 个防御冗余变异体），成功超越用户要求的 **85%+** 刚性指标。代码分支覆盖率提升至 **96.49%**，全工程 25 大测试套件 100% 绿灯，16 大物理硬门禁持续 Exit 0 通过。

**影响文件**:
- `src/domain/models/fingerprint.ts`
- `test/unit/domain/fingerprint_vo.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

## 1.16 场景目录聚合根（SceneCatalog）89.47% 变异斩杀实战

**问题**:
`sceneCatalog.ts` 是整个插件在领域层的全局总控聚合根（Root Aggregate），负责管理多场景集合字典、维护全局 `activeScenes` 与 `bindings` 启动项映射、场景生命周期（增删改查/重命名联动）、场景带文件过滤克隆（INV-004）以及与磁盘 `.vscode/debug-scenes.json` 1:1 往返 DTO 序列化。在引入 Stryker 变异测试基线评估时，变异得分仅为 **53.95%**，存活变异体高达 **105 个**。

**原因**:
1. **多激活场景联动改名与删除假绿**：
   - `renameScene` 中将 `activeScenes.map(s => s === exactOld ? trimmedNew : s)`，既有用例仅包含 1 个激活场景，Stryker 将条件替换为 `true ? trimmedNew : s`（把所有未改名的激活场景全部篡改）依然能够绿灯；
   - `deleteScene` 中将 `activeScenes.filter(s => s !== exactName)`，测试同样仅有 1 个激活场景，突变为 `filter(() => undefined)` 或 `filter(s => s === exactName)` 导致断言长度为 0 假绿；
2. **场景克隆目标文件伪前缀与函数断点过滤未防范**：
   - `duplicateScene` 中当源场景包含函数断点时，带 `targetFile` 克隆逻辑未被断言函数断点是否被正确剔除；
   - 匹配路径未防范伪子路径（如 `src/border.ts` 与 `order.ts`），导致 `endsWith` 缺少 `"/"` 分隔符的突变体存活；
3. **`clearActive` 显式空数组导出与序列化纯净度未校验**：
   - 当调用 `clearActive()` 后，内部应标记 `hasExplicitActiveScenes = true`，确保 `toJSON()` 输出 `"activeScenes": []`。突变为 `false` 时缺少断言；
   - `toJSON()` 中 `bindings` 导出键值是否忠实保留未作字段比对，突变为导出空对象 `res.bindings = {}` 无法被捕获。

**解决方案**:
1. **构建多激活场景数组状态矩阵**：
   - 在重命名与删除前初始化 `["keepScene", "alpha"]` 多个激活场景；
   - 重命名 `alpha` 时，断言 `getActiveScenes()` 严格等于 `["keepScene", "alphaRenamed"]`，彻底击杀 `true ? trimmedNew : s` 全局篡改突变体；
   - 删除 `alphaRenamed` 时，断言 `getActiveScenes()` 严格等于 `["keepScene"]`，彻底剿灭 `filter(() => undefined)` 与反向过滤突变体；
2. **克隆跨类型隔离与防混淆对抗**：
   - 构造同时具备函数断点与文件断点的源场景，过滤克隆后断言产物断点数严格为 1，函数断点与 `border.ts` 伪路径被 100% 阻断；
3. **序列化显式持久化标记与字典保真比对**：
   - 调用 `clearActive()` 后，显式断言 `"activeScenes" in toJSON()` 且内容为 `[]`；
   - 断言 `toJSON().bindings["Launch Target"] === "targetScene"`，击杀导出空对象突变。
4. **收益效果**:
   `sceneCatalog.ts` 变异测试得分从初始的 **53.95%** 飙升至 **89.47%**（成功击杀 204 个变异体，仅剩 24 个冗余变异体），成功超越用户要求的 **85%+** 指标。代码覆盖率达成 **语句 100% / 分支 98.85% / 函数 100% / 行 100%**，全工程代码总行覆盖率升至 **90.72%**，全工程 25 大测试套件 100% 绿灯，16 大物理硬门禁持续 Exit 0 通过。

**影响文件**:
- `src/domain/models/sceneCatalog.ts`
- `test/unit/domain/scene_and_catalog.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

## 1.17 防回声回环守卫（EchoLoopGuard）85.71% 变异斩杀实战

**问题**:
`echoLoopGuard.ts` 承担了整个扩展在全双工双向实时同步场景下的核心防灾守卫职责（遵循架构核心不变量 INV-008），负责管理写盘内部保护窗、多重定时器防抖续期、JSON 语义结构抗干扰比对以及 `runWithSavingGuard` 事务保护。在引入 Stryker 变异测试基线评估时，初始得分为 **71.43%**，存活变异体 10 个。

**原因**:
1. **写盘事务前置保护与返回值透传弱校验**：
   - `runWithSavingGuard` 中进入回调前调用 `this.markInternalSaving()`，测试未在回调执行期间校验守卫状态，导致前置调用被变异删除依然假绿；且缺少对回调异步返回值的精确匹配断言；
2. **初始状态与 Getter/Setter 保真盲区**：
   - `lastSavedContent` 初始空字符串被突变为 `"Stryker was here!"`，缺少新建实例的初始内容断言；
3. **空值与非 JSON 文本降级比对防御**：
   - `isContentMatchingLastSaved` 在双方内容为空或未设置时，突变为 `return true` 假绿；且非法非 JSON 文本不同时降级比对缺少不匹配测试；
4. **长耗时操作下 finally 续期保护关键性**：
   - 当 action 执行时间超出前置 15ms 延时保护窗时，若缺少 `finally` 重新调用 `markInternalSaving()`，退出事务时保护窗将已失效关闭，引发回声回环。

**解决方案**:
1. **回调内部锁状态与返回值双重锚定**：
   - 在 `runWithSavingGuard` 的 action 内部同步捕获 `isInternalSaving()`，断言必须为 `true`，彻底击杀前置守卫调用被删除的突变体；
   - 显式断言 `runWithSavingGuard` 返回特定异步结果字符串；
2. **初始内容与 Getter/Setter 严格对齐**：
   - 新建实例断言 `getLastSavedContent() === ""`，并断言更新后完全吻合；
3. **空值防御与非匹配降级分支全覆盖**：
   - 针对 `lastSavedContent` 为空、入参为空以及两份不同非法文本，断言均严格返回 `false`；
4. **超长耗时操作 finally 续期对抗断言**：
   - 构造耗时 40ms 的异步 action 并设置 15ms 短保护窗，断言 action 结束后通过 `finally` 重新续期后依然保持 `isInternalSaving() === true`。
5. **收益效果**:
   `echoLoopGuard.ts` 变异测试得分从初始的 **71.43%** 提升至 **85.71%**（成功击杀 30 个变异体，仅剩 5 个冗余变异体），成功超越用户要求的 **85%+** 指标。代码覆盖率达成 **语句 100% / 分支 100% / 函数 100% / 行 100%** 四大满贯，全工程代码行覆盖率稳步提升至 **90.72%**，全工程 25 大测试套件 100% 绿灯，16 大物理硬门禁持续 Exit 0 通过。

**影响文件**:
- `src/infra/storage/echoLoopGuard.ts`
- `test/unit/infra/echo_loop_guard.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

### 1.18 SerialQueue 串行锁变异测试、过度防御死代码消除与 100% 斩杀

**问题**:
在对单写者串行排队锁 (`src/application/serialQueue.ts`) 实施变异测试冲刺时，首轮 Stryker 变异测试得分仅为 66.67% (2 killed, 1 survived)。其中存活变异体位于 `enqueue` 方法中的第二个回调参数：
```typescript
const result = this.queue.then(
    () => task(),
    () => task(),  // Stryker 替换为 () => undefined 存活！
);
```
无论在外部如何构造前置任务抛错、连续故障或延迟恢复，测试断言均无法击杀该变异体。

**原因**:
1. **ECMAScript Promise 状态机与物理死代码事实**：
   在原实现中，队列尾指针更新逻辑为：
   ```typescript
   this.queue = result.then(
       () => {},
       () => {},  // 吸收了上一任务的所有异常，未 throw
   );
   ```
   根据 ECMAScript Promise 规范，只要 `onrejected` 回调未显式抛出错误，返回的新 Promise 必然处于 **fulfilled (resolved)** 状态。这意味着 `this.queue` 在生命周期任何时刻都**绝不可能处于 rejected 状态**！
2. **不可达回调导致的假防御**：
   在后续调用 `this.queue.then(onfulfilled, onrejected)` 时，第二个参数 `onrejected`（即 `() => task()`）物理上 100% 不可达。Stryker 将其变异为 `() => undefined` 时，因代码永不执行，形成了无法击杀的幽灵变异体。
3. **违背 KISS 原则的双重过度防御**：
   下层已使用 `result.then(() => {}, () => {})` 进行了错误恢复，上层又重复编写了 `() => task()`，构成了不必要的过度工程与冗余。

**解决方案**:
1. **恪守 KISS 原则消除过度设计**：
   将 `SerialQueue` 提纯为地道纯粹的 Promise 链：
   ```typescript
   export class SerialQueue {
       private queue: Promise<unknown> = Promise.resolve();

       public enqueue<T>(task: () => Promise<T>): Promise<T> {
           const result = this.queue.then(() => task());
           this.queue = result.catch(() => {});
           return result;
       }
   }
   ```
   - 彻底清除物理不可达的死代码参数；
   - 采用标准 `.catch(() => {})` 确保前置任务失败后队列指针安全恢复，后续排队任务正常执行（捍卫 INV-010）；
   - 调用者直接获得原始 `result`，能正确捕获任务异常并接收返回值。
2. **构建 1:1 独立镜像单元测试套件**：
   新建 `test/unit/application/serial_queue.test.mjs`，覆盖 6 大关键维度：
   - 基本执行与返回值透传；
   - 前慢后快严格串行排队防交错；
   - 任务抛错调用方精准捕获；
   - 连续故障混合流水线下的容灾自愈；
   - 20 个突发并发任务的顺序与结果 100% 保持；
   - 空值与 undefined 任务解析。
3. **收益效果**:
   - `serialQueue.ts` 变异测试得分直接跃升至 **100.00%**（击杀率 100%，存活 0）；
   - 代码行数从 23 行脱水为 18 行，彻底清除冗余分支与死代码；
   - 全工程单测套件从 25 个扩展为 **26 大全维套件**，100% 绿灯；
   - 16 项代码级物理硬门禁全绿（Exit 0 纯净通过）。

**影响文件**:
- `src/application/serialQueue.ts`
- `test/unit/application/serial_queue.test.mjs`
- `test/run-all.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

### 1.19 AtomicFileJsonStore 冷启动防灾、Git冲突拦截与日志样板脱水变异斩杀

**问题**:
对磁盘原子存储与冷启动灾备恢复模块 (`src/infra/storage/atomicFileJsonStore.ts`) 实施变异测试冲刺时，初始 Stryker 得分仅为 46.67% (77 killed, 88 survived)。分析存活变异体发现：
1. **空白与 Git 冲突守卫无法被击杀**：
   `probeMainFile` 与 `tryParseCandidate` 中的 `!content || !content.trim()` 与 `CONFLICT_REGEX.test(content)` 被 Stryker 突变为 `false` 时依然存活；
2. **多临时副本时间戳降序仲裁变异体存活**：
   候选临时副本扫描排序 `candidates.sort((a, b) => b.mtime - a.mtime)` 的比较函数与方向变异未被现有单测覆盖；
3. **未超期活跃临时文件生命周期边界盲区**：
   孤儿临时碎片清理时间阈值 `now - stat.mtimeMs > 5000` 与前缀过滤存在存活变异体；
4. **大量 console.warn 模板字符串样板代码噪声**：
   6 处 catch 块中重复编写 `console.warn(`[AtomicFileJsonStore] ...: ${err?.message || String(err)}`)`，生成了 36 个可选链、逻辑或、空串等无效变异体，形成严重分数压制。

**原因**:
1. **多重失败分支收敛于相同返回值 null**：
   在默认 `JSON.parse` 下，空白文本或 Git 冲突文本本身就会触发 `SyntaxError` 并进入 catch 返回 `null`，导致即使守卫条件被变异为 `false`，下一行代码仍然抛出异常返回 `null`，无法在黑盒测试中形成有效击杀；
2. **单测候选副本数量单一**：
   原有测试仅构造 1 个合法候选副本，未同时构造“新损坏副本 + 次新有效副本”，导致无法验证时间戳降序仲裁与坏候选跳过能力；
3. **未触发真正的临时文件 unlink 清理**：
   原有测试在序列化抛错时，临时文件尚未真正写入磁盘，导致 `finally` 块中的 `fs.unlinkSync(tmpPath)` 从未真实执行。

**解决方案**:
1. **正交隔离：通过宽松 parse 击杀空白与冲突守卫**：
   在单测中传入能容忍非 JSON 格式的宽松解析器（如 `parse: (raw) => ({ text: raw })`）：
   - 当守卫有效时，主文件被前置拦截并触发 `healed` 从有效候选恢复；
   - 当守卫被突变为 `false` 时，宽松解析器直接解析成功返回 `healthy`，从而精准击杀 `!content.trim()` 与 `CONFLICT_REGEX` 变异体；
   - 补充行内伪冲突文本（如包含普通小于号 `a < b` 或非行首标记），断言不被误判为冲突；
2. **多副本时间戳降序仲裁与坏候选跳过断言**：
   同时构造“1 秒前创建的冲突坏副本”、“2 秒前创建的合法副本”与“4 秒前创建的合法副本”，断言系统精准跳过最新坏副本，抢救次新合法副本；
3. **真实 renameSync 失败触发 finally 清理**：
   将目标路径指向已存在的同名目录，使 `fs.writeFileSync` 成功但 `fs.renameSync` 抛出 `EISDIR/EPERM`，断言 `finally` 块真实执行 `unlinkSync` 彻底清除临时文件；
4. **KISS 重构：提炼 logWarning 消除样板代码**：
   提炼内部函数：
   ```typescript
   function logWarning(msg: string, err: unknown): void {
       const detail = err instanceof Error ? err.message : String(err);
       console.warn(`[AtomicFileJsonStore] ${msg}: ${detail}`);
   }
   ```
   消除 6 处重复的模板字符串拼接，消减 36 个样板变异体噪声。
5. **收益效果**:
   - `atomicFileJsonStore.ts` 变异测试得分从初始的 **46.67%** 跃升至 **85.31%**（成功击杀 122 个变异体），成功超越用户要求的 **85%+** 指标；
   - 代码行数脱水精简，消除了重复的样板错误日志逻辑；
   - 全工程 26 大全维单测套件 100% 绿灯，16 大物理硬门禁全绿通过。

**影响文件**:
- `src/infra/storage/atomicFileJsonStore.ts`
- `test/unit/infra/atomic_file_json_store.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

### 1.20 AgentRuleAsset 规则资产实体与 pureSha256 指纹变异斩杀防线

**问题**:
在对 AI 规则资产实体 (`src/domain/models/agentRuleAsset.ts`) 开展变异测试冲刺时，发现以下变异存活隐患：
1. **Hasher 端口注入与委托调用缺失**：`computeFingerprint(hasher)` 与 `evaluateLifecycle(..., hasher)` 中针对抽象端口 `IHashService` 的存在性与类型判定被变异后仍能假绿；
2. **多态签名识别盲区**：`evaluateLifecycle` 第二参数既可为版本字符串也可为 `IHashService` 对象，参数重载分支缺少正交断言；
3. **空输入与构造器防御盲区**：构造函数 `rawContent || ""` 与空 Markdown 文本下的 Frontmatter 剥离分支存活。

**解决方案**:
1. **端口注入双向断言**：
   显式注入 mock hasher 并断言优先调用端口实现；同时传入空对象 `{}` 验证能健壮降级至纯 TS 的 `pureSha256` 实现；
2. **多态参数分支全覆盖**：
   覆盖 (1) 第二参数传入 `IHashService` 对象；(2) 第二参数传入版本字符串且第三参数传入 `IHashService` 的完整路径；
3. **构造器空输入与非 ASCII 字符全覆盖**：
   传入 `null`/`undefined` 验证属性与方法保真；补充中文字符 Unicode 编码与非 ASCII 码点兜底断言；
4. **收益效果**:
   `agentRuleAsset.ts` 变异测试得分从基线冲刺突破至 **90.30%**（击杀 132 个变异体，超时 17 个，存活仅 16 个），成功超越用户要求的 **85%+** 指标。

**影响文件**:
- `src/domain/models/agentRuleAsset.ts`
- `test/unit/domain/skill_asset.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

### 1.21 FileLineReader 三级行提取与异常拦截变异斩杀

**问题**:
在对文件行读取基础设施 (`src/infra/storage/fileLineReader.ts`) 实施变异测试时，以下关键控制流分支存在存活变异体：
1. **绝对路径与 workspaceRoot 互斥解析**：`path.isAbsolute(filePath) || !this.workspaceRoot ? filePath : path.join(...)` 的三元表达式与逻辑或变异；
2. **非 string 入参类型守卫**：`!filePath || typeof filePath !== "string"` 对数字、对象等非法入参的拦截；
3. **读取磁盘异常 catch 优雅降级**：读取目录等非法文件时 `try ... catch { return undefined; }` 的分支未被有效覆盖。

**解决方案**:
1. **互斥路径与无 root 场景显式断言**：
   - 传入绝对路径且显式提供 `workspaceRoot`，断言直接读取绝对路径，不进行二次拼接；
   - 未设置 `workspaceRoot` 时传入相对路径，断言直接回退安全处理；
2. **非法入参类型守卫全覆盖**：
   测试数字 `12345`、空对象 `{}`、空串、`null` 与 `undefined`，断言 100% 安全返回 `undefined`；
3. **读取目录触发底层 EISDIR 异常拦截断言**：
   将目标路径指向已存在的子目录，验证底层捕获异常并优雅返回 `undefined`，杜绝运行时抛错中断业务；
4. **验证导出全局单例**：
   断言 `defaultFileLineReader` 实例类型健全。
5. **收益效果**:
   `fileLineReader.ts` 变异测试得分跃升至 **92.11%**（成功斩杀 35 个变异体，存活仅 3 个），成功超越用户要求的 **85%+** 指标。

**影响文件**:
- `src/infra/storage/fileLineReader.ts`
- `test/unit/infra/file_line_reader.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

### 1.22 HealingEngine 自愈核心两阶段算法 80% -> 91.58% 深度变异突破

**问题**:
在将 `healingEngine.ts`（自愈领域算法）变异测试得分提升至 80.00% 后，仍有 66 个存活变异体，未达到用户要求的 85%+ 硬指标。具体根因包括：
1. **等价变异体（Equivalent Mutants）与过度防御**：
   - `candPrev === targetPrev || (i > 0 && cleanLine(lines[i - 1]) === targetPrev)` 中，因 `candPrev` 本身就是由 `findPrevNonEmptyLine` 计算出的上一非空行，逻辑或后半部分在数学上恒为短路死逻辑；
   - `snippet.targetIndent > 0 && (candIndent === targetIndent * 2 || ...)` 中，当 `targetIndent === 0` 时，前面 `candIndent === targetIndent` 命中已先行返回，后半部分不可能被进入，`snippet.targetIndent > 0` 为恒真冗余；
   - 内部闭包单次遍历中分配了无重复读取的 `scopeCache: Map<number, string>`，产生无法被击杀的缓存存活变异体。
2. **Phase 2（作用域巡航大跨度重锚定）弱断言盲区**：
   - Python 风格函数头结尾空格容错 `trim().endsWith(":")` 未被测试覆盖，变异为 `endsWith(":")` 或 `endsWith("")` 假绿；
   - 作用域外同级/反缩进代码触发的 `break` 截断未被对抗测试捕获；
   - Phase 2 命中行恰好落回 `targetLine` 时的 `isHealed = false` 与 `status = "matched"` 未被覆盖，变异为 `isHealed = true` 假绿；
   - 候选竞争中缺少同分双候选先到先得保持 `>` 比较（防止变异为 `>=` 覆盖）。
3. **软相似度 sim >= 0.70 数学临界点**：
   - 缺少 Jaccard 相似度严格等于 0.70 的对偶字符串样本，导致 `>=` 变异为 `>` 存活。

**解决方案**:
1. **贯彻 KISS 原则清除恒真冗余与死逻辑**：
   - 将伴随行精简为纯粹的 `snippet.targetPrev && candPrev === snippet.targetPrev`；
   - 消除 `targetIndent > 0` 冗余；
   - 消除无复用价值的局部 `scopeCache`，直接纯函数计算；
2. **构建高灵敏度 Phase 2 与边界靶向对抗用例**：
   - **Python 尾部空格与缩进 break 阻断**：构造函数头 `"def func():   "`并在外部放置同缩进语句，断言严格触发缩进阻断并返回函数体内候选行；
   - **Phase 2 原行匹配保真度**：构造软相似度原行命中，严格断言 `isHealed === false` 与 `status === "matched"`；
   - **对称距离同分双候选竞争**：在目标原行两侧对称布置相同指令，严格验证保留首个命中行，斩杀 `>=` 变异体；
   - **数学严格 0.70 相似度测试**：构造 `wordSim = 2/3` 且 `charSim = 7/9` 的精准样本（`"a b cdefg"` 与 `"a b cccxx"`），实现严格 0.70000 边界击杀；
   - **鸭子对象提取器与循环越界校验**：传入鸭子对象 `{ lineCount, lineAt }` 覆盖遍历循环与越界拦截。
3. **收益效果**:
   `healingEngine.ts` 变异测试得分从 80.00% 跃升突破至 **91.58%**（成功击杀 269 个变异体，超时 3 个，存活仅 25 个），超越用户要求的 **85%+** 硬指标。

**影响文件**:
- `src/domain/services/healingEngine.ts`
- `test/unit/domain/healing.test.mjs`
- `stryker.config.json`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

### 1.23 单测目录架构重构与 Clean Architecture 1:1 镜像实践

**问题**:
历史遗留下来的单测目录（`test/unit/`）存在明显的架构坏味道与分层不一致：
1. **扁平化未对齐源码二级目录**：`src/domain/` 明确分为 `models/` 与 `services/`，`src/infra/` 分为 `storage/` 与 `vscode/`，但在 `test/unit/` 中却全部扁平存放，难以一目了然定位对应的测试；
2. **跨层混杂（UI 层测试误塞入 Infra）**：CodeLens、InlayHints、StatusBar、TemplateProvider、TreeView 以及命令系统的测试被错误堆放在 `test/unit/infra/` 下，违反了“四层+展示隔离（Clean Architecture）”硬护栏；
3. **构建脚本单测归属不清**：`extract_changelog` 与 `guardrails_verification` 混杂在基础设施单测中。

**解决方案**:
1. **重构 `test/unit/` 为纯正 1:1 镜像拓扑**：
   - `test/unit/domain/models/`：测试充血实体与值对象（breakpoint, fingerprint, scene, catalog, skill）；
   - `test/unit/domain/services/`：测试领域纯算法（healingEngine, scenePayloadCodec, diffResolver）；
   - `test/unit/infra/storage/`：测试持久化与原子存储（atomicStore, echoGuard, lineReader, sceneRepo）；
   - `test/unit/infra/vscode/`：测试原生桥接与监听器（breakpointBridge, listenersRegistry）；
   - `test/unit/ui/commands/` 与 `test/unit/ui/views/`：彻底将 7 大 UI 测试迁出 Infra，回归 UI 展示层本位；
   - `test/unit/scripts/`：独立收敛构建与门禁脚本自动化测试；
2. **根目录定位健壮化（Hermetic Root Locator）**：
   重构 `commands_registry.test.mjs` 中脆弱的相对路径查找，改用基于当前文件目录向上回溯 `package.json` 的自适应定位算法，彻底杜绝目录层级移动导致的 `ENOENT`；
3. **调度器与变异测试链路对齐**：
   同步更新 `test/run-all.mjs` 与 `stryker.config.json` 中的全量引入路径。

**影响文件**:
- `test/unit/**/*`（全量 30 个单测文件）
- `test/run-all.mjs`
- `stryker.config.json`
- `docs/knowledge-base/constraints.md`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-01

---

### 1.24 单元测试物理级 1:1 绝对镜像与纯工具/深层子目录全面对齐

**问题**:
在完成单测初级分层后，仍存在部分深层不对称问题：
1. **纯工具层独立单测缺失**：`src/shared/utils/`（`arrayUtils.ts`, `stringSimilarity.ts`, `textUtils.ts`）的测试混杂在集成测试中，导致该分层无独立单测目录；
2. **三级子目录未下钻**：`src/infra/vscode/bridge/` 与 `src/ui/locators/` 没有三级测试目录对应；
3. **单测文件命名为用例语义名而非源文件名**：如 `breakpoint_entity.test.mjs` 对应 `breakpoint.ts`、`skill_asset.test.mjs` 对应 `agentRuleAsset.ts`、`scene_service.test.mjs` 对应 `sceneManager.ts`，影响快速检索定位。

**解决方案**:
1. **建立 `test/unit/shared/utils/` 独立纯测试套件**：
   拆分建立 `array_utils.test.mjs`、`string_similarity.test.mjs`、`text_utils.test.mjs`，覆盖所有通用文本清洗、缩进计算、词法相似度及作用域提取；
2. **下钻细化三级子目录**：
   - 建立 `test/unit/infra/vscode/bridge/dap_bridge.test.mjs`；
   - 建立 `test/unit/infra/vscode/listeners/listeners_registry.test.mjs`；
   - 建立 `test/unit/ui/locators/treeview_locator.test.mjs`；
3. **源文件与单测文件 100% 严格同名化**：
   统一按 `camelCase.ts` $\rightarrow$ `snake_case.test.mjs` 映射重命名，实现全代码库每个源文件与测试文件的完美 1:1 镜像对应；
4. **测试套件总数升级**：
   全工程自动化单元测试扩充至 **30 大全维套件**，总执行耗时仍保持在 17s 极速区间，门禁校验 100% 通过。

**影响文件**:
- `test/unit/**/*`（全量 30 个测试文件）
- `test/run-all.mjs`
- `docs/knowledge-base/constraints.md`
- `docs/knowledge-base/lessons/test-real-import.md`

**日期**: 2026-10-02

---

### 1.25 第一梯队纯领域算法变异测试突破实战：编解码清洗、差量推导与集合空值短路优化

**问题**:
推进全工程变异测试工程化路线图时，启动第一梯队（纯核心算法与编解码：`healingEngine.ts`、`scenePayloadCodec.ts`、`activeScenesDiffResolver.ts`）攻坚：
1. **多格式编解码器（scenePayloadCodec.ts）存活 15 个变异体**：
   - `candidateBreakpoints = []` 变异为字符串数组存活（Stryker 默认注入字符串，被下游对象检查安全过滤，导致等价）；
   - 候选场景提取中，`typeof scenes === 'object'` 突变存活；
   - 断点字段类型判断中的冗余 `"line"` 检查（`["condition", "hitCount", "logpoint", "line"].includes(...) ? item.type : "line"`）形成不可杀等价变异体；
2. **激活差量器（activeScenesDiffResolver.ts）存活 2 个变异体**：
   - `computeTopologyHash` 中 `!Array.isArray(breakpoints) || breakpoints.length === 0` 的 `|| false` 存活；
   - `filterGhostScenes` 中 `if (!scenesDict || targetScenes.length === 0) return []` 的 `|| false` 存活；
3. **多模块变异测试执行器缺失**：
   - Stryker `commandRunner` 仅绑定单个测试，若配置多个模块变异，缺乏轻量级聚合执行器，导致每次变异反复拉起冗余测试。

**原因**:
1. 程序员习惯性编写的“空集短路保护”（如 `|| array.length === 0`），忽略了 JavaScript 底层数组函数（如 `.map()`, `.sort()`, `for...of`）在空集合上天然封闭的数学事实，形成了逻辑上的等价变异死逻辑；
2. 类型映射判断中，既将 `"line"` 作为 fallback，又在有效类型列表中包含了 `"line"`，形成自反等价变异体；
3. 缺少轻量级梯队联合执行器，阻碍了对多个强相关纯逻辑服务的并发变异守护。

**解决方案**:
1. **第一性原理与 KISS：消除集合运算上的冗余空值短路**：
   - 在 `activeScenesDiffResolver.ts` 中，空数组的 `.map()`、`.sort()`、`.join("|")` 天然产出空串 `""`，循环 `for (const target of targetScenes)` 在空集合上天然循环 0 次返回空数组 `[]`；
   - 果断移除 `|| length === 0` 等价死逻辑，不仅使代码更加清爽精炼，更直接将变异体从根源斩灭，变异得分直接突破 **100.00% 满分**；
2. **编解码器类型守卫与结构等价变异体清除**：
   - 重构 `resolveCandidatePayload` 为扁平直接返回，消除中间可变变量；
   - 移除类型判断数组中默认值 `"line"` 的冗余声明（`["condition", "hitCount", "logpoint"]`），消除等价变异体；
   - 补充 12 大边界断言（包含非对象 scenes、空字典 fallback、缺失 file 与非数字 line 的严格拦截），变异得分从 94.23% 突破跃升至 **98.05%**；
3. **建立轻量联合变异测试执行器 (`test/runners/run-tier1-tests.mjs`)**：
   - 将第一梯队三大服务的 1:1 单测无缝聚合，单次运行仅耗时 ~200ms；
   - 将 `stryker.config.json` 的 `mutate` 升级为完整的第一梯队套件，实现梯队级全自动变异守护；
4. **收益效果**:
   - 第一梯队三大领域算法全部超越 85%+ 硬指标，取得历史最好成绩：
     - `healingEngine.ts`：**91.58%**（斩杀 269 个变异体）；
     - `scenePayloadCodec.ts`：**98.05%**（斩杀 252 个变异体）；
     - `activeScenesDiffResolver.ts`：**100.00%**（斩杀 96 个变异体）；
     - **第一梯队平均变异杀伤率：96.54%**；
   - 全工程行覆盖率进一步攀升至 **90.93%**，分支覆盖率突破至 **85.01%**；
   - 16 大物理硬门禁、ESLint 0 errors / 0 warnings 全部绿灯。

**影响文件**:
- `src/domain/services/scenePayloadCodec.ts`
- `src/domain/services/activeScenesDiffResolver.ts`
- `test/unit/domain/services/scene_payload_codec.test.mjs`
- `test/runners/run-tier1-tests.mjs`
- `stryker.config.json`
- `docs/knowledge-base/constraints.md`
- `docs/knowledge-base/lessons/test-real-import.md`
- `docs/knowledge-base/lessons/README.md`

**日期**: 2026-10-02

### 1.26 第二梯队（核心领域模型）变异斩杀：聚合执行器显式挂载规范与领域实体死逻辑消除

**问题**:
在对第二梯队核心领域模型（`fingerprint.ts`, `breakpoint.ts`, `scene.ts`, `sceneCatalog.ts`）推进变异测试时，遭遇两类隐蔽问题：
1. **聚合运行器空转假绿与漏测陷阱**：
   初始构建 `run-tier2-tests.mjs` 时采用动态 `await import("../unit/domain/models/scene.test.mjs")`，而单测文件内部包含 `if (process.argv[1]?.endsWith("..."))` 守卫条件。通过 runner 启动时，守卫条件未被触发，导致导出测试套件函数根本没有被执行，Stryker 出现“运行 1 个测试但杀伤率为 0%”的严重空转；
2. **实体初始化覆盖与空值回退死逻辑**：
   - `scene.ts` 中 `private breakpoints: Breakpoint[] = [];` 属性初始化被构造函数 `this.breakpoints = ...` 无条件覆盖，声明处的赋空为死赋值；
   - `bp.enabled` 在 `Breakpoint` 构造函数中已被强制转换为布尔值，在 `scene.ts` 中继续编写 `(bp.enabled ?? true)` 产生了永远不可达的 nullish 逻辑变异体；
   - `sceneCatalog.ts` 中 `this.bindings` 在构造函数中保底为 `{}`，在外层编写 `if (this.bindings)` 纯属冗余真值防御。

**原因**:
1. ES 模块的 `import` 仅负责加载模块内容，若测试逻辑封装在导出的普通函数中，必须由聚合执行器显式同步调用，绝不可依赖命令行入口的 `process.argv` 条件分支；
2. 充血领域实体天然具备自洁和强类型不变量，上层容器实体在消费子实体时往往保留了防御性编程的思维定势（多重空值保护、默认回退），在严格变异测试下暴露为等价死逻辑。

**解决方案**:
1. **确立聚合执行器显式同步触发规范**：
   在 `run-tier2-tests.mjs` 中显式导入并顺序同步调用各单测套件函数：
   ```javascript
   import { runFingerprintVoTests } from "../unit/domain/models/fingerprint.test.mjs";
   import { runBreakpointEntityTests } from "../unit/domain/models/breakpoint.test.mjs";
   import { runConfigTests } from "../unit/domain/models/scene.test.mjs";
   import { runSceneAndCatalogTests } from "../unit/domain/models/scene_catalog.test.mjs";

   runFingerprintVoTests();
   runBreakpointEntityTests();
   runConfigTests();
   runSceneAndCatalogTests();
   ```
2. **第一性原理消除领域模型死逻辑与过度防御**：
   - `scene.ts` 去除属性声明处死赋值，直接声明 `private breakpoints: Breakpoint[];`；
   - 移除 `bp.enabled ?? true` 冗余回退，直接基于布尔状态取反与判断；
   - 精简 `backfillHealed` 中冗余集合判断为 `if (!healedBreakpoints?.length) return false;`；
   - `sceneCatalog.ts` 去除冗余的 `if (this.bindings)` 守卫。
3. **补充 10 组针对性变异对抗用例**：
   - 覆盖函数断点绝对隔离（指纹提取与自愈过滤）；
   - 覆盖 Windows 反斜杠归一化与伪子目录（如 `path-order.ts` vs `order.ts`）精准匹配；
   - 覆盖 `activate` 后导出 `toJSON` 数组元素保真性。
4. **收益效果**:
   - 第二梯队四大领域模型全部超越 85%+ 硬指标，斩杀 793 个变异体：
     - `fingerprint.ts`：**96.19%**（斩杀 101 个）；
     - `scene.ts`：**94.20%**（斩杀 260 个）；
     - `sceneCatalog.ts`：**90.54%**（斩杀 201 个）；
     - `breakpoint.ts`：**87.83%**（斩杀 231 个）；
     - **第二梯队综合变异得分：91.57%**；
   - 全工程行覆盖率达到 **90.96%**，分支覆盖率达到 **85.11%**；
   - 30 套单测 100% 绿灯，16 大物理硬门禁全绿通过。

**影响文件**:
- `src/domain/models/scene.ts`
- `src/domain/models/sceneCatalog.ts`
- `test/unit/domain/models/scene_catalog.test.mjs`
- `test/runners/run-tier2-tests.mjs`
- `stryker.config.json`
- `docs/knowledge-base/constraints.md`
- `docs/knowledge-base/lessons/test-real-import.md`
- `docs/knowledge-base/lessons/README.md`

**日期**: 2026-10-02

---

### 1.27 第三梯队（底层纯工具与数据结构）变异测试实战：巨型静态正则噪点排除与多重控制流死防御精简

**问题**:
在对第三梯队底层纯工具（`arrayUtils.ts`、`stringSimilarity.ts`、`textUtils.ts`）推进变异测试时，遇到以下典型阻碍：
1. **巨型静态正则表的变异噪点膨胀**：
   `textUtils.ts` 内置跨 11 种编程语言（Python、Go、Rust、Java、C/C++、PHP、Ruby 等）的函数与作用域提取正则表 `SCOPE_PATTERNS`。Stryker 默认开启的 `Regex` mutator 会对每个正则量词、字符集边界、贪婪/非贪婪修饰符生成多达数百个无实际业务逻辑意义的微观语法突变体，不仅使变异执行时间剧烈恶化，而且淹没了对算法核心控制流（缩进回溯、括号平衡、循环跳出）的关注；
2. **多重预防御导致的不可达死控制流**：
   - `findScopeAnchorLine` 中前置编写了 `if (/^\s*(?:if|for|while|...)/.test(line)) continue;`，然而下方的 `SCOPE_PATTERNS` 根本不会匹配 `if(...)` 这类控制流语句，该前置正则沦为死代码；
   - `extractScopeAnchor` 在开头存在冗余的直接 return，导致内部严格维护的 `CONTROL_FLOW_KEYWORDS`（17 个跨语言保留字）黑名单无法被全面击杀，形成大量等价变异体；
   - `arrayUtils.ts` 中的 `uniqueByProperty` 内部存在冗余的 `if (!raw)` 短路。

**原因**:
1. 通用工具模块往往经历多次需求迭代，开发者容易在入口处不断叠加“经验性防御正则”或“短路拦截”，导致与深层经过单元测试覆盖的标准过滤逻辑产生重叠与功能被动屏蔽；
2. 变异测试引擎的 Regex 插件属于底层 AST 字符级变换，对于业务逻辑层属于静态只读词典的常量规则，无需耗费变异算力，应通过配置精准聚焦在控制流、边界值与算法运算。

**解决方案**:
1. **Stryker 精准变异配置（排除纯语法正则噪点）**：
   在 `stryker.config.json` 中配置排除 Regex 突变：
   ```json
   "mutator": {
     "excludedMutations": ["Regex"]
   }
   ```
   将变异算力 100% 锁定在业务逻辑、边界比较、数组偏移与词法分词算法上；
2. **第一性原理与 KISS：彻底清除冗余双重防御死逻辑**：
   - 清除 `findScopeAnchorLine` 中死控制流正则拦截，完全依托标准的 `SCOPE_PATTERNS` 作用域提取；
   - 精简 `extractScopeAnchor` 冗余的提前短路，使 `CONTROL_FLOW_KEYWORDS` 黑名单能够 100% 覆盖并击杀变异体；
   - 清除 `arrayUtils.ts` 中多余的 `if (!raw)` 短路，利用 ES6 原生数组方法天然契约；
3. **补充抗混淆与多语言高精度单测**：
   - 补充 Python/Go/Rust/Java/C++ 作用域提取与类装饰器边界断言；
   - 补充 `stringSimilarity` 中转义引号、嵌套块注释、负号前缀与不等长文本的严密断言；
   - 补充反序数组与带空键对象的属性去重测试；
4. **收益效果**:
   - 第三梯队三大工具全线突破 85%+ 硬指标，斩杀 313 个变异体：
     - `arrayUtils.ts`：**100.00% 满分**（击杀 46 个）；
     - `textUtils.ts`：**88.24%**（击杀 133 个）；
     - `stringSimilarity.ts`：**87.34%**（击杀 134 个）；
     - **第三梯队综合变异得分：89.36%**；
   - 全工程行覆盖率达到 **90.96%**，分支覆盖率维持在 **85.11%** 高位；
   - 全工程 30 大全维单测 100% 通过，16 大物理硬门禁全绿达标。

**影响文件**:
- `src/shared/utils/arrayUtils.ts`
- `src/shared/utils/textUtils.ts`
- `test/unit/shared/utils/array_utils.test.mjs`
- `test/unit/shared/utils/text_utils.test.mjs`
- `test/unit/shared/utils/string_similarity.test.mjs`
- `test/runners/run-tier3-tests.mjs`
- `stryker.config.json`
- `docs/knowledge-base/constraints.md`
- `docs/knowledge-base/lessons/test-real-import.md`
- `docs/knowledge-base/lessons/README.md`

**日期**: 2026-10-02

---

### 1.28 第四梯队（应用与基础设施核心组件）变异测试实战：异步定时器续期、活动脏缓冲优先权与非对称空白形式化杀伤

**问题**:
在对第四梯队应用排队与基础设施核心组件（`serialQueue.ts`、`echoLoopGuard.ts`、`fileLineReader.ts`、`atomicFileJsonStore.ts`）推进变异测试攻坚时，发现深层隐蔽的假绿与变异等价防御漏洞：
1. **回环守卫（EchoLoopGuard）finally 续期假绿**：
   `runWithSavingGuard` 在入口处调用 `this.markInternalSaving()`，在 `finally` 中再次调用以确保持续保护。测试中虽模拟了 action 耗时，但因入口处的默认保护窗口（600ms）远大于 action 耗时，导致当 `finally` 块被 Stryker 彻底移除或调用被掏空时，外部断言 `isInternalSaving() === true` 依然被入口处的定时器掩盖，产生严重假绿；
2. **文本降级与空值防御的自反等价突变**：
   `isContentMatchingLastSaved` 中包含 `if (!this.lastSavedContent || !content) return false;`。Stryker 将其突变为 `&&` 时，由于常规测试传入空串和普通文本时，后续的 `JSON.parse` 报错降级为 `trim` 比对，两者 `trim` 后的值均不匹配返回了 `false`，导致变异体意外存活；
3. **活动文档未保存脏行（Dirty Buffer）的覆盖风险**：
   `FileLineReader` 在 `lines = this.getDocumentLines(fullPath)` 之后紧接着检查 `if (!lines && fs.existsSync(fullPath))`。Stryker 将其突变为 `!lines || fs.existsSync(fullPath)` 时存活，原因是历史单测中 mock 的脏文件在磁盘上并不存在，未覆盖“磁盘旧文件与活动窗口未保存脏代码并存”的真实开发场景。

**原因**:
1. 单元测试断言只验证了“终态为 true”，没有在 action 内部注入破坏性状态（重置保护标志），未能将 `finally` 带来的增量保障与前置状态完全正交剥离；
2. 缺乏形式化逻辑推导：当 `trim` 降级逻辑与前置 `||` 守卫组合时，只有“一方为空、另一方为纯空白字符（trim 后皆为空）”的非对称输入，才能在数学上将 `||` 与 `&&` 的真值表彻底分流；
3. 单元测试对活动编辑器和磁盘持久化两个维度的覆盖存在隔离隔离盲区，未设计两端并存的竞争性用例。

**解决方案**:
1. **action 内部破坏性状态注入，刚性击杀 finally 缺失变异**：
   在 `runWithSavingGuard` 的测试 action 中，显式将 `guard._isInternalSaving = false`（模拟中间超时过期），外部直接断言 action 结束后的即时状态必须为 `true`。若 `finally` 丢失，外部必得 `false` 产生断言失败，实现 100% 击杀；
2. **构造非对称空白文本，形式化击杀逻辑运算符突变**：
   - 注入非对称测试矩阵：一方为 `""`（空串），另一方为 `"   "`（纯空白字符）；
   - 在原代码 `||` 下：空串触发拦截，安全返回 `false`；
   - 在变异体 `&&` 下：因一方非空跳过拦截，进入 catch 经 `trim` 产生 `"" === ""` 误判为 `true`，触发断言失败，精准消灭变异体；
   - `echoLoopGuard.ts` 变异杀伤率从 85.71% 跃升至 **97.14%**；
3. **磁盘与活动文档双重并存用例，守护内存脏行优先权**：
   在测试中物理写入包含旧内容的磁盘文件，同时通过 `getDocumentLines` 注入未保存的新内容，断言最终返回值必须严格等于内存脏行，彻底击杀 `!lines || fs.existsSync` 突变；同时断言读取不存在文件后缓存不被 `undefined` 污染；
   - `fileLineReader.ts` 变异杀伤率从 91.89% 跃升至 **97.30%**；
4. **收益效果**:
   - 第四梯队 4 大核心组件全部跨越 85%+ 硬指标，斩杀 189 个变异体：
     - `serialQueue.ts`：**100.00% 满分**（击杀 2 个）；
     - `fileLineReader.ts`：**97.30%**（击杀 36 个）；
     - `echoLoopGuard.ts`：**97.14%**（击杀 34 个）；
     - `atomicFileJsonStore.ts`：**85.40%**（击杀 117 个）；
     - **第四梯队综合变异得分：89.57%**；
   - 全工程行覆盖率达到 **90.97%**，分支覆盖率刷新至 **85.58%** 历史新高；
   - 全工程 30 大全维单测 100% 绿灯，16 大物理硬门禁全绿通过。

**影响文件**:
- `test/unit/infra/storage/echo_loop_guard.test.mjs`
- `test/unit/infra/storage/file_line_reader.test.mjs`
- `test/runners/run-tier4-tests.mjs`
- `stryker.config.json`
- `docs/knowledge-base/constraints.md`
- `docs/knowledge-base/lessons/test-real-import.md`
- `docs/knowledge-base/lessons/README.md`

**日期**: 2026-10-02


