<div align="center">
  <img src="./icon.png" width="128" height="128" alt="Scene Breakpoints Logo" />
  <h1>Scene Breakpoints</h1>
  <p><b>Lightweight scenario-driven breakpoint orchestrator for code reading, execution tracing, and AI Agent workflows</b></p>

  <p>
    <a href="https://github.com/Tonys-L/scene-breakpoints-vscode"><img src="https://img.shields.io/badge/GitHub-Repository-blue?logo=github" alt="GitHub" /></a>
    <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/actions/workflows/ci.yml"><img src="https://github.com/Tonys-L/scene-breakpoints-vscode/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License" /></a>
  </p>

  <p><b>English</b> | <a href="https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/README_zh.md">简体中文</a></p>
</div>

> 🏷️ **Highlights**: `Breakpoint Management` · `Scenario Debugging` · `AI Agent Collaboration` · `Self-Healing Anti-Drift` · `Living Code Tour`

**One-line summary**: Turn scattered temporary breakpoints into reusable, shareable, and self-healing debugging assets.

---

## 💡 Why This Extension?

Every developer debugging in VS Code runs into these frustrations:
1. **Too many leftover breakpoints interrupting your flow**: You have dozens of breakpoints scattered from previous debugging sessions. Starting a new task pauses execution every two seconds.
2. **Complex call chains are easily forgotten**: You spend hours tracing a multi-file execution path, but forget key steps weeks later. Onboarding teammates face the same steep curve.
3. **Pulling git or editing code breaks your breakpoints**: Whenever lines shift, your saved breakpoints end up on empty lines or comments; *(the most common cause of breakpoint invalidation in collaborative Git workflows)*.
4. **Impossible to share or sync across computers**: Native breakpoints vanish when you switch laptops, and sharing a debug setup with teammates means manually typing out file paths and line numbers.
5. **AI understands your code, but can't set breakpoints for you directly**: When asking an AI assistant to analyze a bug or trace a flow, it can suggest key functions in chat, but you still have to manually find the files and click line numbers one by one.

**Scene Breakpoints** is your **breakpoint organizer & execution tour guide**: group breakpoints by feature with descriptive notes, switch them in seconds, and share them via Git. It also supports **one-click AI Agent scenario generation and activation**—simply tell your AI in natural language, and let it orchestrate breakpoints directly in your editor.

---

## ✨ What Can It Do For You?

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/sb.gif" alt="Scene Breakpoints Interactive Demo" width="100%" />
</p>

- 🗺️ **Document Execution Flows into Living Code Tours**
  Attach clear notes to each breakpoint (e.g. `Step 1: Auth Guard`, `Step 2: Decrement Inventory`). A scene becomes a self-guided walkthrough for complex codebases.

- 🎯 **Switch Scenarios, Keep Only What You Need**
  Switching to "Login" only enables breakpoints for login. All unrelated breakpoints are cleanly cleared so you never get interrupted.

- 🛡️ **Code Drift Self-Healing**
  Did you pull upstream commits or add a few lines? The extension recognizes the surrounding code and automatically snaps breakpoints to their true lines.

- 🔄 **Set Breakpoints Naturally, Save with One Click**
  Debug as usual with your mouse. When it works, click once to "Export Current Breakpoints to Scene"—no manual JSON editing needed.

- 🌲 **Checklist-Style Sidebar Management**
  View all your scenes in the "Run & Debug" panel. Click checkboxes to toggle breakpoints or layer multiple scenes together.

- ⚡ **Auto-Load on F5**
  Link your launch profiles to a scene. Pressing F5 automatically prepares the right breakpoints before the debugger starts.

- 🤖 **AI-Generated Breakpoint Scenes, Ready in Seconds**
  When asking an AI agent to analyze a bug or trace an execution path, it can directly generate a complete breakpoint scene with step-by-step notes and activate it immediately—no more manual file jumping or clicking line numbers.

---

## 🚀 Quick Start

### 1. Installation

- **From Marketplace**: Search for `Scene Breakpoints` in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click Install;
- **From VSIX**: In Extensions view, click `...` $\rightarrow$ `Install from VSIX...`.

### 2. 3-Step Walkthrough

1. **Add Breakpoint**: Right-click on any line and choose `Add to Debug Scene...`, or press `Ctrl + Alt + B` (`Cmd + Alt + B` on macOS), select a scene, and enter a note;

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/context-menu-add.png" alt="Context menu or Ctrl+Alt+B to add scene breakpoint" width="75%" />
</p>

2. **Switch Scene**: Click the status bar item at the bottom (or press `Ctrl + Alt + S` / `Cmd + Alt + S` on macOS) to activate one or more scenes. Upon activation, the status bar displays the active scene, the sidebar view highlights the scene, and editor breakpoint dots mount instantly;

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/scene-quickpick.png" alt="Scene Switch QuickPick dialog" width="85%" />
</p>

