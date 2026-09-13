# Scene Breakpoints Hands-On Guide

> 💡 **In a nutshell**: Say goodbye to scattered, messy breakpoints! Switch debugging scenarios as effortlessly as Git branches, watch displaced breakpoints heal themselves automatically, and orchestrate breakpoint scenes seamlessly with mainstream AI assistants like Cursor, Windsurf, and Copilot.

---

## Table of Contents

1. [Tired of These Debugging Headaches?](#1-tired-of-these-debugging-headaches)
2. [3-Minute Quick Start](#2-3-minute-quick-start)
3. [Daily Workflows & Core Debugging Techniques](#3-daily-workflows--core-debugging-techniques)
   - [3.1 Activate a Scene, Clear the Clutter](#31-activate-a-scene-clear-the-clutter)
   - [3.2 All Breakpoint Flavors Supported](#32-all-breakpoint-flavors-supported)
   - [3.3 Sidebar TreeView: Direct Toggles & Batch Control](#33-sidebar-treeview-direct-toggles--batch-control)
   - [3.4 Reverse Export: Save What You Clicked On-the-Fly](#34-reverse-export-save-what-you-clicked-on-the-fly)
   - [3.5 Multi-Scene Stacking: Tackle Complex Cross-Service Traces](#35-multi-scene-stacking-tackle-complex-cross-service-traces)
   - [3.6 Auto-Mount on Launch via bindings](#36-auto-mount-on-launch-via-bindings)
   - [3.7 Clipboard Sharing: Hand Off Debugging Sessions in Seconds](#37-clipboard-sharing-hand-off-debugging-sessions-in-seconds)
4. [Code Drift & Self-Healing Architecture](#4-code-drift--self-healing-architecture)
   - [4.1 What is a Code Fingerprint? (3-Line Context Window)](#41-what-is-a-code-fingerprint-3-line-context-window)
   - [4.2 Two-Stage Self-Healing Engine: Near-Site Radiation + Scope Cruise](#42-two-stage-self-healing-engine-near-site-radiation--scope-cruise)
   - [4.3 What if Code Was Completely Deleted? (Unmatched Warning)](#43-what-if-code-was-completely-deleted-unmatched-warning)
5. [AI Agent Orchestration & Skill Planning](#5-ai-agent-orchestration--skill-planning)
   - [5.1 How the Extension Empowers AI (Declarative Driven Architecture)](#51-how-the-extension-empowers-ai-declarative-driven-architecture)
   - [5.2 Install AI Skills: When to Use & Core Scenarios](#52-install-ai-skills-when-to-use--core-scenarios)
   - [5.3 Three Ways AI Activates Breakpoint Scenes](#53-three-ways-ai-activates-breakpoint-scenes)
   - [5.4 AI Breakpoint Authoring Guidelines (Omission Strategy)](#54-ai-breakpoint-authoring-guidelines-omission-strategy)
   - [5.5 Diagnostics Panel: Check Your AI Setup](#55-diagnostics-panel-check-your-ai-setup)
   - [5.6 Will Plugin Updates Overwrite My Custom Rules?](#56-will-plugin-updates-overwrite-my-custom-rules)
6. [Full Configuration Reference (debug-scenes.json)](#6-full-configuration-reference-debug-scenesjson)
7. [Cheat Sheet: Shortcuts & Actions](#7-cheat-sheet-shortcuts--actions)
8. [Frequently Asked Questions (FAQ)](#8-frequently-asked-questions-faq)

---

## 1. Tired of These Debugging Headaches?

Every developer has been through these painful moments:

- 💥 **Breakpoint Explosion**: You placed 8 breakpoints tracking auth in the morning, and 10 more debugging payments in the afternoon. When you start the debugger, it keeps pausing on irrelevant legacy lines, completely breaking your mental flow.
- ❓ **Total Amnesia Days Later**: Staring at a cold `order.ts:142` in your breakpoint list, having zero clue why you put it there, forcing you to re-read the surrounding code.
- 🕳️ **Git Pull Shifts Everything**: A teammate pushes a commit or you run a code formatter. Line numbers shift, and all your carefully placed breakpoints land on the wrong lines.
- 🤖 **AI Diagnoses the Bug, But Can't Touch the IDE**: Chatting with Cursor or Claude gives great insights, but you still have to manually click through the files and set every single red dot yourself.

**Scene Breakpoints was built to end this chaos.** It packages breakpoints into named "Scenes" you can toggle on demand, automatically recovers from code drift, and syncs via Git across your entire team.

---

## 2. 3-Minute Quick Start

### Step 1: Save a Breakpoint on Your Current Line
1. Open any source file in your project;
2. On any line you want to pause, press `Ctrl + Alt + B` (macOS: `Cmd + Alt + B`), or right-click and choose `Save Current Line to Scene`;
3. In the input box:
   - Type a memorable scene name (e.g. `login-flow`);
   - Pick the breakpoint type (standard line breakpoint is default);
   - Add a brief note explaining intent (e.g. `Validate JWT token expiration`);
4. Hit Enter! If this scene is already active, the red dot lights up in your editor **instantly**.

### Step 2: Switch Scenes in One Click
1. Look at the VS Code Status Bar at the bottom: you will spot the indicator (`Scene: (None)`);
2. Click it, or press `Ctrl + Alt + S` (macOS: `Cmd + Alt + S`);
3. Pick `login-flow` and hit Enter:
   - All unrelated, cluttered breakpoints vanish instantly;
   - All breakpoints belonging to `login-flow` mount seamlessly;
   - The status bar turns bright green: `Scene: login-flow`. Pure peace of mind!

### Step 3: An Even Better Way — Reverse Export!
You actually don't have to plan ahead. Just click away in the editor margin as you normally do:
1. Hit `Ctrl + Shift + P` to open the Command Palette;
2. Type and run: `Scene Breakpoints: Export Current Breakpoints to Scene...`;
3. Name it (e.g. `payment-bug`), and all active breakpoints along with code fingerprint snippets are locked in!

---

## 3. Daily Workflows & Core Debugging Techniques

### 3.1 Activate a Scene, Clear the Clutter
In large codebases, stale breakpoints are noise. Whenever you activate a scene:
- Identical existing breakpoints **stay put** (zero visual flicker);
- Irrelevant breakpoints are cleanly **swept away**;
- Want a clean screen? Run `Scene Breakpoints: Clear All Breakpoints` anytime. Rest assured: it only clears your active editor view and **never** touches your saved scene configurations.

### 3.2 All Breakpoint Flavors Supported
Full fidelity with VS Code's native debugging protocol:
1. **Line Breakpoint (line)**: Standard execution pause on the line;
2. **Conditional Breakpoint (condition)**: Pauses only when true (e.g. `user.id === 'admin'`);
3. **Hit Count Breakpoint (hitCount)**: Pauses after hitting $N$ times (e.g. `> 100`);
4. **Logpoint (logpoint)**: Prints messages without stopping (supports `{user.name}` interpolations — fantastic for production tracing);
5. **Function Breakpoint (function)**: Pauses on function entry globally across files.

### 3.3 Sidebar TreeView: Direct Toggles & Batch Control
Open the **Run & Debug** activity bar on the left, and check out the dedicated **Scene Breakpoints** panel:
- **Interactive Checkboxes**: Click the native checkbox next to any breakpoint to toggle it on/off in real-time;
- **Jump to Configuration**: Hover over any breakpoint and click the inline file icon (`Reveal in debug-scenes.json`) to open `.vscode/debug-scenes.json` and highlight that exact breakpoint entry;
- **Reorder Breakpoints**: Use the inline `Move Up ↑` and `Move Down ↓` buttons to adjust the sequence according to execution flow, with changes instantly saved to disk;
- **Active Paused Indicator**: When execution pauses at a breakpoint during an active debug session (F5), the tree auto-expands to the breakpoint and highlights it with an active pointer (`▶ [PAUSED]` and green stack frame icon);
- **Two-Way Sync**: Right-click a breakpoint in code to disable it; the JSON config reflects the change automatically;
- **Batch Operations**: Right-click a scene name to enable/disable all items in one click, or duplicate the entire scene.

### 3.4 Reverse Export: Save What You Clicked On-the-Fly
Finish debugging a thorny issue and think "I'll definitely need these breakpoints again"?
- **Save as New Scene**: Provide a fresh name;
- **Append to Existing Scene**: Merges and deduplicates gracefully (same line gets updated, new lines get appended).

### 3.5 Multi-Scene Stacking: Tackle Complex Cross-Service Traces
Need to trace authentication, orders, and payment webhooks simultaneously?
1. Click the **Multi-select Scenes** button on the TreeView header;
2. Check both `auth-flow` and `order-flow`;
3. Confirm, and both sets merge into the editor without collisions. The status bar displays: `[auth-flow + order-flow]`;
4. You can also click the inline action buttons on individual scenes to toggle them in or out.

### 3.6 Auto-Mount on Launch via bindings
Tired of switching scenes manually every time you launch debugging? Define `bindings` in `debug-scenes.json`:

```json
{
  "bindings": {
    "Debug API Server": "api-debug",
    "Launch Worker": ["worker-init", "worker-exec"]
  },
  "scenes": { ... }
}
```
When launching `Debug API Server`, the extension pre-mounts `api-debug` breakpoints seamlessly before the debugger starts! Zero launch argument alterations needed. *(If bindings are omitted, the extension also attempts matching identical launch config names as a fallback)*.

### 3.7 Clipboard Sharing: Hand Off Debugging Sessions in Seconds
Stuck on a tricky bug and need a colleague's second pair of eyes?
1. Right-click your scene in the tree and pick `Copy Scene to Clipboard`;
2. Paste the JSON to your teammate;
3. They simply click the **Import from Clipboard** button on their TreeView header to replicate your exact debugging scenario;
4. Even if you copied Markdown code fences (````json ... ````) or comments, the built-in parser cleanses everything automatically.

---

## 4. Code Drift & Self-Healing Architecture

When source code is modified, line numbers shift up or down. Conventional debuggers store rigid line numbers (e.g. line 42) that quickly drift out of sync. Scene Breakpoints eliminates this via **Code Fingerprints** and a **Two-Stage Self-Healing Algorithm**.

### 4.1 What is a Code Fingerprint? (3-Line Context Window)
When you save a breakpoint or execute "Reverse Export", the extension captures not only the line number, but also the surrounding lines: previous line, target line, and next line. This forms a 3-line fingerprint (`contextSnippet`):

```json
"contextSnippet": {
  "before": "const port = process.env.PORT || 3000;",
  "current": "app.listen(port, () => {",
  "after": "  logger.info(`Server running on ${port}`);"
}
```
With this topological fingerprint, even if preceding code inserts lines or changes formatting, the extension finds `app.listen` like radar.

---

### 4.2 Two-Stage Self-Healing Engine: Near-Site Radiation + Scope Cruise
When a scene is activated, if target lines do not match current file lines, the engine scans in two stages:

- **Phase 1: Near-Site Radiation ($\pm 30$ lines)**  
  Scans alternating upwards and downwards. Evaluates non-empty topological windows (penetrating blank lines) and indentation tree structures. Enforces a **Target Existence Guard** to prevent drifting if the line itself was deleted.
- **Phase 2: Scope Cruise Dynamic Re-Anchoring (Beyond 30 lines)**  
  If a whole function was moved or 100 lines were inserted above, Phase 1 may fall outside the window. The breakpoint stores its enclosing function name (`scopeAnchor`). Phase 2 locates the function declaration across the file and re-anchors the scanning window inside the function body (even across 50~500 line shifts)! Native support for Python, Go, Rust, TS/JS, Java, C++, and C#.
- **Line Persistence**: Upon successful healing, the extension writes the latest valid line number back to `debug-scenes.json` automatically.

---

### 4.3 What if Code Was Completely Deleted? (Unmatched Warning)
If target code was completely refactored away, the engine never guesses:
- Marked as `unmatched`;
- Gracefully falls back to the original line, surfacing an actionable VS Code warning popup with quick-navigation;
- The TreeView decorates the node with a prominent `[Unmatched]` badge.

---

## 5. AI Agent Orchestration & Skill Planning

### 5.1 How the Extension Empowers AI (Declarative Driven Architecture)

When asking AI assistants (Cursor, Windsurf, GitHub Copilot, Claude Code, etc.) to investigate a bug, the biggest bottleneck was **bridging AI analysis with the IDE interface**: the AI explains where the issue lies, but **it cannot touch your editor UI**. You have to manually navigate files and click red dots, disrupting your mental flow.

**Scene Breakpoints solves this with an elegant declarative contract:**

1. **AI Does What It Does Best: Read & Write Config**  
   The AI needs zero special permissions, complex setup, or background daemons. It simply reads and edits the plain-text `.vscode/debug-scenes.json` file in your workspace.
2. **The Extension Acts as the Execution Engine**  
   The extension watches this file silently. As soon as the AI saves the scenario and activates it, the extension calls the VS Code Debug Adapter Protocol (DAP) within milliseconds to **illuminate red dots directly in your editor**.
3. **Skill Matrix: Infusing AI with Domain Knowledge**  
   To help the AI know *when* and *how* to set breakpoints effectively, the extension provides standard Skill rule files. Once installed, the AI acts like an expert troubleshooter, structuring scenes and orchestrating breakpoints autonomously.

---

### 5.2 Install AI Skills: When to Use & Core Scenarios
Press `Ctrl + Shift + P` and run:
`Scene Breakpoints: Install AI Agent Skill...`
Installs ready-to-use skill rules that mainstream AI tools detect and load automatically:

- **Cursor**: `.cursor/rules/scene-breakpoints.mdc`
- **Windsurf**: `.windsurf/rules/scene-breakpoints.md`
- **Cline**: `.clinerules/scene-breakpoints.md`
- **Roo Code**: `.roorules/scene-breakpoints.md`
- **Continue**: `.continue/prompts/scene-breakpoints.prompt`
- **VS Code / Copilot**: `.github/skills/scene-breakpoints/SKILL.md`
- **Trae**: `.trae/skills/scene-breakpoints/SKILL.md`
- **Antigravity**: `.agents/skills/scene-breakpoints/SKILL.md`

#### Core Trigger Scenarios
Once installed, AI automatically invokes this skill when you express prompts like:
1. **Bug Diagnosis**: "Help me debug this exception and place breakpoints on the suspicious call stack", "Trace why this API response is incorrect";
2. **Code Tours**: "Walk me through the authentication and settlement flow, setting up a sequence of tour breakpoints";
3. **Complex Conditions**: "This loop runs 10,000 times; stop only when `count > 100`", "Place a logpoint printing the user ID";
4. **Organizing Breakpoints**: "I'm switching to another feature; save current breakpoints as a scene", "Create a dedicated scene for payment webhooks".

---

### 5.3 Three Ways AI Activates Breakpoint Scenes

#### Strategy 1: `debug-scenes.json` Launch Binding (Recommended ⭐⭐⭐)
- **How It Works**: AI inspects your launch config name (e.g. `"Launch Program"`) and sets up a mapping in `bindings`:
  ```json
  "bindings": {
    "Launch Program": ["auth-login-flow"]
  }
  ```
- **Advantage**: **Zero extra permissions required!** When hitting F5, target breakpoints mount seamlessly upon launch.

#### Strategy 2: Declarative Immediate Activation (Silent Activation ⭐⭐)
- **How It Works**: AI writes `"activeScenes": ["auth-login-flow"]` at the root of `debug-scenes.json`.
- **Prerequisite**: Guarded by a safety permission in `.vscode/settings.json`:
  ```json
  {
    "sceneBreakpoints.allowAiFileActivation": true
  }
  ```
  *(AI can configure this setting upon project initialization)*. Setting `activeScenes: []` clears all breakpoints.

#### Strategy 3: Sidebar Manual Activation (Fallback ⭐)
- **How It Works**: AI informs the user: "Scene `auth-login-flow` generated. Open the Scene Breakpoints tree view in Run & Debug and click the activate button."

---

### 5.4 AI Breakpoint Authoring Guidelines (Omission Strategy)

1. **Syntax Rule: Condition type MUST be `"condition"`**
   - ❌ Wrong: `{ "type": "conditional", "condition": "x > 5" }` (silently dropped by DAP)
   - ✅ Correct: `{ "type": "condition", "condition": "x > 5" }`

2. **Descriptions (desc) should convey intent, not line numbers**
   - ✅ Good: `"Verify user entity is not null"`, `"Trace retry count limits"`
   - ❌ Bad: `"Line 45"`, `"if statement"`

3. **Omit contextSnippet when generating**
   - As explained in Chapter 4, self-healing relies on 3-line fingerprints. But should the AI generate them?
   - **It is strongly recommended that AI omits `contextSnippet`!** Only `type`, `file`, `line`, and `desc` are needed.
   - The extension trusts the line number directly upon activation, saving LLM tokens and eliminating whitespace formatting hallucinations;
   - When you tweak breakpoints in the editor or export them later, the extension reads source code and populates 3-line fingerprints automatically.

---

### 5.5 Diagnostics Panel: Check Your AI Setup
Press `Ctrl + Shift + P` and run:
`Scene Breakpoints: Diagnose AI Agent Integration...`
Inspects external watcher status, active scenes, and whether your agent rules are up to date.

### 5.6 Will Plugin Updates Overwrite My Custom Rules?
**Never!** Many developers add custom project prompts to rule files:
1. **Instant State Recognition**:
   - Clean official rules show `[Up to date]` or `[Upgrade available]` (one-click upgrade);
   - Modified rules show `[Custom modified]`.
2. **Native Side-by-Side Diff Review**:
   Clicking a custom rule opens VS Code's native `vscode.diff` window (your file on the left, official template on the right). Pick and merge what you want without fear of blind overrides;
3. **Mandatory Backups**:
   Even if you choose to overwrite, a timestamped backup (e.g. `SKILL.2026-09-13T01-20-00-000Z.bak`) is created next to the file automatically.

---

## 6. Full Configuration Reference (debug-scenes.json)

Here is a complete, real-world `.vscode/debug-scenes.json` configuration showing `contextSnippet` (3-line fingerprint) and `scopeAnchor`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "activeScenes": ["server-debug"],
  "bindings": {
    "Debug Server": "server-debug"
  },
  "scenes": {
    "server-debug": [
      {
        "type": "line",
        "file": "src/server.ts",
        "line": 42,
        "desc": "Server bootstrap entrypoint",
        "enabled": true,
        "scopeAnchor": "startServer",
        "contextSnippet": {
          "before": "const port = process.env.PORT || 3000;",
          "current": "app.listen(port, () => {",
          "after": "  logger.info(`Server running on ${port}`);"
        }
      },
      {
        "type": "condition",
        "file": "src/routes/order.ts",
        "line": 88,
        "condition": "order.amount > 1000",
        "desc": "Trace high-value orders",
        "enabled": true,
        "scopeAnchor": "handleOrder"
      },
      {
        "type": "logpoint",
        "file": "src/utils/logger.ts",
        "line": 15,
        "logMessage": "Order status: {order.status}",
        "desc": "Non-intrusive trace logger",
        "enabled": true
      },
      {
        "type": "function",
        "functionName": "calculateTax",
        "desc": "Intercept tax calculations globally",
        "enabled": true
      }
    ]
  }
}
```

---

## 7. Cheat Sheet: Shortcuts & Actions

| What You Want to Do | Windows / Linux | macOS | Mouse Entrypoint |
| :--- | :--- | :--- | :--- |
| **Switch / Activate Scene** | `Ctrl + Alt + S` | `Cmd + Alt + S` | Click Status Bar indicator |
| **Save Current Line to Scene** | `Ctrl + Alt + B` | `Cmd + Alt + B` | Right-click editor line |
| **Export Active Breakpoints** | `Ctrl + Shift + P` | `Cmd + Shift + P` | Command: `Scene Breakpoints: Export Current...` |
| **Clear All Editor Breakpoints** | `Ctrl + Shift + P` | `Cmd + Shift + P` | Command: `Scene Breakpoints: Clear All...` |
| **Multi-select Scenes** | `Ctrl + Shift + P` | `Cmd + Shift + P` | TreeView header `Multi-select Scenes` button |
| **Import from Clipboard** | `Ctrl + Shift + P` | `Cmd + Shift + P` | TreeView header `Import from Clipboard` button |
| **Copy Scene to Clipboard** | Right-click scene | Right-click scene | TreeView right-click: `Copy Scene to Clipboard` |
| **Install AI Agent Skill** | `Ctrl + Shift + P` | `Cmd + Shift + P` | Command: `Scene Breakpoints: Install AI Agent...` |
| **Diagnose AI Setup** | `Ctrl + Shift + P` | `Cmd + Shift + P` | Command: `Scene Breakpoints: Diagnose AI Agent...` |
| **Activate from Config File** | Click lens | Click lens | CodeLens above scene: `▶ Activate Scene Breakpoints` |

---

## 8. Frequently Asked Questions (FAQ)

### Q1: Why did my other breakpoints disappear after activating a scene?
**A**: That's a feature, not a bug! The core philosophy is **Scene Isolation**. Unrelated breakpoints constantly stopping your code are productivity killers. Activating a scene clears other noise. To keep your current points, export them to a new scene in 2 seconds before switching.

### Q2: Can I keep two scenes active at the same time?
**A**: Absolutely! Use **Multi-select Scenes**. Click the multi-select icon on the TreeView header, check the scenes you want, and they will merge together without conflicts.

### Q3: Does self-healing modify my source code?
**A**: **Never.** It only tells VS Code to move the red dot to the healed line and updates the line number in `.vscode/debug-scenes.json`. It will never touch a single character of your source code.

### Q4: Will configurations persist across machines or Git pulls?
**A**: Yes! Commit `.vscode/debug-scenes.json` to Git, and anyone pulling the repository gets the exact same debugging scenarios instantly.

### Q5: Will my customized AI rules be overwritten when the plugin updates?
**A**: **Never.** The fingerprinting engine identifies customized files and marks them as `[Custom modified]`. You can review changes side-by-side using VS Code's native diff editor, and an automatic timestamped `.bak` backup is created before any file is overwritten.

---

## Feedback & Community

- **GitHub Repository**: [https://github.com/Tonys-L/scene-breakpoints-vscode](https://github.com/Tonys-L/scene-breakpoints-vscode)
- **Issues & Suggestions**: [GitHub Issues](https://github.com/Tonys-L/scene-breakpoints-vscode/issues)
- **Enjoying Scene Breakpoints?** Leave us a ⭐ on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Tony-L.scene-breakpoints-vscode) or [Open VSX](https://open-vsx.org/extension/tony-l/scene-breakpoints-vscode)!
