# Change Log

All notable changes to the "scene-breakpoints-vscode" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<p><b>English</b> | <a href="./CHANGELOG_zh.md">简体中文</a></p>

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