3. **Export Active**: After placing breakpoints freely in code, run `Scene: Export Current Breakpoints to Scene...` from the command palette to persist them.

---

## ⌨️ Shortcuts

| Shortcut | Description |
| :--- | :--- |
| `Ctrl + Alt + S` (macOS: `Cmd + Alt + S`) | Open Scene Control Menu / Switch & Multi-select scenes (or click Status Bar) |
| `Ctrl + Alt + B` (macOS: `Cmd + Alt + B`) | Add current line to scene with a description |
| `Alt + ↑` / `Alt + ↓` | Move breakpoint up / down in tree view (supports continuous hold or drag-and-drop) |

> 💡 **Shortcut Conflict Tip**: On Windows, if `Ctrl + Alt + B` is captured by input methods or graphics card utilities, you can easily customize it under VS Code's **Keyboard Shortcuts** (`Ctrl + K Ctrl + S`) by searching for `sceneBreakpoints`.

---

## 📝 Configuration Example (`.vscode/debug-scenes.json`)

Presets are stored in declarative JSON at `.vscode/debug-scenes.json`, with built-in CodeLens buttons and schema validation:

<p align="center">
  <img src="https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/docs/images/config-file-codelens.png" alt="debug-scenes.json and CodeLens view" width="85%" />
</p>

```json
{
  "$schema": "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
  "activeScenes": ["login-debug"],
  "bindings": {
    "Launch API Server": "login-debug"
  },
  "scenes": {
    "login-debug": [
      {
        "type": "condition",
        "file": "src/auth.ts",
        "line": 45,
        "condition": "user.isVip === true",
        "desc": "Step 1: Intercept only when VIP user logs in"
      },
      {
        "type": "logpoint",
        "file": "src/agent-loop.ts",
        "line": 104,
        "logMessage": "Current status: {state.status}",
        "desc": "Step 2: Print runtime status without pausing"
      },
      {
        "type": "line",
        "file": "src/user.ts",
        "line": 88,
        "desc": "Step 3: Extract core session data"
      }
    ]
  }
}
```

> 💡 **`activeScenes` property**: Records currently activated debug scene(s) (supports multi-scene layering). AI Agents can modify this field to trigger declarative scenario activation without invoking commands (see AI Agent section below).

---

## 🤖 AI Agent Integration & One-Click Skill Deployment

Scene Breakpoints collaborates seamlessly with modern AI coding assistants, allowing your AI to understand, create, and manage breakpoint scenes for you:

### 1. One-Click AI Agent Skill Deployment
Press `Ctrl+Shift+P` and run **`Scene Breakpoints: Install Agent Skill`** to deploy the `scene-breakpoints` skill directly into your workspace, covering 8 major AI IDEs & Agent platforms:
- **Antigravity**: `.agents/skills/scene-breakpoints/SKILL.md`
- **Cursor IDE**: `.cursor/rules/scene-breakpoints.mdc`
- **Windsurf**: `.windsurf/rules/scene-breakpoints.md`
- **Cline (Claude Dev)**: `.clinerules/scene-breakpoints.md`
- **Roo Code**: `.roorules/scene-breakpoints.md`
- **Continue.dev**: `.continue/prompts/scene-breakpoints.prompt`
- **GitHub Copilot**: `.github/skills/scene-breakpoints/SKILL.md`
- **Trae IDE**: `.trae/skills/scene-breakpoints/SKILL.md`

Once installed, simply instruct your AI: *"Help me analyze why login failed and set up a breakpoint scene"*. The agent will automatically inspect the code, assemble breakpoints, and activate the scene for you!

### 2. Full-Spectrum AI Diagnostics
Run **`Scene Breakpoints: Diagnose AI Integration`** to inspect cross-platform skill deployment status and perform one-click repairs:

```text
⚡ [Host Environment] Auto-detect current IDE (Antigravity / Cursor / Trae / VS Code) and prioritize rules
✅ [Configuration] allowAiFileActivation: Enabled (declarative scene read/write ready)
✅ [Deployed Skills] Antigravity, Cursor, Trae (latest baseline)
⚠️ [Pending Platforms] GitHub Copilot, Windsurf → Click [One-Click Install] to deploy instantly
```

---

## 📖 More Documentation

- 📕 [Comprehensive User Guide & FAQ](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/docs/guide.md)
- 📝 [Changelog (CHANGELOG.md)](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/CHANGELOG.md)

---

## 💖 Support & Feedback

If this extension is helpful to you, please consider leaving a ⭐ rating on [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Tony-L.scene-breakpoints-vscode) or [Open VSX](https://open-vsx.org/extension/tony-l/scene-breakpoints-vscode).  
Found a bug or have a suggestion? Feel free to [open an issue](https://github.com/Tonys-L/scene-breakpoints-vscode/issues).

---

## 📄 License

[MIT License](https://github.com/Tonys-L/scene-breakpoints-vscode/blob/main/LICENSE) © 2026 Tony.L
