var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var fs6 = __toESM(require("node:fs"));
var vscode18 = __toESM(require("vscode"));

// src/codeLensProvider.ts
var vscode4 = __toESM(require("vscode"));

// src/config/configStorage.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var vscode = __toESM(require("vscode"));

// src/syncCoordinator.ts
var SyncCoordinator = class {
  internalSavingTimer;
  _isInternalSaving = false;
  lastSavedContent = "";
  /**
   * 当前是否正处于扩展内部写盘保护周期内
   */
  isInternalSaving() {
    return this._isInternalSaving;
  }
  /**
   * 显式标记内部写盘行为，并启动延时安全释放窗口
   */
  markInternalSaving(timeoutMs = 600) {
    this._isInternalSaving = true;
    if (this.internalSavingTimer) {
      clearTimeout(this.internalSavingTimer);
    }
    this.internalSavingTimer = setTimeout(() => {
      this._isInternalSaving = false;
      this.internalSavingTimer = void 0;
    }, timeoutMs);
  }
  /**
   * 记录最新一次内部持久化写盘的文件内容指纹
   */
  setLastSavedContent(content) {
    this.lastSavedContent = content;
  }
  getLastSavedContent() {
    return this.lastSavedContent;
  }
  /**
   * 比对磁盘传入内容是否与扩展最新内部写盘内容完全一致（用于拦截自身 fileWatcher 回环）
   */
  isContentMatchingLastSaved(content) {
    if (!this.lastSavedContent || !content) return false;
    try {
      return JSON.stringify(JSON.parse(content)) === JSON.stringify(JSON.parse(this.lastSavedContent));
    } catch {
      return content.trim() === this.lastSavedContent.trim();
    }
  }
  /**
   * 事务化执行内部保存操作，自动包裹指纹记录与安全窗
   */
  async runWithSavingGuard(action) {
    this.markInternalSaving();
    try {
      return await action();
    } finally {
      this.markInternalSaving();
    }
  }
};
var syncCoordinator = new SyncCoordinator();

// src/config/configStorage.ts
function getWorkspaceRoot(warnIfMissing = false) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    if (warnIfMissing) {
      vscode.window.showWarningMessage(vscode.l10n.t("Please open a workspace folder to use Scene Breakpoints."));
    }
    return void 0;
  }
  return folders[0].uri.fsPath;
}
function getScenesConfigPath(workspaceRoot) {
  return path.join(workspaceRoot, ".vscode", "debug-scenes.json");
}
function stripJsonComments(jsonStr) {
  if (typeof jsonStr !== "string") return "{}";
  const stripped = jsonStr.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (_match, stringLiteral) => {
    return stringLiteral ? stringLiteral : "";
  }).replace(/,\s*([\]}])/g, "$1").trim();
  return stripped.length > 0 ? stripped : "{}";
}
function hasGitConflictMarkers(text) {
  if (typeof text !== "string") return false;
  return /^[<]{7}\s|^[=]{7}$|^[>]{7}\s/m.test(text);
}
function loadScenesConfig(workspaceRoot) {
  const configPath = getScenesConfigPath(workspaceRoot);
  if (!fs.existsSync(configPath)) {
    return { scenes: {} };
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    if (!content || !content.trim()) {
      return { scenes: {} };
    }
    if (hasGitConflictMarkers(content)) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("Git conflict detected in debug-scenes.json. Keeping existing breakpoint settings safe.")
      );
      return { scenes: {} };
    }
    const sanitized = stripJsonComments(content);
    const parsed = JSON.parse(sanitized);
    if (!parsed || typeof parsed !== "object") {
      vscode.window.showWarningMessage(vscode.l10n.t("debug-scenes.json root must be an object"));
      return { scenes: {} };
    }
    const candidateScenes = parsed.scenes && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes) ? parsed.scenes : parsed;
    const cleanScenes = {};
    for (const [k, v] of Object.entries(candidateScenes)) {
      if (k !== "$schema" && k !== "bindings" && Array.isArray(v)) {
        cleanScenes[k] = v.filter((it) => it && typeof it === "object");
      }
    }
    let cleanBindings;
    const rawBindings = parsed.bindings || candidateScenes.bindings;
    if (rawBindings && typeof rawBindings === "object" && !Array.isArray(rawBindings)) {
      cleanBindings = {};
      for (const [bk, bv] of Object.entries(rawBindings)) {
        if (typeof bv === "string" && bv.trim()) {
          cleanBindings[bk] = bv.trim();
        } else if (Array.isArray(bv)) {
          cleanBindings[bk] = bv.map((it) => String(it).trim()).filter(Boolean);
        }
      }
    }
    if (cleanBindings && Object.keys(cleanBindings).length > 0) {
      return { bindings: cleanBindings, scenes: cleanScenes };
    }
    return { scenes: cleanScenes };
  } catch (e) {
    vscode.window.showErrorMessage(vscode.l10n.t("Failed to read debug-scenes.json: {0}", e.message));
  }
  return { scenes: {} };
}
var isWriting = false;
var pendingSave;
function saveScenesConfig(workspaceRoot, config) {
  const configPath = getScenesConfigPath(workspaceRoot);
  const vscodeDir = path.dirname(configPath);
  try {
    syncCoordinator.markInternalSaving();
    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir, { recursive: true });
    }
    const content = JSON.stringify(config, null, 2);
    syncCoordinator.setLastSavedContent(content);
    if (isWriting) {
      pendingSave = { workspaceRoot, config };
      return;
    }
    isWriting = true;
    try {
      fs.writeFileSync(configPath, content, "utf-8");
    } finally {
      isWriting = false;
      syncCoordinator.markInternalSaving();
      if (pendingSave) {
        const next = pendingSave;
        pendingSave = void 0;
        saveScenesConfig(next.workspaceRoot, next.config);
      }
    }
  } catch (e) {
    vscode.window.showErrorMessage(vscode.l10n.t("Failed to save debug-scenes.json: {0}", e.message));
  }
}
function isContentMatchingLastSaved(content) {
  return syncCoordinator.isContentMatchingLastSaved(content);
}

// src/config/sceneOperations.ts
var path2 = __toESM(require("node:path"));
function upsertBreakpointToScene(config, sceneName, newEntry) {
  if (!config.scenes) {
    config.scenes = {};
  }
  const list = config.scenes[sceneName] || [];
  if (newEntry.type === "function") {
    const funcEntry = newEntry;
    const existIdx = list.findIndex(
      (it) => it.type === "function" && it.functionName === funcEntry.functionName
    );
    if (existIdx >= 0) {
      list[existIdx] = funcEntry;
    } else {
      list.push(funcEntry);
    }
  } else {
    const srcEntry = newEntry;
    const normFile = srcEntry.file ? srcEntry.file.replace(/\\/g, "/") : "";
    const existIdx = list.findIndex(
      (it) => it.type !== "function" && it.file.replace(/\\/g, "/") === normFile && it.line === srcEntry.line
    );
    if (existIdx >= 0) {
      list[existIdx] = srcEntry;
    } else {
      list.push(srcEntry);
    }
  }
  config.scenes[sceneName] = list;
}
function removeBreakpointFromConfig(config, sceneName, index) {
  const list = config.scenes[sceneName];
  if (!list || index < 0 || index >= list.length) {
    return false;
  }
  list.splice(index, 1);
  return true;
}
function renameSceneInConfig(config, oldName, newName) {
  if (!config.scenes[oldName] || config.scenes[newName]) {
    return false;
  }
  config.scenes[newName] = config.scenes[oldName];
  delete config.scenes[oldName];
  if (config.bindings) {
    for (const [bk, bv] of Object.entries(config.bindings)) {
      if (typeof bv === "string" && bv === oldName) {
        config.bindings[bk] = newName;
      } else if (Array.isArray(bv)) {
        config.bindings[bk] = bv.map((it) => it === oldName ? newName : it);
      }
    }
  }
  return true;
}
function deleteSceneFromConfig(config, sceneName) {
  if (!config.scenes[sceneName]) {
    return false;
  }
  delete config.scenes[sceneName];
  if (config.bindings) {
    for (const [bk, bv] of Object.entries(config.bindings)) {
      if (typeof bv === "string" && bv === sceneName) {
        delete config.bindings[bk];
      } else if (Array.isArray(bv)) {
        const filtered = bv.filter((it) => it !== sceneName);
        if (filtered.length === 0) {
          delete config.bindings[bk];
        } else {
          config.bindings[bk] = filtered;
        }
      }
    }
  }
  return true;
}
function toggleBreakpointEnabledInConfig(config, sceneName, index) {
  const list = config.scenes[sceneName];
  if (!list || index < 0 || index >= list.length) {
    return false;
  }
  const item = list[index];
  item.enabled = !(item.enabled ?? true);
  return true;
}
function setAllBreakpointsEnabledInScene(config, sceneName, targetEnabled) {
  const list = config.scenes[sceneName];
  if (!list || list.length === 0) return false;
  let changed = false;
  for (const item of list) {
    if ((item.enabled ?? true) !== targetEnabled) {
      item.enabled = targetEnabled;
      changed = true;
    }
  }
  return changed;
}
function duplicateSceneInConfig(config, sourceSceneName, targetSceneName) {
  const srcList = config.scenes[sourceSceneName];
  if (!srcList || config.scenes[targetSceneName]) {
    return false;
  }
  config.scenes[targetSceneName] = JSON.parse(JSON.stringify(srcList));
  return true;
}
function syncEditorBreakpointChangesToConfig(config, activeScenes, changedBreakpoints, workspaceRoot) {
  if (!config.scenes || activeScenes.length === 0 || changedBreakpoints.length === 0) {
    return false;
  }
  let hasUpdates = false;
  for (const bp of changedBreakpoints) {
    const targetEnabled = bp.enabled ?? true;
    if (bp.functionName) {
      const targetFuncName = bp.functionName;
      for (const sceneName of activeScenes) {
        const list = config.scenes[sceneName] || [];
        for (const item of list) {
          if (item.type === "function") {
            const funcItem = item;
            if (funcItem.functionName === targetFuncName) {
              if ((funcItem.enabled ?? true) !== targetEnabled) {
                funcItem.enabled = targetEnabled;
                hasUpdates = true;
              }
            }
          }
        }
      }
      continue;
    }
    let bpFsPath = "";
    let bpLine = 0;
    if (bp.location) {
      bpFsPath = bp.location.uri.fsPath;
      bpLine = bp.location.range.start.line + 1;
    } else if (bp.file && typeof bp.line === "number") {
      bpFsPath = bp.file;
      bpLine = bp.line;
    }
    if (!bpFsPath || bpLine <= 0) continue;
    const normBpPath = path2.normalize(bpFsPath).toLowerCase();
    for (const sceneName of activeScenes) {
      const list = config.scenes[sceneName] || [];
      for (const item of list) {
        if (item.type !== "function") {
          const srcItem = item;
          if (srcItem.line === bpLine) {
            let itemFullPath = srcItem.file;
            if (workspaceRoot && !path2.isAbsolute(itemFullPath)) {
              itemFullPath = path2.join(workspaceRoot, itemFullPath);
            }
            const normItemPath = path2.normalize(itemFullPath).toLowerCase();
            if (normItemPath === normBpPath) {
              if ((srcItem.enabled ?? true) !== targetEnabled) {
                srcItem.enabled = targetEnabled;
                hasUpdates = true;
              }
            }
          }
        }
      }
    }
  }
  return hasUpdates;
}
function mergeScenesBreakpoints(config, sceneNames) {
  const merged = [];
  for (const sceneName of sceneNames) {
    const list = config.scenes[sceneName] || [];
    for (const bp of list) {
      if (bp.type === "function") {
        const funcBp = bp;
        const exists = merged.some(
          (it) => it.type === "function" && it.functionName === funcBp.functionName
        );
        if (!exists) merged.push(funcBp);
      } else {
        const srcBp = bp;
        const normFile = srcBp.file ? srcBp.file.replace(/\\/g, "/") : "";
        const exists = merged.some(
          (it) => it.type !== "function" && it.file.replace(/\\/g, "/") === normFile && it.line === srcBp.line
        );
        if (!exists) merged.push(srcBp);
      }
    }
  }
  return merged;
}

