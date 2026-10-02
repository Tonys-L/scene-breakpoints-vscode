# DDD 充血模型重构踩坑教训 (DDD Model Refactor Gotchas)

> **TL;DR**: 记录贫血模型向 DDD 充血模型重构演进过程中的陷阱：属性多态泄漏、DTO 往返保真度与聚合根状态序列化空值语义。

---

## 业务分类：领域模型与 DDD 重构

### 1.1 函数断点多态字段遗漏：DAP 中函数断点同样具备 condition 与 hitCondition

- **背景**：在将散落在 `types.ts` 和 `sceneOperations.ts` 中的断点数据重构成充血实体 `Breakpoint` 时，将断点粗暴区分为函数断点（`type === "function"`）和源码行断点（`type !== "function"`），并在构造函数和 `toJSON()` 时把 `condition` 与 `hitCondition` 归在源码行断点分支。
- **现象**：当外部录入带有条件的函数断点（如 `{ type: "function", functionName: "loginHandler", condition: "attempt > 10" }`）并通过实体 upsert 时，`condition` 属性在序列化 DTO 中意外变成了 `undefined`，导致单测断言失败。
- **根因**：VS Code DAP 规范中，函数断点（`FunctionBreakpoint`）完全支持命中条件与命中计数表达式。
- **规则**：在领域实体中，凡属 VS Code DAP 允许的通用断点属性（`enabled`、`condition`、`hitCondition`、`desc`），必须作为顶级通用特征统一在实体基底提取和赋值，仅将特定宿主字段（如 `file+line` vs `functionName`）做差异分流。

---

### 1.2 聚合根序列化与显式空数组状态 (Explicit Empty State)

- **背景**：在 `SceneCatalog` 聚合根中，`activeScenes` 维护当前被激活的场景名列表。在初版 `toJSON()` 实现中，为了避免向未经激活的纯简略 JSON 强塞空数组，使用了 `if (this.activeScenes.length > 0) res.activeScenes = [...this.activeScenes];`。
- **现象**：当调用 `clearAll()` 或 `catalog.clearActive()` 时，期望将磁盘中的 `activeScenes` 显式重置为清空状态 `[]`。但因长度为 0，导出的 DTO 中 `res.activeScenes` 变成了 `undefined`，导致持久化时未将空数组落盘，状态机与持久化契约不匹配。
- **根因**：在领域模型中，“从未配置/未定义”与“显式清空为无激活场景”具有完全不同的领域语义。
- **规则**：聚合根应引入 `hasExplicitActiveScenes` 状态跟踪。若原始配置已声明 `activeScenes`，或者外部执行了显式激活/清空动作，序列化时必须确保输出 `res.activeScenes = [...]`（即使是 `[]`），严格保障契约保真。

