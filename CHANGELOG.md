# Change Log

All notable changes to the "scene-breakpoints-vscode" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<p><b>English</b> | <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/CHANGELOG_zh.md">简体中文</a></p>

---

## [1.4.0] - 2026-10-16

### Added
- **Permanent Secondary Side Bar Dashboard (ViewContainer & WebviewViewProvider)**: the Scene Breakpoints graph canvas is now available directly in the Secondary Side Bar (`sceneBreakpointsGraphView`) as an always-accessible dashboard, fully preventing the canvas from crowding out the primary editor tabs.
- **Full-screen Canvas Escape Hatch**: a dedicated title-bar button (`sceneBreakpoints.openGraphInEditor`) allows expanding the canvas into an independent full-screen editor tab whenever large-scale topology analysis is required.
- **Interactive Scene Selector Popover**: replaced static scope chips with an elegant 100% opaque dark Popover dropdown menu supporting instant search, quick select all / clear, and clean active/inactive status badges.
- **Instant Single-Scene Activation**: when inspecting a single inactive scene on the canvas, an "Activate Scene" action immediately activates the scene and registers its breakpoints into VS Code DAP.

### Improved & Fixed
- **Seamless Viewport Auto-Resize & Zoom Healing**: resolved an issue where dragging and widening the Secondary Side Bar left the canvas clipped at the old width until a manual refresh was clicked. Dual-channel `window.resize` and `ResizeObserver` listeners now instantly scale the G6 canvas layer without clipping or threshold dropouts.
- **Codicon & Toolbar Alignment**: unified toolbar icons to native VS Code Codicons (`$(screen-full)`, `$(export)`, `$(type-hierarchy)`), removed duplicate export buttons, and kept card widths at a clean, compact 240px.

---

## [1.3.0] - 2026-10-11

### Added
- **Visual Graph Canvas for Scene Breakpoints (roadmap §5)**: the new `sceneBreakpoints.showGraph` command (command palette / status-bar menu / tree-view scene context menu) opens a read-only Webview canvas rendering the expanded execution-flow DAG of all active scenes — scene lanes (team/local layering), nested reference groups, and per-breakpoint nodes with type shapes, disabled translucency, and unmatched warning markers (INV-028, INV-030). Breakpoint types are encoded across three channels — shape (rectangle / tag / hexagon / cut-rectangle / octagon), label icon (● ≡ 💬 ＃ ƒ) and a desaturated semantic border color (GitHub-dark palette) on a unified dark node fill, with the live pulse and latest trace point using the VS Code breakpoint-red semantics.
- **Click-through Source Navigation**: clicking any canvas node (or trace marker) resolves through the snapshot's single-source nodeId resolver and reveals the target file with viewport centering plus a one-shot 800ms decoration highlight.
- **Live DAP Pulse & Hit Trace Timeline**: `debug:paused` events simultaneously pulse the matched execution-flow node and append a `TraceRecord` to the session-scoped trace buffer; `debug:resumed` clears the pulse but keeps the accumulated trace, and `debug:terminated` clears it entirely. The trace timeline renders as an inline-SVG scatter/line view exposing loop iterations and never-hit breakpoints. Traces are session-volatile: zero persistence, no JSON Schema changes.
- **One-click Mermaid Export**: the new `sceneBreakpoints.exportGraphMermaid` command (command palette / canvas button) copies a renderable `flowchart TD` document (nested lane subgraphs, unmatched ⚠ markers) to the clipboard with zero disk writes; a gentle info is shown when no scene is active.
- **Reactive Refresh & Safe Lifecycle**: scene changes rebuild and re-render the snapshot while preserving traces (stable `{ownerScene}#{index}` node ids keep trace remapping drift-free); panel disposal unsubscribes all event listeners in pairs, while the trace buffer lives independently until extension teardown.
- **Scene Scope Selector (canvas)**: the canvas now supports viewing **any** scene (including inactive ones) and arbitrary multi-scene combinations via a top multi-select scope bar (team/local layer-colored chips). "What is visible" (`visibleScenes`, user-selected, defaults to the active set) is decoupled from "what is active" (`activeScenes`); inactive scenes render in an inactive style (translucent + badge) with `registered` as a pure derived annotation, while live pulses and traces naturally only hit registered nodes. A scene whose expansion fails (circular reference) degrades to a dedicated warning lane listing the cycle path instead of rendering blank, and sibling scenes are isolated from the failure. Mermaid export is aligned with what the canvas shows (blocked only when no visible lanes remain); the scope is pure view state within the panel lifecycle and resets to follow the active set on reopen.
- **Native VS Code Codicon Alignment**: unified title-bar actions to standard Codicon `$(type-hierarchy)`, seamlessly matching native VS Code dark, light, and high-contrast themes.
- **AI Skill tutorial updated**: SKILL.md now covers the Visual Graph Canvas collaboration workflow (read-only canvas, Mermaid export for PRs/docs, session-volatile trace) and a new fingerprint is registered in the official history, so existing clean installs will receive the update prompt.