// src/config/payloadSerializer.ts
var vscode2 = __toESM(require("vscode"));
function generateScenePayload(sceneName, breakpoints) {
  const payload = {
    $schema: "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
    version: "1.0",
    sceneName: sceneName.trim(),
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    breakpoints: breakpoints.map((bp) => {
      if (bp.type !== "function") {
        return {
          ...bp,
          file: bp.file.replace(/\\/g, "/")
        };
      }
      return bp;
    })
  };
  return JSON.stringify(payload, null, 2);
}
var serializeScenePayload = generateScenePayload;
function stripMarkdownCodeBlocks(text) {
  const trimmed = text.trim();
  const blockMatch = trimmed.match(/^```(?:json|jsonc)?[\r\n]+([\s\S]*?)[\r\n]+```$/i);
  if (blockMatch) {
    return blockMatch[1].trim();
  }
  return trimmed;
}
function getSupportedFormatsTemplate() {
  const title = vscode2.l10n.t("Scene Breakpoints: Supported Clipboard Formats");
  const format1Title = vscode2.l10n.t("Format 1: Standard Scene Payload (Recommended)");
  const format2Title = vscode2.l10n.t("Format 2: scenes dictionary (debug-scenes.json snippet)");
  const format3Title = vscode2.l10n.t("Format 3: Raw breakpoint array");
  return `// ========================================================
// ${title}
// ========================================================

// ${format1Title}
{
  "$schema": "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
  "version": "1.0",
  "sceneName": "order-debug",
  "breakpoints": [
    {
      "type": "line",
      "file": "src/order.ts",
      "line": 42,
      "enabled": true,
      "condition": "order.total > 100",
      "desc": "Check order total"
    },
    {
      "type": "function",
      "functionName": "handleOrderPayment",
      "enabled": true
    }
  ]
}

// ${format2Title}
{
  "scenes": {
    "order-debug": [
      {
        "file": "src/order.ts",
        "line": 42,
        "enabled": true
      }
    ]
  }
}

// ${format3Title}
[
  {
    "file": "src/order.ts",
    "line": 42,
    "enabled": true
  },
  {
    "type": "function",
    "functionName": "handleOrderPayment"
  }
]
`;
}
function parseScenePayload(rawText, defaultSceneName) {
  if (!rawText || !rawText.trim()) {
    return { success: false, error: "Empty content" };
  }
  if (rawText.length > 1024 * 1024) {
    return { success: false, error: "Content exceeds maximum size limit (1MB)" };
  }
  let parsed;
  try {
    const unmarshalled = stripMarkdownCodeBlocks(rawText);
    const sanitized = stripJsonComments(unmarshalled);
    parsed = JSON.parse(sanitized);
  } catch (e) {
    return { success: false, error: `Invalid JSON format: ${e.message}` };
  }
  if (!parsed || typeof parsed !== "object") {
    return { success: false, error: "Payload must be a JSON object or array" };
  }
  let targetSceneName = (defaultSceneName || "imported-scene").trim();
  let candidateBreakpoints = [];
  if (Array.isArray(parsed)) {
    candidateBreakpoints = parsed;
  } else if (parsed.sceneName && Array.isArray(parsed.breakpoints)) {
    targetSceneName = String(parsed.sceneName).trim() || targetSceneName;
    candidateBreakpoints = parsed.breakpoints;
  } else if (parsed.scenes && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes)) {
    const keys = Object.keys(parsed.scenes);
    if (keys.length > 0) {
      targetSceneName = keys[0];
      candidateBreakpoints = Array.isArray(parsed.scenes[targetSceneName]) ? parsed.scenes[targetSceneName] : [];
    }
  } else {
    const keys = Object.keys(parsed).filter((k) => k !== "$schema" && k !== "version" && k !== "exportedAt");
    if (keys.length > 0 && Array.isArray(parsed[keys[0]])) {
      targetSceneName = keys[0];
      candidateBreakpoints = parsed[keys[0]];
    }
  }
  const validBreakpoints = [];
  for (const item of candidateBreakpoints) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "function") {
      if (typeof item.functionName === "string" && item.functionName.trim()) {
        validBreakpoints.push({
          type: "function",
          functionName: item.functionName.trim(),
          condition: item.condition?.trim() || void 0,
          hitCondition: item.hitCondition?.trim() || void 0,
          enabled: typeof item.enabled === "boolean" ? item.enabled : true,
          desc: item.desc?.trim() || void 0
        });
      }
      continue;
    }
    if (typeof item.file === "string" && item.file.trim() && typeof item.line === "number" && item.line > 0) {
      const type = ["condition", "hitCount", "logpoint", "line"].includes(item.type) ? item.type : "line";
      validBreakpoints.push({
        type,
        file: item.file.trim().replace(/\\/g, "/"),
        line: Math.floor(item.line),
        condition: item.condition?.trim() || void 0,
        hitCondition: item.hitCondition?.trim() || void 0,
        logMessage: item.logMessage?.trim() || void 0,
        enabled: typeof item.enabled === "boolean" ? item.enabled : true,
        desc: item.desc?.trim() || void 0,
        contextSnippet: item.contextSnippet && typeof item.contextSnippet === "object" ? item.contextSnippet : void 0
      });
    }
  }
  if (validBreakpoints.length === 0) {
    return { success: false, error: "No valid breakpoints found in the payload" };
  }
  return {
    success: true,
    sceneName: targetSceneName,
    breakpoints: validBreakpoints
  };
}

// src/config/launchResolver.ts
function resolveLaunchBoundScenes(config, launchName, envScene) {
  const sceneNames = Object.keys(config.scenes || {});
  const matchSceneName = (candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) return void 0;
    const lower = trimmed.toLowerCase();
    return sceneNames.find((name) => name.toLowerCase() === lower);
  };
  if (envScene && typeof envScene === "string" && envScene.trim()) {
    const rawScenes = envScene.split(",").map((s) => s.trim()).filter(Boolean);
    const matchedScenes = rawScenes.map(matchSceneName).filter((s) => typeof s === "string");
    return matchedScenes;
  }
  const normalizedLaunchName = (launchName || "").trim();
  if (!normalizedLaunchName) return [];
  if (config.bindings && typeof config.bindings === "object") {
    const bindingKeys = Object.keys(config.bindings);
    const matchedKey = bindingKeys.find(
      (k) => k.trim().toLowerCase() === normalizedLaunchName.toLowerCase()
    );
    if (matchedKey) {
      const target = config.bindings[matchedKey];
      if (typeof target === "string" && target.trim()) {
        const realName = matchSceneName(target);
        return realName ? [realName] : [];
      }
      if (Array.isArray(target)) {
        const matchedScenes = target.map((item) => typeof item === "string" ? matchSceneName(item) : void 0).filter((s) => typeof s === "string");
        return matchedScenes;
      }
    }
  }
  const exactSameScene = matchSceneName(normalizedLaunchName);
  return exactSameScene ? [exactSameScene] : [];
}

// src/config/aiActivationResolver.ts
function computeBreakpointsTopologyHash(breakpoints) {
  if (!Array.isArray(breakpoints) || breakpoints.length === 0) {
    return "";
  }
  const tokens = breakpoints.map((bp) => {
    const isEnabled = bp.enabled ?? true;
    if (bp.type === "function") {
      const fn = bp;
      return `fn:${fn.functionName || ""}:${fn.condition || ""}:${fn.hitCondition || ""}:${isEnabled}`;
    }
    const src = bp;
    const normFile = (src.file || "").replace(/\\/g, "/").toLowerCase();
    return `src:${normFile}:${src.line}:${src.type}:${src.condition || ""}:${src.hitCondition || ""}:${src.logMessage || ""}:${isEnabled}`;
  });
  return tokens.sort().join("|");
}
function extractTargetActiveScenes(rawActive) {
  if (Array.isArray(rawActive)) {
    const cleaned = rawActive.filter((item) => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0);
    return Array.from(new Set(cleaned));
  }
  if (typeof rawActive === "string") {
    const trimmed = rawActive.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return [];
}
function filterGhostScenes(candidates, scenesDict) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }
  if (!scenesDict || typeof scenesDict !== "object" || Array.isArray(scenesDict)) {
    return [];
  }
  const declaredKeys = Object.keys(scenesDict);
  const result = [];
  for (const candidate of candidates) {
    const matched = declaredKeys.find((k) => k.toLowerCase() === candidate.toLowerCase());
    if (matched && !result.includes(matched)) {
      result.push(matched);
    }
  }
  return result;
}
function resolveActiveScenesDiff(params) {
  const { allowAiActivation, currentActiveScenes, rawActiveScenes, scenesDict } = params;
  if (!allowAiActivation) {
    return { shouldApply: false, action: "noop", targetScenes: [] };
  }
  const extracted = extractTargetActiveScenes(rawActiveScenes);
  const targetScenes = filterGhostScenes(extracted, scenesDict);
  const currentSorted = [...currentActiveScenes].sort();
  const targetSorted = [...targetScenes].sort();
  const isIdentical = currentSorted.length === targetSorted.length && currentSorted.every((s, i) => s === targetSorted[i]);
  if (isIdentical) {
    return { shouldApply: false, action: "noop", targetScenes };
  }
  if (targetScenes.length > 0) {
    return { shouldApply: true, action: "apply", targetScenes };
  }
  if (currentActiveScenes.length > 0) {
    return { shouldApply: true, action: "clear", targetScenes: [] };
  }
  return { shouldApply: false, action: "noop", targetScenes: [] };
}

// src/sceneStateManager.ts
var vscode3 = __toESM(require("vscode"));
var SceneStateManager = class {
  currentActiveScenes = [];
  isDirty = false;
  isApplying = false;
  baselineBreakpointCount = 0;
  unmatchedBreakpointsKeySet = /* @__PURE__ */ new Set();
  _onDidChangeState = new vscode3.EventEmitter();
  onDidChangeState = this._onDidChangeState.event;
  getActiveScenes() {
    return [...this.currentActiveScenes];
  }
  getActiveScene() {
    return this.currentActiveScenes[0];
  }
  isSceneActive(sceneName) {
    return this.currentActiveScenes.includes(sceneName);
  }
  getIsDirty() {
    return this.isDirty;
  }
  setUnmatchedBreakpoints(keys) {
    this.unmatchedBreakpointsKeySet = new Set(
      keys.map((k) => k.replace(/\\/g, "/").toLowerCase())
    );
  }
  isBreakpointUnmatched(file, line) {
    if (!file || !line) return false;
    const norm = `${file.trim().replace(/\\/g, "/")}:${line}`.toLowerCase();
    return this.unmatchedBreakpointsKeySet.has(norm);
  }
  setActiveScenes(sceneNames, initialBpCount = 0) {
    const uniqueSorted = Array.from(new Set(sceneNames.map((s) => s.trim()).filter(Boolean))).sort();
    this.currentActiveScenes = uniqueSorted;
    this.baselineBreakpointCount = initialBpCount;
    this.isDirty = false;
    this._onDidChangeState.fire({
      activeScenes: this.currentActiveScenes,
      isDirty: this.isDirty
    });
  }
  setActiveScene(sceneName, initialBpCount = 0) {
    this.setActiveScenes(sceneName ? [sceneName] : [], initialBpCount);
  }
  toggleScene(sceneName) {
    const target = sceneName.trim();
    if (!target) return this.getActiveScenes();
    let updated;
    if (this.currentActiveScenes.includes(target)) {
      updated = this.currentActiveScenes.filter((s) => s !== target);
    } else {
      updated = [...this.currentActiveScenes, target];
    }
    return updated;
  }
  setDirty(dirty) {
    if (this.isDirty !== dirty && this.currentActiveScenes.length > 0) {
      this.isDirty = dirty;
      this._onDidChangeState.fire({
        activeScenes: this.currentActiveScenes,
        isDirty: this.isDirty
      });
    }
  }
  checkDirtyWithCount(currentCount) {
    if (this.currentActiveScenes.length === 0 || this.isApplying) return;
    const dirty = currentCount !== this.baselineBreakpointCount;
    this.setDirty(dirty);
  }
  isApplyingScene() {
    return this.isApplying;
  }
  setApplyingState(applying) {
    this.isApplying = applying;
  }
  lastAppliedTopologyHash = "";
  pendingTopologyUpdate = false;
  getLastAppliedTopologyHash() {
    return this.lastAppliedTopologyHash;
  }
  setLastAppliedTopologyHash(hash) {
    this.lastAppliedTopologyHash = hash;
  }
  clearLastAppliedTopologyHash() {
    this.lastAppliedTopologyHash = "";
  }
  isPendingTopologyUpdate() {
    return this.pendingTopologyUpdate;
  }
  setPendingTopologyUpdate(pending) {
    this.pendingTopologyUpdate = pending;
  }
  dispose() {
    this.clearLastAppliedTopologyHash();
    this.pendingTopologyUpdate = false;
    this._onDidChangeState.dispose();
  }
};
var sceneStateManager = new SceneStateManager();

// src/codeLensProvider.ts
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var SceneCodeLensProvider = class {
  provideCodeLenses(document) {
    if (!document.fileName.endsWith("debug-scenes.json")) {
      return [];
    }
    const lenses = [];
    try {
      const cleaned = stripJsonComments(document.getText());
      const parsed = JSON.parse(cleaned);
      const scenes = parsed && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes) ? parsed.scenes : parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      const sceneNames = Object.keys(scenes).filter((k) => k !== "$schema" && Array.isArray(scenes[k]));
      for (const sceneName of sceneNames) {
        const count = Array.isArray(scenes[sceneName]) ? scenes[sceneName].length : 0;
        const keyPattern = new RegExp(`^\\s*"${escapeRegex(sceneName)}"\\s*:`);
        const isActive = sceneStateManager.isSceneActive(sceneName);
        for (let i = 0; i < document.lineCount; i++) {
          const lineText = document.lineAt(i).text;
          if (keyPattern.test(lineText)) {
            const range = new vscode4.Range(i, 0, i, 0);
            const title = isActive ? vscode4.l10n.t("\u2714 Active ({0} bps)", count) : vscode4.l10n.t("\u25B6 Apply Scene ({0} bps)", count);
            lenses.push(
              new vscode4.CodeLens(range, {
                title,
                tooltip: vscode4.l10n.t("Click to activate this scene and clean other breakpoints"),
                command: "sceneBreakpoints.applyScene",
                arguments: [sceneName]
              })
            );
            break;
          }
        }
      }
    } catch {
    }
    return lenses;
  }
};

// src/commands/index.ts
var vscode15 = __toESM(require("vscode"));

// src/commands/addBreakpoint.ts
var path5 = __toESM(require("node:path"));
var vscode7 = __toESM(require("vscode"));

// src/breakpointAdapter.ts
var fs3 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
var vscode6 = __toESM(require("vscode"));

