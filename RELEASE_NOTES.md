## What's Changed in v1.4.1

### Added
- **AI Skill Dual-Track Evolution (Reader & Writer)**:
  - **Scene Breakpoints Reader (5-Step Protocol)**: empowers AI agents to read `.vscode/debug-scenes.json` via existence probing, scene semantic matching, inline reference recursion, and physical line jump reading before investigating codebases or diagnosing bugs.
  - **Scene Breakpoints Writer**: standardized the breakpoint description matrix to mandate troubleshooting intentions (e.g. `desc: "Observe DB hash comparison failure branch"`) rather than meaningless file copies.
  - **Canvas & Mermaid Collaboration Contract**: introduced read-only anti-hallucination guardrails and instructions for piping `Scene: Export Scene Graph as Mermaid` clipboard output into AI PR/architecture reviews.

### Fixed & Improved
- **E2E & Test Suite Stability**: aligned command registry bus test contracts to 31 commands and full-screen editor WebviewPanel assertions for reliable headless Linux CI runners.
- **Official Skill Fingerprint Registry**: updated official SHA-256 fingerprint history for seamless lifecycle inspection and upgrade prompts.

---

<details>
<summary><b>🇨🇳 简体中文更新说明 (点击展开)</b></summary>

### 新增 (Added)
- **AI Skill 双轨协同演进 (读图 Reader 与制图 Writer)**：
  - **读图五步法 (Scene Breakpoints Reader)**：指导 AI 在代码研读、排查诊断时优先按图索骥——执行前置廉价探测、场景语义匹配、内联引用递归展开与物理行号精准跳读，以最低 Token 消耗建立工程空间感。
  - **规范制图标准 (Scene Breakpoints Writer)**：确立意图标注编写指引矩阵，强制断点描述聚焦排查动机（如“观察密码校验比对失败分支”），杜绝无意义代码复述。
  - **画布与 Mermaid 协同契约**：明确只读防幻觉铁律（禁止在 JSON 中生造画布字段），并打通 `Scene: Export Scene Graph as Mermaid` 剪贴板文本与 AI 架构审阅链路。

### 优化与修复 (Improved & Fixed)
- **E2E 自动化测试契约对齐**：调整全量 31 大命令总线就绪与全屏独立编辑器 WebviewPanel 契约断言，保障多平台无头 CI 环境 100% 稳定通过。
- **官方技能指纹史表登记**：完成新版 Skill 官方 SHA-256 指纹登记，支持存量纯净版平滑升级感知。

</details>