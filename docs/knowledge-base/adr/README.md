# ADR Index

## 已采纳决策

| 编号 | 标题 | 业务分类 | 状态 | 影响模块 | 日期 |
|------|------|----------|------|----------|------|
| **ADR-001** | [基于三行伴随指纹与双向滑动窗口实现代码行号自愈](001-line-drift-self-healing.md) | 断点自愈 | Accepted | `healingAdapter`, `configManager`, `types` | 2026-09-07 |
| **ADR-002** | [引入独立 SceneStateManager 实现 SSOT 并消除状态栏竞态闪烁](002-scene-state-machine-ssot.md) | 状态管理 | Accepted | `sceneStateManager`, `statusBar`, `commands/*` | 2026-09-07 |
| **ADR-003** | [引入全局单写者可重入串行队列消除多管理器并发写竞态与自死锁](003-reentrant-single-writer-queue.md) | 并发安全 | Accepted | `serialQueue`, `sceneManager`, `breakpointManager`, `agentSyncService` | 2026-10-03 |
| **ADR-004** | [建立架构防摇摆与深浅模块裁决工程规范](004-architectural-anti-churn-standard.md) | 架构防震荡 | Accepted | `constraints`, `sceneStateManager`, `ui/commands/*` | 2026-10-05 |

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