// src/healingAdapter.ts
var fs2 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
var vscode5 = __toESM(require("vscode"));
var HEALING_CONFIDENCE_THRESHOLD = 0.6;
var HEALING_SEARCH_WINDOW = 30;
var SCOPE_MAX_LOOKUP_LINES = 60;
var SCOPE_BODY_SEARCH_WINDOW = 150;
function cleanLine(text) {
  if (typeof text !== "string") return "";
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > 140 ? normalized.substring(0, 140) : normalized;
}
function stripTrailingComment(line) {
  if (!line) return "";
  return line.replace(/\s*(?:\/\/|#).*$/, "").trim();
}
function countIndent(text) {
  if (typeof text !== "string") return 0;
  const match = text.replace(/\t/g, "  ").match(/^(\s*)/);
  return match ? match[1].length : 0;
}
function findPrevNonEmptyLine(lines, fromIdx) {
  for (let i = fromIdx - 1; i >= 0; i--) {
    const line = lines[i];
    if (line && line.trim()) {
      return cleanLine(line);
    }
  }
  return void 0;
}
function findNextNonEmptyLine(lines, fromIdx) {
  for (let i = fromIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim()) {
      return cleanLine(line);
    }
  }
  return void 0;
}
function findGeometricParent(lines, fromIdx, currentIndent) {
  for (let i = fromIdx - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const ind = countIndent(line);
    if (ind < currentIndent) {
      return cleanLine(line);
    }
  }
  return void 0;
}
var CONTROL_FLOW_KEYWORDS = /* @__PURE__ */ new Set([
  "if",
  "else",
  "elif",
  "for",
  "while",
  "do",
  "loop",
  "switch",
  "case",
  "catch",
  "finally",
  "with",
  "select",
  "defer",
  "go",
  "return",
  "throw"
]);
var SCOPE_PATTERNS = [
  // Python: def foo(...) or class Foo(...)
  /^\s*(?:async\s+)?def\s+([a-zA-Z0-9_$]+)/,
  // JS/TS/PHP: function foo(...) or async function foo(...)
  /^\s*(?:export\s+)?(?:async\s+)?function(?:\s+([a-zA-Z0-9_$]+)|\s*\()/i,
  // Go: func (r *Receiver) Method(...) or func Function(...)
  /^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_$]+)/,
  // Rust: fn foo(...) or pub fn foo(...)
  /^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_$]+)/,
  // 类构造函数 constructor(...)
  /^\s*(?:public|private|protected)*\s*constructor\b/i,
  // 类属性访问器 get prop() / set prop(v)
  /^\s*(?:public|private|protected|static)*\s*(?:get|set)\s+([a-zA-Z0-9_$]+)/i,
  // 类方法或对象方法: methodName(...) { or methodName = (...) =>
  /^\s*(?:public|private|protected|static|async)*\s*([a-zA-Z0-9_$]+)\s*(?:=\s*(?:async\s*)?(?:<[^>]*>)?\s*\([^)]*\)\s*=>|\([^)]*\)\s*[{:])/i,
  // Class / Struct / Interface
  /^\s*(?:export\s+)?(?:class|struct|interface|type)\s+([a-zA-Z0-9_$]+)/
];
function extractScopeAnchor(lines, lineZeroBased) {
  const maxLookup = Math.max(0, lineZeroBased - SCOPE_MAX_LOOKUP_LINES);
  for (let i = lineZeroBased; i >= maxLookup; i--) {
    const rawLine = lines[i];
    if (!rawLine || !rawLine.trim()) continue;
    if (/^\s*(?:if|for|while|switch|catch|with|elif)\s*\(/.test(rawLine)) {
      continue;
    }
    for (const pattern of SCOPE_PATTERNS) {
      const match = rawLine.match(pattern);
      if (match) {
        const identifier = match[1] || (pattern.source.includes("constructor") ? "constructor" : void 0);
        if (identifier && identifier.trim() && !CONTROL_FLOW_KEYWORDS.has(identifier.trim())) {
          return identifier.trim();
        }
      }
    }
  }
  return void 0;
}
function findScopeAnchorLine(lines, scopeAnchor) {
  if (!scopeAnchor || !scopeAnchor.trim()) return void 0;
  const target = scopeAnchor.trim();
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine || !rawLine.trim() || !rawLine.includes(target)) continue;
    if (/^\s*(?:if|for|while|switch|catch|with|elif)\s*\(/.test(rawLine)) {
      continue;
    }
    for (const pattern of SCOPE_PATTERNS) {
      const match = rawLine.match(pattern);
      if (match) {
        const identifier = match[1] || (pattern.source.includes("constructor") ? "constructor" : void 0);
        if (identifier && identifier.trim() === target) {
          return i;
        }
      }
    }
  }
  return void 0;
}
function extractContextSnippet(doc, lineZeroBased) {
  const currentLineText = doc.lineAt(lineZeroBased).text;
  const current = cleanLine(currentLineText);
  const indent = countIndent(currentLineText);
  const allLines = [];
  for (let i = 0; i < doc.lineCount; i++) {
    allLines.push(doc.lineAt(i).text);
  }
  const prev = findPrevNonEmptyLine(allLines, lineZeroBased);
  const next = findNextNonEmptyLine(allLines, lineZeroBased);
  const sampleLines = allLines.slice(Math.max(0, lineZeroBased - 60), lineZeroBased + 1);
  const scopeAnchor = extractScopeAnchor(sampleLines, sampleLines.length - 1);
  return { prev, current, next, scopeAnchor, indent };
}
function calculateSimilarity(strA, strB) {
  if (strA === strB) return 1;
  const trimA = strA.trim();
  const trimB = strB.trim();
  if (!trimA || !trimB) return 0;
  if (trimA === trimB) return 0.95;
  const wordsA = trimA.match(/[a-zA-Z0-9_$]+/g) || [];
  const wordsB = trimB.match(/[a-zA-Z0-9_$]+/g) || [];
  if (wordsA.length > 0 && wordsB.length > 0) {
    const setA = new Set(wordsA);
    let matchedWords = 0;
    for (const w of wordsB) {
      if (setA.has(w)) matchedWords++;
    }
    const wordSim = matchedWords / Math.max(wordsA.length, wordsB.length);
    const charSetA = new Set(trimA.split(""));
    let commonChars = 0;
    for (const ch of trimB) {
      if (charSetA.has(ch)) commonChars++;
    }
    const charSim = commonChars / Math.max(trimA.length, trimB.length);
    return wordSim * 0.7 + charSim * 0.3;
  }
  return 0;
}
function calculateCandidateLineScore(lines, i, snippet, getCandidateScope, distancePenalty) {
  const lineText = cleanLine(lines[i]);
  let score = 0;
  const isCurrentExactMatch = lineText === snippet.targetCurrent;
  let hasDirectMatch = isCurrentExactMatch;
  if (isCurrentExactMatch) {
    score += 10;
  } else if (snippet.targetCurrent && stripTrailingComment(lineText) === stripTrailingComment(snippet.targetCurrent) && stripTrailingComment(lineText).length > 0) {
    score += 9;
    hasDirectMatch = true;
  }
  let hasPrevMatch = false;
  const candPrev = findPrevNonEmptyLine(lines, i);
  if (snippet.targetPrev && candPrev && (candPrev === snippet.targetPrev || i > 0 && cleanLine(lines[i - 1]) === snippet.targetPrev)) {
    score += 5;
    hasPrevMatch = true;
  }
  let hasNextMatch = false;
  const candNext = findNextNonEmptyLine(lines, i);
  if (snippet.targetNext && candNext && (candNext === snippet.targetNext || i < lines.length - 1 && cleanLine(lines[i + 1]) === snippet.targetNext)) {
    score += 5;
    hasNextMatch = true;
  }
  let hasContextMatch = hasPrevMatch || hasNextMatch;
  if (!isCurrentExactMatch && hasContextMatch) {
    const sim = calculateSimilarity(lineText, snippet.targetCurrent);
    if (sim >= 0.7) {
      score += Math.round(sim * 6);
      hasDirectMatch = true;
    }
  }
  if (hasPrevMatch && hasNextMatch) {
    hasDirectMatch = true;
  }
  let candIndent = 0;
  if (snippet.targetIndent !== void 0) {
    candIndent = countIndent(lines[i]);
    if (candIndent === snippet.targetIndent) {
      score += 3;
    } else if (snippet.targetIndent > 0 && candIndent > 0 && (candIndent === snippet.targetIndent * 2 || snippet.targetIndent === candIndent * 2)) {
      score += 2;
    }
  }
  if (snippet.targetScope && score >= 5) {
    const candParent = findGeometricParent(lines, i, candIndent);
    const candidateScope = getCandidateScope(i);
    if (candidateScope && candidateScope === snippet.targetScope || candParent && (candParent === snippet.targetScope || candParent.includes(snippet.targetScope))) {
      score += 5;
      hasContextMatch = true;
    }
  }
  score -= distancePenalty;
  return { score, hasDirectMatch };
}
async function resolveHealedLine(workspaceRoot, item, fileLinesCache) {
  if (!item.contextSnippet || typeof item.contextSnippet.current !== "string" || !item.line) {
    return { healedLine: item.line, isHealed: false, status: "matched" };
  }
  if (typeof item.line !== "number" || isNaN(item.line) || item.line <= 0) {
    return { healedLine: item.line, isHealed: false, status: "matched" };
  }
  if (!item.file || typeof item.file !== "string") {
    return { healedLine: item.line, isHealed: false, status: "matched" };
  }
  const filePath = path3.isAbsolute(item.file) ? item.file : path3.join(workspaceRoot, item.file);
  const normFilePath = path3.normalize(filePath).toLowerCase();
  let lines;
  if (fileLinesCache && fileLinesCache.has(filePath)) {
    lines = fileLinesCache.get(filePath);
  } else {
    const openDoc = vscode5.workspace.textDocuments.find(
      (d) => path3.normalize(d.uri.fsPath).toLowerCase() === normFilePath
    );
    if (openDoc) {
      lines = [];
      for (let i = 0; i < openDoc.lineCount; i++) {
        lines.push(openDoc.lineAt(i).text);
      }
    } else if (fs2.existsSync(filePath)) {
      try {
        const content = await fs2.promises.readFile(filePath, "utf-8");
        lines = content.split(/\r?\n/);
      } catch {
        return { healedLine: item.line, isHealed: false, status: "unmatched" };
      }
    }
    if (lines && fileLinesCache) {
      fileLinesCache.set(filePath, lines);
    }
  }
  if (!lines || lines.length === 0) {
    return { healedLine: item.line, isHealed: false, status: "unmatched" };
  }
  const origIdx = item.line - 1;
  const targetCurrent = cleanLine(item.contextSnippet.current);
  const targetPrev = item.contextSnippet.prev ? cleanLine(item.contextSnippet.prev) : void 0;
  const targetNext = item.contextSnippet.next ? cleanLine(item.contextSnippet.next) : void 0;
  const targetScope = item.contextSnippet.scopeAnchor;
  const targetIndent = item.contextSnippet.indent;
  if (origIdx >= 0 && origIdx < lines.length) {
    if (cleanLine(lines[origIdx]) === targetCurrent) {
      return { healedLine: item.line, isHealed: false, status: "matched", confidence: 1 };
    }
  }
  const offsets = [];
  for (let step = 1; step <= HEALING_SEARCH_WINDOW; step++) {
    offsets.push(step);
    offsets.push(-step);
  }
  const scopeCache = /* @__PURE__ */ new Map();
  const getCandidateScope = (lineIdx) => {
    if (scopeCache.has(lineIdx)) return scopeCache.get(lineIdx);
    const scope = extractScopeAnchor(lines, lineIdx);
    scopeCache.set(lineIdx, scope);
    return scope;
  };
  let maxPossibleScore = 10;
  if (targetPrev) maxPossibleScore += 5;
  if (targetNext) maxPossibleScore += 5;
  if (targetScope) maxPossibleScore += 5;
  if (targetIndent !== void 0) maxPossibleScore += 3;
  const snippetSpec = { targetCurrent, targetPrev, targetNext, targetScope, targetIndent };
  let bestIdx = -1;
  let bestScore = -1;
  for (const offset of offsets) {
    const i = origIdx + offset;
    if (i < 0 || i >= lines.length) continue;
    const { score, hasDirectMatch } = calculateCandidateLineScore(
      lines,
      i,
      snippetSpec,
      getCandidateScope,
      Math.abs(offset) * 0.05
    );
    if (hasDirectMatch && score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  const confidenceRatio = maxPossibleScore > 0 ? bestScore / maxPossibleScore : 0;
  if (bestIdx !== -1 && (bestScore >= 12.5 || confidenceRatio >= HEALING_CONFIDENCE_THRESHOLD)) {
    const newHealedLine = bestIdx + 1;
    const isHealed = newHealedLine !== item.line;
    return {
      healedLine: newHealedLine,
      isHealed,
      status: isHealed ? "healed" : "matched",
      confidence: confidenceRatio
    };
  }
  if (targetScope) {
    const scopeHeaderIdx = findScopeAnchorLine(lines, targetScope);
    if (scopeHeaderIdx !== void 0) {
      let p2BestIdx = -1;
      let p2BestScore = -1;
      const searchEnd = Math.min(lines.length - 1, scopeHeaderIdx + SCOPE_BODY_SEARCH_WINDOW);
      for (let i = scopeHeaderIdx; i <= searchEnd; i++) {
        const distance = Math.abs(i - origIdx);
        const { score, hasDirectMatch } = calculateCandidateLineScore(
          lines,
          i,
          snippetSpec,
          getCandidateScope,
          distance * 0.01
        );
        if (hasDirectMatch && score > p2BestScore) {
          p2BestScore = score;
          p2BestIdx = i;
        }
      }
      const p2Ratio = maxPossibleScore > 0 ? p2BestScore / maxPossibleScore : 0;
      if (p2BestIdx !== -1 && (p2BestScore >= 12.5 || p2Ratio >= HEALING_CONFIDENCE_THRESHOLD)) {
        const newHealedLine = p2BestIdx + 1;
        const isHealed = newHealedLine !== item.line;
        return {
          healedLine: newHealedLine,
          isHealed,
          status: isHealed ? "healed" : "matched",
          confidence: p2Ratio
        };
      }
    }
  }
  return { healedLine: item.line, isHealed: false, status: "unmatched", confidence: confidenceRatio };
}

// src/breakpointAdapter.ts
async function applySceneBreakpoints(workspaceRoot, targetScene, bpsToLoad) {
  sceneStateManager.setApplyingState(true);
  try {
    const currentBreakpoints = vscode6.debug.breakpoints;
    if (!bpsToLoad || bpsToLoad.length === 0) {
      if (currentBreakpoints.length > 0) {
        await vscode6.debug.removeBreakpoints(currentBreakpoints);
      }
      return { loadedCount: 0, healedCount: 0 };
    }
    const targetBreakpoints = [];
    let healedCount = 0;
    const pathCache = /* @__PURE__ */ new Map();
    const fileLinesCache = /* @__PURE__ */ new Map();
    const unmatchedBreakpoints = [];
    for (const item of bpsToLoad) {
      if (!item || typeof item !== "object") continue;
      const isEnabled = item.enabled ?? true;
      if (item.type === "function") {
        const funcItem = item;
        if (typeof funcItem.functionName === "string" && funcItem.functionName.trim()) {
          const fbp = new vscode6.FunctionBreakpoint(
            funcItem.functionName.trim(),
            isEnabled,
            funcItem.condition,
            funcItem.hitCondition
          );
          targetBreakpoints.push(fbp);
        }
        continue;
      }
      const srcItem = item;
      if (!srcItem.file || typeof srcItem.file !== "string") continue;
      if (typeof srcItem.line !== "number" || isNaN(srcItem.line) || srcItem.line <= 0) continue;
      let targetUri;
      const cacheKey = srcItem.file;
      if (pathCache.has(cacheKey)) {
        targetUri = pathCache.get(cacheKey);
      } else {
        const fullPath = path4.isAbsolute(srcItem.file) ? srcItem.file : path4.join(workspaceRoot, srcItem.file);
        if (fs3.existsSync(fullPath)) {
          targetUri = vscode6.Uri.file(fullPath);
        } else {
          const found = await vscode6.workspace.findFiles(`**/${path4.basename(srcItem.file)}`, "**/node_modules/**", 1);
          targetUri = found.length > 0 ? found[0] : null;
        }
        pathCache.set(cacheKey, targetUri);
      }
      if (!targetUri) continue;
      let effectiveLine = srcItem.line;
      const healResult = await resolveHealedLine(workspaceRoot, srcItem, fileLinesCache);
      if (healResult.isHealed) {
        effectiveLine = healResult.healedLine;
        srcItem.line = effectiveLine;
        healedCount++;
      } else if (healResult.status === "unmatched") {
        unmatchedBreakpoints.push(srcItem);
      }
      const pos = new vscode6.Position(Math.max(0, effectiveLine - 1), 0);
      const location = new vscode6.Location(targetUri, pos);
      let bp;
      switch (srcItem.type) {
        case "condition":
          bp = new vscode6.SourceBreakpoint(location, isEnabled, srcItem.condition);
          break;
        case "hitCount":
          bp = new vscode6.SourceBreakpoint(location, isEnabled, void 0, srcItem.hitCondition);
          break;
        case "logpoint":
          bp = new vscode6.SourceBreakpoint(location, isEnabled, void 0, void 0, srcItem.logMessage);
          break;
        case "line":
        default:
          bp = new vscode6.SourceBreakpoint(location, isEnabled);
          break;
      }
      targetBreakpoints.push(bp);
    }
    const matchedCurrentIndices = /* @__PURE__ */ new Set();
    const matchedTargetIndices = /* @__PURE__ */ new Set();
    for (let cIdx = 0; cIdx < currentBreakpoints.length; cIdx++) {
      const curr = currentBreakpoints[cIdx];
      for (let tIdx = 0; tIdx < targetBreakpoints.length; tIdx++) {
        if (matchedTargetIndices.has(tIdx)) continue;
        const target = targetBreakpoints[tIdx];
        if (curr instanceof vscode6.FunctionBreakpoint && target instanceof vscode6.FunctionBreakpoint) {
          if (curr.functionName === target.functionName && curr.enabled === target.enabled && curr.condition === target.condition && curr.hitCondition === target.hitCondition) {
            matchedCurrentIndices.add(cIdx);
            matchedTargetIndices.add(tIdx);
            break;
          }
        } else if (curr instanceof vscode6.SourceBreakpoint && target instanceof vscode6.SourceBreakpoint) {
          const currPath = path4.normalize(curr.location.uri.fsPath).toLowerCase();
          const targetPath = path4.normalize(target.location.uri.fsPath).toLowerCase();
          if (currPath === targetPath && curr.location.range.start.line === target.location.range.start.line && curr.enabled === target.enabled && curr.condition === target.condition && curr.hitCondition === target.hitCondition && curr.logMessage === target.logMessage) {
            matchedCurrentIndices.add(cIdx);
            matchedTargetIndices.add(tIdx);
            break;
          }
        }
      }
    }
    const toRemove = currentBreakpoints.filter((_, idx) => !matchedCurrentIndices.has(idx));
    const toAdd = targetBreakpoints.filter((_, idx) => !matchedTargetIndices.has(idx));
    if (toRemove.length > 0) {
      await vscode6.debug.removeBreakpoints(toRemove);
    }
    if (toAdd.length > 0) {
      await vscode6.debug.addBreakpoints(toAdd);
    }
    const unmatchedKeys = unmatchedBreakpoints.map(
      (bp) => `${bp.file.replace(/\\/g, "/")}:${bp.line}`
    );
    sceneStateManager.setUnmatchedBreakpoints(unmatchedKeys);
    sceneStateManager.setLastAppliedTopologyHash(computeBreakpointsTopologyHash(bpsToLoad));
    return {
      loadedCount: targetBreakpoints.length,
      healedCount,
      healedBreakpoints: healedCount > 0 ? bpsToLoad : void 0,
      unmatchedBreakpoints
    };
  } finally {
    setTimeout(() => {
      sceneStateManager.setApplyingState(false);
    }, 150);
  }
}
async function applySingleBreakpointToEditor(workspaceRoot, sceneBp) {
  if (!sceneBp) return false;
  const currentBreakpoints = vscode6.debug.breakpoints;
  const isEnabled = sceneBp.enabled ?? true;
  if (sceneBp.type === "function") {
    const funcItem = sceneBp;
    const alreadyExists2 = currentBreakpoints.some(
      (bp) => bp instanceof vscode6.FunctionBreakpoint && bp.functionName === funcItem.functionName
    );
    if (!alreadyExists2) {
      const fbp = new vscode6.FunctionBreakpoint(
        funcItem.functionName.trim(),
        isEnabled,
        funcItem.condition,
        funcItem.hitCondition
      );
      sceneStateManager.setApplyingState(true);
      try {
        await vscode6.debug.addBreakpoints([fbp]);
        return true;
      } finally {
        setTimeout(() => sceneStateManager.setApplyingState(false), 150);
      }
    }
    return false;
  }
  const srcItem = sceneBp;
  const fullPath = path4.isAbsolute(srcItem.file) ? srcItem.file : path4.join(workspaceRoot, srcItem.file);
  let targetUri;
  if (fs3.existsSync(fullPath)) {
    targetUri = vscode6.Uri.file(fullPath);
  } else {
    const found = await vscode6.workspace.findFiles(`**/${path4.basename(srcItem.file)}`, "**/node_modules/**", 1);
    if (found.length > 0) targetUri = found[0];
  }
  if (!targetUri) return false;
  const targetLineZeroBased = Math.max(0, srcItem.line - 1);
  const normFullPath = path4.normalize(targetUri.fsPath).toLowerCase();
  const alreadyExists = currentBreakpoints.some((bp) => {
    if (!(bp instanceof vscode6.SourceBreakpoint)) return false;
    return path4.normalize(bp.location.uri.fsPath).toLowerCase() === normFullPath && bp.location.range.start.line === targetLineZeroBased;
  });
  if (!alreadyExists) {
    const location = new vscode6.Location(targetUri, new vscode6.Position(targetLineZeroBased, 0));
    let bp;
    switch (srcItem.type) {
      case "condition":
        bp = new vscode6.SourceBreakpoint(location, isEnabled, srcItem.condition);
        break;
      case "hitCount":
        bp = new vscode6.SourceBreakpoint(location, isEnabled, void 0, srcItem.hitCondition);
        break;
      case "logpoint":
        bp = new vscode6.SourceBreakpoint(location, isEnabled, void 0, void 0, srcItem.logMessage);
        break;
      case "line":
      default:
        bp = new vscode6.SourceBreakpoint(location, isEnabled);
        break;
    }
    sceneStateManager.setApplyingState(true);
    try {
      await vscode6.debug.addBreakpoints([bp]);
      return true;
    } finally {
      setTimeout(() => sceneStateManager.setApplyingState(false), 150);
    }
  }
  return false;
}
async function clearAllBreakpoints() {
  sceneStateManager.clearLastAppliedTopologyHash();
  await vscode6.debug.removeBreakpoints(vscode6.debug.breakpoints);
  vscode6.window.showInformationMessage(vscode6.l10n.t("Cleared all breakpoints"));
}
async function collectCurrentBreakpoints(workspaceRoot) {
  const currentBreakpoints = vscode6.debug.breakpoints;
  const exportedBps = [];
  for (const bp of currentBreakpoints) {
    if (bp instanceof vscode6.FunctionBreakpoint) {
      const funcBp = {
        type: "function",
        functionName: bp.functionName,
        enabled: bp.enabled,
        condition: bp.condition?.trim() || void 0,
        hitCondition: bp.hitCondition?.trim() || void 0,
        desc: void 0
      };
      exportedBps.push(funcBp);
    } else if (bp instanceof vscode6.SourceBreakpoint) {
      const fullPath = bp.location.uri.fsPath;
      const relPath = path4.relative(workspaceRoot, fullPath).replace(/\\/g, "/");
      const line = bp.location.range.start.line + 1;
      let bpType = "line";
      if (bp.logMessage) {
        bpType = "logpoint";
      } else if (bp.hitCondition) {
        bpType = "hitCount";
      } else if (bp.condition) {
        bpType = "condition";
      }
      let contextSnippet;
      try {
        const doc = await vscode6.workspace.openTextDocument(bp.location.uri);
        contextSnippet = extractContextSnippet(doc, bp.location.range.start.line);
      } catch {
      }
      const srcBp = {
        type: bpType,
        file: relPath,
        line,
        enabled: bp.enabled,
        condition: bp.condition?.trim() || void 0,
        hitCondition: bp.hitCondition?.trim() || void 0,
        logMessage: bp.logMessage?.trim() || void 0,
        desc: void 0,
        contextSnippet
      };
      exportedBps.push(srcBp);
    }
  }
  return exportedBps;
}
async function syncBreakpointEnabledToEditor(workspaceRoot, sceneBp, targetEnabled) {
  if (!sceneBp) return false;
  const currentBreakpoints = vscode6.debug.breakpoints;
  if (sceneBp.type === "function") {
    const funcItem = sceneBp;
    const matched2 = currentBreakpoints.find(
      (bp) => bp instanceof vscode6.FunctionBreakpoint && bp.functionName === funcItem.functionName
    );
    if (matched2 && matched2.enabled !== targetEnabled) {
      const updated = new vscode6.FunctionBreakpoint(
        matched2.functionName,
        targetEnabled,
        matched2.condition,
        matched2.hitCondition
      );
      sceneStateManager.setApplyingState(true);
      try {
        await vscode6.debug.removeBreakpoints([matched2]);
        await vscode6.debug.addBreakpoints([updated]);
        return true;
      } finally {
        setTimeout(() => {
          sceneStateManager.setApplyingState(false);
        }, 150);
      }
    }
    return false;
  }
  const srcItem = sceneBp;
  if (!srcItem.file || typeof srcItem.line !== "number") return false;
  const targetFullPath = path4.isAbsolute(srcItem.file) ? path4.normalize(srcItem.file).toLowerCase() : path4.normalize(path4.join(workspaceRoot, srcItem.file)).toLowerCase();
  const matched = currentBreakpoints.find((bp) => {
    if (!(bp instanceof vscode6.SourceBreakpoint)) return false;
    const bpPath = path4.normalize(bp.location.uri.fsPath).toLowerCase();
    const bpLine = bp.location.range.start.line + 1;
    return bpPath === targetFullPath && bpLine === srcItem.line;
  });
  if (matched && matched.enabled !== targetEnabled) {
    const updated = new vscode6.SourceBreakpoint(
      matched.location,
      targetEnabled,
      matched.condition,
      matched.hitCondition,
      matched.logMessage
    );
    sceneStateManager.setApplyingState(true);
    try {
      await vscode6.debug.removeBreakpoints([matched]);
      await vscode6.debug.addBreakpoints([updated]);
      return true;
    } finally {
      setTimeout(() => {
        sceneStateManager.setApplyingState(false);
      }, 150);
    }
  }
  return false;
}

// src/commands/addBreakpoint.ts
async function addBreakpointCommand() {
  const editor = vscode7.window.activeTextEditor;
  if (!editor) {
    vscode7.window.showWarningMessage(vscode7.l10n.t("No active editor file detected"));
    return;
  }
  const fullFilePath = editor.document.fileName;
  const workspaceFolder = vscode7.workspace.getWorkspaceFolder(editor.document.uri);
  const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path5.dirname(editor.document.fileName);
  const relativeFilePath = path5.relative(workspaceRoot, fullFilePath).replace(/\\/g, "/");
  const fileNameOnly = path5.basename(fullFilePath);
  const currentLine = editor.selection.active.line + 1;
  const config = loadScenesConfig(workspaceRoot);
  const existingScenes = Object.keys(config.scenes || {});
  const sceneQuickPickItems = [
    ...existingScenes.map((s) => ({ label: `$(symbol-event) ${s}`, sceneName: s })),
    { label: vscode7.l10n.t("$(add) [New Scene...]"), sceneName: "__NEW__" }
  ];
  const selectedSceneItem = await vscode7.window.showQuickPick(sceneQuickPickItems, {
    placeHolder: vscode7.l10n.t("Select a scene to add the current line breakpoint to")
  });
  if (!selectedSceneItem) return;
  let targetScene = selectedSceneItem.sceneName;
  if (targetScene === "__NEW__") {
    const newSceneName = await vscode7.window.showInputBox({
      prompt: vscode7.l10n.t("Enter new scene identifier (e.g. user-login or auth-verify)"),
      validateInput: (value) => {
        if (!value || !value.trim()) return vscode7.l10n.t("Scene name cannot be empty");
        return null;
      }
    });
    if (!newSceneName) return;
    targetScene = newSceneName.trim();
    if (!config.scenes[targetScene]) {
      config.scenes[targetScene] = [];
    }
  }
  const typeItems = [
    {
      label: `$(debug-breakpoint) ${vscode7.l10n.t("Line Breakpoint")}`,
      description: vscode7.l10n.t("Pause execution when hit"),
      type: "line"
    },
    {
      label: `$(debug-breakpoint-conditional) ${vscode7.l10n.t("Conditional Breakpoint")}`,
      description: vscode7.l10n.t("Pause when expression evaluates to true"),
      type: "condition"
    },
    {
      label: `$(debug-breakpoint-data) ${vscode7.l10n.t("Hit Count Breakpoint")}`,
      description: vscode7.l10n.t("Pause when hit count condition is satisfied"),
      type: "hitCount"
    },
    {
      label: `$(debug-breakpoint-log) ${vscode7.l10n.t("Logpoint")}`,
      description: vscode7.l10n.t("Print log message to debug console without pausing"),
      type: "logpoint"
    },
    {
      label: `$(debug-breakpoint-function) ${vscode7.l10n.t("Function Breakpoint")}`,
      description: vscode7.l10n.t("Pause when a named function is invoked"),
      type: "function"
    }
  ];
  const selectedTypeItem = await vscode7.window.showQuickPick(typeItems, {
    placeHolder: vscode7.l10n.t("Select breakpoint type")
  });
  if (!selectedTypeItem) return;
  const bpType = selectedTypeItem.type;
  let condition;
  let hitCondition;
  let logMessage;
  let functionName;
  if (bpType === "condition") {
    condition = await vscode7.window.showInputBox({
      prompt: vscode7.l10n.t("Enter condition expression (e.g. user.isAdmin === true)"),
      placeHolder: "user.isAdmin === true"
    });
    if (condition === void 0) return;
  } else if (bpType === "hitCount") {
    hitCondition = await vscode7.window.showInputBox({
      prompt: vscode7.l10n.t("Enter hit count condition (e.g. > 5 or % 10 === 0)"),
      placeHolder: "> 5"
    });
    if (hitCondition === void 0) return;
  } else if (bpType === "logpoint") {
    logMessage = await vscode7.window.showInputBox({
      prompt: vscode7.l10n.t("Enter log message to print (supports {var} interpolation)"),
      placeHolder: "User state: {user.name}, retries: {retryCount}"
    });
    if (logMessage === void 0) return;
  } else if (bpType === "function") {
    functionName = await vscode7.window.showInputBox({
      prompt: vscode7.l10n.t("Enter function name to break on"),
      placeHolder: "handleUserAuthentication",
      validateInput: (v) => !v || !v.trim() ? vscode7.l10n.t("Function name cannot be empty") : null
    });
    if (!functionName) return;
  }
  const description = await vscode7.window.showInputBox({
    prompt: vscode7.l10n.t("Enter breakpoint description (optional, current line: {0}:{1})", fileNameOnly, currentLine),
    placeHolder: vscode7.l10n.t("e.g. Check steering message injection in decision loop")
  });
  let newEntry;
  if (bpType === "function") {
    newEntry = {
      type: "function",
      functionName: functionName.trim(),
      condition: condition?.trim() || void 0,
      hitCondition: hitCondition?.trim() || void 0,
      desc: description?.trim() || void 0
    };
  } else {
    const contextSnippet = extractContextSnippet(editor.document, editor.selection.active.line);
    newEntry = {
      type: bpType,
      file: relativeFilePath.includes("/") ? relativeFilePath : fileNameOnly,
      line: currentLine,
      condition: condition?.trim() || void 0,
      hitCondition: hitCondition?.trim() || void 0,
      logMessage: logMessage?.trim() || void 0,
      desc: description?.trim() || void 0,
      contextSnippet
    };
  }
  upsertBreakpointToScene(config, targetScene, newEntry);
  saveScenesConfig(workspaceRoot, config);
  if (sceneStateManager.isSceneActive(targetScene)) {
    await applySingleBreakpointToEditor(workspaceRoot, newEntry);
    sceneStateManager.setActiveScene(targetScene, config.scenes[targetScene]?.length || 0);
  }
  const summaryLabel = bpType === "function" ? functionName : `${fileNameOnly}:${currentLine}`;
  vscode7.window.showInformationMessage(
    vscode7.l10n.t("Saved breakpoint to scene [{0}]: {1}:{2} {3}", targetScene, summaryLabel, bpType, newEntry.desc ? `("${newEntry.desc}")` : "")
  );
}

// src/commands/applyScene.ts
var path6 = __toESM(require("node:path"));
var vscode8 = __toESM(require("vscode"));

// src/commands/clearAll.ts
async function clearAllCommand() {
  const workspaceRoot = getWorkspaceRoot(false);
  if (workspaceRoot) {
    const config = loadScenesConfig(workspaceRoot);
    if (config.activeScenes && config.activeScenes.length > 0) {
      config.activeScenes = [];
      syncCoordinator.markInternalSaving();
      saveScenesConfig(workspaceRoot, config);
    }
  }
  await clearAllBreakpoints();
  sceneStateManager.setActiveScene(void 0);
}

// src/commands/applyScene.ts
async function applySceneCommand(sceneParam) {
  const workspaceRoot = getWorkspaceRoot(true);
  if (!workspaceRoot) return;
  const config = loadScenesConfig(workspaceRoot);
  const sceneNames = Object.keys(config.scenes || {});
  if (sceneNames.length === 0) {
    vscode8.window.showWarningMessage(vscode8.l10n.t("No scenes configured in debug-scenes.json yet"));
    return;
  }
  let targetScenes;
  if (Array.isArray(sceneParam)) {
    targetScenes = sceneParam.map((s) => String(s).trim()).filter(Boolean);
  } else if (typeof sceneParam === "string" && sceneParam.trim()) {
    if (sceneParam.includes(",")) {
      targetScenes = sceneParam.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      targetScenes = [sceneParam.trim()];
    }
  }
  if (!targetScenes) {
    const activeEditor = vscode8.window.activeTextEditor;
    if (activeEditor && activeEditor.document.fileName.endsWith("debug-scenes.json")) {
      const currentLine = activeEditor.selection.active.line;
      for (let i = currentLine; i >= 0; i--) {
        const lineText = activeEditor.document.lineAt(i).text;
        for (const sName of sceneNames) {
          if (lineText.includes(`"${sName}"`) && lineText.includes(":")) {
            targetScenes = [sName];
            break;
          }
        }
        if (targetScenes) break;
      }
    }
  }
  if (!targetScenes) {
    const currentActiveScenes = sceneStateManager.getActiveScenes();
    const items = sceneNames.map((name) => ({
      label: name,
      description: vscode8.l10n.t("{0} breakpoint(s)", config.scenes[name]?.length || 0),
      picked: currentActiveScenes.includes(name)
    }));
    const picked = await vscode8.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: vscode8.l10n.t("Select one or more debug scenes to activate (check to layer breakpoints)")
    });
    if (picked === void 0) return;
    targetScenes = picked.map((it) => it.label);
  }
  if (targetScenes.length === 0) {
    await clearAllCommand();
    return;
  }
  const validTargetScenes = [];
  const missingScenes = [];
  for (const target of targetScenes) {
    const matched = sceneNames.find((s) => s.toLowerCase() === target.toLowerCase());
    if (matched) {
      validTargetScenes.push(matched);
    } else {
      missingScenes.push(target);
    }
  }
  if (validTargetScenes.length === 0) {
    vscode8.window.showErrorMessage(
      vscode8.l10n.t("Scene(s) [{0}] not found in debug-scenes.json", missingScenes.join(", "))
    );
    return;
  }
  if (missingScenes.length > 0) {
    vscode8.window.showWarningMessage(
      vscode8.l10n.t("Scene(s) [{0}] not found and skipped", missingScenes.join(", "))
    );
  }
  targetScenes = validTargetScenes;
  const currentActive = sceneStateManager.getActiveScene();
  const isDirty = sceneStateManager.getIsDirty();
  if (currentActive && isDirty) {
    const actionAppend = vscode8.l10n.t("Save & Append to [{0}]", currentActive);
    const actionDiscard = vscode8.l10n.t("Discard Temporary Breakpoints");
    const chosen = await vscode8.window.showWarningMessage(
      vscode8.l10n.t(
        "Workspace has unsaved temporary breakpoints in scene [{0}]. What would you like to do before switching/reloading?",
        currentActive
      ),
      { modal: true },
      actionAppend,
      actionDiscard
    );
    if (!chosen) return;
    if (chosen === actionAppend) {
      const currentBps = await collectCurrentBreakpoints(workspaceRoot);
      config.scenes[currentActive] = currentBps;
      saveScenesConfig(workspaceRoot, config);
    }
  }
  const bpsToLoad = mergeScenesBreakpoints(config, targetScenes);
  const primarySceneLabel = targetScenes.length === 1 ? targetScenes[0] : targetScenes.join(" + ");
  const currentDiskActives = config.activeScenes;
  const isSameActive = Array.isArray(currentDiskActives) && currentDiskActives.length === targetScenes.length && currentDiskActives.every((s, i) => s === targetScenes[i]);
  if (!isSameActive) {
    config.activeScenes = targetScenes;
    syncCoordinator.markInternalSaving();
    saveScenesConfig(workspaceRoot, config);
  }
  const { loadedCount, healedCount, healedBreakpoints, unmatchedBreakpoints } = await applySceneBreakpoints(
    workspaceRoot,
    primarySceneLabel,
    bpsToLoad
  );
  sceneStateManager.setActiveScenes(targetScenes, loadedCount);
  if (healedCount > 0 && healedBreakpoints) {
    let hasPersisted = false;
    if (targetScenes.length === 1) {
      config.scenes[targetScenes[0]] = healedBreakpoints;
      hasPersisted = true;
    } else {
      for (const sceneName of targetScenes) {
        const sceneList = config.scenes[sceneName];
        if (!Array.isArray(sceneList)) continue;
        for (const item of sceneList) {
          if (item.type === "function") continue;
          const srcItem = item;
          const matched = healedBreakpoints.find(
            (h) => h.type !== "function" && h.file === srcItem.file && h.contextSnippet?.current === srcItem.contextSnippet?.current
          );
          if (matched && srcItem.line !== matched.line) {
            srcItem.line = matched.line;
            hasPersisted = true;
          }
        }
      }
    }
    if (hasPersisted) {
      saveScenesConfig(workspaceRoot, config);
    }
  }
  if (unmatchedBreakpoints && unmatchedBreakpoints.length > 0) {
    const count = unmatchedBreakpoints.length;
    const firstItem = unmatchedBreakpoints[0];
    const summary = unmatchedBreakpoints.slice(0, 3).map((bp) => `${path6.basename(bp.file)}:${bp.line}`).join(", ");
    const more = count > 3 ? ` \u7B49 ${count} \u5904` : "";
    const viewAction = vscode8.l10n.t("Locate Code");
    vscode8.window.showWarningMessage(
      vscode8.l10n.t(
        "Scene [{0}] activated, but {1} breakpoint(s) could not match code (fell back to original lines): {2}{3}",
        primarySceneLabel,
        count,
        summary,
        more
      ),
      viewAction
    ).then(async (selected) => {
      if (selected === viewAction && firstItem) {
        const fullPath = path6.isAbsolute(firstItem.file) ? firstItem.file : path6.join(workspaceRoot, firstItem.file);
        try {
          const doc = await vscode8.workspace.openTextDocument(fullPath);
          const editor = await vscode8.window.showTextDocument(doc);
          const pos = new vscode8.Position(Math.max(0, firstItem.line - 1), 0);
          editor.selection = new vscode8.Selection(pos, pos);
          editor.revealRange(new vscode8.Range(pos, pos), vscode8.TextEditorRevealType.InCenter);
        } catch {
        }
      }
    });
  } else if (healedCount > 0) {
    vscode8.window.showInformationMessage(
      vscode8.l10n.t(
        "Scene(s) [{0}] activated! Loaded {1} breakpoint(s) (Auto-healed {2} drifted line(s)).",
        primarySceneLabel,
        loadedCount,
        healedCount
      )
    );
  } else {
    vscode8.window.showInformationMessage(
      vscode8.l10n.t(
        "Scene(s) [{0}] activated! Set {1} target breakpoint(s) and cleaned others.",
        primarySceneLabel,
        loadedCount
      )
    );
  }
}