### Performance & Compatibility
- **AntV G6 5.x & Preact Component Architecture (ADR-008)**: the graph canvas engine migrated from Cytoscape to `@antv/g6` 5.x with a Preact-driven reactive UI architecture, bundled at build time via esbuild into `media/graph/g6-bundle.js` and `media/graph/graphWebview.js`. Production `dependencies` remain empty, with zero external CDN links (GR-012). The packaged VSIX measures **767.67 KB**, safely below the strict 1536 KB engineering budget ceiling (GR-001).

---

## [1.2.0] - 2026-10-07

### Added
- **Team/Personal Config Isolation (`*.local.json`)** (INV-032):
  - `.vscode/debug-scenes.json` stays the team-shared scene library under Git; `.vscode/debug-scenes.local.json` becomes the personal private layer and is automatically added to `.gitignore` on extension activation — temporary debug scenes no longer pollute the repository.
  - Sidebar and all read paths load a merged view where local scenes override team scenes of the same name; scenes newly created from the UI (manual creation, export, capture) default to the local layer.
  - Activation state (`activeScenes`) remains exclusively in the team main file; the file watcher now watches both files with a per-file echo-loop write baseline, and cold-start seeds baselines for both layers.
- **Capture Call Stack (Incident-to-Scene, roadmap §4)**: while the debugger is paused, the new `sceneBreakpoints.captureCallStack` command (editor context menu / command palette) reads the current thread's stack frames via DAP, filters to in-workspace source frames with same file+line deduplication, extracts 3-line context fingerprints, and saves them as a new scene (append upsert, INV-001) into the personal local layer. The capture context is registered on debugger `stopped` and cleared on `continued`/`terminated` to prevent stale stacks.
- **AI Skill tutorial updated**: SKILL.md now covers the dual-layer config guidance (which file to write) and the Capture Call Stack collaboration workflow; a new fingerprint is registered in the official history, so existing clean installs will receive the update prompt.

---

## [1.1.0] - 2026-10-06

### Added
- **Platform Write Guard guidance in AI Skill**: the bundled SKILL.md now teaches AI agents how to handle platform-level file protection (e.g. Trae restricting `.vscode/` edits) when writing `debug-scenes.json` — fall back to a temp file copy, guide the user to whitelist the file, or output the full JSON inline.
- **Scene Composition Engine (Inline Scene References)**:
  - Declare inline scene references (`{ "type": "scene", "name": "..." }`) inside any scene to compose another scene's full breakpoint set at that position — shared infrastructure breakpoints (auth, session, MQ) are maintained in one place and reused everywhere.
  - Declarative order is the execution order: references expand depth-first exactly where they are declared, fully interleaved with regular breakpoints (INV-030).
  - Circular references (including self-references) abort activation before any disk write or DAP dispatch, reporting the full cycle path (e.g. `A → B → A`) with zero state and disk pollution.
  - Dangling references degrade to a non-blocking warning and are skipped; `enabled: false` removes an entire reference subtree without deleting the configuration.
  - Tree view renders nested read-only reference nodes with a `revealRefSource` quick navigation and enable/disable toggles; self-healing write-backs are routed to the owning scene, exactly once per scene.
