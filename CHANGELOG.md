# Change Log

All notable changes to the "scene-breakpoints-vscode" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<p><b>English</b> | <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/CHANGELOG_zh.md">简体中文</a></p>

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
