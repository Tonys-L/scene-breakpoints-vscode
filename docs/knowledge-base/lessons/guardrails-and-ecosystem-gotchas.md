# 架构质量硬门禁与宿主生态踩坑 (Guardrails & Ecosystem Gotchas)

> **TL;DR**: 记录架构重构、VS Code 宿主版本适配、命令总线绑定与持久化状态机中的深层踩坑与应对策略。

---

## 1. 业务逻辑与状态机陷阱

### 1.1 对象原地变异导致持久化变更判定失效 (KDD-HEALING-LOOP-001)

**问题**:
在场景激活阶段，自愈引擎明明计算出了代码行号自然漂移并打印了自愈日志，但 E2E 测试断言磁盘 `debug-scenes.json` 中的行号并未更新，导致测试红灯。

**原因**:
自愈算法在内存执行时，直接在内存中的断点实例上调用了 `updateLine(healed.line)`。后续在应用层持久化检测时，检测逻辑比对 `this.line !== healed.line`，由于对象行号已被提前就地变异为最新值，导致比对返回 `false`，应用层错误判定为“无变更”跳过了原子写盘。

**解决方案**:
应用层坚守“自愈即事实”不变量（INV-003, INV-010）：只要自愈管道报告 `healedCount > 0 || enrichedCount > 0`，不依赖浅层属性 diff，强制触发原子落盘闭环 `loopGuard.markInternalSaving(); sceneRepository.saveScenesConfig(...)`。

**影响文件**: `src/application/sceneManager.ts`
**日期**: 2026-09-30

---

## 2. 宿主生态与版本适配陷阱

### 2.1 engines.vscode 与 @types/vscode 版本错位引发跨版本崩溃

**问题**:
`package.json` 的 `engines.vscode` 声明支持最低 `^1.85.0`，但 `devDependencies` 中误引入了 `@types/vscode: ^1.138.0`。

**原因**:
在高版本类型定义下，调用较新版本引入的 VS Code API 可以在本地编译通过；但低版本（如 1.85）用户运行插件时，宿主环境缺少对应 API 函数，将直接抛出 `TypeError: undefined is not a function` 导致插件崩溃。

**解决方案**:
严格锁定 `@types/vscode: ~1.85.0` 与 `engines.vscode` 主次版本 100% 对齐。通过 TypeScript 编译器在编译期形成“天然硬防线”，凡使用 1.85 不支持的 API 直接报错。并在代码级门禁中建立版本对齐强校验（INV-022）。

**影响文件**: `package.json`, `scripts/verify-guardrails.mjs`
**日期**: 2026-09-30

---

## 3. 代码异常与规范陷阱

### 3.1 空 catch 静默吞错掩盖配置与异步灾难

**问题**:
在文件监听或后台静默同步过程中，个别兜底读取使用了 `catch {}` 空块。

**原因**:
原本初衷是为了容灾不中断主流程，但在真实运行中，若配置文件被操作系统占有、权限受限或编码损坏，空 catch 会导致关键报错彻底失联，让排查变成黑盒。

**解决方案**:
坚守约束禁令（严禁空 catch 静默吞错）：所有 catch 块必须显式捕获 `(err)` 并通过 `console.warn` 记录语义化上下文。在门禁脚本中建立全工程语法扫描守卫，0 容忍空 catch。

**影响文件**: `src/infra/vscode/listeners/configFileWatcherListener.ts`, `src/application/agentSyncService.ts`
**日期**: 2026-09-30

### 3.2 VS Code 弹窗 Thenable 悬空 Promise 与 unhandledRejection 隐患

**问题**:
在代码中裸写 `vscode.window.showInformationMessage(...)`、`showWarningMessage` 或直接触发无 `await` 的异步刷新，在常规语法扫描器下绿灯，但在开启 TypeScript-ESLint 类型感知规则后出现多处警告。

**原因**:
VS Code 宿主交互 API 返回的是 `Thenable<T | undefined>`（Promise 兼容对象）。如果未 `await` 且未捕获错误，一旦在底层被取消、销毁或抛出异步异常，会形成 Node.js 未捕获 rejection 隐患；同时破坏了代码对于“这是并发后台执行还是忘记 await”的语义表达。