- **AI Skill Teaching (Module Map)**: the bundled Scene Breakpoints skill now teaches the composition workflow (module map → core scenes → business scenes with references), cutting ~60% of AI-generated configuration tokens.
- **AI Skill Example Type Coverage**: the skill's end-to-end example now also demonstrates the `hitCount` (string `hitCondition` expression) and `function` (bare `functionName`) breakpoint types, anchoring the correct few-shot patterns for AI generation.
- **Schema & Guardrails**: `schema.json` declares the reference branch via a `oneOf` contract (`additionalProperties: false`, `name` required); guardrails GR-006/GR-007 adapted to validate mixed breakpoint/reference maps and keep the schema 100% in sync with the domain model.

### Fixed
- Scene reference entries are now preserved through config load/save sanitize round-trips (previously silently dropped on the load path); invalid references (empty name) are discarded defensively.
- **pureSha256 restored to standard SHA-256 (FIPS 180-4)**: the bundled zero-dependency pure TS SHA-256 deviated from the standard due to a transcription error (prime sieve limit written as 300 instead of upstream's 313, misjudging composites 300/301 as primes and corrupting the last two K constants). The sieve is now aligned to 313, restoring byte-for-byte standard output (cross-verified against `node:crypto`), and the official skill fingerprint history table was regenerated through the domain pipeline accordingly.
- **External edit vs. fingerprint self-heal conflict resolution (INV-031)**: when a user externally re-anchors a breakpoint (e.g. editing `.vscode/debug-scenes.json` or saving a moved line) and the fingerprint engine would silently roll the edit back to the old line, a warning prompt now asks whether to keep the user's edited line (default, also when the prompt is dismissed) or auto-heal to the fingerprint line. Conflict detection gates on the file watcher marker or a disk-drift signal; Git Pull silent self-healing is preserved via cold-start baseline seeding, and the backfill `lineReader` dependency is now correctly forwarded through `handleExternalChange`.

---

## [1.0.9] - 2026-10-05

### Fixed & Architectural Improvements
- **Push-based Scene Annotation Pipeline (0ms Responsive & Non-intrusive)**:
  - Transition from Monaco's pull-based `InlayHintsProvider` to a push-based `TextEditorDecorationType` pipeline, completely eliminating Monaco's background editor throttling and focus-loss deferrals.
  - Active scene line annotations now appear instantly (0ms) upon scene activation in the sidebar, and disappear instantly when scenes are cleared/deactivated, without requiring manual editor clicking or forced focus switching.
  - Unregister native `InlayHintsProvider` to eliminate duplicate double-rendering on focused lines.
  - Keep 100% pixel-perfect styling, colors, and rich Markdown hover cards matching native editor inlay hints.
- **Deep Module Architecture & Quality Guardrails Hardening**:
  - Unify multi-scene active breakpoint index via deep module `ActiveBreakpointIndex`, eliminating redundant disk I/O and nested searches across editor lifecycle hooks.
  - Standardize single-writer serial mutation pipeline (`mutateCatalog`) and clean pipeline activation (`SceneActivationPipeline`).
  - Encapsulate DAP event echo guards (`dapEchoGuard`) and standardize line reader ports.
  - Pass all 32 comprehensive unit test suites (100% pass rate) and strict code-level guardrails (`npm run check:all`) with average CRAP score <= 3.5.

---

## [1.0.8] - 2026-09-18

### Added & Enhancements
- **Scene Breakpoint Line Annotations & Ghost Text (Inlay Hints)**:
  - Render subtle, elegant labels at the end of breakpoint lines in active scenes (e.g. `💡 [scene-name #1] description`), showing scene name, step index, and description without mouse hovering.
  - Display rich Markdown hover cards containing detailed breakpoint type, condition, log message, and drift status.
  - Multi-scene layered activation support: multiple breakpoints on the same line are compacted with pipe delimiters (` | `).
  - Add `sceneBreakpoints.inlayHints.enabled` configuration toggle (default `true`).
  - Cold-start awareness: automatically fall back to persistent `activeScenes` from disk when runtime projection is in initial state.
  - Support gentle onboarding prompt on first scene activation to enable always-on display with 1-click, and toggle display mode anytime in Quick Menu (`Ctrl+Alt+S`).
- **AI Agent Skill Guardrails Hardening (Scene Breakpoints Skill)**:
  - **Executable Line Selection Rule**: Explicitly mandate that all breakpoint lines must be placed on the **first executable statement inside the function body**, strictly forbidding breakpoints on pure function declaration/signature lines (e.g. `function foo(...) {`) to avoid V8/DAP breakpoint drift or unverified gray hollow circles.
  - **Self-Healing Fingerprint Rule**: Strictly forbid manually adding partial `contextSnippet` fields in breakpoint declarations. Omitting this field completely allows the self-healing engine to automatically extract full 3-line topology fingerprints (`prev`, `current`, `next`, `scopeAnchor`) from source files upon activation and persist them back.
  - Synchronize built-in and workspace AI Skill templates to guarantee 100% reliable breakpoint hits when generated by AI agents.

---

## [1.0.7] - 2026-09-13

### Added & Enhancements
- **Auto-Enrich Missing Breakpoint Self-Healing Fingerprints on Scene Activation**:
  - When breakpoint scenes are generated by AI Agents (e.g. Antigravity, Cursor, Trae, Copilot) or written manually, users only need to provide core attributes (`type`, `file`, `line`, `desc`), completely eliminating the token overhead and cognitive burden of extracting context lines.
  - Upon scene activation, the runtime automatically inspects target source files and extracts 100% faithful 3-line context snippets (`contextSnippet`) with exact indentation using pure domain algorithms.
  - Once activated, the enriched breakpoints are silently and atomically persisted back to `.vscode/debug-scenes.json` via the internal serial queue under `saveLoopGuard` protection.
  - Breakpoints automatically obtain full two-phase self-healing protection (local radiative search + scope cruising re-anchoring) against Git branch merges and code drift.

---

## [1.0.6] - 2026-09-13

### Fixed
- **Breakpoint Schema & JSON Example Accuracy**:
  - Fixed `type: "condition"` specification in configuration example (previously incorrectly demonstrated as `type: "line"` with a condition expression).
  - Fixed breakpoint note field name from `description` to `desc` to align strictly with domain models, `schema.json`, and AI Agent skills, preventing silent note drops and schema warnings.
  - Added explicit `activeScenes` demonstration with interactive footnote in declarative configuration examples.
- **Documentation & Terminology Consistency**:
  - Unified execution flow terminology to `Living Code Tours` across header tags and feature descriptions.
  - Replaced static CI status badge with real-time dynamic GitHub Actions workflow status SVG.
  - Generalized host IDE detection diagnostic outputs and streamlined shortcut reference table.

---

## [1.0.5] - 2026-09-13

### Improvements & Optimization
- **Ultra-Slim VSIX Package (98% Size Reduction)**:
  - Reduced VSIX package size from 5.4MB down to **118KB** by referencing high-definition demo animations (GIFs) and screenshots via official GitHub Raw CDN URLs.
  - Strictly cleaned up internal package contents via `.vscodeignore`, excluding development artifacts, IDE local cache (`.trae/`), and non-runtime scripts for lightning-fast downloads and instant installations.
- **CI/CD & Release Automation**:
  - Automatically extracts and formats bilingual release notes directly from `CHANGELOG.md` and `CHANGELOG_zh.md` upon tag push.
  - Upgraded release workflow runners to Node.js 22.x for full native Type Stripping support.

---

## [1.0.4] - 2026-09-13

### Added
- **Comprehensive Breakpoint Reordering & Drag-and-Drop System**:
  - **Native Drag-and-Drop Reordering**: Full implementation of `TreeDragAndDropController`, allowing intuitive dragging and dropping of breakpoints within scenes in the sidebar tree view with automatic boundary guards.
  - **Fluid Keyboard Navigation (`Alt+↑` / `Alt+↓`)**: Move breakpoints up and down instantly via `Alt+Up` / `Alt+Down` shortcuts when focused on the tree view, with automatic `reveal(node, { select: true, focus: true })` tracking for continuous key-hold movement.
  - **One-Click Move to Top / Move to Bottom**: Added `sceneBreakpoints.moveBreakpointToTop` and `sceneBreakpoints.moveBreakpointToBottom` commands in the breakpoint context menu for instant edge-positioning.
  - **Refined Action Titles & Rich Tooltip Hints**: Inline action buttons display concise keyboard shortcuts (`Move Breakpoint Up (Alt+↑)`), while the breakpoint hover tooltip is upgraded to `vscode.MarkdownString` with a subtle divider and drag/shortcut tip.
- **Runtime Debug Hit Visualization (`[PAUSED]`)**:
  - Automatically expands the active scene and highlights hit breakpoints with a prominent `▶ [PAUSED]` badge and dedicated vector SVG (`bp-paused.svg`), automatically reverting when execution resumes.

### Improvements
- **Instant Status Bar Availability (`onStartupFinished`)**:
  - Configured `activationEvents: ["onStartupFinished"]` in `package.json`, ensuring the status bar item appears immediately upon editor startup without requiring prior manual command execution.
- **Scene QuickPick Hierarchy Restructuring**:
  - Moved management actions (`Clear All Breakpoints`, `Multi-Select Scenes...`, `Export...`, `Open Config`) to the top section of the QuickPick menu, preventing action occlusion regardless of how many scenes exist.
- **Host IDE Adaptive Perception & Prioritization in AI Diagnostics**:
  - Uses `vscode.env.appName` and keyword heuristics to automatically identify whether the extension is running in Antigravity, Trae, Cursor, or VS Code, dynamically pinning the matching host platform to the very top.
  - Deployed and customized platforms are strictly prioritized to eliminate scrolling.

### Architecture & Engineering
- **KDD Governance Guardrails**:
  - Enforced the Single Source of Truth (SSOT) iron rule for extension and skill versions.
  - Enforced direct production imports in unit tests, completely eliminating private mock logic copies ("green lies").
  - Expanded automated sandbox E2E tests to 47 suites, covering all 25 extension commands and full drag-and-drop controller execution.

---

## [1.0.3] - 2026-09-12

### Added
- **AI Agent Deep Integration & One-Click Skill Matrix**:
  - **Declarative Scene Activation (`activeScenes`)**: AI Agents can directly switch active breakpoint scenarios silently by updating the `activeScenes` field in `.vscode/debug-scenes.json`, without requiring extra MCP servers or complex tool calls. The extension listens for changes and mounts breakpoints immediately.
  - **One-Click Agent Skill Installation**: Added the `Scene Breakpoints: Install AI Agent Skill...` command (`sceneBreakpoints.installAgentSkill`) to deploy the battle-tested `scene-breakpoints` skill matrix into the workspace with standard YAML frontmatter.
  - **Universal AI Assistant Support**: Out-of-the-box support for Antigravity (`.agents/skills/scene-breakpoints/SKILL.md`), Cursor (`.cursor/rules/scene-breakpoints.mdc`), Windsurf (`.windsurfrules`), GitHub Copilot (`.github/copilot-instructions.md`), Claude Code (`CLAUDE.md`), Roo Code, Cline, and Continue.
  - **Skill Lifecycle Resolution & Safe Upgrades**:
    - Automatic stripping of platform-specific Frontmatter and cross-platform newline normalization for core SHA-256 fingerprint matching (`O(1)` hash-as-key lookup);
    - Three-state lifecycle resolution (`UpToDate`, `CleanOutdated`, and `CustomModified`);
    - Seamless one-click upgrades for pristine outdated skills, side-by-side native VS Code Diff (`vscode.diff`) for user-modified skills with manual review, and mandatory timestamped `.bak` physical backups before overwriting.
- **Polyglot Scope Self-Healing**:
  - Upgraded the Scope Cruise engine (Phase 2) to natively recognize function and class boundaries across diverse languages, including Python (`def`/`class`), Go (`func`), Rust (`fn`/`impl`), Java, C++, C#, and PHP.

### Improvements & Infrastructure
- **Automated CI/CD & Quality Gates**:
  - Added comprehensive GitHub Actions CI workflows featuring multi-platform test matrices (Linux & Windows) with virtual headless displays (`xvfb`).
  - Added full automated E2E coverage for all 8 Command Palette commands and keybindings.
  - Configured automated GitHub Release packaging workflow triggered by version tags.
- **Documentation & Community Support**:
  - Streamlined README layout and highlighted real-world AI debugging pain points.
  - Added direct links in README footer for Visual Studio Marketplace rating ⭐, Open VSX, and GitHub Issues.

---

## [1.0.2] - 2026-09-12

### Fixed
- **Marketplace Links & User Guide Accessibility**:
  - Upgraded User Guide, License, and documentation links to public GitHub URLs, ensuring all badges and links are directly clickable inside the VS Code Extension Details view and web Marketplace.
  - Included `docs/guide.md` and `docs/guide_zh.md` in the release package distribution.
- **Defensive Null-Safety**:
  - Enhanced array type and null checks in `SceneTreeDataProvider` to prevent transient `reading 'length'` exceptions during process hot-reloading.

---

## [1.0.1] - 2026-09-12

### Added
- **Two-Phase Breakpoint Self-Healing Engine (INV-003)**:
  - **Phase 2 Scope Cruise**: Introduced full-file scope anchor traversal to dynamically re-anchor breakpoints during massive code shifts (> 30 lines, up to 150 lines of function body).
  - **Non-Empty Topology Window**: Enhanced context snippet matching to seamlessly penetrate blank lines and comment insertions without losing confidence scores.
- **Target Existence Guard**:
  - Strictly prevents false positive auto-healing when a target line is deleted. Single-sided context matches (e.g. preceding comment) no longer falsely drift breakpoints to unrelated adjacent lines; safely classifies them as `[Unmatched]`.
- **Dedicated Unmatched Vector Warning Icon in Sidebar**:
  - Added crisp 16x16 amber-yellow warning triangle SVG icons (`bp-unmatched-enabled.svg` / `bp-unmatched-disabled.svg`).
  - Prepended `[Unmatched]` / `[未匹配]` text tag to the front of descriptions, eliminating trailing text truncation on narrow sidebars.

### Fixed
- Fixed runtime `ReferenceError: path is not defined` when triggering unmatched breakpoint warning notifications.
- Fixed an issue where internal disk writes prevented the TreeView from refreshing after clipboard imports or exports.
- Enhanced Windows backslash and forward slash path normalization in unmatched breakpoint state checks.

---

## [1.0.0] - Initial Release (2026-09-08)

### Added
- **Scenario-Driven Breakpoint Management**: Organize breakpoints into business scenarios, switch them in seconds, and automatically clear unrelated breakpoints.
- **Code Drift Self-Healing**: Automatically locate and recover true breakpoint lines after git pulls or code refactorings.
- **Dedicated Sidebar TreeView**: Intuitive checklist in the "Run & Debug" panel with native checkbox toggles.
- **Full Breakpoint Type Support**: Line breakpoints, conditional expressions, hit counts, logpoints, and global function breakpoints.
- **launch.json Integration**: Automatically activate linked breakpoint scenarios before debug sessions start.
- **Full-Duplex Real-Time Sync**: Bi-directional synchronization between editor DAP breakpoints and scene JSON configurations.
- **Multi-Scene Layered Activation**: Layer multiple scenes together with automatic deduplication.
- **One-Click Export & Clipboard Sharing**: Export editor breakpoints to scenes or share them with teammates via clipboard.
- **CodeLens Quick Activation**: Direct `▶ Apply Scene` buttons inside `debug-scenes.json`.
- **Bilingual Adaptive i18n**: Automatic UI language switching following VS Code settings (English & Simplified Chinese).
- **Declarative JSON Configuration**: Version-controlled `.vscode/debug-scenes.json` with integrated JSON Schema validation.
