<div align="center">
  <img src="./icon.png" width="128" height="128" alt="Scene Breakpoints Logo" />
  <h1>Scene Breakpoints</h1>
  <p><b>Scenario-driven breakpoint orchestration, automated cruise debugging, and AI Agent collaboration for VS Code</b></p>

  <p>
    <a href="https://github.com/Tonys-L/scene-breakpoints-vscode"><img src="https://img.shields.io/badge/GitHub-Repository-blue?logo=github" alt="GitHub" /></a>
    <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/actions/workflows/ci.yml"><img src="https://github.com/Tonys-L/scene-breakpoints-vscode/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License" /></a>
  </p>

  <p><b>English</b> | <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/README_zh.md">简体中文</a></p>
</div>

> 🏷️ **Highlights**: `Breakpoint Management` · `Scenario Debugging` · `AI Reader/Writer Dual-Track` · `Auto-Continue Cruise` · `Variable Watch Assertions` · `Debug Trace Persistence` · `Self-Healing Anti-Drift`

**One-line summary**: Turn scattered temporary breakpoints into reusable, shareable, and self-healing debugging assets; hit F5 once to cruise through the execution chain with automatic watch assertions, while AI agents pinpoint root causes with zero prompt friction.

---

## 💡 Why This Extension?

Every developer debugging in VS Code runs into these frustrations:
1. **Too many leftover breakpoints interrupting your flow**: You have dozens of breakpoints scattered from previous debugging sessions. Starting a new task pauses execution every two seconds.
2. **Complex call chains are easily forgotten**: You spend hours tracing a multi-file execution path, but forget key steps weeks later. Onboarding teammates face the same steep curve.
3. **Pulling git or editing code breaks your breakpoints**: Whenever lines shift, your saved breakpoints end up on empty lines or comments; *(the most common cause of breakpoint invalidation in collaborative Git workflows)*.
4. **Impossible to share or sync across computers**: Native breakpoints vanish when you switch laptops, and sharing a debug setup with teammates means manually typing out file paths and line numbers.
5. **Tedious single-stepping just to inspect a few variables**: Pressing F10/F5 dozens of times just to check if deep variables match expectations—one accidental extra press forces you to restart.
6. **AI understands your code, but can't set breakpoints or read debug states directly**: When asking an AI assistant to analyze a bug, it can suggest key lines in chat, but you still have to manually find the files, click breakpoints, and paste variable values back to the chat.

**Scene Breakpoints** is your **breakpoint organizer, automated cruise guide, and AI debugging collaboration hub**: group breakpoints by feature with descriptive notes and variable assertions, switch them in seconds, and share them via Git. Supports **AI Dual-Track Skills (Reader + Writer)** and **Zero-Prompt Auto-Inspection**!

---

## ✨ What Can It Do For You?

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/sb.gif" alt="Scene Breakpoints Interactive Demo" width="100%" />
</p>

- 🗺️ **Document Execution Flows into Living Code Tours**
  Attach clear notes to each breakpoint (e.g. `Step 1: Auth Guard`, `Step 2: Decrement Inventory`). A scene becomes a self-guided walkthrough for complex codebases.

- 🎯 **Switch Scenarios, Keep Only What You Need**
  Switching to "Login" only enables breakpoints for login. All unrelated breakpoints are cleanly cleared so you never get interrupted.

- 🚦 **Auto-Continue Cruise Debugging (v1.5.0)**
  Configure `sceneBreakpoints.autoContinueMode: "onPass"` (default). Press F5 once to run through the entire scenario breakpoint chain and evaluate all watch expressions; auto-continues when assertions match, and **immediately brakes and freezes execution at the exact failing breakpoint when a mismatch or error occurs**!

- 📝 **Debug Trace Persistence & Zero-Prompt AI Loop (v1.5.0)**
  Debug execution hits, watch values, and assertion results are atomically persisted in real-time to `.vscode/debug-trace.local.json` (auto-added to `.gitignore`). After F5 completes, simply say *"Done, check the result"* in chat, and your AI agent automatically diagnoses the root cause!

- 🔍 **Full-Line Breakpoint Hover Cards (v1.5.0)**
  Hovering anywhere on an active breakpoint line in the editor renders a rich Markdown table with step notes, actual evaluated watch values, expected assertions, and status badges (`✅` / `❌ Mismatch` / `⚠️ Error`), while suppressing native uninitialized expression popups.

- 🛡️ **Code Drift Self-Healing**
  Did you pull upstream commits or add lines? The extension matches 3-line contextual fingerprints and function scope anchors to snap breakpoints to their true lines.

- 📊 **Visual Graph Canvas: Secondary Side Bar & Full-Screen Tab (v1.3.0 ~ v1.4.0)**
  Permanent Secondary Side Bar canvas keeps your architecture topology alongside code without crowding primary tabs. Expand into an independent full-screen editor tab at any time, with live DAP pulses and one-click Mermaid flowchart export.