// src/commands/exportScene.ts
var vscode9 = __toESM(require("vscode"));
async function exportSceneCommand() {
  const currentBreakpoints = vscode9.debug.breakpoints;
  if (!currentBreakpoints || currentBreakpoints.length === 0) {
    vscode9.window.showWarningMessage(vscode9.l10n.t("No active breakpoints found in current workspace. Please set some breakpoints first."));
    return;
  }
  const workspaceRoot = getWorkspaceRoot(true);
  if (!workspaceRoot) return;
  const sceneName = await vscode9.window.showInputBox({
    prompt: vscode9.l10n.t("Enter scene identifier to export current breakpoints to (e.g. order-flow-debug)"),
    placeHolder: "order-flow-debug",
    validateInput: (value) => {
      if (!value || !value.trim()) return vscode9.l10n.t("Scene name cannot be empty");
      return null;
    }
  });
  if (!sceneName || !sceneName.trim()) return;
  const targetScene = sceneName.trim();
  const exportedBps = await collectCurrentBreakpoints(workspaceRoot);
  const config = loadScenesConfig(workspaceRoot);
  if (config.scenes[targetScene] && config.scenes[targetScene].length > 0) {
    const action = await vscode9.window.showQuickPick(
      [
        { label: vscode9.l10n.t("Overwrite Existing Scene"), value: "overwrite" },
        { label: vscode9.l10n.t("Append to Existing Scene"), value: "append" }
      ],
      {
        placeHolder: vscode9.l10n.t("Scene [{0}] already exists. Choose action:", targetScene)
      }
    );
    if (!action) return;
    if (action.value === "append") {
      for (const bp of exportedBps) {
        upsertBreakpointToScene(config, targetScene, bp);
      }
    } else {
      config.scenes[targetScene] = exportedBps;
    }
  } else {
    config.scenes[targetScene] = exportedBps;
  }
  saveScenesConfig(workspaceRoot, config);
  sceneStateManager.setActiveScene(targetScene, exportedBps.length);
  await vscode9.commands.executeCommand("sceneBreakpoints.refreshView");
  vscode9.window.showInformationMessage(
    vscode9.l10n.t("Successfully exported {0} active breakpoint(s) to scene [{1}]!", exportedBps.length, targetScene)
  );
}

