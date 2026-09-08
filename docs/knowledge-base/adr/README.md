# ADR Index

## 已采纳决策

| 编号 | 标题 | 业务分类 | 状态 | 影响模块 | 日期 |
|------|------|----------|------|----------|------|
| **ADR-001** | [基于三行伴随指纹与双向滑动窗口实现代码行号自愈](001-line-drift-self-healing.md) | 断点自愈 | Accepted | `healingAdapter`, `configManager`, `types` | 2026-09-07 |
| **ADR-002** | [引入独立 SceneStateManager 实现 SSOT 并消除状态栏竞态闪烁](002-scene-state-machine-ssot.md) | 状态管理 | Accepted | `sceneStateManager`, `statusBar`, `commands/*` | 2026-09-07 |

---

## ADR 生命周期

```text
Draft → Proposed → Accepted → Deprecated → Superseded
```

## ADR 模板

每个 ADR 文件使用以下结构：

```markdown
# ADR-NNN: 标题

## 状态
[Draft | Proposed | Accepted | Deprecated | Superseded by ADR-XXX]

## 背景
描述驱动此决策的背景和问题。

## 方案选项
### 选项 A
描述、优缺点。
### 选项 B
描述、优缺点。

## 决策
选择了哪个方案，以及为什么。

## 影响
此决策带来的影响和后果。
```

---

## 变更记录

| 日期 | 变更内容 | 变更人 | 关联变更 |
|------|----------|--------|----------|
| 2026-09-08 | 初始版本（录入 ADR-001 ~ ADR-003） | Tony.L | KDD-INIT-001 |
| 2026-09-08 | 移除改名工程元数据 ADR，重新对齐纯架构决策 ADR-001/002 | Tony.L | KDD-DOC-002 |
| 2026-09-08 | 更新 ADR-001：录入空格压缩、作用域懒计算缓存与软容错上下文硬门禁 | Tony.L | KDD-HEALING-003 |