- 🧩 **Scene Composition Engine: Inline References (v1.1.0)**
  Declare `{ "type": "scene", "name": "..." }` to compose shared setup and auth breakpoints in-place with built-in cycle-detection guards.

- 🔒 **Team Sharing & Private Config Isolation (v1.2.0)**
  Commit `.vscode/debug-scenes.json` to Git for team sharing, while keeping private local breakpoints in `.vscode/debug-scenes.local.json` with zero Git pollution.

- 📸 **Reverse Snapshot: Call Stack to Scene (v1.2.0)**
  When paused on a breakpoint or exception, right-click to extract the cross-file call stack frames directly into a brand-new scene with contextual code fingerprints.

---

## 🚀 Quick Start

### 1. Installation

- **VS Code Marketplace**: Search for `Scene Breakpoints` and install;
- **From VSIX**: Click `...` in the Extensions view $\rightarrow$ `Install from VSIX...`.

### 2. Basic 3-Step Walkthrough

1. **Add Breakpoint**: Right-click any code line and select `Add to Debug Scene...` (or press `Ctrl + Alt + B` / macOS: `Cmd + Alt + B`), select a scene name, and enter a note;

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/context-menu-add.png" alt="Add breakpoint via context menu or Ctrl+Alt+B" width="75%" />
</p>

2. **Switch Scenario**: Click the status bar indicator at the bottom (or press `Ctrl + Alt + S` / macOS: `Cmd + Alt + S`), select a scene to activate. The status bar immediately reflects the active scene, the tree view highlights, and breakpoints mount into the editor;

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/scene-quickpick.png" alt="Scene QuickPick switcher" width="85%" />
</p>