// src/commands/showMenu.ts
var fs4 = __toESM(require("node:fs"));
var vscode12 = __toESM(require("vscode"));

// src/commands/clipboardSync.ts
var vscode11 = __toESM(require("vscode"));

// src/sceneTreeProvider.ts
var path7 = __toESM(require("node:path"));
var vscode10 = __toESM(require("vscode"));
var SceneNode = class _SceneNode extends vscode10.TreeItem {
  constructor(sceneName, breakpointCount, isActive, isDirty) {
    const isExpanded = _SceneNode.expandedScenes.has(sceneName) || isActive;
    super(
      sceneName,
      isExpanded ? vscode10.TreeItemCollapsibleState.Expanded : vscode10.TreeItemCollapsibleState.Collapsed
    );
    this.sceneName = sceneName;
    this.breakpointCount = breakpointCount;
    this.isActive = isActive;
    this.isDirty = isDirty;
    let desc = vscode10.l10n.t("{0} breakpoint(s)", breakpointCount);
    if (isActive) {
      desc = isDirty ? `${desc}  \u2022  ${vscode10.l10n.t("(Active - Unsaved*)")}` : `${desc}  \u2022  ${vscode10.l10n.t("(Active)")}`;
    }
    this.description = desc;
    if (isActive) {
      this.iconPath = new vscode10.ThemeIcon("debug-alt", new vscode10.ThemeColor("charts.green"));
      this.contextValue = "activeSceneItem";
    } else {
      this.iconPath = new vscode10.ThemeIcon("symbol-event");
      this.contextValue = "sceneItem";
    }
    this.id = `scene:${sceneName}`;
    this.tooltip = vscode10.l10n.t("Scene: [{0}] ({1} breakpoints)", sceneName, breakpointCount);
  }
  sceneName;
  breakpointCount;
  isActive;
  isDirty;
  static expandedScenes = /* @__PURE__ */ new Set();
};
var BreakpointNode = class extends vscode10.TreeItem {
  constructor(sceneName, index, breakpoint, workspaceRoot, extensionPath) {
    const isFunc = breakpoint.type === "function";
    const label = isFunc ? `\u0192 ${breakpoint.functionName}()` : `${path7.basename(breakpoint.file || "")}:${breakpoint.line}`;
    super(label, vscode10.TreeItemCollapsibleState.None);
    this.sceneName = sceneName;
    this.index = index;
    this.breakpoint = breakpoint;
    this.extensionPath = extensionPath;
    const bpIdentifier = isFunc ? breakpoint.functionName : `${breakpoint.file}:${breakpoint.line}`;
    this.id = `bp:${sceneName}:${index}:${bpIdentifier}`;
    this.updateAppearance();
    if (isFunc) {
      const funcBp = breakpoint;
      this.description = funcBp.desc || funcBp.condition || funcBp.hitCondition;
      this.tooltip = vscode10.l10n.t("Function Breakpoint: {0}", funcBp.functionName);
    } else {
      const srcBp = breakpoint;
      const isUnmatched = sceneStateManager.isSceneActive(sceneName) && sceneStateManager.isBreakpointUnmatched(srcBp.file, srcBp.line);
      let extra = srcBp.desc;
      if (!extra) {
        if (srcBp.type === "condition") extra = `? ${srcBp.condition}`;
        else if (srcBp.type === "hitCount") extra = `# ${srcBp.hitCondition}`;
        else if (srcBp.type === "logpoint") extra = `log: "${srcBp.logMessage}"`;
      }
      if (isUnmatched) {
        const unmatchTag = `[${vscode10.l10n.t("Unmatched")}]`;
        extra = extra ? `${unmatchTag}  \u2022  ${extra}` : unmatchTag;
      }
      this.description = extra;
      let tip = `${srcBp.file}:${srcBp.line}${srcBp.desc ? `
${srcBp.desc}` : ""}`;
      if (isUnmatched) {
        tip = `[${vscode10.l10n.t("Unmatched")}] ${vscode10.l10n.t("Could not match current code (fell back to original line)")}
${tip}`;
      }
      this.tooltip = tip;
      const fullFilePath = path7.isAbsolute(srcBp.file) ? srcBp.file : path7.join(workspaceRoot, srcBp.file);
      const targetLine = Math.max(0, srcBp.line - 1);
      this.command = {
        command: "vscode.open",
        title: vscode10.l10n.t("Open File"),
        arguments: [
          vscode10.Uri.file(fullFilePath),
          {
            selection: new vscode10.Range(targetLine, 0, targetLine, 0),
            preview: true
          }
        ]
      };
    }
  }
  sceneName;
  index;
  breakpoint;
  extensionPath;
  updateAppearance() {
    const isEnabled = this.breakpoint.enabled ?? true;
    this.checkboxState = isEnabled ? vscode10.TreeItemCheckboxState.Checked : vscode10.TreeItemCheckboxState.Unchecked;
    const isUnmatched = this.breakpoint.type !== "function" && sceneStateManager.isSceneActive(this.sceneName) && sceneStateManager.isBreakpointUnmatched(
      this.breakpoint.file,
      this.breakpoint.line
    );
    if (isUnmatched) {
      const iconFileName2 = isEnabled ? "bp-unmatched-enabled.svg" : "bp-unmatched-disabled.svg";
      this.iconPath = vscode10.Uri.file(path7.join(this.extensionPath, "media", "icons", iconFileName2));
      this.contextValue = isEnabled ? "breakpointItemEnabled" : "breakpointItemDisabled";
      return;
    }
    let iconBase = "bp-line";
    if (this.breakpoint.type === "function") {
      iconBase = "bp-func";
    } else {
      const srcBp = this.breakpoint;
      switch (srcBp.type) {
        case "condition":
          iconBase = "bp-cond";
          break;
        case "hitCount":
          iconBase = "bp-hit";
          break;
        case "logpoint":
          iconBase = "bp-log";
          break;
        case "line":
        default:
          iconBase = "bp-line";
          break;
      }
    }
    const iconFileName = `${iconBase}-${isEnabled ? "enabled" : "disabled"}.svg`;
    this.iconPath = vscode10.Uri.file(path7.join(this.extensionPath, "media", "icons", iconFileName));
    this.contextValue = isEnabled ? "breakpointItemEnabled" : "breakpointItemDisabled";
  }
};
var PlaceholderNode = class extends vscode10.TreeItem {
  constructor(message, icon = "info") {
    super(message, vscode10.TreeItemCollapsibleState.None);
    this.iconPath = new vscode10.ThemeIcon(icon);
    this.contextValue = "placeholderItem";
  }
};
var SceneTreeDataProvider = class {
  constructor(extensionPath = "") {
    this.extensionPath = extensionPath;
  }
  extensionPath;
  _onDidChangeTreeData = new vscode10.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  refresh(element) {
    this._onDidChangeTreeData.fire(element);
  }
  getTreeItem(element) {
    if (element instanceof BreakpointNode) {
      element.updateAppearance();
    }
    return element;
  }
  async getChildren(element) {
    const workspaceRoot = getWorkspaceRoot(false);
    if (!workspaceRoot) {
      return [new PlaceholderNode(vscode10.l10n.t("Open a workspace folder to view scenes"))];
    }
    if (!element) {
      const config = loadScenesConfig(workspaceRoot);
      const sceneNames = Object.keys(config.scenes || {});
      if (sceneNames.length === 0) {
        return [
          new PlaceholderNode(
            vscode10.l10n.t("No scenes yet. Click + to create or export breakpoints"),
            "add"
          )
        ];
      }
      const activeScenes = sceneStateManager.getActiveScenes();
      const isDirty = sceneStateManager.getIsDirty();
      return sceneNames.map((name) => {
        const bps = config.scenes && Array.isArray(config.scenes[name]) ? config.scenes[name] : [];
        const isActive = activeScenes.includes(name);
        return new SceneNode(name, bps.length, isActive, isDirty && isActive);
      });
    }
    if (element instanceof SceneNode) {
      const config = loadScenesConfig(workspaceRoot);
      const list = config.scenes && Array.isArray(config.scenes[element.sceneName]) ? config.scenes[element.sceneName] : [];
      if (list.length === 0) {
        return [new PlaceholderNode(vscode10.l10n.t("No breakpoints in this scene"))];
      }
      return list.map((bp, idx) => new BreakpointNode(element.sceneName, idx, bp, workspaceRoot, this.extensionPath));
    }
    return [];
  }
};