**解决方案**:
1. 不需要等待用户点击结果的提示通知统一显式前缀 `void` 运算符（如 `void vscode.window.showInformationMessage(...)`），向编译器与阅读者明确传达“有意不阻塞当前流程”；
2. 在 `.eslintrc.json` 中接入 `@typescript-eslint/parser` 与 `project: ["./tsconfig.json"]`，将 `@typescript-eslint/no-floating-promises` 升格为 `error` 级别硬阻断；
3. 将 ESLint 检查挂载到 `scripts/verify-guardrails.mjs` 中形成第 15 大代码级硬门禁。

**影响文件**: `src/ui/commands/*`, `src/infra/storage/jsonFileSceneRepository.ts`, `.eslintrc.json`
**日期**: 2026-09-30

### 3.3 函数行数检测收敛至 ESLint AST 与零特权逃逸原则 (GR-013)

**问题**:
原先在架构单测中手写了 70 余行基于正则与花括号配对的代码行数扫描器，逻辑脆弱且经常无法准确识别包含嵌套对象/回调函数的真实函数体；而部分长函数为了掩盖问题，私自添加了 `/* eslint-disable max-lines-per-function */` 特权逃逸注释。

**原因**:
脆弱的手写正则与特权逃逸违背了 KISS 与防御性设计原则，降低了工程代码可维护性。

**解决方案**:
1. 将单函数 $\le 80$ 行检测全面收敛至业界标准的 ESLint `max-lines-per-function` 规则，由成熟的 TypeScript AST 解析，彻底废除脆弱的手写正则扫描；
2. 坚决拔除全工程所有 `/* eslint-disable max-lines-per-function */` 注释，对长函数实施彻底的纯结构 Extract Method 提取，使所有函数物理收敛至 80 行以内；
3. ESLint 零警告、零报错直接纳入 `npm run lint` 与 `npm run verify` 硬门禁。

**影响文件**: `.eslintrc.json`, `test/unit/architecture/architecture_guard.test.mjs`, `src/**/*`
**日期**: 2026-10-02

## 4. 命令总线与清单一致性陷阱

### 4.1 package.json 命令声明与代码实现 1:1 双向一致性

**问题**:
VS Code 插件容易在 `package.json` 配置了 `contributes.commands`，但在代码中命令 ID 拼错或漏注册；或者快捷键绑定了不存在的命令 ID，导致用户在命令面板触发时报 `command 'xxx' not found`。

**解决方案**:
在自动化门禁脚本中建立双向静态比对：强制 `package.json` 中的 25 个命令与代码中注册的命令 ID 100% 吻合，并严格校验 `keybindings` 和 `menus` 关联命令的有效性（INV-023）。

**影响文件**: `src/ui/commands/index.ts`, `src/ui/commands/treeCommands.ts`, `scripts/verify-guardrails.mjs`
**日期**: 2026-09-30

---

## 5. 门禁与知识库治理陷阱

### 5.1 纯文档维护任务教条执行全量代码硬门禁 (No Cargo Culting)

**问题**:
在对知识库文档（如 `constraints.md`）进行文字脱水与结构重构后，机械教条地执行 `npm run verify` 与全量测试套件，耗费大量等待时间与计算 Token。

**原因**:
混淆了“代码交付门禁”与“文档维护边界”。纯 Markdown 文档的变更未触碰任何 `src/` 生产逻辑、`test/` 单测或工程配置文件，物理上绝不可能导致类型编译、覆盖率或运行时出现逻辑回归。盲目触发重型验证是典型的过度工程与防御性教条主义（Cargo Culting）。

**解决方案**:
1. 明确界定验证边界：纯文档、知识库与注释维护归入 `AGENTS.md` 的【纯文档轻量门禁 (Doc-Only Light Gate)】，仅执行文本一致性与链接有效性自检，立刻交付；
2. 唯有在改动生产代码、单元测试或工程构建配置（`package.json`、`schema.json`、`tsconfig.json`）时，才触发对应单测或全量硬门禁；
3. 知识库坚守 AI-Native 高信噪比第一性原理，禁止将 CI 工具脚本条目冒充为业务不变量。

**影响文件**: `AGENTS.md`, `docs/knowledge-base/README.md`, `docs/knowledge-base/constraints.md`
**日期**: 2026-10-02

