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

---

### 1.3 无状态编解码领域服务杜绝空壳类仪式 (Stateless Domain Codec & Class Ceremony Elimination)

- **背景**：在领域层中，`ScenePayloadCodec` 专职负责将场景实体与通用外部数据文本（如 Markdown、JSON 等）进行无损编解码清洗。原实现将其声明为 `class ScenePayloadCodec`，并在文件底部导出 `defaultScenePayloadCodec = new ScenePayloadCodec()`，外层再包装函数委托。
- **现象**：该类内部完全没有任何可变实例属性、无并发排队锁、无生命周期状态，纯属空壳类仪式（Class Ceremony），违反了 `constraints.md` 中【无状态纯计算 / 工具库使用独立纯函数 `export function`】的硬规范。
- **根因**：混淆了“有状态实体/资源持有者”与“无状态纯计算/领域服务”的区别。
- **规则**：无状态计算、转换与编解码算法必须声明为顶级纯函数（如 `encodeScenePayload`、`decodeScenePayload`），将算法作为一等公民导出；仅在需向后兼容既有静态/实例调用方时保留轻量透明委托门面。

---

### 1.4 应用层实体管理器职责明确划分，消除跨实体透传桩 (Eliminate Manager Forwarding Stubs)

- **背景**：在应用层中，`SceneManager` 负责场景级生命周期（激活、导出、创建、重命名、排序），`BreakpointManager` 负责场景内断点的生命周期（增删、启闭、重排、同步）。先前为了让调用方“在一个管理器里什么都能做”，在 `SceneManager` 内部添加了 7 个纯转发委托方法（如 `addBreakpoint` 转发给 `breakpointManager.addBreakpoint`）。
- **现象**：
  1. 生产代码中所有 UI 命令与侧边栏调用方本来就直接调用 `breakpointManager`，`SceneManager` 的 7 个方法沦为死代码桩；
  2. 导致 `SceneManager` 产生对 `BreakpointManager` 的不必要耦合，且文件行数膨胀并模糊了两个管理器的实体主权边界。
- **根因**：混淆了“聚合门面”与“专职管理器职责边界”，把本应由调用方清晰按实体定位的用例，硬塞进一个大杂烩空壳转发层。
- **规则**：
  1. 实体职责单一：`SceneManager` 专注 Scene 级生命周期，`BreakpointManager` 专注 Breakpoint 级生命周期；
  2. 彻底删除无意义的透传桩（Forwarding Stubs），保持接口小而深（Deep Modules），消除模块间无谓的横向交叉引用。
- **影响文件**: `src/application/sceneManager.ts`, `src/application/breakpointManager.ts`, `test/unit/application/breakpoint_manager.test.mjs`
- **日期**: 2026-10-04