// src/commands/clipboardSync.ts
async function copySceneToClipboardCommand(target) {
  const workspaceRoot = getWorkspaceRoot(true);
  if (!workspaceRoot) return;
  const config = loadScenesConfig(workspaceRoot);
  const sceneNames = Object.keys(config.scenes || {});
  if (sceneNames.length === 0) {
    vscode11.window.showWarningMessage(vscode11.l10n.t("No scenes configured in debug-scenes.json yet"));
    return;
  }
  let targetScene;
  if (target) {
    if (typeof target === "string") {
      targetScene = target.trim();
    } else if (target.sceneName) {
      targetScene = target.sceneName;
    }
  }
  if (!targetScene) {
    const picked = await vscode11.window.showQuickPick(
      sceneNames.map((name) => ({
        label: `$(symbol-event) ${name}`,
        description: vscode11.l10n.t("{0} breakpoint(s)", config.scenes[name]?.length || 0),
        sceneName: name
      })),
      {
        placeHolder: vscode11.l10n.t("Select a scene to copy to clipboard")
      }
    );
    if (!picked) return;
    targetScene = picked.sceneName;
  }
  const breakpoints = config.scenes[targetScene] || [];
  if (breakpoints.length === 0) {
    vscode11.window.showWarningMessage(
      vscode11.l10n.t("Scene [{0}] has no breakpoints to copy.", targetScene)
    );
    return;
  }
  const payloadStr = serializeScenePayload(targetScene, breakpoints);
  await vscode11.env.clipboard.writeText(payloadStr);
  vscode11.window.showInformationMessage(
    vscode11.l10n.t("Scene [{0}] copied to clipboard ({1} breakpoint(s))!", targetScene, breakpoints.length)
  );
}
async function importSceneFromClipboardCommand() {
  const workspaceRoot = getWorkspaceRoot(true);
  if (!workspaceRoot) return;
  const clipboardText = await vscode11.env.clipboard.readText();
  if (!clipboardText || !clipboardText.trim()) {
    vscode11.window.showWarningMessage(
      vscode11.l10n.t("Clipboard is empty or does not contain valid text.")
    );
    return;
  }
  const parseResult = parseScenePayload(clipboardText);
  if (!parseResult.success) {
    const viewFormatAction = vscode11.l10n.t("View Supported Formats");
    const action = await vscode11.window.showErrorMessage(
      vscode11.l10n.t("Failed to import scene from clipboard: {0}", parseResult.error),
      viewFormatAction
    );
    if (action === viewFormatAction) {
      const doc = await vscode11.workspace.openTextDocument({
        language: "jsonc",
        content: getSupportedFormatsTemplate()
      });
      await vscode11.window.showTextDocument(doc, { preview: true });
    }
    return;
  }
  const config = loadScenesConfig(workspaceRoot);
  let finalSceneName = parseResult.sceneName;
  const importedBreakpoints = parseResult.breakpoints;
  if (config.scenes[finalSceneName] && config.scenes[finalSceneName].length > 0) {
    const action = await vscode11.window.showQuickPick(
      [
        {
          label: vscode11.l10n.t("Overwrite Existing Scene"),
          description: vscode11.l10n.t("Replace existing [{0}] completely", finalSceneName),
          value: "overwrite"
        },
        {
          label: vscode11.l10n.t("Append & Merge Breakpoints"),
          description: vscode11.l10n.t("Keep existing breakpoints and upsert imported ones", finalSceneName),
          value: "append"
        },
        {
          label: vscode11.l10n.t("Rename Imported Scene"),
          description: vscode11.l10n.t("Save under a new scene name", finalSceneName),
          value: "rename"
        }
      ],
      {
        placeHolder: vscode11.l10n.t("Scene [{0}] already exists. Choose action:", finalSceneName)
      }
    );
    if (!action) return;
    if (action.value === "rename") {
      const newName = await vscode11.window.showInputBox({
        prompt: vscode11.l10n.t("Enter new scene identifier (e.g. user-login or auth-verify)"),
        value: `${finalSceneName}-copy`,
        validateInput: (val) => {
          if (!val || !val.trim()) return vscode11.l10n.t("Scene name cannot be empty");
          return null;
        }
      });
      if (!newName || !newName.trim()) return;
      finalSceneName = newName.trim();
      config.scenes[finalSceneName] = importedBreakpoints;
    } else if (action.value === "append") {
      for (const bp of importedBreakpoints) {
        upsertBreakpointToScene(config, finalSceneName, bp);
      }
    } else {
      config.scenes[finalSceneName] = importedBreakpoints;
    }
  } else {
    config.scenes[finalSceneName] = importedBreakpoints;
  }
  SceneNode.expandedScenes.add(finalSceneName);
  saveScenesConfig(workspaceRoot, config);
  await vscode11.commands.executeCommand("sceneBreakpoints.refreshView");
  if (sceneStateManager.isSceneActive(finalSceneName)) {
    const activeScenes = sceneStateManager.getActiveScenes();
    const merged = mergeScenesBreakpoints(config, activeScenes);
    await applySceneBreakpoints(workspaceRoot, activeScenes.join("+"), merged);
    sceneStateManager.setActiveScenes(activeScenes, merged.length);
  }
  const activateAction = vscode11.l10n.t("Activate Scene");
  const choice = await vscode11.window.showInformationMessage(
    vscode11.l10n.t(
      "Successfully imported scene [{0}] with {1} breakpoint(s)!",
      finalSceneName,
      config.scenes[finalSceneName].length
    ),
    activateAction
  );
  if (choice === activateAction) {
    await applySceneCommand(finalSceneName);
  }
}

// src/commands/showMenu.ts
async function showMenuCommand() {
  const workspaceRoot = getWorkspaceRoot(true);
  if (!workspaceRoot) return;
  const config = loadScenesConfig(workspaceRoot);
  const sceneNames = Object.keys(config.scenes || {});
  const activeScenes = sceneStateManager.getActiveScenes();
  const isDirty = sceneStateManager.getIsDirty();
  const items = [];
  if (sceneNames.length > 0) {
    for (const name of sceneNames) {
      const bps = config.scenes[name] || [];
      const isActive = activeScenes.includes(name);
      let label = isActive ? `\u{1F7E2} ${name}` : `\u26AA ${name}`;
      if (isActive && isDirty) {
        label = `\u{1F7E2} ${name}*`;
      }
      let description;
      if (isActive) {
        description = isDirty ? vscode12.l10n.t("(Active - Unsaved)") : vscode12.l10n.t("(Active)");
      }
      items.push({
        label,
        description,
        detail: vscode12.l10n.t("{0} breakpoint(s)", bps.length),
        action: "switch",
        sceneName: name
      });
    }
  } else {
    items.push({
      label: `$(info) ${vscode12.l10n.t("No scenes configured yet")}`,
      description: vscode12.l10n.t("Add breakpoints or export active ones to create a scene")
    });
  }
  items.push({
    label: vscode12.l10n.t("Quick Actions"),
    kind: vscode12.QuickPickItemKind.Separator
  });
  items.push(
    {
      label: `$(checklist) ${vscode12.l10n.t("Multi-Select Scenes to Activate...")}`,
      description: vscode12.l10n.t("Check multiple scenes to layer breakpoints together"),
      action: "multiSelect"
    },
    {
      label: `$(cloud-upload) ${vscode12.l10n.t("Export Active Breakpoints as Scene...")}`,
      description: vscode12.l10n.t("Save current editor breakpoints into debug-scenes.json"),
      action: "export"
    },
    {
      label: `$(cloud-download) ${vscode12.l10n.t("Import Scene from Clipboard...")}`,
      description: vscode12.l10n.t("Parse and import scene breakpoints from clipboard"),
      action: "importClipboard"
    },
    {
      label: `$(clear-all) ${vscode12.l10n.t("Clear All Breakpoints")}`,
      description: vscode12.l10n.t("Clear all breakpoints from current workspace"),
      action: "clear"
    },
    {
      label: `$(file-code) ${vscode12.l10n.t("Open debug-scenes.json")}`,
      description: vscode12.l10n.t("Edit configuration file directly"),
      action: "openConfig"
    }
  );
  const quickPick = vscode12.window.createQuickPick();
  quickPick.items = items;
  quickPick.placeholder = vscode12.l10n.t("Select a scene to activate, or choose a management action");
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  const firstActive = activeScenes[0];
  if (firstActive) {
    const activeItem = items.find((it) => it.action === "switch" && it.sceneName === firstActive);
    if (activeItem) {
      quickPick.activeItems = [activeItem];
    }
  }
  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    quickPick.hide();
    if (!selected || !selected.action) return;
    switch (selected.action) {
      case "multiSelect":
        await applySceneCommand();
        break;
      case "switch":
        if (selected.sceneName) {
          await applySceneCommand(selected.sceneName);
        }
        break;
      case "export":
        await exportSceneCommand();
        break;
      case "importClipboard":
        await importSceneFromClipboardCommand();
        break;
      case "clear":
        await clearAllCommand();
        break;
      case "openConfig": {
        const configPath = getScenesConfigPath(workspaceRoot);
        if (!fs4.existsSync(configPath)) {
          saveScenesConfig(workspaceRoot, { scenes: {} });
        }
        const doc = await vscode12.workspace.openTextDocument(configPath);
        await vscode12.window.showTextDocument(doc);
        break;
      }
    }
  });
  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

