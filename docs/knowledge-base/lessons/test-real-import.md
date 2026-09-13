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

**影响文件**: `test-e2e/suite/04_healing_ai_and_guard.test.ts`、`test/unit/infra/storage_guard_and_sync.test.mjs`

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