3. **Export Reverse**: Set breakpoints naturally in your editor, then open the Command Palette and run `Scene: Export All Current Breakpoints to New Scene` to persist them.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + Alt + S` (macOS: `Cmd + Alt + S`) | Open scene menu / switch or multi-select scenes (or click bottom status bar) |
| `Ctrl + Alt + B` (macOS: `Cmd + Alt + B`) | Add current code line to a scene with a description note |
| `Alt + ↑` / `Alt + ↓` | Move breakpoint up / down in the sidebar tree view (supports drag-and-drop) |

---

## 🎨 Advanced Features

### 1. Breakpoint Watch Anchors & Assertions (v1.5.0)

Declare a `watch` list on any breakpoint to specify watched expressions and expected assertion values:

```json
{
  "type": "line",
  "file": "src/services/pay.ts",
  "line": 52,
  "desc": "Step 2: Verify payment gateway response",
  "watch": [
    { "name": "result.status", "expected": "\"SUCCESS\"" },
    { "name": "result.code", "expected": 200 }
  ]
}
```
- **Automatic DAP Evaluation**: Upon breakpoint hit, variables are evaluated against the active top frame;
- **Tolerance Normalization**: Handles single vs double quotes (e.g. `'SUCCESS'` matches `"SUCCESS"`) and type representations across JavaScript, TypeScript, and Python debuggers.

### 2. Auto-Continue Cruise Mode (v1.5.0)

Say goodbye to manual stepping! Configure cruise mode in settings (`sceneBreakpoints.autoContinueMode: "onPass"` by default):
- **`"onPass"` (Default & Recommended)**: Breakpoints with passing assertions (or no `watch` fields) automatically continue execution; any `Mismatch` or evaluation error immediately pauses and freezes on the exact failing line;
- **`"always"`**: Silently evaluates and records all watch expressions across the entire call chain without pausing;
- **`"off"`**: Disables automatic continuation, keeping standard VS Code pause behavior on every hit.

Equipped with a monotonic `pauseSeq` guard and top-frame authority locks (`ActivePauseAuthority`) to eliminate race conditions on statements like `const x = await fn()`.

### 3. Debug Trace Persistence & Zero-Prompt AI Loop (v1.5.0)

Debug execution traces are atomically updated in `.vscode/debug-trace.local.json`:
- Records session state (`running` / `paused` / `terminated`), failure flags (`hasMismatchOrError`), pause coordinates, and ordered watch values;
- **Zero-Prompt Auto-Inspect**: Run your debug session with F5, then simply prompt your AI:
  > *"Done, check the results"* or *"Why did the test fail?"*  
  The AI reads the local trace file directly and pinpoints the mismatch!

### 4. Full-Line Breakpoint Hover Cards (v1.5.0)

Hover over **any column** of an active scene breakpoint line:
- Inspect a rich Markdown card showing step intent, live evaluated variable values, expected assertions, and status badges (`✅` / `❌ Mismatch` / `⚠️ Error`);
- Suppresses confusing `undefined` popups from native VS Code hover on leading indentation and type keywords.

### 5. Visual Graph Canvas (v1.3.0 ~ v1.4.0)

Click the graph icon in the sidebar title bar to open the visual canvas:
- **Secondary Side Bar Dashboard**: Keeps your execution topology open on the right while you code on the left;
- **Full-Screen Canvas Tab**: Expand complex diagrams into an independent editor tab;
- **Live DAP Pulse & Hit Trace**: Nodes pulse dynamically on hit, tracking execution steps and loop iterations;
- **Mermaid Export**: Copy clean, compliant `flowchart TD` diagrams in one click for PRs and design docs.

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/graph-canvas.png" alt="Scene Graph Canvas" width="85%" />
</p>

---

## Configuration Reference (`debug-scenes.json`)

Breakpoints are declaratively stored in `.vscode/debug-scenes.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
  "activeScenes": ["order-checkout-flow"],
  "bindings": {
    "Launch API Server": "order-checkout-flow"
  },
  "scenes": {
    "common-auth": [
      {
        "type": "line",
        "file": "src/auth/session.ts",
        "line": 15,
        "desc": "Common Auth: Verify session token",
        "watch": [
          { "name": "session.isValid", "expected": true }
        ]
      }
    ],
    "order-checkout-flow": [
      {
        "type": "scene",
        "name": "common-auth",
        "desc": "Step 0: Compose shared authentication flow"
      },
      {
        "type": "condition",
        "file": "src/order/service.ts",
        "line": 42,
        "condition": "order.total > 0",
        "desc": "Step 1: Validate positive order total",
        "watch": [
          { "name": "order.total", "expected": 199.9 }
        ]
      },
      {
        "type": "logpoint",
        "file": "src/order/service.ts",
        "line": 68,
        "logMessage": "Order created: {order.id}",
        "desc": "Step 2: Log database insertion"
      },
      {
        "type": "line",
        "file": "src/payment/gateway.ts",
        "line": 95,
        "desc": "Step 3: Trigger payment gateway",
        "watch": [
          { "name": "res.status", "expected": "\"SUCCESS\"" },
          { "name": "res.code", "expected": 200 }
        ]
      }
    ]
  }
}
```

---

## 🤖 AI Agent Collaboration & Dual-Track Skills (v1.4.1 ~ v1.5.0)

Scene Breakpoints is designed natively for AI coding assistants:

### 1. Dual-Track AI Skill (v1.4.1)
- **Reader Protocol (5-Step Protocol)**: Guides AI agents to inspect `.vscode/debug-scenes.json` via existence probing, scene semantic matching, inline reference recursion, and physical line jump reading before diving into unfamiliar codebases;
- **Writer Protocol**: Directs AI agents to draft intention-based notes (`desc: "Observe DB hash comparison failure branch"`) and anchor watched variables with expected values.

### 2. 8 Major AI Platforms Supported
Run **`Scene Breakpoints: Install Agent Skill`** (`Ctrl+Shift+P`) to deploy rules for:
- **Antigravity**: `.agents/skills/scene-breakpoints/SKILL.md`
- **Cursor IDE**: `.cursor/rules/scene-breakpoints.mdc`
- **Windsurf**: `.windsurf/rules/scene-breakpoints.md`
- **Cline (Claude Dev)**: `.clinerules/scene-breakpoints.md`
- **Roo Code**: `.roorules/scene-breakpoints.md`
- **Continue.dev**: `.continue/prompts/scene-breakpoints.prompt`
- **GitHub Copilot**: `.github/skills/scene-breakpoints/SKILL.md`
- **Trae IDE**: `.trae/skills/scene-breakpoints/SKILL.md`

### 3. AI Integration Diagnosis
Run **`Scene Breakpoints: Diagnose AI Integration`** (`Ctrl+Shift+P`) anytime to verify rule health and permissions.

---

## ⚙️ Extension Settings

| Setting | Default | Options | Description |
| :--- | :--- | :--- | :--- |
| `sceneBreakpoints.autoContinueMode` | `"onPass"` | `"onPass"`, `"always"`, `"off"` | Automatic continuation policy upon breakpoint hit: `"onPass"` auto-continues when all assertions pass, freezing on mismatches |
| `sceneBreakpoints.allowAiFileActivation` | `false` | `true`, `false` | Whether AI Agents can modify `activeScenes` in `debug-scenes.json` to declaratively activate scenarios |

---

## 📖 Further Reading

- 📕 [Comprehensive User Guide (docs/guide.md)](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/docs/guide.md)
- 📝 [Changelog (CHANGELOG.md)](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/CHANGELOG.md)

---

## 💖 Support & Feedback

If this extension saves you time, please leave a 5-star rating on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Tony-L.scene-breakpoints-vscode) or [Open VSX](https://open-vsx.org/extension/tony-l/scene-breakpoints-vscode) ⭐.  
Suggestions and issues are warmly welcomed on [GitHub Issues](https://github.com/Tonys-L/scene-breakpoints-vscode/issues).

---

## 📄 License

[MIT License](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/LICENSE) © 2026 Tony.L