// src/commands/skillCommands.ts
var fs5 = __toESM(require("node:fs"));
var path8 = __toESM(require("node:path"));
var vscode13 = __toESM(require("vscode"));
function formatSkillContent(baseContent, target) {
  if (target.customHeader) {
    const baseStr = Buffer.from(baseContent).toString("utf-8");
    return Buffer.from(target.customHeader + baseStr, "utf-8");
  }
  return baseContent;
}
async function writeSkillToTarget(context, workspaceRoot, target) {
  const skillSourceUri = vscode13.Uri.joinPath(
    context.extensionUri,
    "skills",
    "manage-scenes",
    "SKILL.md"
  );
  let content;
  try {
    content = await vscode13.workspace.fs.readFile(skillSourceUri);
  } catch (error) {
    vscode13.window.showErrorMessage(
      vscode13.l10n.t("Failed to read built-in Skill template: {0}", String(error))
    );
    return false;
  }
  const targetDirUri = vscode13.Uri.file(path8.join(workspaceRoot, target.dir));
  const targetFileUri = vscode13.Uri.file(path8.join(workspaceRoot, target.dir, target.file));
  const targetContent = formatSkillContent(content, target);
  try {
    await vscode13.workspace.fs.createDirectory(targetDirUri);
    await vscode13.workspace.fs.writeFile(targetFileUri, targetContent);
    return true;
  } catch (error) {
    vscode13.window.showErrorMessage(
      vscode13.l10n.t("Failed to write Skill file: {0}", String(error))
    );
    return false;
  }
}
async function installSkillCommand(context) {
  const workspaceRoot = getWorkspaceRoot(true);
  if (!workspaceRoot) {
    vscode13.window.showErrorMessage(vscode13.l10n.t("Please open a workspace folder first."));
    return;
  }
  const targets = await pickSkillTargets(workspaceRoot);
  if (!targets || targets.length === 0) {
    return;
  }
  for (const target of targets) {
    const success = await writeSkillToTarget(context, workspaceRoot, target);
    if (!success) return;
  }
  vscode13.window.showInformationMessage(
    vscode13.l10n.t("Scene Breakpoints Skill successfully deployed to target directory.")
  );
}
async function diagnoseAiIntegrationCommand(context) {
  const workspaceRoot = getWorkspaceRoot(true);
  if (!workspaceRoot) {
    vscode13.window.showErrorMessage(vscode13.l10n.t("Please open a workspace folder first."));
    return;
  }
  const config = vscode13.workspace.getConfiguration("sceneBreakpoints");
  const allowAiActivation = config.get("allowAiFileActivation", false);
  const activeScenes = sceneStateManager.getActiveScenes();
  const targetItems = getSupportedSkillTargets();
  const diagnostics = [];
  diagnostics.push({
    label: allowAiActivation ? `$(pass) ${vscode13.l10n.t("AI File Activation: Enabled")}` : `$(warning) ${vscode13.l10n.t("AI File Activation: Disabled (Click to Enable)")}`,
    description: allowAiActivation ? vscode13.l10n.t("AI Agent can declaratively activate scenes via activeScenes") : vscode13.l10n.t("External activeScenes modifications are currently ignored"),
    action: async () => {
      if (!allowAiActivation) {
        await config.update("allowAiFileActivation", true, vscode13.ConfigurationTarget.Workspace);
        vscode13.window.showInformationMessage(
          vscode13.l10n.t("AI File Activation has been enabled for this workspace.")
        );
      }
    }
  });
  diagnostics.push({
    label: `$(symbol-event) ${vscode13.l10n.t("Active Scenes: [{0}]", activeScenes.length > 0 ? activeScenes.join(", ") : "None")}`,
    description: vscode13.l10n.t("Current effective breakpoint scenes")
  });
  diagnostics.push({
    label: vscode13.l10n.t("Skill Deployment Status across Platforms:"),
    kind: vscode13.QuickPickItemKind.Separator
  });
  for (const target of targetItems) {
    const fullPath = path8.join(workspaceRoot, target.dir, target.file);
    const exists = fs5.existsSync(fullPath);
    diagnostics.push({
      label: exists ? `$(check) ${target.label}` : `$(add) ${target.label} (${vscode13.l10n.t("Click to Install")})`,
      description: target.description,
      detail: exists ? vscode13.l10n.t("Installed: {0}", fullPath) : vscode13.l10n.t("Not installed yet"),
      action: async () => {
        if (!exists) {
          const success = await writeSkillToTarget(context, workspaceRoot, target);
          if (success) {
            vscode13.window.showInformationMessage(
              vscode13.l10n.t("Skill installed to {0}", target.label)
            );
          }
        }
      }
    });
  }
  const selected = await vscode13.window.showQuickPick(diagnostics, {
    placeHolder: vscode13.l10n.t("Scene Breakpoints AI Integration Diagnostics")
  });
  if (selected?.action) {
    await selected.action();
  }
}
function getSupportedSkillTargets() {
  return [
    // 1. Cursor IDE 专属 MDC 规则体系
    {
      label: "Cursor",
      description: ".cursor/rules/manage-scenes.mdc",
      dir: ".cursor/rules",
      file: "manage-scenes.mdc",
      customHeader: `---
description: Manage and declare breakpoint scenes for debugging
globs: **
---

`
    },
    // 2. Windsurf (Codeium) 级联规则体系
    {
      label: "Windsurf",
      description: ".windsurf/rules/manage-scenes.md",
      dir: ".windsurf/rules",
      file: "manage-scenes.md"
    },
    // 3. Cline (Claude Dev) 自主 Agent 规则体系
    {
      label: "Cline",
      description: ".clinerules/manage-scenes.md",
      dir: ".clinerules",
      file: "manage-scenes.md"
    },
    // 4. Roo Code (Roo Cline) 规则体系
    {
      label: "Roo Code",
      description: ".roorules/manage-scenes.md",
      dir: ".roorules",
      file: "manage-scenes.md"
    },
    // 5. Continue.dev 开源 Agent 提示词体系
    {
      label: "Continue",
      description: ".continue/prompts/manage-scenes.prompt",
      dir: ".continue/prompts",
      file: "manage-scenes.prompt"
    },
    // 6. VS Code / GitHub Copilot 官方 Skills 体系
    // TODO(v1.0.4): VS Code Copilot Skill 路径待官方稳定后验证，当前为推测路径
    {
      label: "VS Code / GitHub Copilot",
      description: ".github/skills/manage-scenes/SKILL.md",
      dir: ".github/skills/manage-scenes",
      file: "SKILL.md"
    },
    // 7. Trae IDE 技能体系
    // TODO(v1.0.4): Trae 的 Skill 格式规范待官方文档明确，当前直接复用标准 SKILL.md
    {
      label: "Trae IDE",
      description: ".trae/skills/manage-scenes/SKILL.md",
      dir: ".trae/skills/manage-scenes",
      file: "SKILL.md"
    },
    // 8. Antigravity 工作区 Skill 体系
    {
      label: "Antigravity",
      description: ".agents/skills/manage-scenes/SKILL.md",
      dir: ".agents/skills/manage-scenes",
      file: "SKILL.md"
    }
  ];
}
async function pickSkillTargets(workspaceRoot) {
  const items = getSupportedSkillTargets();
  for (const item of items) {
    const fullPath = path8.join(workspaceRoot, item.dir, item.file);
    if (fs5.existsSync(fullPath)) {
      item.description = `${item.description} (${vscode13.l10n.t("Installed")})`;
      item.picked = true;
    }
  }
  return await vscode13.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: vscode13.l10n.t("Select target AI Agent environments to install Skill")
  });
}

// src/commands/treeCommands.ts
var vscode14 = __toESM(require("vscode"));
function registerTreeCommands(context, treeDataProvider) {
  const refreshViewCmd = vscode14.commands.registerCommand("sceneBreakpoints.refreshView", () => {
    treeDataProvider.refresh();
  });
  const createNewSceneCmd = vscode14.commands.registerCommand("sceneBreakpoints.createNewScene", async () => {
    const workspaceRoot = getWorkspaceRoot(true);
    if (!workspaceRoot) return;
    const sceneName = await vscode14.window.showInputBox({
      prompt: vscode14.l10n.t("Enter new scene identifier (e.g. auth-flow)"),
      placeHolder: "auth-flow",
      validateInput: (v) => !v || !v.trim() ? vscode14.l10n.t("Scene name cannot be empty") : null
    });
    if (!sceneName) return;
    const config = loadScenesConfig(workspaceRoot);
    const target = sceneName.trim();
    if (!config.scenes[target]) {
      config.scenes[target] = [];
      syncCoordinator.markInternalSaving();
      saveScenesConfig(workspaceRoot, config);
      treeDataProvider.refresh();
      vscode14.window.showInformationMessage(vscode14.l10n.t("Created empty scene [{0}]", target));
    } else {
      vscode14.window.showWarningMessage(vscode14.l10n.t("Scene [{0}] already exists", target));
    }
  });
  const applySceneItemCmd = vscode14.commands.registerCommand(
    "sceneBreakpoints.applySceneItem",
    async (node) => {
      if (node && node.sceneName) {
        const nextScenes = sceneStateManager.toggleScene(node.sceneName);
        await applySceneCommand(nextScenes);
      }
    }
  );
  const toggleSceneActivationCmd = vscode14.commands.registerCommand(
    "sceneBreakpoints.toggleSceneActivation",
    async (node) => {
      if (node && node.sceneName) {
        const nextScenes = sceneStateManager.toggleScene(node.sceneName);
        await applySceneCommand(nextScenes);
      }
    }
  );
  const renameSceneItemCmd = vscode14.commands.registerCommand(
    "sceneBreakpoints.renameSceneItem",
    async (node) => {
      if (!node || !node.sceneName) return;
      const workspaceRoot = getWorkspaceRoot(true);
      if (!workspaceRoot) return;
      const newName = await vscode14.window.showInputBox({
        prompt: vscode14.l10n.t("Enter new identifier for scene [{0}]", node.sceneName),
        value: node.sceneName,
        validateInput: (v) => !v || !v.trim() ? vscode14.l10n.t("Scene name cannot be empty") : null
      });
      if (!newName || newName.trim() === node.sceneName) return;
      const config = loadScenesConfig(workspaceRoot);
      const renamed = renameSceneInConfig(config, node.sceneName, newName.trim());
      if (renamed) {
        syncCoordinator.markInternalSaving();
        saveScenesConfig(workspaceRoot, config);
        const currentActives = sceneStateManager.getActiveScenes();
        if (currentActives.includes(node.sceneName)) {
          const updated = currentActives.map((s) => s === node.sceneName ? newName.trim() : s);
          sceneStateManager.setActiveScenes(updated);
        }
        treeDataProvider.refresh();
        vscode14.window.showInformationMessage(
          vscode14.l10n.t("Renamed scene [{0}] to [{1}]", node.sceneName, newName.trim())
        );
      }
    }
  );
  const deleteSceneItemCmd = vscode14.commands.registerCommand(
    "sceneBreakpoints.deleteSceneItem",
    async (node) => {
      if (!node || !node.sceneName) return;
      const workspaceRoot = getWorkspaceRoot(true);
      if (!workspaceRoot) return;
      const confirmText = vscode14.l10n.t("Delete");
      const choice = await vscode14.window.showWarningMessage(
        vscode14.l10n.t("Are you sure you want to delete scene [{0}]? This action cannot be undone.", node.sceneName),
        { modal: true },
        confirmText
      );
      if (choice !== confirmText) return;
      const config = loadScenesConfig(workspaceRoot);
      const deleted = deleteSceneFromConfig(config, node.sceneName);
      if (deleted) {
        syncCoordinator.markInternalSaving();
        saveScenesConfig(workspaceRoot, config);
        const currentActives = sceneStateManager.getActiveScenes();
        if (currentActives.includes(node.sceneName)) {
          const remaining = currentActives.filter((s) => s !== node.sceneName);
          sceneStateManager.setActiveScenes(remaining);
        }
        treeDataProvider.refresh();
        vscode14.window.showInformationMessage(vscode14.l10n.t("Deleted scene [{0}]", node.sceneName));
      }
    }
  );
  const removeBpItemCmd = vscode14.commands.registerCommand(
    "sceneBreakpoints.removeBreakpointItem",
    async (node) => {
      if (!node || typeof node.index !== "number" || !node.sceneName) return;
      const workspaceRoot = getWorkspaceRoot(true);
      if (!workspaceRoot) return;
      const config = loadScenesConfig(workspaceRoot);
      const removed = removeBreakpointFromConfig(config, node.sceneName, node.index);
      if (removed) {
        syncCoordinator.markInternalSaving();
        saveScenesConfig(workspaceRoot, config);
        treeDataProvider.refresh();
      }
    }
  );
  const toggleBpItemCmd = vscode14.commands.registerCommand(
    "sceneBreakpoints.toggleBreakpointItem",
    async (node) => {
      if (!node || typeof node.index !== "number" || !node.sceneName) return;
      const workspaceRoot = getWorkspaceRoot(true);
      if (!workspaceRoot) return;
      const config = loadScenesConfig(workspaceRoot);
      const toggled = toggleBreakpointEnabledInConfig(config, node.sceneName, node.index);
      if (toggled) {
        const updatedBp = config.scenes[node.sceneName]?.[node.index];
        if (updatedBp) {
          node.breakpoint.enabled = updatedBp.enabled;
          node.updateAppearance();
        }
        syncCoordinator.markInternalSaving();
        saveScenesConfig(workspaceRoot, config);
        treeDataProvider.refresh(node);
        if (updatedBp && sceneStateManager.isSceneActive(node.sceneName)) {
          await syncBreakpointEnabledToEditor(workspaceRoot, updatedBp, updatedBp.enabled ?? true);
        }
      }
    }
  );
  const enableAllBreakpointsInSceneCmd = vscode14.commands.registerCommand(
    "sceneBreakpoints.enableAllBreakpointsInScene",
    async (node) => {
      if (!node || !node.sceneName) return;
      const workspaceRoot = getWorkspaceRoot(true);
      if (!workspaceRoot) return;
      const config = loadScenesConfig(workspaceRoot);
      const changed = setAllBreakpointsEnabledInScene(config, node.sceneName, true);
      if (changed) {
        syncCoordinator.markInternalSaving();
        saveScenesConfig(workspaceRoot, config);
        treeDataProvider.refresh(node);
        if (sceneStateManager.isSceneActive(node.sceneName)) {
          const list = config.scenes[node.sceneName] || [];
          for (const bp of list) {
            await syncBreakpointEnabledToEditor(workspaceRoot, bp, true);
          }
        }
        vscode14.window.showInformationMessage(vscode14.l10n.t("Enabled all breakpoints in scene [{0}]", node.sceneName));
      }
    }
  );
  const disableAllBreakpointsInSceneCmd = vscode14.commands.registerCommand(
    "sceneBreakpoints.disableAllBreakpointsInScene",
    async (node) => {
      if (!node || !node.sceneName) return;
      const workspaceRoot = getWorkspaceRoot(true);
      if (!workspaceRoot) return;
      const config = loadScenesConfig(workspaceRoot);
      const changed = setAllBreakpointsEnabledInScene(config, node.sceneName, false);
      if (changed) {
        syncCoordinator.markInternalSaving();
        saveScenesConfig(workspaceRoot, config);
        treeDataProvider.refresh(node);
        if (sceneStateManager.isSceneActive(node.sceneName)) {
          const list = config.scenes[node.sceneName] || [];
          for (const bp of list) {
            await syncBreakpointEnabledToEditor(workspaceRoot, bp, false);
          }
        }
        vscode14.window.showInformationMessage(vscode14.l10n.t("Disabled all breakpoints in scene [{0}]", node.sceneName));
      }
    }
  );
  const duplicateSceneCmd = vscode14.commands.registerCommand(
    "sceneBreakpoints.duplicateScene",
    async (node) => {
      if (!node || !node.sceneName) return;
      const workspaceRoot = getWorkspaceRoot(true);
      if (!workspaceRoot) return;
      const defaultTargetName = `${node.sceneName}-copy`;
      const newName = await vscode14.window.showInputBox({
        prompt: vscode14.l10n.t("Enter target identifier for duplicated scene"),
        value: defaultTargetName,
        validateInput: (v) => !v || !v.trim() ? vscode14.l10n.t("Scene name cannot be empty") : null
      });
      if (!newName) return;
      const config = loadScenesConfig(workspaceRoot);
      const target = newName.trim();
      if (config.scenes[target]) {
        vscode14.window.showWarningMessage(vscode14.l10n.t("Scene [{0}] already exists", target));
        return;
      }
      const duplicated = duplicateSceneInConfig(config, node.sceneName, target);
      if (duplicated) {
        syncCoordinator.markInternalSaving();
        saveScenesConfig(workspaceRoot, config);
        treeDataProvider.refresh();
        vscode14.window.showInformationMessage(
          vscode14.l10n.t("Duplicated scene [{0}] as [{1}]", node.sceneName, target)
        );
      }
    }
  );
  context.subscriptions.push(
    refreshViewCmd,
    createNewSceneCmd,
    applySceneItemCmd,
    toggleSceneActivationCmd,
    renameSceneItemCmd,
    deleteSceneItemCmd,
    removeBpItemCmd,
    toggleBpItemCmd,
    enableAllBreakpointsInSceneCmd,
    disableAllBreakpointsInSceneCmd,
    duplicateSceneCmd
  );
}

