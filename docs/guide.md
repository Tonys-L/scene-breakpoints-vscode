# Scene Breakpoints - Complete User Guide & Best Practices

This guide provides a comprehensive walkthrough for the `Scene Breakpoints` VS Code extension, covering basic workflows, advanced configurations, drift self-healing, and troubleshooting.

---

## Table of Contents

1. [Core Concepts & Problem Statement](#1-core-concepts--problem-statement)
2. [5-Minute Quick Start](#2-5-minute-quick-start)
3. [Key Features Walkthrough](#3-key-features-walkthrough)
   - [Scenario Isolation & Auto Cleanup](#31-scenario-isolation--auto-cleanup)
   - [All Breakpoint Types Supported](#32-all-breakpoint-types-supported)
   - [Sidebar Tree View & Full-Duplex Sync](#33-sidebar-tree-view--full-duplex-sync)
   - [Reverse Export Active Breakpoints](#34-reverse-export-active-breakpoints)
   - [Layered Activation & Multi-Scene Composition](#35-layered-activation--multi-scene-composition)
   - [Instant Clipboard Sharing](#36-instant-clipboard-sharing)
4. [Advanced Techniques](#4-advanced-techniques)
   - [How the Code Drift Self-Healing Engine Works](#41-how-the-code-drift-self-healing-engine-works)
   - [Smart launch.json Binding Hook & Priority Matching](#42-smart-launchjson-binding-hook--priority-matching)
   - [debug-scenes.json Schema Breakdown](#43-debug-scenesjson-schema-breakdown)
5. [Shortcuts & Navigation Cheat Sheet](#5-shortcuts--navigation-cheat-sheet)
6. [Frequently Asked Questions (FAQ)](#6-frequently-asked-questions-faq)

---

## 1. Core Concepts & Problem Statement

| Problem in Native VS Code | Scene Breakpoints Solution |
| :--- | :--- |
| **Breakpoint Pollution**<br>Debugging multiple code paths leaves dozens of breakpoints scattered around. Unrelated breaks interrupt execution flow. | **Scenario Isolation**<br>Activating a target scene purges scattered residual breakpoints automatically, injecting only what is relevant to the task. |
| **Lack of Context & Meaning**<br>Breakpoints only display cold file paths and line numbers. After a few days, you forget why a breakpoint was placed. | **Semantic Descriptions**<br>Attach clear descriptions to each breakpoint, visible right inside the editor and the tree view. |
| **Ephemeral Storage**<br>Native breakpoints exist only in ephemeral local cache. Switching machines or collaborating with peers means losing your debugging context. | **Declarative Git Versioning**<br>Stored in `.vscode/debug-scenes.json`, shared seamlessly with teammates and versioned along with code. |
| **Line Drift After Code Changes**<br>Git pulls or refactoring shift line numbers, rendering saved breakpoints misplaced or broken. | **Context Fingerprint Self-Healing**<br>Captures surrounding 3-line code snippets and scans with weighted sliding windows to safely realign displaced breakpoints. |

---

## 2. 5-Minute Quick Start

### Step 1: Add Your First Scene Breakpoint
1. Open any source file in your workspace;
2. Right-click on any line you wish to debug, or press `Ctrl + Alt + B` (`Cmd + Alt + B` on macOS);
3. In the input dialog:
   - Pick or type a scene name (e.g. `auth-flow`);
   - Select the breakpoint type (default: standard Line Breakpoint);
   - Enter a descriptive note (e.g. `Validate JWT bearer token`);
4. The breakpoint is immediately recorded in `.vscode/debug-scenes.json`.

### Step 2: Switch and Activate Scenes
1. Look at the persistent item in the VS Code status bar at the bottom (`$(debug-alt) Scene: (None)`);
2. Click the status bar or press `Ctrl + Alt + S` (`Cmd + Alt + S` on macOS);
3. Select `auth-flow` and hit Enter:
   - All unrelated breakpoints in your workspace are cleanly cleared;
   - All breakpoints belonging to `auth-flow` are injected into your editor;
   - The status bar lights up green: `$(check) Scene: auth-flow`!

### Step 3: Reverse Export (Recommended Workflow)
If you prefer placing breakpoints directly in the editor gutter with your mouse:
1. Place line, conditional, or logpoint breakpoints freely in your code;
2. Press `Ctrl + Shift + P` and run:
   `Scene: Export Current Breakpoints to Scene...`;
3. Type a scene name (e.g. `order-flow`). All active breakpoints and their code fingerprints are instantly solidified into your configuration!

---

## 3. Key Features Walkthrough

### 3.1 Scenario Isolation & Auto Cleanup
When exploring large codebases, scene activation enforces the **Clean Isolation Principle**:
- Clears pre-existing breakpoints to eliminate noise from older tasks;
- Injects the targeted scene breakpoints in batch;
- Need to temporarily clear breakpoints? Use `Scene: Clear All Breakpoints`. It cleans up the editor without touching your stored JSON scene presets.

### 3.2 All Breakpoint Types Supported
Scene Breakpoints fully adheres to the VS Code Debug Adapter Protocol (DAP):
1. **Line Breakpoint**: Standard pause on the specified line;
2. **Conditional Breakpoint**: Pauses execution only when an expression evaluates to `true` (e.g. `user.role === 'admin'`);
3. **Hit Count Breakpoint**: Pauses when hit condition is satisfied (e.g. `> 10` or `% 2 === 0`);
4. **Logpoint**: Non-intrusive logging into the Debug Console with `{variable}` interpolation;
5. **Function Breakpoint**: Intercepts execution across files whenever a named function is invoked.

### 3.3 Sidebar Tree View & Full-Duplex Sync
Open the **Run & Debug** view on the left sidebar to see the **Scene Breakpoints** panel:
- **TreeView $\rightarrow$ Editor**: Expand any active scene and click the native checkbox. Toggling it immediately enables or disables the live breakpoint in the editor.
- **Editor $\rightarrow$ Preset Configuration**: Disabling a breakpoint in the code gutter automatically updates `enabled: false` in `.vscode/debug-scenes.json`.
- **16x16 Vector SVG Icons**: High-contrast, vivid vector icons designed specifically to prevent VS Code selection styles from muting icons to grey.
- **Zero-Flicker DOM Diff**: Stable element IDs prevent tree collapses and scrollbar jumping during edits.

### 3.4 Reverse Export Active Breakpoints
Work naturally without upfront planning. When a debugging session concludes, export your setup:
- **New Scene**: Enter a brand new scene name;
- **Append / Merge**: Pick an existing scene to upsert breakpoints (same line/file updates properties, new files/lines are smoothly appended).

### 3.5 Layered Activation & Multi-Scene Composition
End-to-end debugging often spans multiple interconnected services:
1. Click the `$(checklist)` multi-select button on the TreeView header or choose `Multi-select Scenes` from the status bar menu;
2. Check multiple scenes (e.g. `auth-flow` and `worker-flow`);
3. Confirm to layer both scenes into the editor with automatic deduplication. The status bar reflects composite states like `[auth-flow + worker-flow]`;
4. Click the inline `$(play)` or `$(check)` buttons on scene items to toggle them in and out of the active set individually.

### 3.6 Instant Clipboard Sharing
Need a colleague to look at your exact debugging state?
1. Right-click the scene in the sidebar and select `Copy Scene to Clipboard`;
2. Send the standardized JSON payload to your colleague;
3. Your teammate clicks `Import Scene from Clipboard` on their tree view header and chooses Overwrite, Append, or Rename.

---

## 4. Advanced Techniques

### 4.1 How the Code Drift Self-Healing Engine Works
When upstream code is pulled or lines are reformatted, line numbers shift.

**Self-Healing Workflow:**
1. **Fingerprint Capture**: Captures lexical signatures of the target line along with preceding and succeeding lines;
2. **Bidirectional Radiating Search**: When lines mismatch, the algorithm searches upwards and downwards in alternating steps (default scan window: $\pm 30$ lines);
3. **Multi-Factor Scoring**:
   - Target line lexical similarity (weight: 10);
   - Previous line context match (weight: 5);
   - Next line context match (weight: 5);
   - Indentation depth and structure (weight: 3);
4. **Context Guard**: Requires at least one adjacent line to match precisely and confidence ratio to exceed the threshold, completely preventing false positives on generic lines (e.g. `return true`);
5. **Silent Realignment**: Aligns breakpoints to the newly discovered lines and safely saves the updated lines back to `.vscode/debug-scenes.json`.

### 4.2 Smart launch.json Binding Hook & Priority Matching
You don't need to manually switch scenes before hitting F5. The extension hooks into debug startup using a **3-tier priority resolution engine**:

#### Priority 1: `env.DEBUG_SCENE` in launch.json (Highest Priority)
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Server",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/src/index.ts",
      "env": {
        "DEBUG_SCENE": "api-debug"
      }
    }
  ]
}
```
*Tip: Accepts comma-separated values for composite scenes, e.g. `"DEBUG_SCENE": "auth-debug, api-debug"`.*

#### Priority 2: `bindings` Map in debug-scenes.json
```json
{
  "bindings": {
    "Debug Server": "api-debug",
    "Launch Worker": ["worker-init", "worker-exec"]
  }
}
```

#### Priority 3: Smart Same-Name Inference (Fallback)
If neither of the above is configured, the system matches scene names that share the launch configuration name (case-insensitive, ignoring prefixes like `Launch` or `Debug`).

*Toggle this feature off anytime in settings via `sceneBreakpoints.autoActivateOnLaunch`.*

### 4.3 debug-scenes.json Schema Breakdown
The preset file is stored at `.vscode/debug-scenes.json` and supports JSON Schema validation:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "bindings": {
    "Launch Server": "server-scene"
  },
  "scenes": {
    "server-scene": [
      {
        "type": "line",
        "file": "src/app.ts",
        "line": 42,
        "desc": "Entry server bootstrap",
        "enabled": true
      },
      {
        "type": "condition",
        "file": "src/routes/order.ts",
        "line": 88,
        "condition": "order.amount > 1000",
        "desc": "Pause on high-value transactions"
      },
      {
        "type": "logpoint",
        "file": "src/utils/logger.ts",
        "line": 15,
        "logMessage": "Processing order: {order.id}",
        "desc": "Non-intrusive trace"
      },
      {
        "type": "function",
        "functionName": "calculateTax",
        "desc": "Global tax calculation hook"
      }
    ]
  }
}
```

---

## 5. Shortcuts & Navigation Cheat Sheet

| Action | Windows / Linux | macOS | Access Point |
| :--- | :--- | :--- | :--- |
| **Show Scene Menu** | `Ctrl + Alt + S` | `Cmd + Alt + S` | Click status bar item |
| **Add Line to Scene** | `Ctrl + Alt + B` | `Cmd + Alt + B` | Editor context menu |
| **Export All Breakpoints** | `Ctrl + Shift + P` | `Cmd + Shift + P` | Command: `Scene: Export` |
| **Clear All Breakpoints** | `Ctrl + Shift + P` | `Cmd + Shift + P` | Command: `Scene: Clear All` |
| **CodeLens Activation** | Click lens button | Click lens button | Click `▶ Apply Scene` in `debug-scenes.json` |

---

## 6. Frequently Asked Questions (FAQ)

### Q1: Why did activating a scene remove my existing breakpoints?
**A**: This is intentional. The extension enforces **Scenario Isolation** to keep your debugging clean and uninterrupted by unrelated historical breakpoints. If you want to keep your current set before switching, simply run `Export Current Breakpoints to Scene...` to save it first.

### Q2: Can I activate multiple scenes concurrently?
**A**: Yes! Use the **Multi-select Scenes** command (or the `$(checklist)` button on the sidebar header). It layers multiple scenes together with automatic deduplication.

### Q3: Does self-healing alter my source code files?
**A**: **Never.** Self-healing only updates the line numbers inside `.vscode/debug-scenes.json` and injects the updated line into the editor debug session. It never writes to or alters your source code.

### Q4: Will my presets be lost across git branches or new machines?
**A**: No. Presets live in `.vscode/debug-scenes.json`. Commit this file to Git, and your entire team will have instant access to identical debugging setups.

---

## Feedback & Community

- **GitHub Repository**: [https://github.com/Tonys-L/scene-breakpoints-vscode](https://github.com/Tonys-L/scene-breakpoints-vscode)
- **Issues & Suggestions**: [Report an Issue](https://github.com/Tonys-L/scene-breakpoints-vscode/issues)