// src/commands/index.ts
function registerAllCommands(context, deps) {
  const commands5 = [
    // 核心断点场景交互
    ["sceneBreakpoints.addBreakpoint", addBreakpointCommand],
    ["sceneBreakpoints.applyScene", applySceneCommand],
    ["sceneBreakpoints.clearAll", clearAllCommand],
    ["sceneBreakpoints.exportScene", exportSceneCommand],
    ["sceneBreakpoints.showMenu", showMenuCommand],
    // 剪贴板快速流转与团队共享
    ["sceneBreakpoints.copySceneToClipboard", copySceneToClipboardCommand],
    ["sceneBreakpoints.importSceneFromClipboard", importSceneFromClipboardCommand],
    // AI Agent 技能集成与状态诊断
    ["sceneBreakpoints.installSkill", () => installSkillCommand(context)],
    ["sceneBreakpoints.diagnoseAiIntegration", () => diagnoseAiIntegrationCommand(context)]
  ];
  for (const [commandId, handler] of commands5) {
    context.subscriptions.push(vscode15.commands.registerCommand(commandId, handler));
  }
  if (deps?.treeDataProvider) {
    registerTreeCommands(context, deps.treeDataProvider);
  }
}

// src/statusBar.ts
var vscode16 = __toESM(require("vscode"));
var statusBarItem;
function initStatusBarItem(context) {
  statusBarItem = vscode16.window.createStatusBarItem(vscode16.StatusBarAlignment.Left, 10);
  statusBarItem.command = "sceneBreakpoints.showMenu";
  renderStatusBar(sceneStateManager.getActiveScenes(), sceneStateManager.getIsDirty());
  statusBarItem.show();
  const sub = sceneStateManager.onDidChangeState((state) => {
    renderStatusBar(state.activeScenes, state.isDirty);
  });
  context.subscriptions.push(statusBarItem, sub);
  return statusBarItem;
}
function formatScenesLabel(scenes) {
  if (scenes.length === 0) return "(None)";
  if (scenes.length === 1) return `[${scenes[0]}]`;
  const fullLabel = `[${scenes.join(" + ")}]`;
  if (fullLabel.length <= 28) {
    return fullLabel;
  }
  if (scenes.length > 2) {
    const prefixTwo = `[${scenes[0]} + ${scenes[1]}, +${scenes.length - 2}]`;
    if (prefixTwo.length <= 28) {
      return prefixTwo;
    }
  }
  return `[${scenes[0]}, +${scenes.length - 1}]`;
}
function renderStatusBar(activeScenes, isDirty = false) {
  if (!statusBarItem) return;
  if (activeScenes.length > 0) {
    const label = formatScenesLabel(activeScenes);
    const fullNames = activeScenes.join(", ");
    if (isDirty) {
      statusBarItem.text = `$(circle-filled) Scene: ${label}*`;
      statusBarItem.color = "#cca700";
      statusBarItem.tooltip = vscode16.l10n.t(
        "Current Scene: [{0}] (Unsaved temporary breakpoints present. Click or Ctrl+Alt+S to open Menu)",
        fullNames
      );
    } else {
      statusBarItem.text = `$(circle-filled) Scene: ${label}`;
      statusBarItem.color = "#49c998";
      statusBarItem.tooltip = vscode16.l10n.t(
        "Current Scene: [{0}] (Click or Ctrl+Alt+S to open Scene Menu)",
        fullNames
      );
    }
  } else {
    statusBarItem.text = `$(circle-outline) Scene: (None)`;
    statusBarItem.color = void 0;
    statusBarItem.tooltip = vscode16.l10n.t("No scene active (Click or Ctrl+Alt+S to open Scene Menu)");
  }
}

// src/coordinators/aiActivationCoordinator.ts
var vscode17 = __toESM(require("vscode"));
async function handleExternalScenesFileChange(workspaceRoot) {
  const allowAiActivation = vscode17.workspace.getConfiguration("sceneBreakpoints").get("allowAiFileActivation", false);
  const config = loadScenesConfig(workspaceRoot);
  const currentActives = sceneStateManager.getActiveScenes();
  const diff = resolveActiveScenesDiff({
    allowAiActivation,
    currentActiveScenes: currentActives,
    rawActiveScenes: config.activeScenes,
    scenesDict: config.scenes
  });
  if (diff.shouldApply) {
    if (diff.action === "apply") {
      await applySceneCommand(diff.targetScenes);
    } else if (diff.action === "clear") {
      await clearAllCommand();
    }
  } else if (currentActives.length > 0 && !sceneStateManager.isApplyingScene()) {
    const merged = mergeScenesBreakpoints(config, currentActives);
    const newTopologyHash = computeBreakpointsTopologyHash(merged);
    if (newTopologyHash === sceneStateManager.getLastAppliedTopologyHash()) {
      return;
    }
    if (vscode17.debug.activeDebugSession) {
      sceneStateManager.setPendingTopologyUpdate(true);
      vscode17.window.setStatusBarMessage(
        vscode17.l10n.t("$(alert) Breakpoint changes pending. Will apply on next debug session."),
        5e3
      );
      return;
    }
    await applySceneBreakpoints(workspaceRoot, currentActives.join("+"), merged);
    sceneStateManager.setLastAppliedTopologyHash(newTopologyHash);
  }
}

// src/extension.ts
function activate(context) {
  initStatusBarItem(context);
  const treeDataProvider = new SceneTreeDataProvider(context.extensionPath);
  const treeView = vscode18.window.createTreeView("sceneBreakpointsView", {
    treeDataProvider,
    showCollapseAll: true
  });
  registerAllCommands(context, { treeDataProvider });
  const debugConfigProvider = vscode18.debug.registerDebugConfigurationProvider("*", {
    async resolveDebugConfiguration(folder, config) {
      const autoActivate = vscode18.workspace.getConfiguration("sceneBreakpoints").get("autoActivateOnLaunch", true);
      if (autoActivate && config) {
        const workspaceRoot = getWorkspaceRoot(false);
        if (workspaceRoot) {
          const scenesConfig = loadScenesConfig(workspaceRoot);
          const targetScenes = resolveLaunchBoundScenes(
            scenesConfig,
            config.name,
            config.env?.DEBUG_SCENE
          );
          if (targetScenes.length > 0) {
            const currentActives = sceneStateManager.getActiveScenes();
            const isIdentical = currentActives.length === targetScenes.length && currentActives.every((s, idx) => s === targetScenes[idx]);
            if (!isIdentical) {
              await applySceneCommand(targetScenes);
            }
          }
        }
      }
      return config;
    }
  });
  const codeLensProvider = vscode18.languages.registerCodeLensProvider(
    { pattern: "**/debug-scenes.json" },
    new SceneCodeLensProvider()
  );
  const bpChangeListener = vscode18.debug.onDidChangeBreakpoints(async (event) => {
    if (sceneStateManager.isApplyingScene()) {
      return;
    }
    const currentCount = vscode18.debug.breakpoints.length;
    if (currentCount === 0) {
      sceneStateManager.setActiveScene(void 0, 0);
      return;
    }
    if (event.changed && event.changed.length > 0) {
      const activeScenes = sceneStateManager.getActiveScenes();
      if (activeScenes.length > 0) {
        const workspaceRoot = getWorkspaceRoot(false);
        if (workspaceRoot) {
          const config = loadScenesConfig(workspaceRoot);
          const hasUpdated = syncEditorBreakpointChangesToConfig(
            config,
            activeScenes,
            event.changed,
            workspaceRoot
          );
          if (hasUpdated) {
            syncCoordinator.markInternalSaving();
            saveScenesConfig(workspaceRoot, config);
            treeDataProvider.refresh();
          }
        }
      }
    }
    sceneStateManager.checkDirtyWithCount(currentCount);
  });
  treeView.onDidExpandElement((e) => {
    if (e.element instanceof SceneNode) {
      SceneNode.expandedScenes.add(e.element.sceneName);
    }
  });
  treeView.onDidCollapseElement((e) => {
    if (e.element instanceof SceneNode) {
      SceneNode.expandedScenes.delete(e.element.sceneName);
    }
  });
  const stateChangeListener = sceneStateManager.onDidChangeState(() => {
    treeDataProvider.refresh();
  });
  const checkboxChangeListener = treeView.onDidChangeCheckboxState(async (e) => {
    const workspaceRoot = getWorkspaceRoot(true);
    if (!workspaceRoot) return;
    const config = loadScenesConfig(workspaceRoot);
    let hasChanges = false;
    const affectedBreakpoints = [];
    for (const [item, state] of e.items) {
      if (item instanceof BreakpointNode && item.sceneName && typeof item.index === "number") {
        const list = config.scenes[item.sceneName];
        if (list && list[item.index]) {
          const targetBp = list[item.index];
          const newEnabled = state === vscode18.TreeItemCheckboxState.Checked;
          if (targetBp.enabled !== newEnabled) {
            targetBp.enabled = newEnabled;
            item.breakpoint.enabled = newEnabled;
            hasChanges = true;
            affectedBreakpoints.push({ node: item, sceneName: item.sceneName, bp: targetBp });
          }
        }
      }
    }
    if (hasChanges) {
      syncCoordinator.markInternalSaving();
      saveScenesConfig(workspaceRoot, config);
      for (const { node } of affectedBreakpoints) {
        node.updateAppearance();
        treeDataProvider.refresh(node);
      }
      for (const { sceneName, bp } of affectedBreakpoints) {
        if (sceneStateManager.isSceneActive(sceneName)) {
          await syncBreakpointEnabledToEditor(workspaceRoot, bp, bp.enabled ?? true);
        }
      }
    }
  });
  let fileChangeDebounceTimer;
  const fileWatcher = vscode18.workspace.createFileSystemWatcher("**/debug-scenes.json");
  fileWatcher.onDidChange((uri) => {
    if (fileChangeDebounceTimer) {
      clearTimeout(fileChangeDebounceTimer);
    }
    fileChangeDebounceTimer = setTimeout(async () => {
      fileChangeDebounceTimer = void 0;
      try {
        if (fs6.existsSync(uri.fsPath)) {
          const currentDiskContent = fs6.readFileSync(uri.fsPath, "utf-8");
          if (isContentMatchingLastSaved(currentDiskContent)) {
            return;
          }
        }
      } catch {
      }
      if (syncCoordinator.isInternalSaving()) {
        return;
      }
      const workspaceRoot = getWorkspaceRoot(false);
      if (workspaceRoot) {
        await handleExternalScenesFileChange(workspaceRoot);
      }
      treeDataProvider.refresh();
    }, 100);
  });
  fileWatcher.onDidCreate(() => treeDataProvider.refresh());
  fileWatcher.onDidDelete(() => treeDataProvider.refresh());
  const terminateSessionListener = vscode18.debug.onDidTerminateDebugSession(async () => {
    sceneStateManager.clearLastAppliedTopologyHash();
    if (sceneStateManager.isPendingTopologyUpdate()) {
      sceneStateManager.setPendingTopologyUpdate(false);
      const workspaceRoot = getWorkspaceRoot(false);
      if (workspaceRoot) {
        await handleExternalScenesFileChange(workspaceRoot);
      }
    }
  });
  if (typeof vscode18.chat?.registerSkillProvider === "function") {
    const skillProvider = {
      onDidChangeSkills: new vscode18.EventEmitter().event,
      provideSkills() {
        return [
          {
            uri: vscode18.Uri.joinPath(
              context.extensionUri,
              "skills",
              "manage-scenes",
              "SKILL.md"
            )
          }
        ];
      }
    };
    try {
      context.subscriptions.push(
        vscode18.chat.registerSkillProvider(skillProvider)
      );
    } catch {
    }
  }
  context.subscriptions.push(
    debugConfigProvider,
    codeLensProvider,
    bpChangeListener,
    treeView,
    checkboxChangeListener,
    stateChangeListener,
    fileWatcher,
    terminateSessionListener,
    { dispose: () => sceneStateManager.dispose() }
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
