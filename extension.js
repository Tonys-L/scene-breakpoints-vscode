"use strict";
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
var vscode31 = __toESM(require("vscode"));

// src/application/dependencies.ts
var defaultDependencies = {};
function configureDependencies(deps2) {
  defaultDependencies = { ...defaultDependencies, ...deps2 };
}
function getDependencies() {
  return defaultDependencies;
}

// src/application/serialQueue.ts
var import_node_async_hooks = require("node:async_hooks");
var SerialQueue = class {
  queue = Promise.resolve();
  storage = new import_node_async_hooks.AsyncLocalStorage();
  /**
   * 将异步任务放入串行队列执行
   */
  enqueue(task) {
    if (this.storage.getStore()) {
      return task();
    }
    const result = this.queue.then(() => this.storage.run(true, () => task()));
    this.queue = result.catch(() => {
    });
    return result;
  }
};
var applicationSerialQueue = new SerialQueue();

// src/shared/utils/pathUtils.ts
var path = __toESM(require("node:path"));
function normalizeFsPath(filePath) {
  if (!filePath) return "";
  return path.normalize(filePath).replace(/\\/g, "/").toLowerCase();
}
function isSameFsPath(p1, p2) {
  return normalizeFsPath(p1) === normalizeFsPath(p2);
}
function isFilePathMatch(targetFilePath, breakpointFile, workspaceRoot) {
  if (!targetFilePath || !breakpointFile) return false;
  const normTarget = normalizeFsPath(targetFilePath);
  const normBpFile = normalizeFsPath(breakpointFile);
  if (normTarget === normBpFile) return true;
  if (workspaceRoot) {
    const fullBpPath = path.isAbsolute(breakpointFile) ? normalizeFsPath(breakpointFile) : normalizeFsPath(path.join(workspaceRoot, breakpointFile));
    if (normTarget === fullBpPath) return true;
  }
  return normTarget.endsWith("/" + normBpFile) || normTarget.endsWith(normBpFile);
}

// src/application/eventBus.ts
var ApplicationEventBus = class {
  listeners = /* @__PURE__ */ new Map();
  /**
   * 订阅指定类型的应用事件
   */
  on(type, listener) {
    let set = this.listeners.get(type);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return {
      dispose: () => {
        const current = this.listeners.get(type);
        if (current) {
          current.delete(listener);
          if (current.size === 0) {
            this.listeners.delete(type);
          }
        }
      }
    };
  }
  /**
   * 同步广播应用事件
   */
  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    for (const listener of Array.from(set)) {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[ApplicationEventBus] Error in listener for event "${type}":`, err);
      }
    }
  }
  /**
   * 清空所有订阅者 (通常用于测试重置)
   */
  clear() {
    this.listeners.clear();
  }
};
var appEventBus = new ApplicationEventBus();

// src/application/activeBreakpointIndex.ts
var ActiveBreakpointIndex = class {
  workspaceRoot = "";
  activeScenes = [];
  items = [];
  docCache = /* @__PURE__ */ new Map();
  hitCache = /* @__PURE__ */ new Map();
  needsSync = false;
  disposables = [];
  constructor() {
    this.disposables.push(
      appEventBus.on("breakpoints:changed", () => this.markDirty()),
      appEventBus.on("scenes:changed", () => this.markDirty())
    );
  }
  /**
   * 标记当前索引缓存已失效，下次读取前需按需刷新
   */
  markDirty() {
    this.docCache.clear();
    this.hitCache.clear();
    this.needsSync = true;
  }
  /**
   * 获取当前索引是否被标记为需要重同步
   */
  getNeedsSync() {
    return this.needsSync;
  }
  /**
   * 同步/刷新当前激活场景的断点索引（支持组合场景引用深度优先递归展开）
   */
  sync(workspaceRoot, scenes, activeScenes) {
    this.workspaceRoot = workspaceRoot;
    this.activeScenes = [...activeScenes];
    this.items = [];
    this.docCache.clear();
    this.hitCache.clear();
    this.needsSync = false;
    const visitedScenes = /* @__PURE__ */ new Set();
    const collectBreakpoints = (sceneName) => {
      if (visitedScenes.has(sceneName)) return;
      visitedScenes.add(sceneName);
      const sceneBps = scenes[sceneName];
      if (!Array.isArray(sceneBps)) return;
      let stepIndex = 0;
      for (const bp of sceneBps) {
        if (!bp || typeof bp !== "object" || bp.type === "function") continue;
        if (bp.type === "scene" && bp.name) {
          collectBreakpoints(bp.name);
          continue;
        }
        stepIndex++;
        const srcBp = bp;
        if (!srcBp.file || typeof srcBp.line !== "number" || srcBp.line <= 0) continue;
        this.items.push({
          sceneName,
          stepIndex,
          breakpoint: srcBp
        });
      }
    };
    for (const sceneName of activeScenes) {
      collectBreakpoints(sceneName);
    }
  }
  /**
   * 根据完整配置对象刷新索引
   */
  syncFromConfig(workspaceRoot, config, activeScenesOverride) {
    const activeScenes = activeScenesOverride ?? config.activeScenes ?? [];
    this.sync(workspaceRoot, config.scenes || {}, activeScenes);
  }
  /**
   * 获取与指定文档关联的所有活动断点
   */
  getBreakpointsForDocument(docFsPath, wsRoot) {
    const root = wsRoot || this.workspaceRoot;
    const normDoc = normalizeFsPath(docFsPath);
    if (this.docCache.has(normDoc)) {
      return this.docCache.get(normDoc);
    }
    const matched = this.items.filter(
      (item) => isFilePathMatch(docFsPath, item.breakpoint.file, root)
    );
    this.docCache.set(normDoc, matched);
    return matched;
  }
  /**
   * 精确查找指定文件和行号对应的活动断点
   */
  findActiveBreakpoint(file, line, wsRoot) {
    const root = wsRoot || this.workspaceRoot;
    const cacheKey = `${normalizeFsPath(file)}:${line}`;
    if (this.hitCache.has(cacheKey)) {
      return this.hitCache.get(cacheKey);
    }
    const found = this.items.find(
      (item) => Number(item.breakpoint.line) === line && isFilePathMatch(file, item.breakpoint.file, root)
    );
    this.hitCache.set(cacheKey, found);
    return found;
  }
  /**
   * 判断指定文件与行号是否命中了当前激活场景中的断点
   */
  isHitInActiveScenes(file, line, wsRoot) {
    return this.findActiveBreakpoint(file, line, wsRoot) !== void 0;
  }
  /**
   * 获取当前所有已索引断点
   */
  getAllIndexedBreakpoints() {
    return [...this.items];
  }
  /**
   * 获取当前索引所关联的激活场景列表
   */
  getActiveScenes() {
    return [...this.activeScenes];
  }
  /**
   * 获取当前索引关联的工作区根目录
   */
  getWorkspaceRoot() {
    return this.workspaceRoot;
  }
  /**
   * 判断当前内存索引是否与给定工作区根路径及激活场景完全吻合
   */
  isUpToDate(workspaceRoot, activeScenes) {
    if (this.needsSync) return false;
    if (normalizeFsPath(this.workspaceRoot) !== normalizeFsPath(workspaceRoot)) return false;
    if (this.activeScenes.length !== activeScenes.length) return false;
    return this.activeScenes.every((s, i) => s === activeScenes[i]);
  }
  /**
   * 清空索引（测试重置或无场景激活时）
   */
  clear() {
    this.workspaceRoot = "";
    this.activeScenes = [];
    this.items = [];
    this.docCache.clear();
    this.hitCache.clear();
    this.needsSync = false;
  }
  /**
   * 释放事件监听订阅与内部资源
   */
  dispose() {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.clear();
  }
};
var activeBreakpointIndex = new ActiveBreakpointIndex();

// src/application/sceneStateManager.ts
var PureEventEmitter = class {
  listeners = /* @__PURE__ */ new Set();
  event = (listener) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  };
  fire(data) {
    for (const listener of this.listeners) {
      listener(data);
    }
  }
  dispose() {
    this.listeners.clear();
  }
};
var SceneStateManager = class {
  currentActiveScenes = [];
  isDirty = false;
  isApplying = false;
  baselineBreakpointCount = 0;
  unmatchedBreakpointsKeySet = /* @__PURE__ */ new Set();
  hasExplicitActiveState = false;
  _onDidChangeState = new PureEventEmitter();
  onDidChangeState = this._onDidChangeState.event;
  hasExplicitState() {
    return this.hasExplicitActiveState;
  }
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
  getBaselineBreakpointCount() {
    return this.baselineBreakpointCount;
  }
  setBaselineBreakpointCount(count) {
    this.baselineBreakpointCount = count;
  }
  incrementActiveBaseline() {
    this.baselineBreakpointCount++;
  }
  setActiveScenes(sceneNames, initialBpCount = 0) {
    this.hasExplicitActiveState = true;
    const uniqueSorted = Array.from(new Set(sceneNames.map((s) => s.trim()).filter(Boolean))).sort();
    const prev = this.currentActiveScenes;
    const isSame = prev.length === uniqueSorted.length && prev.every((s, i) => s === uniqueSorted[i]);
    this.currentActiveScenes = uniqueSorted;
    this.baselineBreakpointCount = initialBpCount;
    this.isDirty = false;
    if (!isSame && !activeBreakpointIndex.isUpToDate(activeBreakpointIndex.getWorkspaceRoot(), uniqueSorted)) {
      activeBreakpointIndex.markDirty();
    }
    if (uniqueSorted.length === 0) {
      activeBreakpointIndex.clear();
    }
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
  resetState() {
    this.currentActiveScenes = [];
    this.isDirty = false;
    this.isApplying = false;
    this.baselineBreakpointCount = 0;
    this.hasExplicitActiveState = false;
    this.unmatchedBreakpointsKeySet.clear();
    this.clearLastAppliedTopologyHash();
    this.pendingTopologyUpdate = false;
    activeBreakpointIndex.clear();
  }
  dispose() {
    this.resetState();
    this._onDidChangeState.dispose();
  }
};
var sceneStateManager = new SceneStateManager();

// src/shared/utils/stringSimilarity.ts
function stripTrailingComment(line) {
  if (!line) return "";
  let inString = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'" || char === "`") {
      if (!inString) inString = char;
      else if (inString === char && line[i - 1] !== "\\") inString = null;
    } else if (!inString) {
      if (char === "/" && line[i + 1] === "/") {
        return line.slice(0, i).trim();
      }
      if (char === "#" || char === "-" && line[i + 1] === "-") {
        return line.slice(0, i).trim();
      }
      if (char === "/" && line[i + 1] === "*") {
        const endIdx = line.indexOf("*/", i + 2);
        if (endIdx !== -1) {
          line = line.slice(0, i) + line.slice(endIdx + 2);
          i--;
          continue;
        } else {
          return line.slice(0, i).trim();
        }
      }
    }
  }
  return line.trim();
}
function cleanLine(text) {
  if (typeof text !== "string") return "";
  const uncommented = stripTrailingComment(text);
  const normalized = uncommented.trim().replace(/\s+/g, " ");
  return normalized.length > 140 ? normalized.substring(0, 140) : normalized;
}
function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1;
  const clean1 = cleanLine(str1);
  const clean2 = cleanLine(str2);
  if (!clean1 || !clean2) return 0;
  if (clean1 === clean2) return 0.95;
  const wordsA = clean1.match(/[a-zA-Z0-9_$]+/g) || [];
  const wordsB = clean2.match(/[a-zA-Z0-9_$]+/g) || [];
  if (wordsA.length > 0 && wordsB.length > 0) {
    const setA = new Set(wordsA);
    let matchedWords = 0;
    for (const w of wordsB) {
      if (setA.has(w)) matchedWords++;
    }
    const wordSim = matchedWords / Math.max(wordsA.length, wordsB.length);
    const charSetA = new Set(clean1.split(""));
    let commonChars = 0;
    for (const ch of clean2) {
      if (charSetA.has(ch)) commonChars++;
    }
    const charSim = commonChars / Math.max(clean1.length, clean2.length);
    return wordSim * 0.7 + charSim * 0.3;
  }
  return 0;
}

// src/shared/utils/textUtils.ts
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
  /^\s*(?:async\s+)?def\s+([a-zA-Z0-9_$]+)/,
  /^\s*(?:export\s+)?(?:async\s+)?function(?:\s+([a-zA-Z0-9_$]+)|\s*\()/i,
  /^\s*(?:(?:pub|public|private|protected|internal|override|final)\s+)*(?:func|fun)\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_$]+)/i,
  /^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_$]+)/,
  /^\s*(?:public|private|protected)*\s*(constructor)\b/i,
  /^\s*(?:public|private|protected|static)*\s*(?:get|set)\s+([a-zA-Z0-9_$]+)/i,
  /^\s*(?:(?:public|private|protected|static|final|native|synchronized|abstract|virtual|override|async)\s+)+[a-zA-Z0-9_$<>,\[\]\s*&]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\s*[{;]/i,
  /^\s*(?:public|private|protected|static|async)*\s*([a-zA-Z0-9_$]+)\s*(?:=\s*(?:async\s*)?(?:<[^>]*>)?\s*\([^)]*\)\s*=>|\([^)]*\)\s*[{:])/i,
  /^\s*(?:export\s+)?(?:class|struct|interface|trait|enum|type)\s+([a-zA-Z0-9_$]+)/,
  /^\s*impl(?:\s+<[^>]+>)?(?:\s+[a-zA-Z0-9_$]+)?\s+for\s+([a-zA-Z0-9_$]+)/,
  /^\s*impl(?:\s+<[^>]+>)?\s+([a-zA-Z0-9_$]+)/
];
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
    if (!line?.trim()) continue;
    const ind = countIndent(line);
    if (ind < currentIndent) {
      return cleanLine(line);
    }
  }
  return void 0;
}
function extractScopeAnchor(lines, fromIdx, maxLookup = 60) {
  if (!lines?.length || fromIdx < 0) return void 0;
  const startIdx = Math.min(fromIdx, lines.length - 1);
  const endIdx = Math.max(0, startIdx - maxLookup);
  for (let i = startIdx; i >= endIdx; i--) {
    const rawLine = lines[i];
    if (!rawLine?.trim()) continue;
    for (const pattern of SCOPE_PATTERNS) {
      const match = rawLine.match(pattern);
      if (match) {
        const identifier = match[1];
        if (identifier && !CONTROL_FLOW_KEYWORDS.has(identifier)) {
          return identifier;
        }
      }
    }
  }
  return void 0;
}
function findScopeAnchorLine(lines, scopeAnchor) {
  if (!scopeAnchor?.trim() || !lines?.length) return void 0;
  const target = scopeAnchor.trim();
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine?.includes(target)) continue;
    for (const pattern of SCOPE_PATTERNS) {
      const match = rawLine.match(pattern);
      if (match) {
        const identifier = match[1];
        if (identifier && identifier.trim() === target) {
          return i;
        }
      }
    }
  }
  return void 0;
}
function stripMarkdown(text) {
  const trimmed = (text || "").trim();
  const blockMatch = trimmed.match(/^```(?:json|jsonc)?[\r\n]+([\s\S]*?)[\r\n]+```$/i);
  if (blockMatch) {
    return blockMatch[1].trim();
  }
  return trimmed;
}
function stripComments(jsonStr) {
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

// src/domain/models/fingerprint.ts
function extractContextSnippetFromLines(lines, lineZeroBased) {
  const currentLineText = lines[lineZeroBased] ?? "";
  const current = cleanLine(currentLineText);
  const indent = countIndent(currentLineText);
  const prev = findPrevNonEmptyLine(lines, lineZeroBased);
  const next = findNextNonEmptyLine(lines, lineZeroBased);
  const scopeAnchor = extractScopeAnchor(lines, lineZeroBased);
  return { prev, current, next, scopeAnchor, indent };
}
var Fingerprint = class _Fingerprint {
  current;
  prev;
  next;
  scopeAnchor;
  indent;
  constructor(props) {
    this.current = cleanLine(props.current || "");
    this.prev = props.prev ? cleanLine(props.prev) : void 0;
    this.next = props.next ? cleanLine(props.next) : void 0;
    this.scopeAnchor = props.scopeAnchor ? cleanLine(props.scopeAnchor) : void 0;
    this.indent = typeof props.indent === "number" ? props.indent : void 0;
    Object.freeze(this);
  }
  /**
   * 从纯数据 DTO 创建指纹值对象
   */
  static fromSnippet(snippet) {
    if (!snippet || typeof snippet.current !== "string" || !snippet.current.trim()) {
      return void 0;
    }
    return new _Fingerprint({
      current: snippet.current,
      prev: snippet.prev,
      next: snippet.next,
      scopeAnchor: snippet.scopeAnchor,
      indent: snippet.indent
    });
  }
  /**
   * 静态工厂：直接从源码文本行数组在指定行号位置提取并构建指纹值对象
   * @param lines 源码文本行数组 (0-indexed 数组)
   * @param targetLine 目标代码行号 (1-indexed)
   */
  static fromLines(lines, targetLine) {
    if (!Array.isArray(lines) || targetLine < 1 || targetLine > lines.length) {
      return void 0;
    }
    const rawLine = lines[targetLine - 1];
    if (!rawLine || !rawLine.trim()) {
      return void 0;
    }
    const snippet = extractContextSnippetFromLines(lines, targetLine - 1);
    return new _Fingerprint(snippet);
  }
  /**
   * 指纹是否有效（具备非空当前行）
   */
  isValid() {
    return Boolean(this.current);
  }
  /**
   * 是否具备上级函数/方法作用域锚点
   */
  hasScope() {
    return Boolean(this.scopeAnchor);
  }
  /**
   * 检查候选代码行文本是否与当前指纹精准匹配或剥离注释后匹配
   */
  matches(candidateText) {
    if (typeof candidateText !== "string") return false;
    const cleanedCandidate = cleanLine(candidateText);
    if (!cleanedCandidate) return false;
    return cleanedCandidate === this.current;
  }
  /**
   * 计算候选代码行文本与当前指纹的抗混淆词法单元相似度 (0 ~ 1.0)
   */
  similarity(candidateText) {
    if (typeof candidateText !== "string") return 0;
    return calculateSimilarity(this.current, candidateText);
  }
  /**
   * 值对象等价性比较（两个指纹属性全部相同则等价）
   */
  equals(other) {
    if (!other || !(other instanceof _Fingerprint)) return false;
    return this.current === other.current && this.prev === other.prev && this.next === other.next && this.scopeAnchor === other.scopeAnchor;
  }
  /**
   * 序列化为纯数据 DTO，用于落盘持久化或跨层传输
   */
  toJSON() {
    const res = {
      current: this.current
    };
    if (this.prev) res.prev = this.prev;
    if (this.next) res.next = this.next;
    if (this.scopeAnchor) res.scopeAnchor = this.scopeAnchor;
    if (typeof this.indent === "number") res.indent = this.indent;
    return res;
  }
};

// src/domain/models/breakpoint.ts
var Breakpoint = class _Breakpoint {
  kind = "breakpoint";
  type;
  file;
  line;
  enabled;
  condition;
  hitCondition;
  logMessage;
  functionName;
  desc;
  fingerprint;
  constructor(data) {
    const raw = data;
    this.type = raw.type || (raw.functionName ? "function" : "line");
    this.enabled = raw.enabled ?? true;
    this.desc = raw.desc;
    this.condition = raw.condition;
    this.hitCondition = raw.hitCondition;
    if (raw.contextSnippet) {
      this.fingerprint = Fingerprint.fromSnippet(raw.contextSnippet);
    }
    if (this.type === "function") {
      this.functionName = data.functionName || "";
    } else {
      const src = data;
      this.file = src.file ? src.file.replace(/\\/g, "/") : "";
      this.line = typeof src.line === "number" ? src.line : 1;
      this.logMessage = src.logMessage;
    }
  }
  /**
   * 获取或设置上下文指纹 (与内部不可变指纹值对象 Fingerprint 100% 桥接)
   */
  get contextSnippet() {
    return this.fingerprint ? this.fingerprint.toJSON() : void 0;
  }
  set contextSnippet(val) {
    if (val) {
      this.fingerprint = Fingerprint.fromSnippet(val);
    } else {
      this.fingerprint = void 0;
    }
  }
  /**
   * 检查当前断点是否已具备有效的代码伴随指纹
   */
  isFingerprinted() {
    return this.fingerprint?.isValid() ?? false;
  }
  /**
   * 获取当前断点的指纹值对象
   */
  getFingerprint() {
    return this.fingerprint;
  }
  /**
   * 附加或更新当前断点的伴随指纹
   */
  setFingerprint(fingerprint) {
    this.fingerprint = fingerprint;
  }
  /**
   * 启闭切换 (SceneStep 协议实现)
   */
  toggle() {
    this.enabled = !this.enabled;
  }
  /**
   * 设置启用状态
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
  /**
   * 解析断点物理绝对路径（跨平台纯净实现）
   */
  resolveFullPath(workspaceRoot) {
    if (this.type === "function" || !this.file) return "";
    const normFile = this.file.replace(/\\/g, "/");
    const isAbs = /^[a-zA-Z]:\//.test(normFile) || normFile.startsWith("/");
    if (isAbs || !workspaceRoot) {
      return normFile;
    }
    const normRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const rel = normFile.replace(/^\/+/, "");
    return `${normRoot}/${rel}`;
  }
  /**
   * 更新断点物理代码行号 (自愈命中或行号校准)
   */
  updateLine(newLine) {
    if (this.type === "function") return false;
    if (typeof newLine !== "number" || isNaN(newLine) || newLine <= 0) return false;
    if (this.line === newLine) return false;
    this.line = newLine;
    return true;
  }
  /**
   * 判断当前断点是否匹配目标自愈候选断点（同文件下，优先指纹严格匹配，回退物理行号匹配）
   */
  matchesHealedTarget(healed) {
    if (this.type === "function" || healed.type === "function") return false;
    const normThisFile = (this.file || "").replace(/\\/g, "/").toLowerCase();
    const normHealedFile = (healed.file || "").replace(/\\/g, "/").toLowerCase();
    if (normThisFile !== normHealedFile) return false;
    if (this.contextSnippet?.current && healed.contextSnippet?.current) {
      return this.contextSnippet.current === healed.contextSnippet.current;
    }
    return this.line === healed.line;
  }
  /**
   * 吸收并应用自愈修正结果（行号校准与指纹对齐），返回是否有实质性变更
   */
  applyHealed(healed) {
    if (this.type === "function" || healed.type === "function") return false;
    let changed = false;
    if (typeof healed.line === "number" && this.line !== healed.line) {
      this.line = healed.line;
      changed = true;
    }
    if (healed.contextSnippet && (!this.contextSnippet || this.contextSnippet.current !== healed.contextSnippet.current)) {
      this.contextSnippet = JSON.parse(JSON.stringify(healed.contextSnippet));
      changed = true;
    }
    return changed;
  }
  /**
   * 现场提取当前代码行的伴随指纹并持久化绑定 (幂等保护：若已具备有效指纹则跳过)
   */
  enrich(lines) {
    if (this.isFingerprinted()) {
      return false;
    }
    if (this.type === "function" || !this.line) {
      return false;
    }
    const fp = Fingerprint.fromLines(lines, this.line);
    if (!fp) return false;
    this.fingerprint = fp;
    return true;
  }
  enrichFingerprint(lines) {
    return this.enrich(lines);
  }
  /**
   * 物理位置比对与跨平台路径归一化匹配 (SceneStep 协议实现)
   * 非 Breakpoint（引用节点等）直接返回 false —— 引用与断点永不判等
   */
  matches(other) {
    if (!(other instanceof _Breakpoint)) return false;
    if (this.type === "function") {
      return other.type === "function" && other.functionName === this.functionName;
    }
    if (other.type === "function") {
      return false;
    }
    const otherFile = other.file ? other.file.replace(/\\/g, "/") : "";
    const currentFile = this.file ? this.file.replace(/\\/g, "/") : "";
    return currentFile.toLowerCase() === otherFile.toLowerCase() && this.line === other.line;
  }
  /**
   * 导出为符合 schema.json 规范的纯 DTO 对象 (SceneStep 协议实现)
   */
  toJSON() {
    if (this.type === "function") {
      const res2 = {
        type: "function",
        functionName: this.functionName || "",
        enabled: this.enabled
      };
      if (this.condition) res2.condition = this.condition;
      if (this.hitCondition) res2.hitCondition = this.hitCondition;
      if (this.desc) res2.desc = this.desc;
      return res2;
    }
    const res = {
      type: this.type,
      file: this.file || "",
      line: this.line || 1,
      enabled: this.enabled
    };
    if (this.condition) res.condition = this.condition;
    if (this.hitCondition) res.hitCondition = this.hitCondition;
    if (this.logMessage) res.logMessage = this.logMessage;
    if (this.desc) res.desc = this.desc;
    if (this.fingerprint && this.fingerprint.isValid()) {
      res.contextSnippet = this.fingerprint.toJSON();
    }
    return res;
  }
  get raw() {
    return this.toJSON();
  }
  clone() {
    return new _Breakpoint(this.toJSON());
  }
};

// src/domain/models/sceneRef.ts
var SceneRef = class _SceneRef {
  constructor(name, desc, enabled = true) {
    this.name = name;
    this.desc = desc;
    this.enabled = enabled;
  }
  name;
  desc;
  enabled;
  kind = "scene-ref";
  matches(other) {
    return other instanceof _SceneRef && other.name === this.name;
  }
  toggle() {
    this.enabled = !this.enabled;
  }
  /** 缺省不落盘：enabled === true 与 desc === undefined 时不写键，保持 JSON 最小形状 */
  toJSON() {
    const out = { type: "scene", name: this.name };
    if (this.desc !== void 0) out.desc = this.desc;
    if (this.enabled === false) out.enabled = false;
    return out;
  }
  /** 工厂：从 DTO 构造（name 非空校验，非法返回 undefined 交由调用方丢弃） */
  static from(dto) {
    const name = dto?.name?.trim();
    if (!name) return void 0;
    return new _SceneRef(name, dto.desc?.trim() || void 0, dto.enabled !== false);
  }
};

// src/domain/models/scene.ts
var Scene = class _Scene {
  name;
  steps;
  constructor(name, initialSteps = []) {
    this.name = (name || "").trim();
    this.steps = initialSteps.map((s) => _Scene.adaptStep(s)).filter((s) => !!s);
  }
  /** 实体/DTO 统一适配：SceneStep 直存；引用 DTO 走 SceneRef.from（非法丢弃）；其余构造 Breakpoint */
  static adaptStep(input) {
    if (input instanceof Breakpoint || input instanceof SceneRef) return input;
    if (!input || typeof input !== "object") return void 0;
    if (input.type === "scene") return SceneRef.from(input);
    return new Breakpoint(input);
  }
  /**
   * 获取当前场景内的步骤列表（声明世界唯一读取口；只读视图）
   * 编译器强制消费者经收窄点（resolver）消费断点，杜绝"忘记展开引用"静默缺陷
   */
  getSteps() {
    return this.steps;
  }
  /**
   * 获取指定索引位置的步骤
   */
  getStep(index) {
    if (index < 0 || index >= this.steps.length) {
      return void 0;
    }
    return this.steps[index];
  }
  /**
   * 全量替换场景内的步骤列表（常用于全量覆盖模式）
   */
  setSteps(newSteps = []) {
    this.steps = newSteps.map((s) => _Scene.adaptStep(s)).filter((s) => !!s);
  }
  /**
   * 清空场景内全部步骤
   */
  clearSteps() {
    this.steps = [];
  }
  /**
   * 向场景添加步骤，遵循同位置唯一性查重覆盖契约 (INV-001)
   * matches 命中替换、否则尾部追加；返回值标识是否为新增（true=追加，false=覆盖）
   */
  upsertStep(step) {
    const existIdx = this.steps.findIndex((it) => it.matches(step));
    if (existIdx >= 0) {
      this.steps[existIdx] = step;
      return false;
    }
    this.steps.push(step);
    return true;
  }
  /**
   * 从场景中移除指定索引位置的步骤
   */
  removeStep(index) {
    if (index < 0 || index >= this.steps.length) {
      return false;
    }
    this.steps.splice(index, 1);
    return true;
  }
  /**
   * 调整步骤在场景内的排列次序（上移/下移/置顶/置底）
   */
  moveStep(index, direction) {
    if (index < 0 || index >= this.steps.length) {
      return false;
    }
    if (direction === "top") {
      if (index === 0) return false;
      const [item] = this.steps.splice(index, 1);
      this.steps.unshift(item);
      return true;
    }
    if (direction === "bottom") {
      if (index === this.steps.length - 1) return false;
      const [item] = this.steps.splice(index, 1);
      this.steps.push(item);
      return true;
    }
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= this.steps.length) {
      return false;
    }
    const temp = this.steps[index];
    this.steps[index] = this.steps[targetIndex];
    this.steps[targetIndex] = temp;
    return true;
  }
  /**
   * 拖拽重排步骤至目标索引位置 (reorder)
   */
  reorderStep(sourceIndex, targetIndex) {
    if (sourceIndex < 0 || sourceIndex >= this.steps.length || targetIndex < 0 || targetIndex >= this.steps.length || sourceIndex === targetIndex) {
      return false;
    }
    const [item] = this.steps.splice(sourceIndex, 1);
    this.steps.splice(targetIndex, 0, item);
    return true;
  }
  /**
   * 切换场景中指定索引步骤的启用/禁用状态（多态分发：断点与引用均为一等公民）
   */
  toggleStep(index) {
    if (index < 0 || index >= this.steps.length) {
      return false;
    }
    this.steps[index].toggle();
    return true;
  }
  /**
   * 批量设置场景内所有步骤的启用/禁用状态
   */
  setAllStepsEnabled(targetEnabled) {
    let hasChanged = false;
    for (const step of this.steps) {
      if (step instanceof Breakpoint) {
        if (step.enabled !== targetEnabled) {
          step.setEnabled(targetEnabled);
          hasChanged = true;
        }
      } else if (step instanceof SceneRef) {
        if (step.enabled !== targetEnabled) {
          step.toggle();
          hasChanged = true;
        }
      }
    }
    return hasChanged;
  }
  /**
   * 获取当前场景中所有尚未提取有效指纹的物理断点（聚合根内部 kind 收窄）
   */
  getUnfingerprintedBreakpoints() {
    return this.steps.filter((s) => s.kind === "breakpoint").filter(
      (bp) => bp.type !== "function" && !bp.isFingerprinted() && bp.file && bp.line
    );
  }
  /**
   * 将自愈修正后的断点集合回填到当前场景中，返回是否有断点发生了更新
   * 仅具象断点参与自愈回填匹配（引用节点无物理身份）
   */
  backfillHealed(healedBreakpoints) {
    if (!healedBreakpoints?.length) return false;
    let hasChanged = false;
    for (const step of this.steps) {
      if (!(step instanceof Breakpoint)) continue;
      const bp = step;
      if (bp.type === "function") continue;
      const matched = healedBreakpoints.find((h) => bp.matchesHealedTarget(h));
      if (matched && bp.applyHealed(matched)) {
        hasChanged = true;
      }
    }
    return hasChanged;
  }
  /**
   * 同步单个断点目标的启用/禁用状态（支持函数断点名匹配与文件路径归一化匹配）
   * 仅具象断点参与 DAP 启停同步（引用无物理身份）
   */
  syncBreakpointEnabled(target) {
    let changed = false;
    const targetEnabled = target.enabled ?? true;
    if (target.functionName) {
      for (const step of this.steps) {
        if (!(step instanceof Breakpoint)) continue;
        const bp = step;
        if (bp.type === "function" && bp.functionName === target.functionName) {
          if (bp.enabled !== targetEnabled) {
            bp.setEnabled(targetEnabled);
            changed = true;
          }
        }
      }
      return changed;
    }
    if (target.file && typeof target.line === "number") {
      const normTarget = target.file.replace(/\\/g, "/").toLowerCase();
      for (const step of this.steps) {
        if (!(step instanceof Breakpoint)) continue;
        const bp = step;
        if (bp.type === "function" || bp.line !== target.line || !bp.file) continue;
        const normBp = bp.file.replace(/\\/g, "/").toLowerCase();
        if (normBp === normTarget || normTarget.endsWith("/" + normBp) || normBp.endsWith("/" + normTarget)) {
          if (bp.enabled !== targetEnabled) {
            bp.setEnabled(targetEnabled);
            changed = true;
          }
        }
      }
    }
    return changed;
  }
  /**
   * 深度克隆生成场景副本（断点走 clone，引用重建，保持声明结构）
   */
  clone(newName) {
    const clonedSteps = this.steps.map((s) => {
      if (s instanceof Breakpoint) return s.clone();
      if (s instanceof SceneRef) return new SceneRef(s.name, s.desc, s.enabled);
      return s;
    });
    return new _Scene(newName, clonedSteps);
  }
  /**
   * 快速判定：场景是否含引用节点（激活管道/树视图决定是否走解析路径）
   */
  hasSceneRefs() {
    return this.steps.some((s) => s.kind === "scene-ref");
  }
  /**
   * 将多个场景按“先到先得”排重策略 (INV-011) 合并生成一个新的场景实体
   * 输入约束为视图场景（仅吸收具象断点，引用不参与合并，防止声明污染）
   */
  static merge(scenes, mergedName = "merged") {
    const mergedBreakpoints = [];
    for (const scene of scenes) {
      if (!scene) continue;
      for (const bp of scene.getConcreteBreakpoints()) {
        const exists = mergedBreakpoints.some((it) => it.matches(bp));
        if (!exists) {
          mergedBreakpoints.push(bp);
        }
      }
    }
    return new _Scene(mergedName, mergedBreakpoints);
  }
  /**
   * 将另一场景或断点集合按“先到先得”排重策略合并吸收至当前场景中
   * 仅吸收具象断点（引用不跨场景吸收，防止声明污染）
   */
  mergeFrom(other) {
    const incoming = other instanceof _Scene ? other.getConcreteBreakpoints() : other;
    for (const bp of incoming) {
      const exists = this.steps.some((it) => it.matches(bp));
      if (!exists) {
        this.steps.push(bp);
      }
    }
  }
  /**
   * 具象断点投影（私有辅助，仅供 Scene 内部与视图场景合并使用）：
   * 返回 steps 中 kind === "breakpoint" 的实体数组。不作为公开 API —— 公开读取口只有 getSteps()。
   */
  getConcreteBreakpoints() {
    return this.steps.filter((s) => s.kind === "breakpoint");
  }
  /**
   * 导出为纯数据步骤数组 DTO（断点与引用项混合的声明态）
   */
  toJSON() {
    return this.steps.map((s) => s.toJSON());
  }
};

// src/domain/models/sceneCatalog.ts
var SceneCatalog = class _SceneCatalog {
  $schema;
  scenes = /* @__PURE__ */ new Map();
  activeScenes = [];
  bindings = {};
  hasExplicitActiveScenes = false;
  constructor(config) {
    if (config) {
      this.$schema = config.$schema;
      if (Array.isArray(config.activeScenes)) {
        this.activeScenes = [...config.activeScenes];
        this.hasExplicitActiveScenes = true;
      }
      this.bindings = config.bindings ? JSON.parse(JSON.stringify(config.bindings)) : {};
      if (config.scenes && typeof config.scenes === "object") {
        for (const [name, bps] of Object.entries(config.scenes)) {
          if (Array.isArray(bps)) {
            this.scenes.set(name, new Scene(name, bps));
          }
        }
      }
    }
  }
  /**
   * 从原始配置对象或 DTO 构造聚合根
   */
  static fromConfig(config) {
    return new _SceneCatalog(config);
  }
  /**
   * 获取全量场景实体列表
   */
  getAllScenes() {
    return Array.from(this.scenes.values());
  }
  /**
   * 获取全量场景名称列表
   */
  getSceneNames() {
    return Array.from(this.scenes.keys());
  }
  /**
   * 检查是否存在指定场景（大小写容错匹配，INV-009）
   */
  hasScene(name) {
    return !!this.findExactSceneName(name);
  }
  /**
   * 查找并获取与入参大小写容错匹配的真实场景键名
   */
  findExactSceneName(name) {
    if (!name || typeof name !== "string") return void 0;
    const targetLower = name.trim().toLowerCase();
    for (const key of this.scenes.keys()) {
      if (key.toLowerCase() === targetLower) {
        return key;
      }
    }
    return void 0;
  }
  /**
   * 获取指定名称的场景实体（支持大小写容错）
   */
  getScene(name) {
    const exactName = this.findExactSceneName(name);
    return exactName ? this.scenes.get(exactName) : void 0;
  }
  /**
   * 获取或创建场景实体
   */
  getOrCreateScene(name) {
    const existing = this.getScene(name);
    if (existing) return existing;
    const trimmedName = name.trim();
    const created = new Scene(trimmedName);
    this.scenes.set(trimmedName, created);
    return created;
  }
  /**
   * 重命名场景，并联动维护 launch.json 启动项映射 bindings
   */
  renameScene(oldName, newName) {
    const exactOld = this.findExactSceneName(oldName);
    const trimmedNew = typeof newName === "string" ? newName.trim() : "";
    if (!exactOld || !trimmedNew || this.hasScene(trimmedNew)) {
      return false;
    }
    const scene = this.scenes.get(exactOld);
    scene.name = trimmedNew;
    this.scenes.delete(exactOld);
    this.scenes.set(trimmedNew, scene);
    this.activeScenes = this.activeScenes.map((s) => s === exactOld ? trimmedNew : s);
    for (const [k, v] of Object.entries(this.bindings)) {
      if (typeof v === "string" && v === exactOld) {
        this.bindings[k] = trimmedNew;
      } else if (Array.isArray(v)) {
        this.bindings[k] = v.map((it) => it === exactOld ? trimmedNew : it);
      }
    }
    return true;
  }
  /**
   * 删除场景，并联动清理 bindings 与 activeScenes
   */
  deleteScene(name) {
    const exactName = this.findExactSceneName(name);
    if (!exactName) return false;
    this.scenes.delete(exactName);
    this.activeScenes = this.activeScenes.filter((s) => s !== exactName);
    for (const [k, v] of Object.entries(this.bindings)) {
      if (typeof v === "string" && v === exactName) {
        delete this.bindings[k];
      } else if (Array.isArray(v)) {
        const filtered = v.filter((it) => it !== exactName);
        if (filtered.length === 0) {
          delete this.bindings[k];
        } else {
          this.bindings[k] = filtered;
        }
      }
    }
    return true;
  }
  /**
   * 克隆/复制场景副本，支持可选的目标文件过滤 (INV-004)
   */
  duplicateScene(sourceSceneName, targetSceneName, targetFile) {
    const trimmedTarget = typeof targetSceneName === "string" ? targetSceneName.trim() : "";
    if (!trimmedTarget) return false;
    const sourceScene = this.getScene(sourceSceneName);
    if (!sourceScene || this.hasScene(trimmedTarget)) {
      return false;
    }
    if (targetFile) {
      const normTargetFile = targetFile.replace(/\\/g, "/").toLowerCase();
      const clonedBreakpoints = [];
      for (const step of sourceScene.getSteps()) {
        if (!(step instanceof Breakpoint)) continue;
        const bpFile = (step.file || "").replace(/\\/g, "/").toLowerCase();
        if (bpFile === normTargetFile || bpFile.endsWith("/" + normTargetFile)) {
          clonedBreakpoints.push(step.clone());
        }
      }
      this.scenes.set(trimmedTarget, new Scene(trimmedTarget, clonedBreakpoints));
    } else {
      this.scenes.set(trimmedTarget, sourceScene.clone(trimmedTarget));
    }
    return true;
  }
  /**
   * 获取当前激活的场景列表
   */
  getActiveScenes() {
    return [...this.activeScenes];
  }
  /**
   * 判断当前聚合根是否显式声明了激活场景集合 (即使为空数组)
   */
  getHasExplicitActiveScenes() {
    return this.hasExplicitActiveScenes;
  }
  /**
   * 获取启动项路由表
   */
  getBindings() {
    return { ...this.bindings };
  }
  /**
   * 激活指定场景列表，施加幽灵场景强防御 (INV-009)
   */
  activate(targetScenes) {
    const validTargetScenes = [];
    const missingScenes = [];
    for (const target of targetScenes) {
      const matched = this.findExactSceneName(target);
      if (matched) {
        if (!validTargetScenes.includes(matched)) {
          validTargetScenes.push(matched);
        }
      } else {
        missingScenes.push(target);
      }
    }
    if (validTargetScenes.length === 0) {
      return {
        success: false,
        validTargetScenes: [],
        missingScenes
      };
    }
    this.activeScenes = validTargetScenes;
    this.hasExplicitActiveScenes = true;
    return {
      success: true,
      validTargetScenes,
      missingScenes
    };
  }
  /**
   * 清空当前激活场景
   */
  clearActive() {
    this.activeScenes = [];
    this.hasExplicitActiveScenes = true;
  }
  /**
   * 序列化为与磁盘 .vscode/debug-scenes.json 100% 格式吻合的纯 JSON DTO
   */
  toJSON() {
    const scenesDict = {};
    for (const [name, scene] of this.scenes.entries()) {
      scenesDict[name] = scene.toJSON();
    }
    const res = {
      scenes: scenesDict
    };
    if (this.$schema) res.$schema = this.$schema;
    if (this.hasExplicitActiveScenes || this.activeScenes.length > 0) {
      res.activeScenes = [...this.activeScenes];
    }
    if (Object.keys(this.bindings).length > 0) res.bindings = { ...this.bindings };
    return res;
  }
};

// src/domain/services/sceneResolver.ts
var MAX_REF_DEPTH = 32;
var CircularReferenceError = class extends Error {
  constructor(cyclePath) {
    super(`Circular scene reference: ${cyclePath.join(" \u2192 ")}`);
    this.cyclePath = cyclePath;
  }
  cyclePath;
  name = "CircularReferenceError";
};
function breakpointKey(bp) {
  if (bp.type === "function") return `fn:${bp.functionName}`;
  const normFile = (bp.file ?? "").replace(/\\/g, "/").toLowerCase();
  return `src:${normFile}:${bp.line}`;
}
function dfs(catalog, sceneName, refPath, seen, output, warnings) {
  const scene = catalog.getScene(sceneName);
  if (!scene) return;
  for (const step of scene.getSteps()) {
    if (step.kind === "breakpoint") {
      const bp = step;
      const key = breakpointKey(bp);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ breakpoint: bp, ownerScene: sceneName, refPath });
      continue;
    }
    const ref = step;
    if (!ref.enabled) {
      warnings.push({ code: "disabled-ref", refName: ref.name, refPath });
      continue;
    }
    if (!catalog.hasScene(ref.name)) {
      warnings.push({ code: "dangling-ref", refName: ref.name, refPath });
      continue;
    }
    if (refPath.includes(ref.name)) {
      const start = refPath.indexOf(ref.name);
      throw new CircularReferenceError([...refPath.slice(start), ref.name]);
    }
    if (refPath.length >= MAX_REF_DEPTH) {
      throw new CircularReferenceError([...refPath, ref.name]);
    }
    dfs(catalog, ref.name, [...refPath, ref.name], seen, output, warnings);
  }
}
function expandScene(catalog, sceneName) {
  const output = [];
  const warnings = [];
  const seen = /* @__PURE__ */ new Set();
  const root = catalog.getScene(sceneName);
  if (!root) {
    return { steps: output, warnings: [{ code: "dangling-ref", refName: sceneName, refPath: [] }] };
  }
  if (!root.hasSceneRefs()) {
    for (const step of root.getSteps()) {
      const bp = step;
      const key = breakpointKey(bp);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ breakpoint: bp, ownerScene: sceneName, refPath: [sceneName] });
    }
    return { steps: output, warnings };
  }
  dfs(catalog, sceneName, [sceneName], seen, output, warnings);
  return { steps: output, warnings };
}
function expandScenes(catalog, sceneNames) {
  const output = [];
  const warnings = [];
  const seen = /* @__PURE__ */ new Set();
  for (const name of sceneNames) {
    const root = catalog.getScene(name);
    if (!root) continue;
    if (root.hasSceneRefs()) {
      dfs(catalog, name, [name], seen, output, warnings);
    } else {
      for (const step of root.getSteps()) {
        const bp = step;
        const key = breakpointKey(bp);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({ breakpoint: bp, ownerScene: name, refPath: [name] });
      }
    }
  }
  return { steps: output, warnings };
}

// src/shared/utils/arrayUtils.ts
function uniqueStrings(raw) {
  let arr = [];
  if (typeof raw === "string") {
    arr = raw.split(",");
  } else if (Array.isArray(raw)) {
    arr = raw.flatMap((item) => typeof item === "string" ? item.split(",") : []);
  }
  const cleaned = arr.map((s) => s.trim()).filter((s) => s.length > 0);
  return Array.from(new Set(cleaned));
}
function arrayEqualsIgnoreOrder(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

// src/domain/services/activeScenesDiffResolver.ts
function computeTopologyHash(breakpoints) {
  if (!Array.isArray(breakpoints)) {
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
function filterGhostScenes(targetScenes, scenesDict) {
  if (!scenesDict) return [];
  const existingNames = Object.keys(scenesDict);
  const validScenes = [];
  for (const target of targetScenes) {
    const matched = existingNames.find((name) => name.toLowerCase() === target.toLowerCase());
    if (matched && !validScenes.includes(matched)) {
      validScenes.push(matched);
    }
  }
  return validScenes;
}
function resolveActiveScenesDiff(params) {
  const { allowAiActivation = true, currentActiveScenes, rawActiveScenes, scenesDict } = params;
  if (!allowAiActivation) {
    return { shouldApply: false, action: "noop", targetScenes: currentActiveScenes };
  }
  const targetScenes = filterGhostScenes(
    uniqueStrings(rawActiveScenes),
    scenesDict
  );
  const isSame = arrayEqualsIgnoreOrder(targetScenes, currentActiveScenes);
  if (isSame) {
    return { shouldApply: false, action: "noop", targetScenes: currentActiveScenes };
  }
  if (targetScenes.length === 0) {
    return { shouldApply: true, action: "clear", targetScenes: [] };
  }
  return { shouldApply: true, action: "apply", targetScenes };
}

// src/application/mutateCatalog.ts
function getMergedActiveBreakpoints(catalog, activeScenes) {
  return expandScenes(catalog, activeScenes).steps.map((s) => s.breakpoint.raw);
}
async function syncActiveBreakpointsIfNeeded(workspaceRoot, catalog, activeScenes, breakpointBridge) {
  if (activeScenes.length === 0) return;
  const survivingActiveScenes = catalog.getHasExplicitActiveScenes() && catalog.getActiveScenes().length === 0 ? [] : catalog.getActiveScenes().length > 0 ? catalog.getActiveScenes().filter((s) => catalog.hasScene(s)) : activeScenes.filter((s) => catalog.hasScene(s));
  const newActiveBps = getMergedActiveBreakpoints(catalog, survivingActiveScenes);
  const newHash = computeTopologyHash(newActiveBps);
  const currentHash = sceneStateManager.getLastAppliedTopologyHash();
  if (newHash !== currentHash || survivingActiveScenes.length !== activeScenes.length) {
    if (breakpointBridge) {
      if (survivingActiveScenes.length === 0) {
        await breakpointBridge.clearAllBreakpoints();
      } else {
        const primaryLabel = survivingActiveScenes.length === 1 ? survivingActiveScenes[0] : survivingActiveScenes.join(" + ");
        await breakpointBridge.applySceneBreakpoints(workspaceRoot, primaryLabel, newActiveBps);
      }
    }
    sceneStateManager.setLastAppliedTopologyHash(newHash);
    sceneStateManager.setActiveScenes(survivingActiveScenes, newActiveBps.length);
    activeBreakpointIndex.sync(workspaceRoot, catalog.toJSON().scenes, survivingActiveScenes);
  }
}
async function mutateCatalog(workspaceRoot, action, options, legacyNotify, legacyQueue) {
  const queue = options?.queue ?? legacyQueue ?? applicationSerialQueue;
  const notify = options?.notify ?? legacyNotify;
  return queue.enqueue(async () => {
    const defaultDeps = getDependencies();
    const sceneRepository = options?.sceneRepository || defaultDeps.sceneRepository;
    const breakpointBridge = options?.breakpointBridge || defaultDeps.breakpointBridge;
    if (!sceneRepository) {
      throw new Error("mutateCatalog: sceneRepository must be configured");
    }
    const merged = sceneRepository.loadMergedScenesConfig?.(workspaceRoot);
    const config = merged ? merged.config : sceneRepository.loadScenesConfig(workspaceRoot);
    const catalog = new SceneCatalog(config);
    const shouldSyncActive = options?.syncActive !== false;
    const activeScenes = shouldSyncActive ? sceneStateManager.getActiveScenes() : [];
    const result = await action(catalog);
    if (result) {
      if (merged && sceneRepository.saveScenesLayers) {
        const originByScene = { ...merged.originByScene };
        if (options?.renameOrigin) {
          const { from, to } = options.renameOrigin;
          if (from in originByScene) {
            originByScene[to] = originByScene[from];
            delete originByScene[from];
          }
        }
        for (const name of Object.keys(catalog.toJSON().scenes || {})) {
          if (!(name in originByScene)) {
            originByScene[name] = options?.targetLayer ?? "local";
          }
        }
        sceneRepository.saveScenesLayers(workspaceRoot, catalog.toJSON(), originByScene);
      } else {
        sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
      }
      if (shouldSyncActive) {
        await syncActiveBreakpointsIfNeeded(workspaceRoot, catalog, activeScenes, breakpointBridge);
      }
      if (!options?.silent) {
        appEventBus.emit("scenes:changed", { workspaceRoot, reason: options?.reason });
      }
      if (notify?.sceneName) {
        appEventBus.emit("breakpoints:changed", { workspaceRoot, sceneName: notify.sceneName });
      }
    }
    return result;
  });
}

// src/domain/services/healingEngine.ts
var HEALING_CONFIDENCE_THRESHOLD = 0.6;
var HEALING_SEARCH_WINDOW = 30;
var SCOPE_BODY_SEARCH_WINDOW = 150;
function extractContextSnippet(docOrLines, lineZeroBased) {
  if (Array.isArray(docOrLines)) {
    return extractContextSnippetFromLines(docOrLines, lineZeroBased);
  }
  const lines = [];
  for (let i = 0; i < docOrLines.lineCount; i++) {
    lines.push(docOrLines.lineAt(i).text);
  }
  return extractContextSnippetFromLines(lines, lineZeroBased);
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
  if (snippet.targetPrev && candPrev === snippet.targetPrev) {
    score += 5;
    hasPrevMatch = true;
  }
  let hasNextMatch = false;
  const candNext = findNextNonEmptyLine(lines, i);
  if (snippet.targetNext && candNext === snippet.targetNext) {
    score += 5;
    hasNextMatch = true;
  }
  const hasContextMatch = hasPrevMatch || hasNextMatch;
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
    } else if (candIndent === snippet.targetIndent * 2 || snippet.targetIndent === candIndent * 2) {
      score += 2;
    }
  }
  if (snippet.targetScope && score >= 5) {
    const candParent = findGeometricParent(lines, i, candIndent);
    const candidateScope = getCandidateScope(i);
    if (candidateScope && candidateScope === snippet.targetScope || candParent && candParent.includes(snippet.targetScope)) {
      score += 5;
    }
  }
  score -= distancePenalty;
  return { score, hasDirectMatch };
}
var HealingEngine = class {
  constructor(confidenceThreshold = HEALING_CONFIDENCE_THRESHOLD, searchWindow = HEALING_SEARCH_WINDOW, scopeBodyWindow = SCOPE_BODY_SEARCH_WINDOW) {
    this.confidenceThreshold = confidenceThreshold;
    this.searchWindow = searchWindow;
    this.scopeBodyWindow = scopeBodyWindow;
  }
  confidenceThreshold;
  searchWindow;
  scopeBodyWindow;
  /**
   * 计算指纹特征理论满分分值
   */
  computeMaxPossibleScore(spec) {
    let score = 10;
    if (spec.targetPrev) score += 5;
    if (spec.targetNext) score += 5;
    if (spec.targetScope) score += 5;
    if (spec.targetIndent !== void 0) score += 3;
    return score;
  }
  /**
   * 阶段一：原址近距辐射探测 (零分配双向辐射探测)
   */
  probeNearRadius(lines, origIdx, spec, maxPossibleScore) {
    const getCandidateScope = (lineIdx) => extractScopeAnchor(lines, lineIdx);
    let bestIdx = -1;
    let bestScore = -1;
    for (let step = 1; step <= this.searchWindow; step++) {
      for (const offset of [step, -step]) {
        const i = origIdx + offset;
        if (i < 0 || i >= lines.length) continue;
        const { score, hasDirectMatch } = calculateCandidateLineScore(
          lines,
          i,
          spec,
          getCandidateScope,
          step * 0.05
        );
        if (hasDirectMatch && score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
    }
    const confidenceRatio = bestScore / maxPossibleScore;
    if (bestScore >= 12.5 || confidenceRatio >= this.confidenceThreshold) {
      return {
        healedLine: bestIdx + 1,
        isHealed: true,
        status: "healed",
        confidence: confidenceRatio
      };
    }
    return void 0;
  }
  /**
   * 阶段二：作用域巡航大跨度重锚定
   */
  cruiseScopeAnchor(lines, origIdx, targetLine, targetScope, spec, maxPossibleScore) {
    const scopeHeaderIdx = findScopeAnchorLine(lines, targetScope);
    if (scopeHeaderIdx === void 0) return void 0;
    const getCandidateScope = (lineIdx) => extractScopeAnchor(lines, lineIdx);
    let p2BestIdx = -1;
    let p2BestScore = -1;
    const searchEnd = Math.min(lines.length - 1, scopeHeaderIdx + this.scopeBodyWindow);
    const headerLine = lines[scopeHeaderIdx] || "";
    const isPythonStyle = headerLine.trim().endsWith(":");
    const headerIndent = countIndent(headerLine);
    for (let i = scopeHeaderIdx; i <= searchEnd; i++) {
      if (isPythonStyle && i > scopeHeaderIdx) {
        const trimmed = lines[i]?.trim();
        if (trimmed && !trimmed.startsWith("#") && countIndent(lines[i]) <= headerIndent) {
          break;
        }
      }
      const distance = Math.abs(i - origIdx);
      const { score, hasDirectMatch } = calculateCandidateLineScore(
        lines,
        i,
        spec,
        getCandidateScope,
        distance * 0.01
      );
      if (hasDirectMatch && score > p2BestScore) {
        p2BestScore = score;
        p2BestIdx = i;
      }
    }
    const p2Ratio = p2BestScore / maxPossibleScore;
    if (p2BestScore >= 12.5 || p2Ratio >= this.confidenceThreshold) {
      const newHealedLine = p2BestIdx + 1;
      const isHealed = newHealedLine !== targetLine;
      return {
        healedLine: newHealedLine,
        isHealed,
        status: isHealed ? "healed" : "matched",
        confidence: p2Ratio
      };
    }
    return void 0;
  }
  /**
   * 对给定代码行数组及伴随指纹执行两阶段自愈运算 (纯内存算法)
   */
  heal(lines, targetLine, fp) {
    if (typeof targetLine !== "number" || isNaN(targetLine) || targetLine <= 0) {
      return { healedLine: targetLine || 1, isHealed: false, status: "matched" };
    }
    if (!lines || lines.length === 0) {
      return { healedLine: targetLine, isHealed: false, status: "unmatched" };
    }
    const fingerprint = fp instanceof Fingerprint ? fp : Fingerprint.fromSnippet(fp);
    if (!fingerprint || !fingerprint.isValid()) {
      return { healedLine: targetLine, isHealed: false, status: "matched" };
    }
    const origIdx = targetLine - 1;
    const spec = {
      targetCurrent: fingerprint.current,
      targetPrev: fingerprint.prev,
      targetNext: fingerprint.next,
      targetScope: fingerprint.scopeAnchor,
      targetIndent: fingerprint.indent
    };
    if (origIdx < lines.length && cleanLine(lines[origIdx]) === spec.targetCurrent) {
      return { healedLine: targetLine, isHealed: false, status: "matched", confidence: 1 };
    }
    const maxPossibleScore = this.computeMaxPossibleScore(spec);
    const phase1Result = this.probeNearRadius(lines, origIdx, spec, maxPossibleScore);
    if (phase1Result) return phase1Result;
    if (spec.targetScope) {
      const phase2Result = this.cruiseScopeAnchor(lines, origIdx, targetLine, spec.targetScope, spec, maxPossibleScore);
      if (phase2Result) return phase2Result;
    }
    return { healedLine: targetLine, isHealed: false, status: "unmatched" };
  }
  /**
   * 面向 ILineReader 端口读取并执行自愈 (零 fs 依赖，依赖倒置)
   */
  async healWithReader(reader, filePath, targetLine, fp) {
    const lines = await reader.readLines(filePath);
    return this.heal(lines, targetLine, fp);
  }
  // 静态快捷调用
  static heal(lines, targetLine, fp) {
    return defaultHealingEngine.heal(lines, targetLine, fp);
  }
};
var defaultHealingEngine = new HealingEngine();

// src/application/sceneActivationPipeline.ts
async function resolveConflictDecision(onConflict, bp, fingerprintLine) {
  if (!onConflict) return false;
  const decision = await onConflict({
    file: bp.file || "",
    registeredLine: bp.line || 0,
    fingerprintLine
  });
  return decision !== "fingerprint";
}
function syncDiskActiveScenesIfNeeded(workspaceRoot, catalog, currentDiskActives, validTargetScenes, sceneRepository) {
  const isSameActive = Array.isArray(currentDiskActives) && currentDiskActives.length === validTargetScenes.length && currentDiskActives.every((s, i) => s === validTargetScenes[i]);
  if (!isSameActive) {
    sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
  }
}
function persistHealedBackfill(workspaceRoot, catalog, _validTargetScenes, applyResult, resolved, sceneRepository) {
  const candidateInstances = applyResult.healedBreakpoints?.length ? applyResult.healedBreakpoints.map(
    (b) => b instanceof Breakpoint ? b : new Breakpoint(b)
  ) : resolved.map((s) => s.breakpoint);
  const ownerScenes = [...new Set(resolved.map((s) => s.ownerScene))];
  for (const owner of ownerScenes) {
    catalog.getScene(owner)?.backfillHealed(candidateInstances);
  }
  sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
}
async function enrichAndHealBreakpoints(workspaceRoot, breakpoints, lineReader, conflict) {
  let healedCount = 0;
  let enrichedCount = 0;
  const unmatched = [];
  if (!lineReader) return { healedCount, enrichedCount, unmatched };
  for (const bp of breakpoints) {
    if (bp.type === "function") continue;
    const fullPath = bp.resolveFullPath(workspaceRoot);
    if (!fullPath) continue;
    try {
      const lines = await lineReader.readLines(fullPath);
      if (!lines || lines.length === 0) continue;
      if (bp.enrich(lines)) enrichedCount++;
      const healResult = HealingEngine.heal(lines, bp.line, bp.contextSnippet);
      if (healResult.isHealed) {
        if (conflict?.enabled && await resolveConflictDecision(conflict.onConflict, bp, healResult.healedLine)) {
          bp.contextSnippet = void 0;
          if (bp.enrich(lines)) enrichedCount++;
        } else {
          bp.updateLine(healResult.healedLine);
          healedCount++;
        }
      } else if (healResult.status === "unmatched") {
        unmatched.push(bp.toJSON());
      }
    } catch {
    }
  }
  return { healedCount, enrichedCount, unmatched };
}
async function executeSceneActivation(params) {
  const { workspaceRoot, targetScenes, deps: deps2 } = params;
  const { sceneRepository, breakpointBridge, lineReader } = deps2;
  if (!sceneRepository || !breakpointBridge) {
    throw new Error("SceneService: sceneRepository and breakpointBridge must be configured");
  }
  lineReader?.clearCache?.();
  const config = sceneRepository.loadScenesConfig(workspaceRoot);
  const catalog = new SceneCatalog(config);
  const actResult = catalog.activate(targetScenes);
  if (!actResult.success) {
    return {
      success: false,
      validTargetScenes: [],
      missingScenes: actResult.missingScenes,
      loadedCount: 0,
      healedCount: 0,
      unmatchedCount: 0
    };
  }
  const validTargetScenes = actResult.validTargetScenes;
  const missingScenes = actResult.missingScenes;
  const { steps: resolvedSteps, warnings: resolveWarnings } = expandScenes(catalog, validTargetScenes);
  const mergedBreakpoints = resolvedSteps.map((s) => s.breakpoint);
  const conflictEnabled = deps2.conflictDetection === "enabled" || (deps2.isExternalPendingEdit?.() ?? false);
  const {
    healedCount: appHealedCount,
    enrichedCount: appEnrichedCount,
    unmatched: unmatchedBreakpoints
  } = await enrichAndHealBreakpoints(workspaceRoot, mergedBreakpoints, lineReader, {
    enabled: conflictEnabled,
    onConflict: deps2.resolveFingerprintConflict
  });
  sceneStateManager.setUnmatchedBreakpoints(
    unmatchedBreakpoints.map((bp) => `${bp.file.replace(/\\/g, "/")}:${bp.line}`)
  );
  const bpsToLoad = mergedBreakpoints.map((b) => b.raw);
  const primarySceneLabel = validTargetScenes.length === 1 ? validTargetScenes[0] : validTargetScenes.join(" + ");
  syncDiskActiveScenesIfNeeded(workspaceRoot, catalog, config.activeScenes, validTargetScenes, sceneRepository);
  sceneStateManager.setApplyingState(true);
  let applyResult;
  try {
    applyResult = await breakpointBridge.applySceneBreakpoints(workspaceRoot, primarySceneLabel, bpsToLoad);
  } finally {
    sceneStateManager.setApplyingState(false);
  }
  const loadedCount = applyResult.loadedCount;
  const healedCount = appHealedCount + (applyResult.healedCount || 0);
  const enrichedCount = appEnrichedCount + (applyResult.enrichedCount || 0);
  const finalUnmatched = unmatchedBreakpoints.length > 0 ? unmatchedBreakpoints : applyResult.unmatchedBreakpoints;
  const unmatchedCount = finalUnmatched?.length || 0;
  sceneStateManager.setLastAppliedTopologyHash(computeTopologyHash(bpsToLoad));
  activeBreakpointIndex.sync(workspaceRoot, catalog.toJSON().scenes, validTargetScenes);
  sceneStateManager.setActiveScenes(validTargetScenes, loadedCount);
  if (healedCount > 0 || enrichedCount > 0) {
    persistHealedBackfill(workspaceRoot, catalog, validTargetScenes, applyResult, resolvedSteps, sceneRepository);
  }
  appEventBus.emit("scene:activated", { workspaceRoot, activeScenes: validTargetScenes });
  if (resolveWarnings.length > 0) {
    appEventBus.emit("scene:resolve-warnings", { workspaceRoot, warnings: resolveWarnings });
  }
  return {
    success: true,
    validTargetScenes,
    missingScenes,
    loadedCount,
    healedCount,
    enrichedCount,
    unmatchedCount,
    unmatchedBreakpoints: finalUnmatched
  };
}

// src/application/sceneManager.ts
var SceneManager = class {
  constructor(queue = applicationSerialQueue) {
    this.queue = queue;
  }
  queue;
  resolveDeps(opts) {
    const defaultDeps = getDependencies();
    return {
      sceneRepository: opts?.sceneRepository || defaultDeps.sceneRepository,
      breakpointBridge: opts?.breakpointBridge || defaultDeps.breakpointBridge,
      lineReader: opts?.lineReader || defaultDeps.lineReader,
      isExternalPendingEdit: opts?.isExternalPendingEdit || defaultDeps.isExternalPendingEdit,
      resolveFingerprintConflict: opts?.resolveFingerprintConflict || defaultDeps.resolveFingerprintConflict,
      conflictDetection: opts?.conflictDetection
    };
  }
  /**
   * 获取当前工作区的场景配置纯数据结构 (只读查询门面)
   */
  loadScenesConfig(workspaceRoot, options) {
    const { sceneRepository } = this.resolveDeps(options);
    if (!sceneRepository) {
      throw new Error("SceneService: sceneRepository must be configured");
    }
    return sceneRepository.loadScenesConfig(workspaceRoot);
  }
  /**
   * 获取当前工作区的场景目录聚合根 (只读查询门面)
   */
  loadCatalog(workspaceRoot, options) {
    return new SceneCatalog(this.loadScenesConfig(workspaceRoot, options));
  }
  /**
   * 分层合并只读查询门面 (v1.3.0 画布投影用)：返回目录聚合根 + 场景级来源溯源表。
   * 仓储未实现分层方法（测试内存替身）时回退单文件语义，originByScene 为空表。
   */
  loadMergedCatalog(workspaceRoot, options) {
    const { sceneRepository } = this.resolveDeps(options);
    const merged = sceneRepository?.loadMergedScenesConfig?.(workspaceRoot);
    if (merged) {
      return { catalog: new SceneCatalog(merged.config), originByScene: merged.originByScene };
    }
    return { catalog: this.loadCatalog(workspaceRoot, options), originByScene: {} };
  }
  /**
   * 激活目标场景并执行多场景合并与自愈闭环
   */
  async activateScene(workspaceRoot, targetScenes, options) {
    return this.queue.enqueue(async () => {
      const deps2 = this.resolveDeps(options);
      return executeSceneActivation({ workspaceRoot, targetScenes, deps: deps2 });
    });
  }
  /**
   * 清空全局断点与激活场景
   */
  async clearAll(workspaceRoot, options) {
    return this.queue.enqueue(async () => {
      sceneStateManager.setApplyingState(true);
      try {
        const { sceneRepository, breakpointBridge } = this.resolveDeps(options);
        if (!breakpointBridge) throw new Error("SceneService: breakpointBridge must be configured");
        if (workspaceRoot && sceneRepository) {
          await mutateCatalog(
            workspaceRoot,
            (catalog) => {
              if (catalog.getActiveScenes().length > 0) {
                catalog.clearActive();
                return true;
              }
              return false;
            },
            { sceneRepository, queue: this.queue, silent: true, syncActive: false }
          );
        }
        await breakpointBridge.clearAllBreakpoints();
        sceneStateManager.clearLastAppliedTopologyHash();
        sceneStateManager.setActiveScene(void 0);
        if (workspaceRoot) {
          appEventBus.emit("scenes:changed", { workspaceRoot, reason: "clearAll" });
        }
      } finally {
        sceneStateManager.setApplyingState(false);
      }
    });
  }
  async exportScene(workspaceRoot, targetScene, mode, options) {
    return this.queue.enqueue(async () => {
      const { sceneRepository, breakpointBridge } = this.resolveDeps(options);
      if (!sceneRepository || !breakpointBridge) {
        throw new Error("SceneService: sceneRepository and breakpointBridge must be configured");
      }
      const exportedBps = await breakpointBridge.collectCurrentBreakpoints(workspaceRoot);
      if (exportedBps.length === 0) return { success: false, count: 0 };
      await mutateCatalog(
        workspaceRoot,
        (catalog) => {
          const scene = catalog.getOrCreateScene(targetScene);
          if (mode === "append") {
            for (const bp of exportedBps) scene.upsertStep(new Breakpoint(bp));
          } else {
            scene.setSteps(exportedBps.map((b) => new Breakpoint(b)));
          }
          return true;
        },
        { sceneRepository, queue: this.queue, reason: "exportScene" }
      );
      return { success: true, count: exportedBps.length };
    });
  }
  /**
   * 创建新空白场景
   */
  async createScene(workspaceRoot, sceneName, options) {
    const target = (sceneName || "").trim();
    if (!target) return false;
    return mutateCatalog(
      workspaceRoot,
      (cat) => {
        if (cat.hasScene(target)) return false;
        cat.getOrCreateScene(target);
        return true;
      },
      { ...options, queue: this.queue }
    );
  }
  /**
   * 重命名现有场景
   */
  async renameScene(workspaceRoot, oldName, newName, options) {
    return mutateCatalog(
      workspaceRoot,
      (cat) => cat.renameScene(oldName, newName),
      {
        ...options,
        renameOrigin: { from: oldName, to: newName },
        queue: this.queue
      }
    );
  }
  /**
   * 删除指定场景
   */
  async deleteScene(workspaceRoot, sceneName, options) {
    return mutateCatalog(
      workspaceRoot,
      (cat) => cat.deleteScene(sceneName),
      { ...options, queue: this.queue }
    );
  }
  /**
   * 克隆场景副本
   */
  async duplicateScene(workspaceRoot, sourceName, targetName, options) {
    return mutateCatalog(
      workspaceRoot,
      (cat) => cat.duplicateScene(sourceName, targetName),
      { ...options, queue: this.queue }
    );
  }
  /**
   * 从外部步骤列表导入场景（支持覆盖与追加合并；断点与引用条目均按声明态适配）
   */
  async importScene(workspaceRoot, sceneName, items, mode = "overwrite", options) {
    const target = (sceneName || "").trim();
    if (!target) return false;
    return mutateCatalog(
      workspaceRoot,
      (catalog) => {
        const scene = catalog.getOrCreateScene(target);
        if (mode === "append") {
          const incoming = new Scene(target, items);
          for (const step of incoming.getSteps()) scene.upsertStep(step);
        } else {
          scene.setSteps(items);
        }
        return true;
      },
      { ...options, queue: this.queue }
    );
  }
  /**
   * 获取场景配置文件物理路径
   */
  getScenesConfigPath(workspaceRoot, options) {
    const { sceneRepository } = this.resolveDeps(options);
    if (!sceneRepository) {
      throw new Error("SceneService: sceneRepository must be configured");
    }
    return sceneRepository.getScenesConfigPath(workspaceRoot);
  }
  /**
   * 确保场景配置文件存在并返回其物理路径
   */
  ensureScenesConfigFile(workspaceRoot, options) {
    const { sceneRepository } = this.resolveDeps(options);
    if (!sceneRepository) {
      throw new Error("SceneService: sceneRepository must be configured");
    }
    const configPath = sceneRepository.getScenesConfigPath(workspaceRoot);
    const config = sceneRepository.loadScenesConfig(workspaceRoot);
    if (!config.scenes) {
      sceneRepository.saveScenesConfig(workspaceRoot, { scenes: {} });
    }
    return configPath;
  }
};
var sceneManager = new SceneManager();

// src/application/breakpointManager.ts
var BreakpointManager = class {
  constructor(queue = applicationSerialQueue) {
    this.queue = queue;
  }
  queue;
  resolveDeps(opts) {
    const defaultDeps = getDependencies();
    return {
      breakpointBridge: opts?.breakpointBridge || defaultDeps.breakpointBridge
    };
  }
  /**
   * 向目标场景添加断点，并根据激活状态执行即刻点亮
   */
  async addBreakpoint(workspaceRoot, targetScene, breakpoint, options) {
    return this.queue.enqueue(async () => {
      let totalBreakpoints = 0;
      const success = await mutateCatalog(
        workspaceRoot,
        (catalog) => {
          const scene = catalog.getOrCreateScene(targetScene);
          scene.upsertStep(new Breakpoint(breakpoint));
          totalBreakpoints = scene.getSteps().length;
          return true;
        },
        {
          ...options,
          syncActive: false,
          // 由下方单点即刻点亮接管
          notify: { sceneName: targetScene },
          queue: this.queue
        }
      );
      if (!success) {
        return { success: false, totalBreakpoints: 0 };
      }
      let isImmediatelyApplied = false;
      const activeScenes = sceneStateManager.getActiveScenes();
      if (activeScenes.includes(targetScene)) {
        const { breakpointBridge } = this.resolveDeps(options);
        const isSuccess = breakpointBridge ? await breakpointBridge.applySingleBreakpointToEditor(workspaceRoot, breakpoint) : false;
        if (isSuccess !== false) {
          sceneStateManager.incrementActiveBaseline();
          isImmediatelyApplied = true;
          appEventBus.emit("breakpoints:changed", { workspaceRoot, sceneName: targetScene });
        }
      }
      return {
        success: true,
        totalBreakpoints,
        isImmediatelyApplied
      };
    });
  }
  /**
   * 移除场景内指定索引断点，若属于激活场景自动联动 DAP 桥接器同步移除 (修复失步缺陷)
   */
  async removeBreakpoint(workspaceRoot, sceneName, index, options) {
    return mutateCatalog(
      workspaceRoot,
      (catalog) => {
        const scene = catalog.getScene(sceneName);
        if (!scene) return false;
        return scene.removeStep(index);
      },
      {
        ...options,
        notify: { sceneName },
        queue: this.queue
      }
    );
  }
  /**
   * 切换场景内指定断点的启用/禁用状态，并同步刷新编辑器
   */
  async toggleBreakpoint(workspaceRoot, sceneName, index, targetEnabled, options) {
    let newEnabled;
    const success = await mutateCatalog(
      workspaceRoot,
      (catalog) => {
        const scene = catalog.getScene(sceneName);
        if (!scene) return false;
        const step = scene.getStep(index);
        if (!step) return false;
        const currentEnabled = step.toJSON().enabled !== false;
        newEnabled = targetEnabled !== void 0 ? targetEnabled : !currentEnabled;
        if (newEnabled !== currentEnabled) step.toggle();
        return true;
      },
      {
        ...options,
        notify: { sceneName },
        queue: this.queue
      }
    );
    if (!success || newEnabled === void 0) {
      return { success: false };
    }
    return {
      success: true,
      newEnabled
    };
  }
  /**
   * 批量启用或禁用场景内的所有断点
   */
  async setAllEnabled(workspaceRoot, sceneName, enabled, options) {
    return mutateCatalog(
      workspaceRoot,
      (catalog) => {
        const scene = catalog.getScene(sceneName);
        if (!scene) return false;
        scene.setAllStepsEnabled(enabled);
        return true;
      },
      {
        ...options,
        notify: { sceneName },
        queue: this.queue
      }
    );
  }
  /**
   * 上移/下移单步微调或置顶/置底断点顺序
   */
  async moveBreakpoint(workspaceRoot, sceneName, index, direction, options) {
    return mutateCatalog(
      workspaceRoot,
      (catalog) => {
        const scene = catalog.getScene(sceneName);
        if (!scene) return false;
        return scene.moveStep(index, direction);
      },
      {
        ...options,
        notify: { sceneName },
        queue: this.queue
      }
    );
  }
  /**
   * 任意索引拖拽或置顶/置底重排断点顺序
   */
  async reorderBreakpoint(workspaceRoot, sceneName, sourceIndex, targetIndex, options) {
    return mutateCatalog(
      workspaceRoot,
      (catalog) => {
        const scene = catalog.getScene(sceneName);
        if (!scene) return false;
        return scene.reorderStep(sourceIndex, targetIndex);
      },
      {
        ...options,
        notify: { sceneName },
        queue: this.queue
      }
    );
  }
  /**
   * 同步外部编辑器断点启闭状态至当前激活场景并写盘
   */
  async syncBreakpointChanges(workspaceRoot, changes, activeScenes, options) {
    if (!changes || changes.length === 0) return false;
    return mutateCatalog(
      workspaceRoot,
      (catalog) => {
        const scenesToSync = activeScenes || catalog.getActiveScenes();
        if (scenesToSync.length === 0) return false;
        let hasChanged = false;
        for (const sName of scenesToSync) {
          const scene = catalog.getScene(sName);
          if (!scene) continue;
          for (const change of changes) {
            if (scene.syncBreakpointEnabled(change)) {
              hasChanged = true;
            }
          }
        }
        return hasChanged;
      },
      {
        ...options,
        syncActive: false,
        // 外部编辑器驱动的同步，禁止反向回环再次刷 DAP (INV-008)
        queue: this.queue
      }
    );
  }
};
var breakpointManager = new BreakpointManager();

// src/application/agentSyncService.ts
var AgentSyncService = class {
  constructor(queue = applicationSerialQueue) {
    this.queue = queue;
  }
  queue;
  /**
   * 全场景伴随指纹静默预加固
   */
  async enrichAllSceneFingerprints(workspaceRoot, options) {
    return this.queue.enqueue(async () => {
      const defaultDeps = getDependencies();
      const sceneRepository = options?.sceneRepository || defaultDeps.sceneRepository;
      const activeLineReader = options?.lineReader || defaultDeps.lineReader;
      if (!sceneRepository) {
        return { enrichedCount: 0, persisted: false };
      }
      const config = sceneRepository.loadScenesConfig(workspaceRoot);
      if (!config || !config.scenes) {
        return { enrichedCount: 0, persisted: false };
      }
      const catalog = new SceneCatalog(config);
      const unfingerprintedBps = catalog.getAllScenes().flatMap((s) => s.getUnfingerprintedBreakpoints());
      if (unfingerprintedBps.length === 0) {
        return { enrichedCount: 0, persisted: false };
      }
      let enrichedCount = 0;
      for (const bp of unfingerprintedBps) {
        if (bp.type === "function") continue;
        const fullPath = bp.resolveFullPath(workspaceRoot);
        const lines = activeLineReader ? await activeLineReader.readLines(fullPath) : void 0;
        if (!lines || lines.length === 0) continue;
        if (bp.enrich(lines)) {
          enrichedCount++;
        }
      }
      if (enrichedCount > 0) {
        sceneRepository.saveScenesConfig(workspaceRoot, catalog.toJSON());
        return { enrichedCount, persisted: true };
      }
      return { enrichedCount: 0, persisted: false };
    });
  }
  /**
   * 静默预补齐场景中可能缺失的代码上下文指纹
   */
  async autoEnrichEmptyFingerprints(workspaceRoot, sceneRepository, lineReader) {
    if (!lineReader) return;
    lineReader.clearCache?.();
    try {
      const configForEnrich = sceneRepository.loadScenesConfig(workspaceRoot);
      const catalogForEnrich = new SceneCatalog(configForEnrich);
      const unfingerprintedBps = catalogForEnrich.getAllScenes().flatMap((s) => s.getUnfingerprintedBreakpoints());
      if (unfingerprintedBps.length === 0) return;
      let enriched = false;
      for (const bp of unfingerprintedBps) {
        if (bp.type === "function") continue;
        const fullPath = bp.resolveFullPath(workspaceRoot);
        const lines = await lineReader.readLines(fullPath);
        if (lines && lines.length > 0 && bp.enrich(lines)) {
          enriched = true;
        }
      }
      if (enriched) {
        sceneRepository.saveScenesConfig(workspaceRoot, catalogForEnrich.toJSON());
      }
    } catch (err) {
      console.warn("[AgentSyncService] Failed to auto-enrich empty fingerprints:", err);
    }
  }
  /**
   * 处理未发生场景增减但断点核心拓扑内容发生变更的情况
   */
  async handleTopologyDiff(workspaceRoot, catalog, currentActives, deps2) {
    const { steps } = expandScenes(catalog, currentActives);
    const merged = steps.map((s) => s.breakpoint.raw);
    const newTopologyHash = computeTopologyHash(merged);
    if (newTopologyHash === sceneStateManager.getLastAppliedTopologyHash()) {
      return { action: "noop" };
    }
    if (deps2.isDebuggingActive) {
      sceneStateManager.setPendingTopologyUpdate(true);
      deps2.onPendingMessage?.();
      return { action: "pending" };
    }
    await deps2.breakpointBridge.applySceneBreakpoints(
      workspaceRoot,
      currentActives.join("+"),
      merged
    );
    sceneStateManager.setLastAppliedTopologyHash(newTopologyHash);
    return { action: "applied", targetScenes: currentActives };
  }
  /**
   * 处理外部 debug-scenes.json 磁盘文件变更与 AI 声明式场景激活
   */
  async handleExternalChange(workspaceRoot, options) {
    return this.queue.enqueue(async () => {
      const defaultDeps = getDependencies();
      const sceneRepository = options?.sceneRepository || defaultDeps.sceneRepository;
      const breakpointBridge = options?.breakpointBridge || defaultDeps.breakpointBridge;
      const allowAiActivation = options?.allowAiActivation ?? false;
      const isDebuggingActive = options?.isDebuggingActive ?? false;
      const activeLineReader = options?.lineReader || defaultDeps.lineReader;
      const onPendingMessage = options?.onPendingMessage;
      if (!sceneRepository || !breakpointBridge) {
        return { action: "noop" };
      }
      if (activeLineReader) {
        await this.autoEnrichEmptyFingerprints(workspaceRoot, sceneRepository, activeLineReader);
      }
      const config = sceneRepository.loadScenesConfig(workspaceRoot);
      const catalog = new SceneCatalog(config);
      const currentActives = sceneStateManager.getActiveScenes();
      const diff = resolveActiveScenesDiff({
        currentActiveScenes: currentActives,
        rawActiveScenes: config.activeScenes,
        allowAiActivation,
        scenesDict: config.scenes
      });
      if (diff.shouldApply) {
        if (diff.action === "apply" && diff.targetScenes && diff.targetScenes.length > 0) {
          await sceneManager.activateScene(workspaceRoot, diff.targetScenes, {
            sceneRepository,
            breakpointBridge,
            lineReader: activeLineReader,
            conflictDetection: options?.conflictDetection
          });
          return { action: "applied", targetScenes: diff.targetScenes };
        } else if (diff.action === "clear") {
          await sceneManager.clearAll(
            workspaceRoot,
            { sceneRepository, breakpointBridge }
          );
          return { action: "cleared" };
        }
      } else if (currentActives.length > 0 && !sceneStateManager.isApplyingScene()) {
        return this.handleTopologyDiff(workspaceRoot, catalog, currentActives, {
          breakpointBridge,
          isDebuggingActive,
          onPendingMessage
        });
      }
      return { action: "noop" };
    });
  }
};
var agentSyncService = new AgentSyncService();

// src/application/agentSkillService.ts
var fs = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));

// src/domain/models/agentRuleAsset.ts
function pureSha256(ascii) {
  function rightRotate(value, amount) {
    return value >>> amount | value << 32 - amount;
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i, j;
  let result = "";
  const words = [];
  const asciiBitLength = ascii.length * 8;
  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = mathPow(candidate, 0.5) * maxWord | 0;
      k[primeCounter++] = mathPow(candidate, 1 / 3) * maxWord | 0;
    }
  }
  ascii += "\x80";
  while (ascii.length % 64 !== 56) ascii += "\0";
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return "";
    words[i >> 2] |= j << (3 - i) % 4 * 8;
  }
  words[words.length] = asciiBitLength / maxWord | 0;
  words[words.length] = asciiBitLength;
  for (j = 0; j < words.length; ) {
    const w = words.slice(j, j += 16);
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ w15 >>> 3;
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ w2 >>> 10;
      w[i] = (i < 16 ? w[i] : w[i - 16] + s0 + w[i - 7] + s1 | 0) | 0;
      const s1_ = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const ch = hash[4] & hash[5] ^ ~hash[4] & hash[6];
      const temp1 = hash[7] + s1_ + ch + k[i] + w[i] | 0;
      const s0_ = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const maj = hash[0] & hash[1] ^ hash[0] & hash[2] ^ hash[1] & hash[2];
      const temp2 = s0_ + maj | 0;
      hash = [temp1 + temp2 | 0, hash[0], hash[1], hash[2], hash[3] + temp1 | 0, hash[4], hash[5], hash[6]];
    }
    for (i = 0; i < 8; i++) {
      hash[i] = hash[i] + oldHash[i] | 0;
    }
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = hash[i] >> j * 8 & 255;
      result += (b < 16 ? 0 : "") + b.toString(16);
    }
  }
  return result;
}
var LATEST_SKILL_VERSION = "1.3.0";
var LATEST_RULE_VERSION = LATEST_SKILL_VERSION;
var OFFICIAL_SKILL_HISTORY = {
  "f026e091703950315e7b7ca2e55a3650af729c2a9512e49bd82e5e695be5ffea": "1.0.3",
  "be86d3a35575f137d075f49867c9a8ead61e60d7c7e43e2f05d26a13c1d21a42": "1.0.8",
  "fa60dde5fac4cf2ca521867909765ed653e41148de1cea824758274753bc39d5": "1.1.0",
  "05a7af959099f4dd4c45e78f2384bd0117b997ce158c20d80358e706a684c902": "1.2.0",
  "8abab22b8137395c6452faea2e611b3b0f0a9ec196acbc12ef41d0f5351dadd5": "1.3.0"
};
var OFFICIAL_RULE_HISTORY = OFFICIAL_SKILL_HISTORY;
var AgentRuleAsset = class _AgentRuleAsset {
  targetPath;
  rawContent;
  constructor(targetPath, rawContent) {
    this.targetPath = targetPath;
    this.rawContent = rawContent || "";
  }
  /**
   * 剥离开头的 YAML / MDC Frontmatter 元数据头，提取纯 Markdown 规则正文
   */
  getCoreBody() {
    return this.rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, "");
  }
  /**
   * 跨操作系统归一化文本（消除 CRLF/LF 与行末空格干扰，严格保障指纹一致性）
   */
  getNormalizedBody() {
    return this.getCoreBody().replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();
  }
  /**
   * 计算规范化核心正文的 SHA-256 唯一指纹
   * 默认使用纯 TS 实现，亦可通过 hasher 端口注入外部实现
   */
  computeFingerprint(hasher) {
    const normalized = this.getNormalizedBody();
    if (typeof hasher === "function") {
      return hasher(normalized);
    }
    if (hasher && typeof hasher.sha256 === "function") {
      return hasher.sha256(normalized);
    }
    const utf8Str = unescape(encodeURIComponent(normalized));
    return pureSha256(utf8Str);
  }
  /**
   * 评估规则文件在工作区中的生命周期状态
   */
  evaluateLifecycle(latestTemplate, hasherOrVersion, hasher) {
    const targetVersion = typeof hasherOrVersion === "string" ? hasherOrVersion : LATEST_RULE_VERSION;
    const actualHasher = typeof hasherOrVersion === "function" || typeof hasherOrVersion === "object" && hasherOrVersion !== null && "sha256" in hasherOrVersion ? hasherOrVersion : hasher;
    const localHash = this.computeFingerprint(actualHasher);
    const latestAsset = new _AgentRuleAsset("builtin-template", latestTemplate);
    const latestHash = latestAsset.computeFingerprint(actualHasher);
    if (localHash === latestHash) {
      return {
        status: "UpToDate",
        detectedVersion: targetVersion,
        localHash,
        latestHash
      };
    }
    if (OFFICIAL_RULE_HISTORY[localHash]) {
      return {
        status: "CleanOutdated",
        detectedVersion: OFFICIAL_RULE_HISTORY[localHash],
        localHash,
        latestHash
      };
    }
    return {
      status: "CustomModified",
      localHash,
      latestHash
    };
  }
};

// src/application/agentSkillService.ts
function formatSkillContent(baseContent, target) {
  const rawBytes = typeof baseContent === "string" ? Buffer.from(baseContent, "utf-8") : baseContent;
  if (target.customHeader) {
    let baseStr = Buffer.from(rawBytes).toString("utf-8");
    baseStr = baseStr.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, "");
    return Buffer.from(target.customHeader + baseStr, "utf-8");
  }
  return rawBytes;
}
function backupSkillFile(targetFilePath) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupPath = `${targetFilePath}.${timestamp}.bak`;
  fs.copyFileSync(targetFilePath, backupPath);
  return backupPath;
}
function getSupportedSkillTargets() {
  return [
    // 1. Antigravity 工作区 Skill 体系 (默认置顶，保证首屏直达)
    {
      id: "antigravity",
      label: "Antigravity",
      description: ".agents/skills/scene-breakpoints/SKILL.md",
      dir: ".agents/skills/scene-breakpoints",
      file: "SKILL.md",
      hostKeywords: ["antigravity"]
    },
    // 2. Trae IDE 技能体系
    {
      id: "trae",
      label: "Trae IDE",
      description: ".trae/skills/scene-breakpoints/SKILL.md",
      dir: ".trae/skills/scene-breakpoints",
      file: "SKILL.md",
      hostKeywords: ["trae"]
    },
    // 3. Cursor IDE 专属 MDC 规则体系
    {
      id: "cursor",
      label: "Cursor",
      description: ".cursor/rules/scene-breakpoints.mdc",
      dir: ".cursor/rules",
      file: "scene-breakpoints.mdc",
      hostKeywords: ["cursor"],
      customHeader: `---
description: Orchestrate and declare breakpoint scenes in .vscode/debug-scenes.json for debugging workflows and code reading
globs: **
---

`
    },
    // 4. VS Code / GitHub Copilot 官方 Skills 体系
    {
      id: "copilot",
      label: "VS Code / GitHub Copilot",
      description: ".github/skills/scene-breakpoints/SKILL.md",
      dir: ".github/skills/scene-breakpoints",
      file: "SKILL.md",
      hostKeywords: ["visual studio code", "vscode", "code"]
    },
    // 5. Windsurf (Codeium) 级联规则体系
    {
      id: "windsurf",
      label: "Windsurf",
      description: ".windsurf/rules/scene-breakpoints.md",
      dir: ".windsurf/rules",
      file: "scene-breakpoints.md",
      hostKeywords: ["windsurf", "codeium"]
    },
    // 6. Cline (Claude Dev) 自主 Agent 规则体系
    {
      id: "cline",
      label: "Cline",
      description: ".clinerules/scene-breakpoints.md",
      dir: ".clinerules",
      file: "scene-breakpoints.md",
      hostKeywords: ["cline"]
    },
    // 7. Roo Code (Roo Cline) 规则体系
    {
      id: "roo",
      label: "Roo Code",
      description: ".roorules/scene-breakpoints.md",
      dir: ".roorules",
      file: "scene-breakpoints.md",
      hostKeywords: ["roo"]
    },
    // 8. Continue.dev 开源 Agent 提示词体系
    {
      id: "continue",
      label: "Continue",
      description: ".continue/prompts/scene-breakpoints.prompt",
      dir: ".continue/prompts",
      file: "scene-breakpoints.prompt",
      hostKeywords: ["continue"]
    }
  ];
}
function isTargetHostMatch(target, hostAppName) {
  if (!hostAppName) return false;
  const lowerHost = hostAppName.toLowerCase();
  if (target.hostKeywords && target.hostKeywords.some((k) => lowerHost.includes(k.toLowerCase()))) {
    return true;
  }
  const baseName = target.label.split(/[\s/]/)[0].toLowerCase();
  return Boolean(baseName && lowerHost.includes(baseName));
}
var AgentSkillService = class {
  getSupportedSkillTargets() {
    return getSupportedSkillTargets();
  }
  formatSkillContent(baseContent, target) {
    return formatSkillContent(baseContent, target);
  }
  backupSkillFile(targetFilePath) {
    return backupSkillFile(targetFilePath);
  }
  /**
   * 全平台巡检：探测指定工作区中所有 AI 平台的规则部署与版本生命周期状态
   */
  inspectSkillTargets(workspaceRoot, officialTemplate, currentVersion = LATEST_SKILL_VERSION, hostAppName) {
    const targets = this.getSupportedSkillTargets();
    const results = [];
    for (const target of targets) {
      const fullPath = path2.join(workspaceRoot, target.dir, target.file);
      const isCurrentHost = isTargetHostMatch(target, hostAppName);
      if (!fs.existsSync(fullPath)) {
        results.push({
          target,
          fullPath,
          exists: false,
          status: "NotInstalled",
          isCurrentHost
        });
        continue;
      }
      results.push(this.inspectExistingTarget(target, fullPath, officialTemplate, currentVersion, isCurrentHost));
    }
    return this.sortInspectedTargets(results);
  }
  inspectExistingTarget(target, fullPath, officialTemplate, currentVersion, isCurrentHost) {
    try {
      const localContent = fs.readFileSync(fullPath, "utf-8");
      if (!officialTemplate) {
        return {
          target,
          fullPath,
          exists: true,
          status: "UpToDate",
          localContent,
          isCurrentHost
        };
      }
      const lifecycle = new AgentRuleAsset("local", localContent).evaluateLifecycle(
        officialTemplate,
        currentVersion
      );
      return {
        target,
        fullPath,
        exists: true,
        status: lifecycle.status,
        detectedVersion: lifecycle.detectedVersion,
        localContent,
        isCurrentHost
      };
    } catch (error) {
      console.warn(`[AgentSkillService] Failed to read ${fullPath}:`, error);
      return {
        target,
        fullPath,
        exists: true,
        status: "CustomModified",
        isCurrentHost
      };
    }
  }
  sortInspectedTargets(items) {
    return [...items].sort((a, b) => {
      if (a.exists && !b.exists) return -1;
      if (!a.exists && b.exists) return 1;
      if (a.isCurrentHost && !b.isCurrentHost) return -1;
      if (!a.isCurrentHost && b.isCurrentHost) return 1;
      return 0;
    });
  }
  /**
   * 将技能模板安全格式化并写入到目标平台的指定路径
   */
  async deploySkillToTarget(workspaceRoot, target, officialTemplate) {
    if (!officialTemplate) {
      return false;
    }
    try {
      const fullDir = path2.join(workspaceRoot, target.dir);
      const fullFile = path2.join(fullDir, target.file);
      const content = this.formatSkillContent(officialTemplate, target);
      await fs.promises.mkdir(fullDir, { recursive: true });
      await fs.promises.writeFile(fullFile, content);
      return true;
    } catch (error) {
      console.warn(`[AgentSkillService] Failed to deploy skill to ${target.file}:`, error);
      return false;
    }
  }
};
var agentSkillService = new AgentSkillService();

// src/application/sceneGraphProjection.ts
function buildBreakpointNode(step, index, registered, isUnmatched) {
  const bp = step.breakpoint;
  const isFunction = bp.type === "function";
  const file = isFunction ? void 0 : bp.file;
  const line = isFunction ? void 0 : bp.line;
  const inferredType = bp.type === "line" && bp.condition ? "condition" : bp.type === "line" && bp.hitCondition ? "hitCount" : bp.type === "line" && bp.logMessage ? "logpoint" : bp.type;
  return {
    id: `${step.ownerScene}#${index}`,
    kind: "breakpoint",
    ownerScene: step.ownerScene,
    refPath: [...step.refPath],
    file,
    line,
    functionName: isFunction ? bp.functionName : void 0,
    bpType: inferredType,
    desc: bp.desc,
    contextSnippet: bp.contextSnippet ? [
      bp.contextSnippet.prev ? `  ${bp.contextSnippet.prev}` : null,
      `> ${bp.contextSnippet.current}`,
      bp.contextSnippet.next ? `  ${bp.contextSnippet.next}` : null
    ].filter(Boolean).join("\n") : void 0,
    condition: bp.condition,
    hitCondition: bp.hitCondition,
    logMessage: bp.logMessage,
    enabled: bp.enabled,
    status: isUnmatched?.(file, line) ? "unmatched" : "idle",
    registered
  };
}
function buildRefPlaceholderNode(w, occurrence, registered) {
  const ownerScene = w.refPath[w.refPath.length - 1] ?? w.refName;
  const suffix = occurrence >= 2 ? `@${occurrence - 1}` : "";
  return {
    id: `${w.refPath.join(">")}#ref-${w.refName}${suffix}`,
    kind: "scene-ref",
    ownerScene,
    refPath: [...w.refPath],
    refName: w.refName,
    enabled: w.code !== "disabled-ref",
    status: "idle",
    registered
  };
}
function buildGraphSnapshot(input) {
  const { workspaceRoot, catalog, originByScene, isUnmatched } = input;
  const allSceneNames = catalog.getSceneNames();
  const activeScenes = [...new Set(input.activeScenes)];
  const activeSet = new Set(activeScenes);
  const visibleScenes = [...new Set(input.visibleScenes ?? input.activeScenes)];
  const availableScenes = allSceneNames.map((name) => ({
    name,
    layer: originByScene?.[name] ?? "team",
    registered: activeSet.has(name)
  }));
  if (visibleScenes.length === 0) {
    return { workspaceRoot, activeScenes, availableScenes, lanes: [], warnings: [] };
  }
  const lanes = [];
  const allWarnings = [];
  for (const sceneName of visibleScenes) {
    let cyclePath;
    let steps = [];
    let warnings = [];
    try {
      const res = expandScene(catalog, sceneName);
      steps = res.steps;
      warnings = res.warnings;
    } catch (err) {
      if (err instanceof CircularReferenceError) {
        cyclePath = err.cyclePath;
      } else {
        throw err;
      }
    }
    const laneRegistered = activeSet.has(sceneName);
    const laneNodes = [];
    const ownerCounters = /* @__PURE__ */ new Map();
    for (const step of steps) {
      const index = ownerCounters.get(step.ownerScene) ?? 0;
      ownerCounters.set(step.ownerScene, index + 1);
      const isRegistered = activeSet.has(sceneName) || activeSet.has(step.ownerScene);
      laneNodes.push(buildBreakpointNode(step, index, isRegistered, isUnmatched));
    }
    const refOccurrence = /* @__PURE__ */ new Map();
    for (const warning of warnings) {
      const key = `${warning.refPath.join(">")}|${warning.refName}|${warning.code}`;
      const occurrence = (refOccurrence.get(key) ?? 0) + 1;
      refOccurrence.set(key, occurrence);
      laneNodes.push(buildRefPlaceholderNode(warning, occurrence, laneRegistered));
      allWarnings.push({
        code: warning.code,
        refName: warning.refName,
        refPath: warning.refPath
      });
    }
    lanes.push({
      id: `scene:${sceneName}`,
      sceneName,
      layer: originByScene?.[sceneName] ?? "team",
      registered: laneRegistered,
      expandError: cyclePath ? { code: "circular-ref", cyclePath: [...cyclePath] } : void 0,
      nodes: laneNodes
    });
  }
  return { workspaceRoot, activeScenes, availableScenes, lanes, warnings: allWarnings };
}
function findNodeByLocation(snapshot, file, line) {
  for (const lane of snapshot.lanes) {
    for (const node of lane.nodes) {
      if (node.kind !== "breakpoint") continue;
      if (node.file === void 0 || node.line === void 0) continue;
      if (node.line !== line) continue;
      if (isFilePathMatch(file, node.file, snapshot.workspaceRoot || void 0)) {
        return node;
      }
    }
  }
  return void 0;
}
function findNodeById(snapshot, nodeId) {
  for (const lane of snapshot.lanes) {
    const found = lane.nodes.find((node) => node.id === nodeId);
    if (found) return found;
  }
  return void 0;
}
function createNodeIdResolver(snapshot) {
  return (file, line) => findNodeByLocation(snapshot, file, line)?.id ?? null;
}

// src/application/debugTraceBuffer.ts
var DebugTraceBuffer = class {
  records = [];
  nextSeq = 1;
  startTs = null;
  nodeIdResolver;
  disposables = [];
  needsSessionReset = false;
  constructor(nodeIdResolver = null) {
    this.nodeIdResolver = nodeIdResolver;
  }
  /** 注入/更新 nodeId 解析器（画布快照重建时由控制器刷新） */
  setNodeIdResolver(resolver) {
    this.nodeIdResolver = resolver;
  }
  /** 订阅调试事件（扩展装配时调用，与 dispose 成对；幂等守卫） */
  init() {
    if (this.disposables.length > 0) return;
    this.disposables.push(
      appEventBus.on("debug:started", () => {
        this.clear();
        this.needsSessionReset = false;
      }),
      appEventBus.on("debug:paused", ({ file, line }) => {
        this.append(file, line);
      }),
      appEventBus.on("debug:terminated", () => {
        this.needsSessionReset = true;
      })
    );
  }
  /** 追加一条命中记录（seq 递增；ts 相对会话首次命中） */
  append(file, line) {
    if (this.needsSessionReset) {
      this.clear();
      this.needsSessionReset = false;
    }
    const now = Date.now();
    const last = this.records[this.records.length - 1];
    if (last && last.file === file && last.line === line && now - (last.wallTime ?? this.startTs + last.ts) < 500) {
      return last;
    }
    if (this.startTs === null) {
      this.startTs = now;
    }
    const record = {
      seq: this.nextSeq++,
      nodeId: this.nodeIdResolver?.(file, line) ?? null,
      file,
      line,
      ts: now - this.startTs,
      wallTime: now
    };
    this.records.push(record);
    return record;
  }
  /** 只读副本（外部变异不影响内部状态） */
  getRecords() {
    return this.records.map((record) => ({ ...record }));
  }
  getSize() {
    return this.records.length;
  }
  /** 全量清空（会话终止时触发；resumed 不清空） */
  clear() {
    this.records = [];
    this.nextSeq = 1;
    this.startTs = null;
  }
  /** 退订事件并清空状态（扩展卸载时调用） */
  dispose() {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.clear();
  }
};
var debugTraceBuffer = new DebugTraceBuffer();

// src/ui/views/sceneTreeProvider.ts
var vscode3 = __toESM(require("vscode"));

// src/ui/utils/commandRunner.ts
var path3 = __toESM(require("node:path"));
var vscode = __toESM(require("vscode"));
function getWorkspaceRoot(warnIfMissing = false) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    if (warnIfMissing) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t("Please open a workspace folder to use Scene Breakpoints.")
      );
    }
    return void 0;
  }
  return folders[0].uri.fsPath;
}
async function runWithWorkspace(warnOrHandler, maybeHandler) {
  const warnIfMissing = typeof warnOrHandler === "boolean" ? warnOrHandler : true;
  const handler = typeof warnOrHandler === "function" ? warnOrHandler : maybeHandler;
  const workspaceRoot = getWorkspaceRoot(warnIfMissing);
  if (!workspaceRoot) {
    return void 0;
  }
  try {
    return await handler(workspaceRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      vscode.l10n.t("Command failed: {0}", message)
    );
    return void 0;
  }
}
async function runWithActiveEditor(handler) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(vscode.l10n.t("No active editor file detected"));
    return void 0;
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : getWorkspaceRoot(false) || path3.dirname(editor.document.fileName);
  try {
    return await handler(editor, workspaceRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      vscode.l10n.t("Command failed: {0}", message)
    );
    return void 0;
  }
}

// src/ui/views/treeNodes.ts
var path4 = __toESM(require("node:path"));
var vscode2 = __toESM(require("vscode"));
var TreeViewState = class {
  expandedScenes = /* @__PURE__ */ new Set();
  markExpanded(sceneName) {
    this.expandedScenes.add(sceneName);
  }
  markCollapsed(sceneName) {
    this.expandedScenes.delete(sceneName);
  }
  isExpanded(sceneName) {
    return this.expandedScenes.has(sceneName);
  }
  clearExpanded() {
    this.expandedScenes.clear();
  }
};
var treeViewState = new TreeViewState();
var SceneNode = class extends vscode2.TreeItem {
  constructor(sceneName, breakpointCount, isActive, isDirty, isExpanded = treeViewState.isExpanded(sceneName) || isActive) {
    super(
      sceneName,
      isExpanded ? vscode2.TreeItemCollapsibleState.Expanded : vscode2.TreeItemCollapsibleState.Collapsed
    );
    this.sceneName = sceneName;
    this.breakpointCount = breakpointCount;
    this.isActive = isActive;
    this.isDirty = isDirty;
    let desc = vscode2.l10n.t("{0} breakpoint(s)", breakpointCount);
    if (isActive) {
      desc = isDirty ? `${desc}  \u2022  ${vscode2.l10n.t("(Active - Unsaved*)")}` : `${desc}  \u2022  ${vscode2.l10n.t("(Active)")}`;
    }
    this.description = desc;
    if (isActive) {
      this.iconPath = new vscode2.ThemeIcon("debug-alt", new vscode2.ThemeColor("charts.green"));
      this.contextValue = "activeSceneItem";
    } else {
      this.iconPath = new vscode2.ThemeIcon("symbol-event");
      this.contextValue = "sceneItem";
    }
    this.id = `scene:${sceneName}`;
    this.tooltip = vscode2.l10n.t("Scene: [{0}] ({1} breakpoints)", sceneName, breakpointCount);
  }
  sceneName;
  breakpointCount;
  isActive;
  isDirty;
  static get expandedScenes() {
    return treeViewState.expandedScenes;
  }
  static isExpanded(sceneName) {
    return treeViewState.isExpanded(sceneName);
  }
  static markExpanded(sceneName) {
    treeViewState.markExpanded(sceneName);
  }
  static markCollapsed(sceneName) {
    treeViewState.markCollapsed(sceneName);
  }
  static clearExpanded() {
    treeViewState.clearExpanded();
  }
};
function resolveBreakpointIconFileName(breakpointType, isEnabled, isPaused, isUnmatched, sourceType) {
  if (isPaused) return "bp-paused.svg";
  if (isUnmatched) {
    return isEnabled ? "bp-unmatched-enabled.svg" : "bp-unmatched-disabled.svg";
  }
  let iconBase = "bp-line";
  if (breakpointType === "function") {
    iconBase = "bp-func";
  } else {
    switch (sourceType) {
      case "condition":
        iconBase = "bp-cond";
        break;
      case "hitCount":
        iconBase = "bp-hit";
        break;
      case "logpoint":
        iconBase = "bp-log";
        break;
      default:
        iconBase = "bp-line";
        break;
    }
  }
  return `${iconBase}-${isEnabled ? "enabled" : "disabled"}.svg`;
}
var BreakpointNode = class extends vscode2.TreeItem {
  constructor(sceneName, index, breakpoint, workspaceRoot, extensionPath, pausedLocation = null, options) {
    const isFunc = breakpoint.type === "function";
    const label = isFunc ? `\u0192 ${breakpoint.functionName}()` : `${path4.basename(breakpoint.file || "")}:${breakpoint.line}`;
    super(label, vscode2.TreeItemCollapsibleState.None);
    this.sceneName = sceneName;
    this.index = index;
    this.breakpoint = breakpoint;
    this.workspaceRoot = workspaceRoot;
    this.extensionPath = extensionPath;
    this.pausedLocation = pausedLocation;
    this.options = options;
    const bpIdentifier = isFunc ? breakpoint.functionName : `${breakpoint.file}:${breakpoint.line}`;
    this.id = `bp:${sceneName}:${index}:${bpIdentifier}`;
    if (!isFunc) {
      const srcBp = breakpoint;
      const fullFilePath = path4.isAbsolute(srcBp.file) ? srcBp.file : path4.join(workspaceRoot, srcBp.file);
      const targetLine = Math.max(0, srcBp.line - 1);
      this.command = {
        command: "vscode.open",
        title: vscode2.l10n.t("Open File"),
        arguments: [
          vscode2.Uri.file(fullFilePath),
          {
            selection: new vscode2.Range(targetLine, 0, targetLine, 0),
            preview: true
          }
        ]
      };
    }
    this.updateAppearance();
  }
  sceneName;
  index;
  breakpoint;
  workspaceRoot;
  extensionPath;
  pausedLocation;
  options;
  setPausedLocation(loc) {
    this.pausedLocation = loc;
    this.updateAppearance();
  }
  isReadonly() {
    return this.options?.readonly === true;
  }
  isPausedAtBreakpoint() {
    if (!this.pausedLocation || this.breakpoint.type === "function") {
      return false;
    }
    const srcBp = this.breakpoint;
    if (Number(srcBp.line) !== Number(this.pausedLocation.line)) {
      return false;
    }
    return isFilePathMatch(this.pausedLocation.file, srcBp.file, this.workspaceRoot);
  }
  isUnmatched() {
    if (this.breakpoint.type === "function") return false;
    if (this.options?.isUnmatched !== void 0) {
      return this.options.isUnmatched;
    }
    const srcBp = this.breakpoint;
    return sceneStateManager.isSceneActive(this.sceneName) && sceneStateManager.isBreakpointUnmatched(srcBp.file, srcBp.line);
  }
  updateAppearance() {
    const isEnabled = this.breakpoint.enabled ?? true;
    this.checkboxState = this.isReadonly() ? void 0 : isEnabled ? vscode2.TreeItemCheckboxState.Checked : vscode2.TreeItemCheckboxState.Unchecked;
    const isPaused = this.isPausedAtBreakpoint();
    const hintText = this.isReadonly() ? vscode2.l10n.t("Breakpoints inside a referenced scene are read-only. Edit them in the source scene.") : vscode2.l10n.t("Tip: Drag to reorder, or use Alt+\u2191 / Alt+\u2193 to move");
    this.buildDescriptionAndTooltip(isPaused, hintText);
    const srcBp = this.breakpoint.type !== "function" ? this.breakpoint : void 0;
    const iconFileName = resolveBreakpointIconFileName(
      this.breakpoint.type,
      isEnabled,
      isPaused,
      this.isUnmatched(),
      srcBp?.type
    );
    this.iconPath = vscode2.Uri.file(path4.join(this.extensionPath, "media", "icons", iconFileName));
    this.contextValue = this.isReadonly() ? "breakpointReadonly" : isEnabled ? "breakpointItemEnabled" : "breakpointItemDisabled";
  }
  buildDescriptionAndTooltip(isPaused, hintText) {
    if (this.breakpoint.type === "function") {
      const funcBp = this.breakpoint;
      this.description = funcBp.desc || funcBp.condition || funcBp.hitCondition;
      const md2 = new vscode2.MarkdownString();
      md2.appendMarkdown(`**${vscode2.l10n.t("Function Breakpoint: {0}", funcBp.functionName)}**`);
      if (funcBp.desc) md2.appendMarkdown(`

${funcBp.desc}`);
      md2.appendMarkdown(`

---
*\u{1F4A1} ${hintText}*`);
      this.tooltip = md2;
      return;
    }
    const srcBp = this.breakpoint;
    const isUnmatched = this.isUnmatched();
    let extra = srcBp.desc;
    if (!extra) {
      if (srcBp.type === "condition") extra = `? ${srcBp.condition}`;
      else if (srcBp.type === "hitCount") extra = `# ${srcBp.hitCondition}`;
      else if (srcBp.type === "logpoint") extra = `log: "${srcBp.logMessage}"`;
    }
    if (isUnmatched) {
      const unmatchTag = `[${vscode2.l10n.t("Unmatched")}]`;
      extra = extra ? `${unmatchTag}  \u2022  ${extra}` : unmatchTag;
    }
    if (isPaused) {
      const pausedTag = `\u25B6 ${vscode2.l10n.t("[PAUSED]")}`;
      extra = extra ? `${pausedTag}  \u2022  ${extra}` : pausedTag;
    }
    this.description = extra;
    const md = new vscode2.MarkdownString();
    if (isPaused) {
      md.appendMarkdown(`\u25B6 **[${vscode2.l10n.t("Currently Paused Here")}]**

`);
    }
    if (isUnmatched) {
      md.appendMarkdown(`\u26A0\uFE0F **[${vscode2.l10n.t("Unmatched")}]** ${vscode2.l10n.t("Could not match current code (fell back to original line)")}

`);
    }
    md.appendMarkdown(`\`${srcBp.file}:${srcBp.line}\``);
    if (srcBp.desc) md.appendMarkdown(`

${srcBp.desc}`);
    md.appendMarkdown(`

---
*\u{1F4A1} ${hintText}*`);
    this.tooltip = md;
  }
};
var PlaceholderNode = class extends vscode2.TreeItem {
  constructor(message, icon = "info") {
    super(message, vscode2.TreeItemCollapsibleState.None);
    this.iconPath = new vscode2.ThemeIcon(icon);
    this.contextValue = "placeholderItem";
  }
};
function buildNodeId(parts) {
  return parts.join("/");
}
var SceneRefTreeItem = class extends vscode2.TreeItem {
  constructor(ctx, options) {
    super(ctx.refName, vscode2.TreeItemCollapsibleState.Collapsed);
    this.ctx = ctx;
    this.id = buildNodeId(ctx.path);
    this.description = options.isDangling ? vscode2.l10n.t('Dangling reference: scene "{0}" not found', ctx.refName) : options.desc ?? vscode2.l10n.t("{0} breakpoints", options.childCount);
    this.contextValue = !options.enabled ? "sceneRefDisabled" : options.isDangling || options.childCount === 0 ? "sceneRefEmpty" : "sceneRef";
    this.isEnabled = options.enabled;
    if (options.isDangling) {
      this.iconPath = new vscode2.ThemeIcon("error", new vscode2.ThemeColor("charts.red"));
    } else if (options.extensionPath) {
      const iconFileName = options.enabled ? "scene-ref-enabled.svg" : "scene-ref-disabled.svg";
      this.iconPath = vscode2.Uri.file(path4.join(options.extensionPath, "media", "icons", iconFileName));
    } else {
      this.iconPath = options.enabled ? new vscode2.ThemeIcon("references") : new vscode2.ThemeIcon("circle-slash");
    }
  }
  ctx;
  /** 引用当前启停状态（toggleSceneRef 的翻转基准） */
  isEnabled;
  /** 声明所在场景（toggle/remove/move 的路由目标） */
  get sceneName() {
    return this.ctx.sceneName;
  }
  /** 被引用场景名 */
  get refName() {
    return this.ctx.refName;
  }
  /** 在父 steps 中的声明索引（多态操作定位） */
  get index() {
    return this.ctx.index;
  }
};

// src/ui/views/sceneRefProjection.ts
function projectSteps(sceneName, steps, scenes, ctx) {
  const refCounts = /* @__PURE__ */ new Map();
  for (const item of steps) {
    if (item && item.type === "scene") {
      refCounts.set(item.name, (refCounts.get(item.name) ?? 0) + 1);
    }
  }
  const emittedRefs = /* @__PURE__ */ new Map();
  return steps.map((item, idx) => {
    if (item && item.type === "scene") {
      const sourceSteps = scenes[item.name];
      const occurrence = (emittedRefs.get(item.name) ?? 0) + 1;
      emittedRefs.set(item.name, occurrence);
      const idSuffix = occurrence >= 2 ? `@${idx}` : "";
      return new SceneRefTreeItem(
        {
          sceneName,
          refName: item.name,
          path: [...ctx.path, `ref:${item.name}${idSuffix}`],
          index: idx
        },
        {
          desc: item.desc,
          enabled: item.enabled !== false,
          childCount: Array.isArray(sourceSteps) ? sourceSteps.length : 0,
          isDangling: !Array.isArray(sourceSteps),
          extensionPath: ctx.extensionPath
        }
      );
    }
    const bpNode = new BreakpointNode(
      sceneName,
      idx,
      item,
      ctx.workspaceRoot,
      ctx.extensionPath,
      ctx.pausedLocation,
      { readonly: ctx.readonly }
    );
    if (ctx.readonly) {
      bpNode.id = buildNodeId([...ctx.path, `bp:${idx}`]);
    }
    return bpNode;
  });
}
function projectSceneStepNodes(sceneName, workspaceRoot, extensionPath, pausedLocation) {
  const config = sceneManager.loadScenesConfig(workspaceRoot);
  const steps = config.scenes[sceneName] ?? [];
  return projectSteps(sceneName, steps, config.scenes, {
    workspaceRoot,
    extensionPath,
    pausedLocation,
    path: [`scene:${sceneName}`],
    readonly: false
  });
}
function projectRefChildNodes(refNode, workspaceRoot, extensionPath, pausedLocation) {
  const config = sceneManager.loadScenesConfig(workspaceRoot);
  const sourceSteps = config.scenes[refNode.ctx.refName];
  if (!Array.isArray(sourceSteps)) return [];
  return projectSteps(
    refNode.ctx.refName,
    sourceSteps,
    config.scenes,
    {
      workspaceRoot,
      extensionPath,
      pausedLocation,
      path: [...refNode.ctx.path],
      readonly: true
    }
  );
}

// src/ui/views/sceneTreeProvider.ts
var SceneTreeDataProvider = class {
  constructor(extensionPath = "") {
    this.extensionPath = extensionPath;
    this._busDisposables.push(
      appEventBus.on("scenes:changed", () => this.refresh()),
      appEventBus.on("scene:activated", () => this.refresh()),
      appEventBus.on("breakpoints:changed", () => this.refresh()),
      appEventBus.on("debug:paused", async ({ file, line }) => {
        await this.revealPausedLocation(file, line);
      }),
      appEventBus.on("debug:resumed", () => {
        this.clearPausedLocation();
      })
    );
  }
  extensionPath;
  dropMimeTypes = ["application/vnd.code.tree.sceneBreakpointsView"];
  dragMimeTypes = ["application/vnd.code.tree.sceneBreakpointsView"];
  _onDidChangeTreeData = new vscode3.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  _pausedLocation = null;
  _sceneNodesMap = /* @__PURE__ */ new Map();
  _activeBreakpointNodes = [];
  _boundTreeView;
  _expandedSceneNames = /* @__PURE__ */ new Set();
  _busDisposables = [];
  markSceneExpanded(sceneName) {
    this._expandedSceneNames.add(sceneName);
  }
  markSceneCollapsed(sceneName) {
    this._expandedSceneNames.delete(sceneName);
  }
  isSceneExpanded(sceneName) {
    return this._expandedSceneNames.has(sceneName);
  }
  dispose() {
    for (const d of this._busDisposables) {
      d.dispose();
    }
    this._busDisposables.length = 0;
    this._onDidChangeTreeData.dispose();
  }
  handleDrag(source, treeDataTransfer, _token) {
    const bpNodes = source.filter(
      (item) => item instanceof BreakpointNode && !item.isReadonly()
    );
    if (bpNodes.length > 0) {
      treeDataTransfer.set(
        "application/vnd.code.tree.sceneBreakpointsView",
        new vscode3.DataTransferItem(bpNodes)
      );
    }
  }
  async handleDrop(target, sources, _token) {
    const transferItem = sources.get("application/vnd.code.tree.sceneBreakpointsView");
    if (!transferItem || !transferItem.value) return;
    const draggedNodes = transferItem.value;
    if (!Array.isArray(draggedNodes) || draggedNodes.length === 0) return;
    const sourceNode = draggedNodes[0];
    if (!sourceNode || !(sourceNode instanceof BreakpointNode) || typeof sourceNode.index !== "number") return;
    let targetSceneName;
    let targetIndex;
    if (target instanceof BreakpointNode) {
      targetSceneName = target.sceneName;
      targetIndex = target.index;
    } else if (target instanceof SceneNode) {
      targetSceneName = target.sceneName;
      targetIndex = 0;
    }
    if (!targetSceneName || targetSceneName !== sourceNode.sceneName || typeof targetIndex !== "number") {
      return;
    }
    const workspaceRoot = getWorkspaceRoot(true);
    if (!workspaceRoot) return;
    const reordered = await breakpointManager.reorderBreakpoint(
      workspaceRoot,
      targetSceneName,
      sourceNode.index,
      targetIndex
    );
    if (reordered) {
      this.refresh();
    }
  }
  setPausedLocation(file, line) {
    this._pausedLocation = { file, line };
    for (const node of this._activeBreakpointNodes) {
      node.setPausedLocation(this._pausedLocation);
    }
    this.refresh();
  }
  clearPausedLocation() {
    if (this._pausedLocation) {
      this._pausedLocation = null;
      for (const node of this._activeBreakpointNodes) {
        node.setPausedLocation(null);
      }
      this.refresh();
    }
  }
  getPausedLocation() {
    return this._pausedLocation;
  }
  findPausedBreakpointNode() {
    if (!this._pausedLocation) return void 0;
    return this._activeBreakpointNodes.find((n) => n.isPausedAtBreakpoint());
  }
  getParent(element) {
    if (element instanceof BreakpointNode) {
      const parent = this._sceneNodesMap.get(element.sceneName);
      if (parent) return parent;
      return new SceneNode(element.sceneName, 0, sceneStateManager.isSceneActive(element.sceneName), false);
    }
    return void 0;
  }
  refresh(element) {
    this._onDidChangeTreeData.fire(element);
  }
  getTreeItem(element) {
    if (element instanceof BreakpointNode) {
      element.updateAppearance();
    }
    return element;
  }
  /**
   * 获取指定场景内的所有步骤树节点（深接口，声明态嵌套投影：引用节点 + 断点节点）
   * 供 getChildren 与命令层查询使用，避免外部伪造 SceneNode 实例
   */
  getBreakpointNodes(sceneName) {
    const workspaceRoot = getWorkspaceRoot(false);
    if (!workspaceRoot) return [];
    return projectSceneStepNodes(sceneName, workspaceRoot, this.extensionPath, this._pausedLocation);
  }
  async getChildren(element) {
    const workspaceRoot = getWorkspaceRoot(false);
    if (!workspaceRoot) {
      return [new PlaceholderNode(vscode3.l10n.t("Open a workspace folder to view scenes"))];
    }
    if (!element) {
      const config = sceneManager.loadScenesConfig(workspaceRoot);
      const sceneNames = Object.keys(config.scenes || {});
      if (sceneNames.length === 0) {
        return [
          new PlaceholderNode(
            vscode3.l10n.t("No scenes yet. Click + to create or export breakpoints"),
            "add"
          )
        ];
      }
      const activeScenes = sceneStateManager.getActiveScenes();
      const isDirty = sceneStateManager.getIsDirty();
      this._sceneNodesMap.clear();
      return sceneNames.map((name) => {
        const bps = config.scenes && Array.isArray(config.scenes[name]) ? config.scenes[name] : [];
        const isActive = activeScenes.includes(name);
        const isExpanded = this.isSceneExpanded(name) || isActive;
        const node = new SceneNode(name, bps.length, isActive, isDirty && isActive, isExpanded);
        this._sceneNodesMap.set(name, node);
        return node;
      });
    }
    if (element instanceof SceneNode) {
      const nodes = await this.getBreakpointNodes(element.sceneName);
      if (nodes.length === 0) {
        return [new PlaceholderNode(vscode3.l10n.t("No breakpoints in this scene"))];
      }
      const bpNodes = nodes.filter((n) => n instanceof BreakpointNode);
      this._activeBreakpointNodes = this._activeBreakpointNodes.filter((n) => n.sceneName !== element.sceneName).concat(bpNodes);
      return nodes;
    }
    if (element instanceof SceneRefTreeItem) {
      return projectRefChildNodes(element, workspaceRoot, this.extensionPath, this._pausedLocation);
    }
    return [];
  }
  /**
   * 统一高亮与自动展开调试运行时命中的断点节点 (UI 呈现深接口)
   */
  async revealPausedLocation(treeViewOrFile, fileOrLine, lineOrNothing) {
    let treeView;
    let file;
    let line;
    if (typeof treeViewOrFile === "string") {
      file = treeViewOrFile;
      line = typeof fileOrLine === "number" ? fileOrLine : 0;
      treeView = this._boundTreeView;
    } else {
      treeView = treeViewOrFile;
      file = typeof fileOrLine === "string" ? fileOrLine : "";
      line = typeof lineOrNothing === "number" ? lineOrNothing : 0;
    }
    const workspaceRoot = getWorkspaceRoot(false);
    if (!workspaceRoot) {
      this.setPausedLocation(file, line);
      return;
    }
    const activeScenes = sceneStateManager.getActiveScenes();
    if (activeScenes.length === 0) return;
    if (!activeBreakpointIndex.isUpToDate(workspaceRoot, activeScenes)) {
      const config = sceneManager.loadScenesConfig(workspaceRoot);
      activeBreakpointIndex.syncFromConfig(workspaceRoot, config, activeScenes);
    }
    const activeBp = activeBreakpointIndex.findActiveBreakpoint(file, line, workspaceRoot);
    if (!activeBp) {
      return;
    }
    const hitSceneName = activeBp.sceneName;
    this.setPausedLocation(file, line);
    let pausedNode = this.findPausedBreakpointNode();
    if (!pausedNode && hitSceneName && treeView) {
      const config = sceneManager.loadScenesConfig(workspaceRoot);
      const bps = config.scenes[hitSceneName] || [];
      const parentNode = new SceneNode(hitSceneName, bps.length, true, false);
      try {
        await treeView.reveal(parentNode, { expand: true });
        await this.getChildren(parentNode);
        pausedNode = this.findPausedBreakpointNode();
      } catch {
      }
    }
    if (pausedNode && treeView) {
      try {
        await treeView.reveal(pausedNode, { select: true, focus: false });
      } catch {
      }
    }
  }
  /**
   * 绑定 VS Code TreeView 原生视图实例
   * 统一接管展开/折叠状态持久化记忆、复选框点击局部静默刷新与领域状态变更监听
   */
  bindView(treeView) {
    this._boundTreeView = treeView;
    const disposables = [];
    disposables.push(
      treeView.onDidExpandElement((e) => {
        if (e.element instanceof SceneNode) {
          this.markSceneExpanded(e.element.sceneName);
          treeViewState.markExpanded(e.element.sceneName);
        }
      }),
      treeView.onDidCollapseElement((e) => {
        if (e.element instanceof SceneNode) {
          this.markSceneCollapsed(e.element.sceneName);
          treeViewState.markCollapsed(e.element.sceneName);
        }
      })
    );
    disposables.push(
      sceneStateManager.onDidChangeState(() => {
        this.refresh();
      })
    );
    disposables.push(
      treeView.onDidChangeCheckboxState(async (e) => {
        const workspaceRoot = getWorkspaceRoot(true);
        if (!workspaceRoot) return;
        for (const [item, state] of e.items) {
          if (item instanceof BreakpointNode && item.sceneName && typeof item.index === "number") {
            const newEnabled = state === vscode3.TreeItemCheckboxState.Checked;
            const result = await breakpointManager.toggleBreakpoint(
              workspaceRoot,
              item.sceneName,
              item.index,
              newEnabled
            );
            if (result.success) {
              item.breakpoint.enabled = result.newEnabled;
              item.updateAppearance();
              this.refresh(item);
            }
          }
        }
      })
    );
    return vscode3.Disposable.from(...disposables);
  }
};

// src/ui/views/statusBarView.ts
var vscode4 = __toESM(require("vscode"));
var statusBarItem;
function getStatusBarItem() {
  return statusBarItem;
}
function initStatusBarItem(context) {
  statusBarItem = vscode4.window.createStatusBarItem(vscode4.StatusBarAlignment.Left, 10);
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
      statusBarItem.tooltip = vscode4.l10n.t(
        "Current Scene: [{0}] (Unsaved temporary breakpoints present. Click or Ctrl+Alt+S to open Menu)",
        fullNames
      );
    } else {
      statusBarItem.text = `$(circle-filled) Scene: ${label}`;
      statusBarItem.color = "#49c998";
      statusBarItem.tooltip = vscode4.l10n.t(
        "Current Scene: [{0}] (Click or Ctrl+Alt+S to open Scene Menu)",
        fullNames
      );
    }
  } else {
    statusBarItem.text = `$(circle-outline) Scene: (None)`;
    statusBarItem.color = void 0;
    statusBarItem.tooltip = vscode4.l10n.t("No scene active (Click or Ctrl+Alt+S to open Scene Menu)");
  }
}

// src/ui/views/sceneCodeLensProvider.ts
var vscode5 = __toESM(require("vscode"));
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
      const cleaned = stripComments(document.getText());
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
            const range = new vscode5.Range(i, 0, i, 0);
            const title = isActive ? vscode5.l10n.t("\u2714 Active ({0} bps)", count) : vscode5.l10n.t("\u25B6 Apply Scene ({0} bps)", count);
            lenses.push(
              new vscode5.CodeLens(range, {
                title,
                tooltip: vscode5.l10n.t("Click to activate this scene and clean other breakpoints"),
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

// src/ui/views/sceneInlayHintsProvider.ts
var vscode6 = __toESM(require("vscode"));
var SceneInlayHintsProvider = class {
  _onDidChangeInlayHints = new vscode6.EventEmitter();
  onDidChangeInlayHints = this._onDidChangeInlayHints.event;
  disposables = [];
  configLoader;
  workspaceRootGetter;
  enabledGetter;
  constructor(configLoader, workspaceRootGetter, enabledGetter) {
    this.workspaceRootGetter = workspaceRootGetter ?? (() => getWorkspaceRoot(false));
    this.configLoader = configLoader ?? (() => {
      const ws = this.workspaceRootGetter();
      return ws ? sceneManager.loadScenesConfig(ws) : { scenes: {} };
    });
    this.enabledGetter = enabledGetter ?? (() => {
      const conf = vscode6.workspace.getConfiguration("sceneBreakpoints");
      const val = conf.get("inlayHints.enabled");
      return val !== false;
    });
    this.disposables.push(
      sceneStateManager.onDidChangeState(() => {
        this.refresh();
      }),
      appEventBus.on("breakpoints:changed", () => {
        this.refresh();
      }),
      appEventBus.on("scenes:changed", () => {
        if (sceneStateManager.getActiveScenes().length > 0) {
          this.refresh();
        }
      })
    );
    if (vscode6.window.onDidChangeVisibleTextEditors) {
      this.disposables.push(
        vscode6.window.onDidChangeVisibleTextEditors((editors) => {
          this.updateDecorations(editors);
        })
      );
    }
    if (vscode6.window.onDidChangeActiveTextEditor) {
      this.disposables.push(
        vscode6.window.onDidChangeActiveTextEditor((editor) => {
          if (editor) {
            this.updateDecorations([editor]);
          }
        })
      );
    }
    if (vscode6.workspace.onDidChangeConfiguration) {
      this.disposables.push(
        vscode6.workspace.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration("sceneBreakpoints.inlayHints")) {
            this.refresh();
          }
        })
      );
    }
    if (vscode6.debug?.onDidChangeBreakpoints) {
      this.disposables.push(
        vscode6.debug.onDidChangeBreakpoints(() => {
          if (sceneStateManager.isApplyingScene()) {
            return;
          }
          this.refresh();
        })
      );
    }
    activeProviderInstance = this;
  }
  /**
   * 统一刷新入口：派发 onDidChangeInlayHints 并穿透可见编辑器装饰管线，
   * 零延时、零竞态、单次精准通知宿主重绘
   */
  refresh() {
    this._onDidChangeInlayHints.fire();
    this.updateDecorations();
  }
  /**
   * 主动向可见文本编辑器触发无感微触唤醒，
   * 唤醒 Monaco 底层 deltaDecorations 调度，穿透失焦节流屏障，且避免在行末生成双重文本重影。
   */
  updateDecorations(editors) {
    const targetEditors = editors ?? vscode6.window.visibleTextEditors;
    if (!targetEditors || targetEditors.length === 0) return;
    const deco = getSceneAnnotationDecorationType();
    for (const editor of targetEditors) {
      try {
        editor.setDecorations(deco, []);
      } catch {
      }
    }
  }
  /**
   * 解析当前有效的激活场景列表（含冷启动自动降级与显式状态区分）
   */
  resolveActiveScenes() {
    let activeScenes = sceneStateManager.getActiveScenes();
    if (activeScenes.length === 0 && !sceneStateManager.hasExplicitState()) {
      const config = this.configLoader();
      if (config && Array.isArray(config.activeScenes) && config.activeScenes.length > 0) {
        activeScenes = config.activeScenes;
      }
    }
    return activeScenes;
  }
  /**
   * 将已索引断点聚合为按物理行号索引的步骤映射表
   */
  groupBreakpointsByLine(indexedBps) {
    const lineToStepsMap = /* @__PURE__ */ new Map();
    for (const item of indexedBps) {
      const bpLine = item.breakpoint.line;
      const existing = lineToStepsMap.get(bpLine) || [];
      existing.push(item);
      lineToStepsMap.set(bpLine, existing);
    }
    return lineToStepsMap;
  }
  /**
   * 解析并确保当前活跃断点内存索引有效，返回与指定文档关联的按行聚合断点映射
   */
  getGroupedBreakpointsForDocument(docFsPath) {
    if (!this.enabledGetter()) return void 0;
    const activeScenes = this.resolveActiveScenes();
    if (activeScenes.length === 0) return void 0;
    const wsRoot = this.workspaceRootGetter();
    if (!activeBreakpointIndex.isUpToDate(wsRoot || "", activeScenes)) {
      const config = this.configLoader();
      if (config && config.scenes) {
        activeBreakpointIndex.sync(wsRoot || "", config.scenes, activeScenes);
      }
    }
    const indexedBps = activeBreakpointIndex.getBreakpointsForDocument(docFsPath, wsRoot);
    if (indexedBps.length === 0) return void 0;
    return this.groupBreakpointsByLine(indexedBps);
  }
  /**
   * 构建断点步骤的丰富悬停 Markdown 信息
   */
  buildHintTooltip(stepItems) {
    const tooltipMarkdown = new vscode6.MarkdownString("", true);
    tooltipMarkdown.isTrusted = true;
    for (let i = 0; i < stepItems.length; i++) {
      const item = stepItems[i];
      const bp = item.breakpoint;
      const isUnmatched = sceneStateManager.isBreakpointUnmatched(bp.file, bp.line);
      if (i > 0) {
        tooltipMarkdown.appendMarkdown("\n\n---\n\n");
      }
      tooltipMarkdown.appendMarkdown(`### \u{1F4A1} ${vscode6.l10n.t("Scene Breakpoint: {0}", item.sceneName)}

`);
      tooltipMarkdown.appendMarkdown(`- **${vscode6.l10n.t("Step")}**: #${item.stepIndex}
`);
      tooltipMarkdown.appendMarkdown(`- **${vscode6.l10n.t("Type")}**: \`${bp.type}\`
`);
      if (bp.desc) tooltipMarkdown.appendMarkdown(`- **${vscode6.l10n.t("Description")}**: ${bp.desc}
`);
      if (bp.condition) tooltipMarkdown.appendMarkdown(`- **${vscode6.l10n.t("Condition")}**: \`${bp.condition}\`
`);
      if (bp.hitCondition) tooltipMarkdown.appendMarkdown(`- **${vscode6.l10n.t("Hit Condition")}**: \`${bp.hitCondition}\`
`);
      if (bp.logMessage) tooltipMarkdown.appendMarkdown(`- **${vscode6.l10n.t("Log Message")}**: \`${bp.logMessage}\`
`);
      if (isUnmatched) tooltipMarkdown.appendMarkdown(`- **${vscode6.l10n.t("Status")}**: \u26A0\uFE0F ${vscode6.l10n.t("Unmatched (Code Drift Detected)")}
`);
    }
    return tooltipMarkdown;
  }
  /**
   * 创建单行的 InlayHint 实体
   */
  createInlayHint(document, bpLine, stepItems) {
    const zeroBasedLine = bpLine - 1;
    if (zeroBasedLine < 0 || zeroBasedLine >= document.lineCount) return void 0;
    const lineLength = document.lineAt(zeroBasedLine).text.length;
    const position = new vscode6.Position(zeroBasedLine, lineLength);
    const labelParts = stepItems.map((item) => {
      const base = `[${item.sceneName} #${item.stepIndex}]`;
      const desc = item.breakpoint.desc?.trim();
      return desc ? `${base} ${desc}` : base;
    });
    const hint = new vscode6.InlayHint(position, `\u{1F4A1} ${labelParts.join(" | ")}`);
    hint.paddingLeft = true;
    hint.tooltip = this.buildHintTooltip(stepItems);
    return hint;
  }
  provideInlayHints(document, _range, _token) {
    const lineToStepsMap = this.getGroupedBreakpointsForDocument(document.uri.fsPath);
    if (!lineToStepsMap) return [];
    const hints = [];
    for (const [bpLine, stepItems] of lineToStepsMap.entries()) {
      const hint = this.createInlayHint(document, bpLine, stepItems);
      if (hint) hints.push(hint);
    }
    return hints;
  }
  dispose() {
    if (activeProviderInstance === this) {
      activeProviderInstance = void 0;
    }
    this._onDidChangeInlayHints.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    if (sceneAnnotationDecorationType) {
      sceneAnnotationDecorationType.dispose();
      sceneAnnotationDecorationType = void 0;
    }
  }
};
var activeProviderInstance;
var sceneAnnotationDecorationType;
function getSceneAnnotationDecorationType() {
  if (!sceneAnnotationDecorationType) {
    sceneAnnotationDecorationType = vscode6.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 1.5em"
      },
      rangeBehavior: vscode6.DecorationRangeBehavior.ClosedClosed
    });
  }
  return sceneAnnotationDecorationType;
}
function flushVisibleEditors() {
  if (activeProviderInstance) {
    activeProviderInstance.updateDecorations();
  }
}

// src/ui/utils/inlayHintsCoordinator.ts
var vscode7 = __toESM(require("vscode"));
function isInlayHintsAlwaysOn() {
  const currentInlay = vscode7.workspace.getConfiguration("editor.inlayHints").get("enabled");
  return currentInlay === "on";
}
async function toggleInlayHintsMode() {
  const conf = vscode7.workspace.getConfiguration("editor.inlayHints");
  const cur = conf.get("enabled");
  const next = cur === "on" ? "offUnlessPressed" : "on";
  await conf.update("enabled", next, vscode7.ConfigurationTarget.Global);
  const msg = next === "on" ? vscode7.l10n.t("Line Annotations (Inlay Hints) are now Always-On.") : vscode7.l10n.t("Line Annotations (Inlay Hints) now show on holding Ctrl+Alt.");
  void vscode7.window.showInformationMessage(msg);
  return next === "on";
}
async function promptInlayHintsModeIfFirstTime(globalState) {
  try {
    if (isInlayHintsAlwaysOn()) return;
    const STATE_KEY = "sceneBreakpoints.inlayHintsPromptDismissed";
    if (globalState && globalState.get(STATE_KEY)) return;
    const btnEnable = vscode7.l10n.t("Enable Always-On");
    const btnKeep = vscode7.l10n.t("Hold Ctrl+Alt is Fine");
    const btnNever = vscode7.l10n.t("Don't Ask Again");
    const selected = await vscode7.window.showInformationMessage(
      vscode7.l10n.t(
        "Scene Breakpoints: Line annotations are currently in shortcut mode. Would you like to enable always-on display?"
      ),
      btnEnable,
      btnKeep,
      btnNever
    );
    if (globalState) {
      await globalState.update(STATE_KEY, true);
    }
    if (selected === btnEnable) {
      await vscode7.workspace.getConfiguration("editor.inlayHints").update("enabled", "on", vscode7.ConfigurationTarget.Global);
      void vscode7.window.showInformationMessage(
        vscode7.l10n.t("Line Annotations (Inlay Hints) are now Always-On.")
      );
    }
  } catch (err) {
    console.warn("[inlayHintsCoordinator] Failed to prompt inlay hints mode:", err);
  }
}

// src/ui/commands/index.ts
var vscode21 = __toESM(require("vscode"));

// src/ui/commands/addBreakpointCommand.ts
var path5 = __toESM(require("node:path"));
var vscode9 = __toESM(require("vscode"));

// src/ui/utils/promptHelpers.ts
var vscode8 = __toESM(require("vscode"));

// src/domain/services/scenePayloadCodec.ts
var SCHEMA_URL = "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json";
var MAX_PAYLOAD_SIZE = 1024 * 1024;
function encodeScenePayload(sceneOrName, breakpoints) {
  let name;
  let bps;
  if (sceneOrName instanceof Scene) {
    name = sceneOrName.name;
    bps = sceneOrName.getSteps().map((s) => s.toJSON());
  } else {
    name = sceneOrName;
    bps = breakpoints || [];
  }
  const payload = {
    $schema: SCHEMA_URL,
    version: "1.0",
    sceneName: name.trim(),
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    breakpoints: bps.map((bp) => {
      if (bp.type !== "function" && "file" in bp && bp.file) {
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
function resolveCandidatePayload(parsed, defaultSceneName) {
  const fallbackSceneName = (defaultSceneName || "imported-scene").trim();
  if (Array.isArray(parsed)) {
    return { targetSceneName: fallbackSceneName, candidateBreakpoints: parsed };
  }
  if (parsed.sceneName && Array.isArray(parsed.breakpoints)) {
    const sceneName = String(parsed.sceneName).trim();
    return {
      targetSceneName: sceneName || fallbackSceneName,
      candidateBreakpoints: parsed.breakpoints
    };
  }
  if (parsed.scenes && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes)) {
    const keys2 = Object.keys(parsed.scenes);
    const targetSceneName = keys2[0];
    if (targetSceneName) {
      return {
        targetSceneName,
        candidateBreakpoints: Array.isArray(parsed.scenes[targetSceneName]) ? parsed.scenes[targetSceneName] : []
      };
    }
  }
  const keys = Object.keys(parsed).filter((k) => k !== "$schema" && k !== "version" && k !== "exportedAt");
  const firstKey = keys[0];
  if (firstKey && Array.isArray(parsed[firstKey])) {
    return {
      targetSceneName: firstKey,
      candidateBreakpoints: parsed[firstKey]
    };
  }
  return { targetSceneName: fallbackSceneName, candidateBreakpoints: [] };
}
function sanitizeSceneRefItem(item) {
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!name) return void 0;
  const out = { type: "scene", name };
  const trimmedDesc = typeof item.desc === "string" ? item.desc.trim() : "";
  if (trimmedDesc) out.desc = trimmedDesc;
  if (item.enabled === false) out.enabled = false;
  return out;
}
function sanitizeBreakpointEntry(item) {
  if (item.type === "function") {
    if (typeof item.functionName === "string" && item.functionName.trim()) {
      return {
        type: "function",
        functionName: item.functionName.trim(),
        condition: item.condition?.trim() || void 0,
        hitCondition: item.hitCondition?.trim() || void 0,
        enabled: typeof item.enabled === "boolean" ? item.enabled : true,
        desc: item.desc?.trim() || void 0
      };
    }
    return void 0;
  }
  if (typeof item.file === "string" && item.file.trim() && typeof item.line === "number" && item.line > 0) {
    const type = ["condition", "hitCount", "logpoint"].includes(item.type) ? item.type : "line";
    return {
      type,
      file: item.file.trim().replace(/\\/g, "/"),
      line: Math.floor(item.line),
      condition: item.condition?.trim() || void 0,
      hitCondition: item.hitCondition?.trim() || void 0,
      logMessage: item.logMessage?.trim() || void 0,
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
      desc: item.desc?.trim() || void 0,
      contextSnippet: item.contextSnippet && typeof item.contextSnippet === "object" ? item.contextSnippet : void 0
    };
  }
  return void 0;
}
function sanitizeSceneItem(item) {
  if (!item || typeof item !== "object") return void 0;
  if (item.type === "scene") return sanitizeSceneRefItem(item);
  return sanitizeBreakpointEntry(item);
}
function sanitizeBreakpoints(candidates) {
  return candidates.map((item) => sanitizeSceneItem(item)).filter((item) => !!item);
}
function decodeScenePayload(rawText, defaultSceneName) {
  if (!rawText || !rawText.trim()) {
    return { success: false, error: "Empty content" };
  }
  if (rawText.length > MAX_PAYLOAD_SIZE) {
    return { success: false, error: "Content exceeds maximum size limit (1MB)" };
  }
  let parsed;
  try {
    const unmarshalled = stripMarkdown(rawText);
    const sanitized = stripComments(unmarshalled);
    parsed = JSON.parse(sanitized);
  } catch (e) {
    return { success: false, error: `Invalid JSON format: ${e.message}` };
  }
  if (!parsed || typeof parsed !== "object") {
    return { success: false, error: "Payload must be a JSON object or array" };
  }
  const { targetSceneName, candidateBreakpoints } = resolveCandidatePayload(parsed, defaultSceneName);
  const validBreakpoints = sanitizeBreakpoints(candidateBreakpoints);
  if (validBreakpoints.length === 0) {
    return { success: false, error: "No valid breakpoints found in the payload" };
  }
  return {
    success: true,
    sceneName: targetSceneName,
    breakpoints: validBreakpoints
  };
}
function getSupportedFormatsTemplate(titles = {}) {
  const title = titles.title || "Scene Breakpoints: Supported Payload Formats";
  const format1Title = titles.format1Title || "Format 1: Standard Scene Payload (Recommended)";
  const format2Title = titles.format2Title || "Format 2: scenes dictionary (debug-scenes.json snippet)";
  const format3Title = titles.format3Title || "Format 3: Raw breakpoint array";
  return `// ========================================================
// ${title}
// ========================================================

// ${format1Title}
{
  "$schema": "${SCHEMA_URL}",
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
function sanitizeScenesConfig(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { scenes: {} };
  }
  const candidateScenes = parsed.scenes && typeof parsed.scenes === "object" && !Array.isArray(parsed.scenes) ? parsed.scenes : parsed;
  const cleanScenes = {};
  for (const [k, v] of Object.entries(candidateScenes)) {
    if (k !== "$schema" && k !== "bindings" && k !== "activeScenes" && Array.isArray(v)) {
      cleanScenes[k] = v.map((it) => sanitizeSceneItem(it)).filter((it) => !!it);
    }
  }
  let cleanActiveScenes;
  const rawActiveScenes = parsed.activeScenes || candidateScenes.activeScenes;
  if (Array.isArray(rawActiveScenes)) {
    cleanActiveScenes = rawActiveScenes.map((it) => String(it).trim()).filter(Boolean);
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
  const result = { scenes: cleanScenes };
  if (cleanBindings && Object.keys(cleanBindings).length > 0) {
    result.bindings = cleanBindings;
  }
  if (cleanActiveScenes && cleanActiveScenes.length > 0) {
    result.activeScenes = cleanActiveScenes;
  }
  return result;
}
var ScenePayloadCodec = class {
  static SCHEMA_URL = SCHEMA_URL;
  static MAX_PAYLOAD_SIZE = MAX_PAYLOAD_SIZE;
  encode(sceneOrName, breakpoints) {
    return encodeScenePayload(sceneOrName, breakpoints);
  }
  decode(rawText, defaultSceneName) {
    return decodeScenePayload(rawText, defaultSceneName);
  }
  sanitizeConfig(parsed) {
    return sanitizeScenesConfig(parsed);
  }
  getTemplate(titles = {}) {
    return getSupportedFormatsTemplate(titles);
  }
  stripMarkdown(text) {
    return stripMarkdown(text);
  }
  stripComments(jsonStr) {
    return stripComments(jsonStr);
  }
  // 静态快捷方式
  static encode(sceneOrName, breakpoints) {
    return encodeScenePayload(sceneOrName, breakpoints);
  }
  static decode(rawText, defaultSceneName) {
    return decodeScenePayload(rawText, defaultSceneName);
  }
  static sanitizeConfig(parsed) {
    return sanitizeScenesConfig(parsed);
  }
  static stripMarkdown(text) {
    return stripMarkdown(text);
  }
};
var defaultScenePayloadCodec = new ScenePayloadCodec();

// src/ui/utils/promptHelpers.ts
async function promptSceneName(options) {
  const result = await vscode8.window.showInputBox({
    prompt: options.prompt,
    value: options.value,
    placeHolder: options.placeHolder,
    validateInput: (value) => {
      if (!value || !value.trim()) {
        return vscode8.l10n.t("Scene name cannot be empty");
      }
      return null;
    }
  });
  return result?.trim() ? result.trim() : void 0;
}
async function confirmModalAction(message, confirmLabel) {
  const choice = await vscode8.window.showWarningMessage(
    message,
    { modal: true },
    confirmLabel
  );
  return choice === confirmLabel;
}
async function promptSelectScenes(sceneNames, sceneCounts, currentActiveScenes) {
  const items = sceneNames.map((name) => ({
    label: name,
    description: vscode8.l10n.t("{0} breakpoint(s)", sceneCounts[name] || 0),
    picked: currentActiveScenes.includes(name)
  }));
  const picked = await vscode8.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: vscode8.l10n.t("Select one or more debug scenes to activate (check to layer breakpoints)")
  });
  if (picked === void 0) return void 0;
  return picked.map((it) => it.label);
}
async function promptSceneCollision(options) {
  const items = [
    {
      label: vscode8.l10n.t("Overwrite Existing Scene"),
      description: vscode8.l10n.t("Replace existing [{0}] completely", options.sceneName),
      value: "overwrite"
    },
    {
      label: vscode8.l10n.t("Append & Merge Breakpoints"),
      description: vscode8.l10n.t("Keep existing breakpoints and upsert imported ones", options.sceneName),
      value: "append"
    }
  ];
  if (options.allowRename) {
    items.push({
      label: vscode8.l10n.t("Rename Imported Scene"),
      description: vscode8.l10n.t("Save under a new scene name", options.sceneName),
      value: "rename"
    });
  }
  const action = await vscode8.window.showQuickPick(items, {
    placeHolder: vscode8.l10n.t("Scene [{0}] already exists. Choose action:", options.sceneName)
  });
  if (!action) return null;
  if (action.value === "rename") {
    const newName = await promptSceneName({
      prompt: vscode8.l10n.t("Enter new scene identifier (e.g. user-login or auth-verify)"),
      value: `${options.sceneName}-copy`
    });
    if (!newName) return null;
    return { sceneName: newName, mode: "overwrite" };
  }
  return { sceneName: options.sceneName, mode: action.value };
}
async function showPayloadFormatError(errorMsg) {
  const viewFormatAction = vscode8.l10n.t("View Supported Formats");
  const action = await vscode8.window.showErrorMessage(
    vscode8.l10n.t("Failed to import scene from clipboard: {0}", errorMsg),
    viewFormatAction
  );
  if (action === viewFormatAction) {
    const doc = await vscode8.workspace.openTextDocument({
      language: "jsonc",
      content: getSupportedFormatsTemplate()
    });
    await vscode8.window.showTextDocument(doc, { preview: true });
  }
}
async function promptFingerprintConflict(info) {
  const keepDiskLabel = vscode8.l10n.t("Keep My Edited Line");
  const healLabel = vscode8.l10n.t("Auto-heal to Line {0}", info.fingerprintLine);
  const choice = await vscode8.window.showWarningMessage(
    vscode8.l10n.t(
      "Breakpoint in {0} was externally moved to line {1}, but its fingerprint matches line {2}. Keep your line or auto-heal?",
      info.file,
      info.registeredLine,
      info.fingerprintLine
    ),
    keepDiskLabel,
    healLabel
  );
  return choice === healLabel ? "fingerprint" : "disk";
}

// src/ui/commands/addBreakpointCommand.ts
async function promptTargetScene(workspaceRoot) {
  const config = sceneManager.loadScenesConfig(workspaceRoot);
  const existingScenes = Object.keys(config.scenes || {});
  const sceneQuickPickItems = [
    ...existingScenes.map((s) => ({ label: `$(symbol-event) ${s}`, sceneName: s })),
    { label: vscode9.l10n.t("$(add) [New Scene...]"), sceneName: "__NEW__" }
  ];
  const selectedSceneItem = await vscode9.window.showQuickPick(sceneQuickPickItems, {
    placeHolder: vscode9.l10n.t("Select a scene to add the current line breakpoint to")
  });
  if (!selectedSceneItem) return void 0;
  let targetScene = selectedSceneItem.sceneName;
  if (targetScene === "__NEW__") {
    const newSceneName = await promptSceneName({
      prompt: vscode9.l10n.t("Enter new scene identifier (e.g. user-login or auth-verify)")
    });
    if (!newSceneName) return void 0;
    targetScene = newSceneName;
  }
  return targetScene;
}
async function promptBreakpointType() {
  const typeItems = [
    { label: `$(debug-breakpoint) ${vscode9.l10n.t("Line Breakpoint")}`, description: vscode9.l10n.t("Pause execution when hit"), type: "line" },
    { label: `$(debug-breakpoint-conditional) ${vscode9.l10n.t("Conditional Breakpoint")}`, description: vscode9.l10n.t("Pause when expression evaluates to true"), type: "condition" },
    { label: `$(debug-breakpoint-data) ${vscode9.l10n.t("Hit Count Breakpoint")}`, description: vscode9.l10n.t("Pause when hit count condition is satisfied"), type: "hitCount" },
    { label: `$(debug-breakpoint-log) ${vscode9.l10n.t("Logpoint")}`, description: vscode9.l10n.t("Print log message to debug console without pausing"), type: "logpoint" },
    { label: `$(debug-breakpoint-function) ${vscode9.l10n.t("Function Breakpoint")}`, description: vscode9.l10n.t("Pause when a named function is invoked"), type: "function" }
  ];
  const selectedTypeItem = await vscode9.window.showQuickPick(typeItems, {
    placeHolder: vscode9.l10n.t("Select breakpoint type")
  });
  return selectedTypeItem?.type;
}
async function promptBreakpointParams(bpType, fileNameOnly, currentLine) {
  let condition;
  let hitCondition;
  let logMessage;
  let functionName;
  if (bpType === "condition") {
    condition = await vscode9.window.showInputBox({
      prompt: vscode9.l10n.t("Enter condition expression (e.g. user.isAdmin === true)"),
      placeHolder: "user.isAdmin === true"
    });
    if (condition === void 0) return void 0;
  } else if (bpType === "hitCount") {
    hitCondition = await vscode9.window.showInputBox({
      prompt: vscode9.l10n.t("Enter hit count condition (e.g. > 5 or % 10 === 0)"),
      placeHolder: "> 5"
    });
    if (hitCondition === void 0) return void 0;
  } else if (bpType === "logpoint") {
    logMessage = await vscode9.window.showInputBox({
      prompt: vscode9.l10n.t("Enter log message to print (supports {var} interpolation)"),
      placeHolder: "User state: {user.name}, retries: {retryCount}"
    });
    if (logMessage === void 0) return void 0;
  } else if (bpType === "function") {
    functionName = await vscode9.window.showInputBox({
      prompt: vscode9.l10n.t("Enter function name to break on"),
      placeHolder: "handleUserAuthentication",
      validateInput: (v) => !v || !v.trim() ? vscode9.l10n.t("Function name cannot be empty") : null
    });
    if (!functionName) return void 0;
  }
  const description = await vscode9.window.showInputBox({
    prompt: vscode9.l10n.t("Enter breakpoint description (optional, current line: {0}:{1})", fileNameOnly, currentLine),
    placeHolder: vscode9.l10n.t("e.g. Check steering message injection in decision loop")
  });
  return { bpType, condition, hitCondition, logMessage, functionName, description };
}
function createBreakpointEntry(params, editor, relativeFilePath, fileNameOnly, currentLine) {
  if (params.bpType === "function") {
    return {
      type: "function",
      functionName: params.functionName.trim(),
      condition: params.condition?.trim() || void 0,
      hitCondition: params.hitCondition?.trim() || void 0,
      desc: params.description?.trim() || void 0
    };
  }
  const contextSnippet = extractContextSnippet(editor.document, editor.selection.active.line);
  return {
    type: params.bpType,
    file: relativeFilePath.includes("/") ? relativeFilePath : fileNameOnly,
    line: currentLine,
    condition: params.condition?.trim() || void 0,
    hitCondition: params.hitCondition?.trim() || void 0,
    logMessage: params.logMessage?.trim() || void 0,
    desc: params.description?.trim() || void 0,
    contextSnippet
  };
}
async function addBreakpointCommand() {
  await runWithActiveEditor(async (editor, workspaceRoot) => {
    const fullFilePath = editor.document.fileName;
    const relativeFilePath = path5.relative(workspaceRoot, fullFilePath).replace(/\\/g, "/");
    const fileNameOnly = path5.basename(fullFilePath);
    const currentLine = editor.selection.active.line + 1;
    const targetScene = await promptTargetScene(workspaceRoot);
    if (!targetScene) return;
    const bpType = await promptBreakpointType();
    if (!bpType) return;
    const params = await promptBreakpointParams(bpType, fileNameOnly, currentLine);
    if (!params) return;
    const newEntry = createBreakpointEntry(params, editor, relativeFilePath, fileNameOnly, currentLine);
    await breakpointManager.addBreakpoint(workspaceRoot, targetScene, newEntry);
    const summaryLabel = bpType === "function" ? params.functionName || "" : `${fileNameOnly}:${currentLine}`;
    void vscode9.window.showInformationMessage(
      vscode9.l10n.t("Saved breakpoint to scene [{0}]: {1}:{2} {3}", targetScene, summaryLabel, bpType, newEntry.desc ? `("${newEntry.desc}")` : "")
    );
    try {
      await vscode9.window.showTextDocument(editor.document, {
        selection: editor.selection,
        preserveFocus: false
      });
      flushVisibleEditors();
    } catch {
    }
  });
}

// src/ui/commands/sceneCommands.ts
var path6 = __toESM(require("node:path"));
var vscode11 = __toESM(require("vscode"));

// src/ui/locators/sceneJsonLocator.ts
var vscode10 = __toESM(require("vscode"));
function findBreakpointLineInJson(jsonContent, sceneName, bp) {
  const lines = jsonContent.split(/\r?\n/);
  let inTargetScene = false;
  let sceneLine = 1;
  let bracketDepth = 0;
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (!inTargetScene) {
      const scenePattern = new RegExp(`"${escapeRegExp(sceneName)}"\\s*:`);
      if (scenePattern.test(lineText)) {
        inTargetScene = true;
        sceneLine = i + 1;
        bracketDepth = (lineText.match(/\[/g) || []).length - (lineText.match(/\]/g) || []).length;
      }
      continue;
    }
    bracketDepth += (lineText.match(/\[/g) || []).length - (lineText.match(/\]/g) || []).length;
    if (bracketDepth < 0 || bracketDepth === 0 && lineText.includes("]")) {
      break;
    }
    if (bp.type === "function") {
      if (bp.functionName && lineText.includes(`"${bp.functionName}"`)) {
        return i + 1;
      }
    } else {
      const targetFile = (bp.file || "").replace(/\\/g, "/");
      const baseName = targetFile.split("/").pop() || targetFile;
      if (lineText.includes(`"${targetFile}"`) || lineText.includes(`"${baseName}"`) || lineText.includes(`"line"`) && lineText.includes(String(bp.line))) {
        return i + 1;
      }
    }
  }
  return sceneLine;
}
function findEnclosingSceneName(lines, cursorLineIndex, candidateSceneNames) {
  const getLineText = Array.isArray(lines) ? (idx) => lines[idx] ?? "" : (idx) => lines.lineAt(idx)?.text ?? "";
  for (let i = cursorLineIndex; i >= 0; i--) {
    const lineText = getLineText(i);
    for (const sName of candidateSceneNames) {
      if (lineText.includes(`"${sName}"`) && lineText.includes(":")) {
        return sName;
      }
    }
  }
  return void 0;
}
function detectSceneFromActiveEditor(candidateSceneNames, activeEditor) {
  const editor = activeEditor ?? vscode10.window.activeTextEditor;
  if (!editor || !editor.document.fileName.endsWith("debug-scenes.json")) {
    return void 0;
  }
  const currentLine = editor.selection.active.line;
  return findEnclosingSceneName(editor.document, currentLine, candidateSceneNames);
}

// src/ui/commands/sceneCommands.ts
var extensionGlobalState;
function setExtensionGlobalState(state) {
  extensionGlobalState = state;
}
async function clearAllCommand() {
  await runWithWorkspace(false, async (workspaceRoot) => {
    await sceneManager.clearAll(workspaceRoot);
    flushVisibleEditors();
    void vscode11.window.showInformationMessage(vscode11.l10n.t("Cleared all breakpoints"));
  });
}
function parseSceneParameter(sceneParam) {
  if (sceneParam === void 0 || sceneParam === null) return void 0;
  if (Array.isArray(sceneParam)) return uniqueStrings(sceneParam);
  if (typeof sceneParam === "string") {
    const parsed = uniqueStrings(sceneParam);
    return parsed.length > 0 ? parsed : void 0;
  }
  return void 0;
}
async function resolveTargetScenes(workspaceRoot, sceneParam) {
  const config = sceneManager.loadScenesConfig(workspaceRoot);
  const sceneNames = Object.keys(config.scenes || {});
  if (sceneNames.length === 0) {
    void vscode11.window.showWarningMessage(vscode11.l10n.t("No scenes configured in debug-scenes.json yet"));
    return void 0;
  }
  let targetScenes = parseSceneParameter(sceneParam);
  if (targetScenes === void 0) {
    const detected = detectSceneFromActiveEditor(sceneNames);
    if (detected) {
      targetScenes = [detected];
    }
  }
  if (targetScenes === void 0) {
    const sceneCounts = {};
    for (const name of sceneNames) {
      sceneCounts[name] = config.scenes[name]?.length || 0;
    }
    targetScenes = await promptSelectScenes(sceneNames, sceneCounts, sceneStateManager.getActiveScenes());
  }
  return targetScenes;
}
async function handleDirtyCheckBeforeSwitch(workspaceRoot) {
  const currentActive = sceneStateManager.getActiveScene();
  const isDirty = sceneStateManager.getIsDirty();
  if (!currentActive || !isDirty) return true;
  const actionAppend = vscode11.l10n.t("Save & Append to [{0}]", currentActive);
  const actionDiscard = vscode11.l10n.t("Discard Temporary Breakpoints");
  const chosen = await vscode11.window.showWarningMessage(
    vscode11.l10n.t(
      "Workspace has unsaved temporary breakpoints in scene [{0}]. What would you like to do before switching/reloading?",
      currentActive
    ),
    { modal: true },
    actionAppend,
    actionDiscard
  );
  if (!chosen) return false;
  if (chosen === actionAppend) {
    await sceneManager.exportScene(workspaceRoot, currentActive, "overwrite");
  }
  return true;
}
function showActivationFeedback(workspaceRoot, primarySceneLabel, result) {
  if (result.unmatchedCount > 0) {
    const count = result.unmatchedCount;
    const unmatches = result.unmatchedBreakpoints || [];
    const firstItem = unmatches[0];
    const summary = unmatches.slice(0, 3).map((bp) => `${path6.basename(bp.file)}:${bp.line}`).join(", ");
    const more = count > 3 ? vscode11.l10n.t(" and {0} other locations", count) : "";
    const viewAction = vscode11.l10n.t("Locate Code");
    void vscode11.window.showWarningMessage(
      vscode11.l10n.t(
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
          const doc = await vscode11.workspace.openTextDocument(fullPath);
          const editor = await vscode11.window.showTextDocument(doc);
          const pos = new vscode11.Position(Math.max(0, firstItem.line - 1), 0);
          editor.selection = new vscode11.Selection(pos, pos);
          editor.revealRange(new vscode11.Range(pos, pos), vscode11.TextEditorRevealType.InCenter);
        } catch {
        }
      }
    });
  } else if (result.healedCount > 0) {
    void vscode11.window.showInformationMessage(
      vscode11.l10n.t(
        "Scene(s) [{0}] activated! Loaded {1} breakpoint(s) (Auto-healed {2} drifted line(s)).",
        primarySceneLabel,
        result.loadedCount,
        result.healedCount
      )
    );
  } else {
    void vscode11.window.showInformationMessage(
      vscode11.l10n.t(
        "Scene(s) [{0}] activated! Set {1} target breakpoint(s) and cleaned others.",
        primarySceneLabel,
        result.loadedCount
      )
    );
  }
}
async function applySceneCommand(sceneParam) {
  await runWithWorkspace(true, async (workspaceRoot) => {
    const targetScenes = await resolveTargetScenes(workspaceRoot, sceneParam);
    if (!targetScenes) return;
    if (targetScenes.length === 0) {
      await sceneManager.clearAll(workspaceRoot);
      flushVisibleEditors();
      return;
    }
    const proceed = await handleDirtyCheckBeforeSwitch(workspaceRoot);
    if (!proceed) return;
    let result;
    try {
      result = await sceneManager.activateScene(workspaceRoot, targetScenes);
    } catch (err) {
      if (err instanceof CircularReferenceError) {
        void vscode11.window.showErrorMessage(
          vscode11.l10n.t("Circular scene reference: {0}", err.cyclePath.join(" \u2192 "))
        );
        return;
      }
      throw err;
    }
    if (!result.success) {
      void vscode11.window.showErrorMessage(
        vscode11.l10n.t("Scene(s) [{0}] not found in debug-scenes.json", result.missingScenes.join(", "))
      );
      return;
    }
    if (result.missingScenes.length > 0) {
      void vscode11.window.showWarningMessage(
        vscode11.l10n.t("Scene(s) [{0}] not found and skipped", result.missingScenes.join(", "))
      );
    }
    const primarySceneLabel = result.validTargetScenes.length === 1 ? result.validTargetScenes[0] : result.validTargetScenes.join(" + ");
    showActivationFeedback(workspaceRoot, primarySceneLabel, result);
    flushVisibleEditors();
    promptInlayHintsModeIfFirstTime(extensionGlobalState).catch(() => {
    });
  });
}
async function exportSceneCommand() {
  const currentBreakpoints = vscode11.debug.breakpoints;
  if (!currentBreakpoints || currentBreakpoints.length === 0) {
    void vscode11.window.showWarningMessage(
      vscode11.l10n.t("No active breakpoints found in current workspace. Please set some breakpoints first.")
    );
    return;
  }
  await runWithWorkspace(true, async (workspaceRoot) => {
    const targetScene = await promptSceneName({
      prompt: vscode11.l10n.t("Enter scene identifier to export current breakpoints to (e.g. order-flow-debug)"),
      placeHolder: "order-flow-debug"
    });
    if (!targetScene) return;
    const config = sceneManager.loadScenesConfig(workspaceRoot);
    let mode = "overwrite";
    if (config.scenes[targetScene] && config.scenes[targetScene].length > 0) {
      const decision = await promptSceneCollision({ sceneName: targetScene });
      if (!decision) return;
      mode = decision.mode;
    }
    const result = await sceneManager.exportScene(workspaceRoot, targetScene, mode);
    if (result.success) {
      sceneStateManager.setActiveScene(targetScene, result.count);
      void vscode11.window.showInformationMessage(
        vscode11.l10n.t("Successfully exported {0} active breakpoint(s) to scene [{1}]!", result.count, targetScene)
      );
    }
  });
}
function registerResolveWarningsNotifier() {
  return appEventBus.on("scene:resolve-warnings", ({ warnings }) => {
    if (!warnings?.length) return;
    const lines = warnings.map(
      (w) => w.code === "dangling-ref" ? vscode11.l10n.t('Scene reference "{0}" not found; skipped. Scene: {1}', w.refName, w.refPath.join(" \u2192 ")) : vscode11.l10n.t('Referenced scene "{0}" is disabled; skipped.', w.refName)
    );
    void vscode11.window.showWarningMessage(
      vscode11.l10n.t("Scene activated with {0} warning(s)", warnings.length),
      { detail: lines.join("\n") }
    );
  });
}

// src/ui/commands/menuCommands.ts
var vscode14 = __toESM(require("vscode"));

// src/ui/commands/clipboardCommands.ts
var vscode12 = __toESM(require("vscode"));
async function copySceneToClipboardCommand(target) {
  await runWithWorkspace(true, async (workspaceRoot) => {
    const config = sceneManager.loadScenesConfig(workspaceRoot);
    const sceneNames = Object.keys(config.scenes || {});
    if (sceneNames.length === 0) {
      void vscode12.window.showWarningMessage(vscode12.l10n.t("No scenes configured in debug-scenes.json yet"));
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
      const picked = await vscode12.window.showQuickPick(
        sceneNames.map((name) => ({
          label: `$(symbol-event) ${name}`,
          description: vscode12.l10n.t("{0} breakpoint(s)", config.scenes[name]?.length || 0),
          sceneName: name
        })),
        {
          placeHolder: vscode12.l10n.t("Select a scene to copy to clipboard")
        }
      );
      if (!picked) return;
      targetScene = picked.sceneName;
    }
    const breakpoints = config.scenes[targetScene] || [];
    if (breakpoints.length === 0) {
      void vscode12.window.showWarningMessage(
        vscode12.l10n.t("Scene [{0}] has no breakpoints to copy.", targetScene)
      );
      return;
    }
    const payloadStr = encodeScenePayload(targetScene, breakpoints);
    await vscode12.env.clipboard.writeText(payloadStr);
    void vscode12.window.showInformationMessage(
      vscode12.l10n.t("Scene [{0}] copied to clipboard ({1} breakpoint(s))!", targetScene, breakpoints.length)
    );
  });
}
async function importSceneFromClipboardCommand() {
  await runWithWorkspace(true, async (workspaceRoot) => {
    const clipboardText = await vscode12.env.clipboard.readText();
    if (!clipboardText || !clipboardText.trim()) {
      void vscode12.window.showWarningMessage(
        vscode12.l10n.t("Clipboard is empty or does not contain valid text.")
      );
      return;
    }
    const parseResult = decodeScenePayload(clipboardText);
    if (!parseResult.success) {
      const errorMsg = parseResult.error;
      await showPayloadFormatError(errorMsg);
      return;
    }
    const config = sceneManager.loadScenesConfig(workspaceRoot);
    const target = await resolveImportTargetScene(config.scenes || {}, parseResult.sceneName);
    if (!target) return;
    const { sceneName: finalSceneName, mode } = target;
    const importedBreakpoints = parseResult.breakpoints;
    await sceneManager.importScene(workspaceRoot, finalSceneName, importedBreakpoints, mode);
    SceneNode.markExpanded(finalSceneName);
    const activateAction = vscode12.l10n.t("Activate Scene");
    const choice = await vscode12.window.showInformationMessage(
      vscode12.l10n.t(
        "Successfully imported scene [{0}] with {1} breakpoint(s)!",
        finalSceneName,
        importedBreakpoints.length
      ),
      activateAction
    );
    if (choice === activateAction) {
      await applySceneCommand(finalSceneName);
    }
  });
}
async function resolveImportTargetScene(scenes, initialName) {
  const existing = scenes[initialName];
  if (!existing || Array.isArray(existing) && existing.length === 0) {
    return { sceneName: initialName, mode: "overwrite" };
  }
  return promptSceneCollision({ sceneName: initialName, allowRename: true });
}

// src/ui/commands/graphCommands.ts
var vscode13 = __toESM(require("vscode"));

// src/shared/utils/mermaidGraphExporter.ts
function escapeMermaidText(text) {
  return text.replace(/\s*\r?\n\s*/g, " ").replace(/"/g, "'");
}
function buildNodeLabel(node) {
  let label;
  if (node.kind === "scene-ref") {
    label = `\u{1F517} ${node.refName ?? "?"}`;
  } else if (node.functionName) {
    label = node.desc ?? `\u0192 ${node.functionName}`;
  } else if (node.file !== void 0 && node.line !== void 0) {
    label = node.desc ?? `${node.file}:${node.line}`;
  } else {
    label = node.desc ?? node.id;
  }
  if (node.status === "unmatched") {
    label = `\u26A0 ${label}`;
  }
  if (!node.enabled) {
    label = `\u26D4 ${label}`;
  }
  return label;
}
function buildGroupTree(lane) {
  const root = { title: lane.sceneName, children: [] };
  const groupIndex = /* @__PURE__ */ new Map();
  for (const node of lane.nodes) {
    const path15 = node.refPath?.slice(1) ?? [];
    let parent = root;
    for (let i = 0; i < path15.length; i++) {
      const key = `${i}:${path15[i]}`;
      let group = groupIndex.get(key);
      if (!group) {
        group = { title: path15[i], children: [] };
        groupIndex.set(key, group);
        parent.children.push(group);
      }
      parent = group;
    }
    parent.children.push(node);
  }
  return root;
}
function renderGroup(group, indent, lines, idOf, nextNodeId, nextGroupId) {
  for (const child of group.children) {
    if ("children" in child) {
      lines.push(`${indent}subgraph ${nextGroupId()}["\u{1F517} ${escapeMermaidText(child.title)}"]`);
      renderGroup(child, `${indent}    `, lines, idOf, nextNodeId, nextGroupId);
      lines.push(`${indent}end`);
      continue;
    }
    const mermaidId = nextNodeId();
    idOf.set(child.id, mermaidId);
    lines.push(`${indent}${mermaidId}["${escapeMermaidText(buildNodeLabel(child))}"]`);
  }
}
function exportGraphToMermaid(source) {
  const lines = ["flowchart TD"];
  const idOf = /* @__PURE__ */ new Map();
  let nodeSeq = 0;
  let groupSeq = 0;
  const nextNodeId = () => `n${nodeSeq++}`;
  const nextGroupId = () => `s${groupSeq++}`;
  for (const lane of source.lanes) {
    lines.push(`    subgraph ${nextGroupId()}["${escapeMermaidText(lane.sceneName)}"]`);
    renderGroup(buildGroupTree(lane), "        ", lines, idOf, nextNodeId, nextGroupId);
    lines.push("    end");
    const laneIds = lane.nodes.map((node) => idOf.get(node.id)).filter((id) => id !== void 0);
    for (let i = 1; i < laneIds.length; i++) {
      lines.push(`    ${laneIds[i - 1]} --> ${laneIds[i]}`);
    }
  }
  return lines.join("\n");
}

// src/ui/commands/graphCommands.ts
var deps;
function setGraphCommandDeps(next) {
  deps = next;
}
async function showGraphCommand() {
  const workspaceRoot = getWorkspaceRoot(true);
  if (!workspaceRoot || !deps) return;
  deps.controller.show(workspaceRoot);
}
async function exportGraphMermaidCommand() {
  const workspaceRoot = getWorkspaceRoot(true);
  if (!workspaceRoot || !deps) return;
  const snapshot = deps.loadSnapshot(workspaceRoot, deps.controller.getVisibleScenes());
  if (snapshot.lanes.length === 0) {
    void vscode13.window.showWarningMessage(
      vscode13.l10n.t("No scenes in the current scope to export.")
    );
    return;
  }
  const mermaid = exportGraphToMermaid(snapshot);
  await vscode13.env.clipboard.writeText(mermaid);
  void vscode13.window.showInformationMessage(
    vscode13.l10n.t("Scene graph exported as Mermaid and copied to clipboard.")
  );
}

// src/ui/commands/menuCommands.ts
function buildManagementMenuItems() {
  const isAlwaysOn = isInlayHintsAlwaysOn();
  return [
    {
      label: `$(type-hierarchy) ${vscode14.l10n.t("Open Scene Graph Canvas")}`,
      description: vscode14.l10n.t("Visualize active scenes as a breakpoint flow graph"),
      action: "showGraph"
    },
    {
      label: `$(clear-all) ${vscode14.l10n.t("Clear All Breakpoints")}`,
      description: vscode14.l10n.t("Clear all breakpoints from current workspace"),
      action: "clear"
    },
    {
      label: `$(checklist) ${vscode14.l10n.t("Multi-Select Scenes to Activate...")}`,
      description: vscode14.l10n.t("Check multiple scenes to layer breakpoints together"),
      action: "multiSelect"
    },
    {
      label: `$(cloud-upload) ${vscode14.l10n.t("Export Active Breakpoints as Scene...")}`,
      description: vscode14.l10n.t("Save current editor breakpoints into debug-scenes.json"),
      action: "export"
    },
    {
      label: `$(cloud-download) ${vscode14.l10n.t("Import Scene from Clipboard...")}`,
      description: vscode14.l10n.t("Parse and import scene breakpoints from clipboard"),
      action: "importClipboard"
    },
    {
      label: `$(file-code) ${vscode14.l10n.t("Open debug-scenes.json")}`,
      description: vscode14.l10n.t("Edit configuration file directly"),
      action: "openConfig"
    },
    {
      label: isAlwaysOn ? `$(eye-closed) ${vscode14.l10n.t("Line Annotations: Switch to Press Mode (Ctrl+Alt)")}` : `$(eye) ${vscode14.l10n.t("Line Annotations: Switch to Always-On")}`,
      description: isAlwaysOn ? vscode14.l10n.t("Currently always shown. Click to show only on holding Ctrl+Alt") : vscode14.l10n.t("Currently shown on holding Ctrl+Alt. Click to keep always visible"),
      action: "toggleInlayHintsMode"
    }
  ];
}
function buildSceneMenuItems(scenesDict, activeScenes, isDirty) {
  const items = [
    { label: vscode14.l10n.t("Scenes"), kind: vscode14.QuickPickItemKind.Separator }
  ];
  const sceneNames = Object.keys(scenesDict || {});
  if (sceneNames.length > 0) {
    for (const name of sceneNames) {
      const bps = scenesDict[name] || [];
      const isActive = activeScenes.includes(name);
      const label = isActive ? isDirty ? `\u{1F7E2} ${name}*` : `\u{1F7E2} ${name}` : `\u26AA ${name}`;
      const description = isActive ? isDirty ? vscode14.l10n.t("(Active - Unsaved)") : vscode14.l10n.t("(Active)") : void 0;
      items.push({
        label,
        description,
        detail: vscode14.l10n.t("{0} breakpoint(s)", bps.length),
        action: "switch",
        sceneName: name
      });
    }
  } else {
    items.push({
      label: `$(info) ${vscode14.l10n.t("No scenes configured yet")}`,
      description: vscode14.l10n.t("Add breakpoints or export active ones to create a scene")
    });
  }
  return items;
}
async function executeMenuAction(selected, workspaceRoot) {
  switch (selected.action) {
    case "showGraph":
      await showGraphCommand();
      break;
    case "multiSelect":
      await applySceneCommand();
      break;
    case "switch":
      if (selected.sceneName) await applySceneCommand(selected.sceneName);
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
      const configPath = sceneManager.ensureScenesConfigFile(workspaceRoot);
      const doc = await vscode14.workspace.openTextDocument(configPath);
      await vscode14.window.showTextDocument(doc);
      break;
    }
    case "toggleInlayHintsMode": {
      await toggleInlayHintsMode();
      break;
    }
  }
}
async function showMenuCommand() {
  await runWithWorkspace(async (workspaceRoot) => {
    const config = sceneManager.loadScenesConfig(workspaceRoot);
    const activeScenes = sceneStateManager.getActiveScenes();
    const isDirty = sceneStateManager.getIsDirty();
    const items = [
      ...buildManagementMenuItems(),
      ...buildSceneMenuItems(config.scenes || {}, activeScenes, isDirty)
    ];
    const quickPick = vscode14.window.createQuickPick();
    quickPick.items = items;
    quickPick.placeholder = vscode14.l10n.t("Select a scene to activate, or choose a management action");
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    const firstActive = activeScenes[0];
    if (firstActive) {
      const activeItem = items.find((it) => it.action === "switch" && it.sceneName === firstActive);
      if (activeItem) quickPick.activeItems = [activeItem];
    }
    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      quickPick.hide();
      if (!selected || !selected.action) return;
      await executeMenuAction(selected, workspaceRoot);
    });
    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  });
}

// src/ui/commands/captureCallStackCommand.ts
var path7 = __toESM(require("node:path"));
var vscode15 = __toESM(require("vscode"));

// src/application/debugPauseContext.ts
var capturablePause;
function setCapturablePauseContext(context) {
  capturablePause = context;
}
function getCapturablePauseContext() {
  return capturablePause;
}
function isInternalOrVirtualFramePath(filePath) {
  if (!filePath) return true;
  const norm = filePath.replace(/\\/g, "/");
  if (norm.includes("<node_internals>") || norm.startsWith("node:") || norm.includes("/internal/modules/")) {
    return true;
  }
  return false;
}
var isNavigatingSourceLocked = false;
var navigationLockTimer;
function setSourceNavigationLock(active, autoReleaseMs = 350) {
  if (navigationLockTimer) {
    clearTimeout(navigationLockTimer);
    navigationLockTimer = void 0;
  }
  isNavigatingSourceLocked = active;
  if (active && autoReleaseMs > 0) {
    navigationLockTimer = setTimeout(() => {
      isNavigatingSourceLocked = false;
      navigationLockTimer = void 0;
    }, autoReleaseMs);
    navigationLockTimer.unref?.();
  }
}
function isSourceNavigationLocked() {
  return isNavigatingSourceLocked;
}

// src/ui/commands/captureCallStackCommand.ts
var CAPTURE_MAX_FRAMES = 20;
function isInsideWorkspace(absolutePath, workspaceRoot) {
  const rel = path7.relative(workspaceRoot, absolutePath);
  return rel !== "" && !rel.startsWith("..") && !path7.isAbsolute(rel);
}
async function captureCallStackCommand() {
  const pause = getCapturablePauseContext();
  if (!pause) {
    void vscode15.window.showInformationMessage(
      vscode15.l10n.t("Capture Call Stack is only available while the debugger is paused.")
    );
    return;
  }
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    void vscode15.window.showWarningMessage(vscode15.l10n.t("No workspace folder is open."));
    return;
  }
  let frames = [];
  try {
    const response = await pause.session.customRequest("stackTrace", {
      threadId: pause.threadId,
      startFrame: 0,
      levels: CAPTURE_MAX_FRAMES
    });
    frames = Array.isArray(response?.stackFrames) ? response.stackFrames : [];
  } catch (e) {
    void vscode15.window.showErrorMessage(
      vscode15.l10n.t("Failed to read call stack from debug session: {0}", e?.message || String(e))
    );
    return;
  }
  const { lineReader } = getDependencies();
  const seen = /* @__PURE__ */ new Set();
  const items = [];
  for (const frame of frames) {
    const absPath = frame.source?.path;
    const line = frame.line;
    if (!absPath || typeof line !== "number" || line < 1) continue;
    if (!isInsideWorkspace(absPath, workspaceRoot)) continue;
    const relativeFile = path7.relative(workspaceRoot, absPath).replace(/\\/g, "/");
    const dedupeKey = `${relativeFile}:${line}`;
    if (seen.has(dedupeKey)) continue;
    const lines = await lineReader?.readLines(absPath);
    if (!lines || line - 1 >= lines.length) continue;
    seen.add(dedupeKey);
    items.push({
      type: "line",
      file: relativeFile,
      line,
      desc: frame.name?.trim() || void 0,
      contextSnippet: extractContextSnippet(lines, line - 1)
    });
  }
  if (items.length === 0) {
    void vscode15.window.showWarningMessage(
      vscode15.l10n.t("No capturable source frames found in the current call stack.")
    );
    return;
  }
  const sceneName = await promptSceneName({
    prompt: vscode15.l10n.t("Enter scene name to save the captured call stack (e.g. order-crash-repro)")
  });
  if (!sceneName) return;
  await sceneManager.importScene(workspaceRoot, sceneName, items, "append");
  void vscode15.window.showInformationMessage(
    vscode15.l10n.t("Captured {0} call stack frame(s) into scene [{1}].", items.length, sceneName)
  );
}

// src/ui/commands/skillCommands.ts
var vscode18 = __toESM(require("vscode"));

// src/ui/utils/agentRuleManager.ts
var vscode17 = __toESM(require("vscode"));

// src/ui/views/templateContentProvider.ts
var vscode16 = __toESM(require("vscode"));
var TemplateContentProvider = class {
  static scheme = "scene-breakpoints-template";
  templateCache = /* @__PURE__ */ new Map();
  onDidChangeEmitter = new vscode16.EventEmitter();
  onDidChange = this.onDidChangeEmitter.event;
  setTemplateContent(key, content) {
    this.templateCache.set(key, content);
  }
  provideTextDocumentContent(uri) {
    const key = uri.path.replace(/^\//, "");
    return this.templateCache.get(key) || "";
  }
};
var templateContentProvider = new TemplateContentProvider();

// src/ui/utils/agentRuleManager.ts
async function readOfficialTemplate(context) {
  const skillSourceUri = vscode17.Uri.joinPath(
    context.extensionUri,
    "skills",
    "scene-breakpoints",
    "SKILL.md"
  );
  try {
    const rawBytes = await vscode17.workspace.fs.readFile(skillSourceUri);
    return Buffer.from(rawBytes).toString("utf-8");
  } catch {
    return "";
  }
}
async function writeSkillToTarget(context, workspaceRoot, target) {
  const templateStr = await readOfficialTemplate(context);
  if (!templateStr) {
    void vscode17.window.showErrorMessage(
      vscode17.l10n.t("Failed to read built-in Skill template: {0}", "Template file not found or empty")
    );
    return false;
  }
  const success = await agentSkillService.deploySkillToTarget(workspaceRoot, target, templateStr);
  if (!success) {
    void vscode17.window.showErrorMessage(
      vscode17.l10n.t("Failed to write Skill file: {0}", target.file)
    );
  }
  return success;
}
async function showSkillDiff(target, fullPath, rawOfficialTemplate, currentVersion) {
  const expectedBytes = formatSkillContent(rawOfficialTemplate, target);
  templateContentProvider.setTemplateContent(target.file, Buffer.from(expectedBytes).toString("utf-8"));
  await vscode17.commands.executeCommand(
    "vscode.diff",
    vscode17.Uri.file(fullPath),
    vscode17.Uri.parse(`scene-breakpoints-template://template/${target.file}`),
    `${target.label} (${vscode17.l10n.t("Local vs Official v{0}", currentVersion)})`
  );
}

// src/ui/commands/skillCommands.ts
async function installSkillCommand(context) {
  await runWithWorkspace(async (workspaceRoot) => {
    const targets = await pickSkillTargets(workspaceRoot);
    if (!targets || targets.length === 0) {
      void vscode18.window.showInformationMessage(
        vscode18.l10n.t("No target AI environments selected. Installation cancelled.")
      );
      return;
    }
    for (const target of targets) {
      const success = await writeSkillToTarget(context, workspaceRoot, target);
      if (!success) return;
    }
    void vscode18.window.showInformationMessage(
      vscode18.l10n.t("Scene Breakpoints Skill successfully deployed to target directory.")
    );
  });
}
async function checkAndPromptSkillUpdates(context, workspaceRoot) {
  const currentVersion = context.extension?.packageJSON?.version || LATEST_SKILL_VERSION;
  const lastNotifiedVer = context.workspaceState.get("lastNotifiedSkillVersion");
  if (lastNotifiedVer === currentVersion) {
    return;
  }
  const rawOfficialTemplate = await readOfficialTemplate(context);
  if (!rawOfficialTemplate) {
    return;
  }
  const inspectedTargets = agentSkillService.inspectSkillTargets(
    workspaceRoot,
    rawOfficialTemplate,
    currentVersion
  );
  const outdatedTargets = inspectedTargets.filter(
    (t) => t.status === "CleanOutdated" || t.status === "CustomModified"
  );
  if (outdatedTargets.length === 0) return;
  await context.workspaceState.update("lastNotifiedSkillVersion", currentVersion);
  await promptAndHandleSkillUpdates(context, workspaceRoot, outdatedTargets, rawOfficialTemplate, currentVersion);
}
async function promptAndHandleSkillUpdates(context, workspaceRoot, outdatedTargets, rawOfficialTemplate, currentVersion) {
  const cleanOutdatedList = outdatedTargets.filter((t) => t.status === "CleanOutdated");
  const customModifiedList = outdatedTargets.filter((t) => t.status === "CustomModified");
  const actions = [];
  const updateAction = cleanOutdatedList.length > 0 ? vscode18.l10n.t("Update Clean Skills") : void 0;
  const diffAction = customModifiedList.length === 1 ? vscode18.l10n.t("View Diff") : void 0;
  const diagnoseAction = vscode18.l10n.t("Open Diagnostics");
  const dismissAction = vscode18.l10n.t("Later");
  if (updateAction) actions.push(updateAction);
  if (diffAction) actions.push(diffAction);
  actions.push(diagnoseAction, dismissAction);
  const promptMsg = customModifiedList.length > 0 ? vscode18.l10n.t("Scene Breakpoints: Found {0} installed AI Skill(s) with local modifications or available updates (v{1}).", outdatedTargets.length, currentVersion) : vscode18.l10n.t("Scene Breakpoints: Found {0} installed AI Skill(s) with available updates (v{1}).", outdatedTargets.length, currentVersion);
  const selected = await vscode18.window.showInformationMessage(promptMsg, ...actions);
  if (selected === void 0) {
    return;
  }
  if (selected === updateAction) {
    for (const { target } of cleanOutdatedList) {
      await writeSkillToTarget(context, workspaceRoot, target);
    }
    void vscode18.window.showInformationMessage(vscode18.l10n.t("Successfully updated {0} Skill(s) to v{1}.", cleanOutdatedList.length, currentVersion));
  } else if (selected === diffAction && customModifiedList.length === 1) {
    const { target, fullPath } = customModifiedList[0];
    await showSkillDiff(target, fullPath, rawOfficialTemplate, currentVersion);
  } else if (selected === diagnoseAction) {
    await vscode18.commands.executeCommand("sceneBreakpoints.diagnoseAiIntegration");
  }
}
async function pickSkillTargets(workspaceRoot) {
  const inspected = agentSkillService.inspectSkillTargets(workspaceRoot);
  const items = inspected.map((item) => ({
    ...item.target,
    description: item.exists ? `${item.target.description} (${vscode18.l10n.t("Installed")})` : item.target.description,
    picked: item.exists
  }));
  return await vscode18.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: vscode18.l10n.t("Select target AI Agent environments to install Skill")
  });
}

// src/ui/commands/skillDiagnostic.ts
var path8 = __toESM(require("node:path"));
var vscode19 = __toESM(require("vscode"));
function createPermissionDiagnostic(config, allowAiActivation) {
  return {
    label: allowAiActivation ? `$(pass) ${vscode19.l10n.t("AI File Activation: Enabled")}` : `$(warning) ${vscode19.l10n.t("AI File Activation: Disabled (Click to Enable)")}`,
    description: allowAiActivation ? vscode19.l10n.t("AI Agent can declaratively activate scenes via activeScenes") : vscode19.l10n.t("External activeScenes modifications are currently ignored"),
    action: async () => {
      if (!allowAiActivation) {
        await config.update("allowAiFileActivation", true, vscode19.ConfigurationTarget.Workspace);
        void vscode19.window.showInformationMessage(
          vscode19.l10n.t("AI File Activation has been enabled for this workspace.")
        );
      }
    }
  };
}
function createActiveScenesDiagnostic(activeScenes) {
  return {
    label: `$(symbol-event) ${vscode19.l10n.t("Active Scenes: [{0}]", activeScenes.length > 0 ? activeScenes.join(", ") : "None")}`,
    description: vscode19.l10n.t("Current effective breakpoint scenes")
  };
}
async function handleCustomModifiedAction(context, workspaceRoot, target, fullPath, rawOfficialTemplate) {
  const choice = await vscode19.window.showQuickPick(
    [
      {
        label: `$(diff) ${vscode19.l10n.t("View Side-by-Side Diff with Latest Official Version")}`,
        value: "diff"
      },
      {
        label: `$(save) ${vscode19.l10n.t("Backup & Overwrite with Latest Version")}`,
        value: "backup"
      },
      {
        label: `$(close) ${vscode19.l10n.t("Keep Current Changes")}`,
        value: "cancel"
      }
    ],
    {
      placeHolder: vscode19.l10n.t("Local modifications detected in {0}. Choose action:", target.file)
    }
  );
  if (choice?.value === "diff") {
    await showSkillDiff(target, fullPath, rawOfficialTemplate, LATEST_SKILL_VERSION);
  } else if (choice?.value === "backup") {
    const backupPath = backupSkillFile(fullPath);
    await writeSkillToTarget(context, workspaceRoot, target);
    void vscode19.window.showInformationMessage(
      vscode19.l10n.t(
        "Skill updated to v{0}. Original backed up to: {1}",
        LATEST_SKILL_VERSION,
        path8.basename(backupPath)
      )
    );
  }
}
function createTargetItemDiagnostic(context, workspaceRoot, item, rawOfficialTemplate, currentVersion) {
  const { target, fullPath, status } = item;
  if (status === "NotInstalled") {
    return {
      label: `$(add) ${target.label} (${vscode19.l10n.t("Not Installed - Click to Install")})`,
      description: target.description,
      detail: vscode19.l10n.t("Click to deploy v{0} Skill", currentVersion),
      action: async () => {
        const success = await writeSkillToTarget(context, workspaceRoot, target);
        if (success) {
          void vscode19.window.showInformationMessage(
            vscode19.l10n.t("Skill installed to {0}", target.label)
          );
        }
      }
    };
  }
  if (status === "UpToDate") {
    return {
      label: `$(pass) ${target.label} (${vscode19.l10n.t("Up to Date: v{0}", currentVersion)})`,
      description: target.description,
      detail: vscode19.l10n.t("Installed: {0}", fullPath),
      action: async () => {
        const reInstall = await vscode19.window.showQuickPick(
          [
            { label: vscode19.l10n.t("Reinstall / Overwrite with latest template"), value: true },
            { label: vscode19.l10n.t("Cancel"), value: false }
          ],
          { placeHolder: vscode19.l10n.t("Already up to date. Do you want to reinstall?") }
        );
        if (reInstall?.value) {
          await writeSkillToTarget(context, workspaceRoot, target);
          void vscode19.window.showInformationMessage(
            vscode19.l10n.t("Skill reinstalled to {0}", target.label)
          );
        }
      }
    };
  }
  if (status === "CleanOutdated") {
    return {
      label: `$(sync) ${target.label} (${vscode19.l10n.t("Updatable: v{0} -> v{1}", item.detectedVersion || "1.0.x", currentVersion)})`,
      description: target.description,
      detail: vscode19.l10n.t("Official template outdated. Click to update smoothly."),
      action: async () => {
        const success = await writeSkillToTarget(context, workspaceRoot, target);
        if (success) {
          void vscode19.window.showInformationMessage(
            vscode19.l10n.t("Skill successfully updated to v{0} ({1})", currentVersion, target.label)
          );
        }
      }
    };
  }
  return {
    label: `$(diff) ${target.label} (${vscode19.l10n.t("Customized (Click to Diff / Update)")})`,
    description: target.description,
    detail: vscode19.l10n.t("Modified locally. Click to view diff or backup & update."),
    action: () => handleCustomModifiedAction(context, workspaceRoot, target, fullPath, rawOfficialTemplate)
  };
}
async function diagnoseAiIntegrationCommand(context) {
  await runWithWorkspace(async (workspaceRoot) => {
    const config = vscode19.workspace.getConfiguration("sceneBreakpoints");
    const allowAiActivation = config.get("allowAiFileActivation", false);
    const activeScenes = sceneStateManager.getActiveScenes();
    const currentVersion = context.extension?.packageJSON?.version || LATEST_SKILL_VERSION;
    const rawOfficialTemplate = await readOfficialTemplate(context);
    const diagnostics = [
      createPermissionDiagnostic(config, allowAiActivation),
      createActiveScenesDiagnostic(activeScenes),
      {
        label: vscode19.l10n.t("Skill Deployment & Version Status across Platforms:"),
        kind: vscode19.QuickPickItemKind.Separator
      }
    ];
    const sortedTargetItems = agentSkillService.inspectSkillTargets(
      workspaceRoot,
      rawOfficialTemplate,
      currentVersion,
      vscode19.env.appName
    );
    for (const item of sortedTargetItems) {
      diagnostics.push(
        createTargetItemDiagnostic(context, workspaceRoot, item, rawOfficialTemplate, currentVersion)
      );
    }
    const selected = await vscode19.window.showQuickPick(diagnostics, {
      placeHolder: vscode19.l10n.t("Scene Breakpoints AI Integration Diagnostics")
    });
    if (selected?.action) {
      await selected.action();
    }
  });
}

// src/ui/commands/treeCommands.ts
var path9 = __toESM(require("node:path"));
var vscode20 = __toESM(require("vscode"));
function registerSceneActivationCommands() {
  const handleToggleSceneItem = async (node) => {
    if (node?.sceneName) {
      const nextScenes = sceneStateManager.toggleScene(node.sceneName);
      await applySceneCommand(nextScenes);
    }
  };
  return [
    vscode20.commands.registerCommand("sceneBreakpoints.applySceneItem", handleToggleSceneItem),
    vscode20.commands.registerCommand("sceneBreakpoints.toggleSceneActivation", handleToggleSceneItem)
  ];
}
function registerSceneCrudCommands(treeDataProvider) {
  return [
    vscode20.commands.registerCommand("sceneBreakpoints.refreshView", () => {
      treeDataProvider.refresh();
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.createNewScene", async () => {
      await runWithWorkspace(true, async (workspaceRoot) => {
        const target = await promptSceneName({
          prompt: vscode20.l10n.t("Enter new scene identifier (e.g. auth-flow)"),
          placeHolder: "auth-flow"
        });
        if (!target) return;
        const ok = await sceneManager.createScene(workspaceRoot, target);
        if (ok) {
          void vscode20.window.showInformationMessage(vscode20.l10n.t("Created empty scene [{0}]", target));
        } else {
          void vscode20.window.showWarningMessage(vscode20.l10n.t("Scene [{0}] already exists", target));
        }
      });
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.renameSceneItem", async (node) => {
      if (!node?.sceneName) return;
      await runWithWorkspace(true, async (workspaceRoot) => {
        const newName = await promptSceneName({
          prompt: vscode20.l10n.t("Enter new identifier for scene [{0}]", node.sceneName),
          value: node.sceneName
        });
        if (!newName || newName === node.sceneName) return;
        const renamed = await sceneManager.renameScene(workspaceRoot, node.sceneName, newName);
        if (renamed) {
          void vscode20.window.showInformationMessage(
            vscode20.l10n.t("Renamed scene [{0}] to [{1}]", node.sceneName, newName)
          );
        }
      });
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.deleteSceneItem", async (node) => {
      if (!node?.sceneName) return;
      await runWithWorkspace(true, async (workspaceRoot) => {
        const confirmed = await confirmModalAction(
          vscode20.l10n.t("Are you sure you want to delete scene [{0}]? This action cannot be undone.", node.sceneName),
          vscode20.l10n.t("Delete")
        );
        if (!confirmed) return;
        const deleted = await sceneManager.deleteScene(workspaceRoot, node.sceneName);
        if (deleted) {
          void vscode20.window.showInformationMessage(vscode20.l10n.t("Deleted scene [{0}]", node.sceneName));
        }
      });
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.duplicateScene", async (node) => {
      if (!node?.sceneName) return;
      await runWithWorkspace(true, async (workspaceRoot) => {
        const target = await promptSceneName({
          prompt: vscode20.l10n.t("Enter target identifier for duplicated scene"),
          value: `${node.sceneName}-copy`
        });
        if (!target) return;
        const duplicated = await sceneManager.duplicateScene(workspaceRoot, node.sceneName, target);
        if (duplicated) {
          void vscode20.window.showInformationMessage(
            vscode20.l10n.t("Duplicated scene [{0}] as [{1}]", node.sceneName, target)
          );
        } else {
          void vscode20.window.showWarningMessage(vscode20.l10n.t("Scene [{0}] already exists", target));
        }
      });
    })
  ];
}
function registerBreakpointMutationCommands() {
  return [
    vscode20.commands.registerCommand("sceneBreakpoints.removeBreakpointItem", async (node) => {
      if (node instanceof SceneRefTreeItem) {
        await runWithWorkspace(true, async (workspaceRoot) => {
          await breakpointManager.removeBreakpoint(workspaceRoot, node.sceneName, node.index);
        });
        return;
      }
      if (!node || typeof node.index !== "number" || !node.sceneName) return;
      await runWithWorkspace(true, async (workspaceRoot) => {
        await breakpointManager.removeBreakpoint(workspaceRoot, node.sceneName, node.index);
      });
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.toggleBreakpointItem", async (node) => {
      if (!node || typeof node.index !== "number" || !node.sceneName) return;
      await runWithWorkspace(true, async (workspaceRoot) => {
        const result = await breakpointManager.toggleBreakpoint(workspaceRoot, node.sceneName, node.index);
        if (result.success) {
          node.breakpoint.enabled = result.newEnabled;
          node.updateAppearance();
        }
      });
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.enableAllBreakpointsInScene", async (node) => {
      if (!node?.sceneName) return;
      await runWithWorkspace(true, async (workspaceRoot) => {
        const changed = await breakpointManager.setAllEnabled(workspaceRoot, node.sceneName, true);
        if (changed) {
          void vscode20.window.showInformationMessage(vscode20.l10n.t("Enabled all breakpoints in scene [{0}]", node.sceneName));
        }
      });
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.disableAllBreakpointsInScene", async (node) => {
      if (!node?.sceneName) return;
      await runWithWorkspace(true, async (workspaceRoot) => {
        const changed = await breakpointManager.setAllEnabled(workspaceRoot, node.sceneName, false);
        if (changed) {
          void vscode20.window.showInformationMessage(vscode20.l10n.t("Disabled all breakpoints in scene [{0}]", node.sceneName));
        }
      });
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.revealInConfigFile", async (node) => {
      if (!node?.sceneName || !node.breakpoint) return;
      await runWithWorkspace(true, async (workspaceRoot) => {
        const configPath = path9.join(workspaceRoot, ".vscode", "debug-scenes.json");
        try {
          const doc = await vscode20.workspace.openTextDocument(vscode20.Uri.file(configPath));
          const editor = await vscode20.window.showTextDocument(doc, { preview: false });
          const targetLine = findBreakpointLineInJson(doc.getText(), node.sceneName, node.breakpoint);
          const lineIdx = Math.max(0, targetLine - 1);
          const pos = new vscode20.Position(lineIdx, 0);
          const range = new vscode20.Range(pos, pos);
          editor.selection = new vscode20.Selection(pos, pos);
          editor.revealRange(range, vscode20.TextEditorRevealType.InCenter);
        } catch (err) {
          void vscode20.window.showWarningMessage(
            vscode20.l10n.t("Failed to read debug-scenes.json: {0}", err?.message || String(err))
          );
        }
      });
    })
  ];
}
function resolveTargetNode(node, treeView) {
  if (node instanceof BreakpointNode && typeof node.index === "number") return node;
  const selected = treeView?.selection?.[0];
  if (selected instanceof BreakpointNode && typeof selected.index === "number") return selected;
  return void 0;
}
function calculateTargetIndex(direction, currentIndex, listLength) {
  if (direction === "top") return 0;
  if (direction === "bottom") return listLength - 1;
  if (direction === "up") return Math.max(0, currentIndex - 1);
  return Math.min(listLength - 1, currentIndex + 1);
}
async function executeMove(rawNode, direction, treeDataProvider, treeView) {
  const refTarget = rawNode instanceof SceneRefTreeItem ? rawNode : void 0;
  const bpTarget = refTarget ? void 0 : resolveTargetNode(rawNode, treeView);
  const sceneName = refTarget?.sceneName ?? bpTarget?.sceneName;
  const currentIndex = refTarget?.index ?? bpTarget?.index;
  if (!sceneName || typeof currentIndex !== "number") return;
  await runWithWorkspace(true, async (workspaceRoot) => {
    const moved = await breakpointManager.moveBreakpoint(workspaceRoot, sceneName, currentIndex, direction);
    if (moved && treeView) {
      const config = sceneManager.loadScenesConfig(workspaceRoot);
      const list = config.scenes[sceneName] || [];
      const targetIndex = calculateTargetIndex(direction, currentIndex, list.length);
      setTimeout(async () => {
        try {
          const children = await treeDataProvider.getBreakpointNodes(sceneName);
          const updatedNode = children.find((c) => c.index === targetIndex);
          if (updatedNode) {
            await treeView.reveal(updatedNode, { select: true, focus: true });
          }
        } catch {
        }
      }, 50);
    }
  });
}
function registerBreakpointReorderCommands(treeDataProvider, treeView) {
  return [
    vscode20.commands.registerCommand("sceneBreakpoints.moveBreakpointUp", async (node) => {
      await executeMove(node, "up", treeDataProvider, treeView);
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.moveBreakpointDown", async (node) => {
      await executeMove(node, "down", treeDataProvider, treeView);
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.moveBreakpointToTop", async (node) => {
      await executeMove(node, "top", treeDataProvider, treeView);
    }),
    vscode20.commands.registerCommand("sceneBreakpoints.moveBreakpointToBottom", async (node) => {
      await executeMove(node, "bottom", treeDataProvider, treeView);
    })
  ];
}
function registerRevealRefSourceCommand(treeView, treeDataProvider) {
  return vscode20.commands.registerCommand(
    "sceneBreakpoints.revealRefSource",
    async (raw, declaringScene) => {
      let targetScene;
      let ownerScene = declaringScene;
      let targetIndex;
      if (typeof raw === "string") {
        targetScene = raw;
      } else if (raw instanceof SceneRefTreeItem) {
        targetScene = raw.refName;
        ownerScene = raw.sceneName;
      } else if (raw instanceof BreakpointNode && raw.isReadonly()) {
        targetScene = raw.sceneName;
        targetIndex = raw.index;
      }
      if (!targetScene) return;
      await runWithWorkspace(false, async (workspaceRoot) => {
        const config = sceneManager.loadScenesConfig(workspaceRoot);
        const sourceSteps = config.scenes[targetScene];
        if (!Array.isArray(sourceSteps)) {
          void vscode20.window.showWarningMessage(
            vscode20.l10n.t('Scene reference "{0}" not found; skipped. Scene: {1}', targetScene, ownerScene || targetScene)
          );
          return;
        }
        if (!treeView) return;
        const sourceNode = new SceneNode(
          targetScene,
          sourceSteps.length,
          sceneStateManager.isSceneActive(targetScene),
          false
        );
        try {
          await treeView.reveal(sourceNode, { focus: true, select: true, expand: true });
        } catch {
          return;
        }
        if (typeof targetIndex === "number" && treeDataProvider) {
          const stepNodes = treeDataProvider.getBreakpointNodes(targetScene);
          const targetBpNode = stepNodes[targetIndex];
          if (targetBpNode instanceof BreakpointNode) {
            try {
              await treeView.reveal(targetBpNode, { select: true, focus: false, expand: true });
            } catch {
            }
          }
        }
      });
    }
  );
}
function registerSceneRefToggleCommand(treeDataProvider) {
  return vscode20.commands.registerCommand("sceneBreakpoints.toggleSceneRef", async (node) => {
    if (!node) return;
    await runWithWorkspace(true, async (workspaceRoot) => {
      const result = await breakpointManager.toggleBreakpoint(
        workspaceRoot,
        node.sceneName,
        node.index,
        !node.isEnabled
      );
      if (result.success) {
        treeDataProvider.refresh();
      }
    });
  });
}
function registerTreeCommands(context, treeDataProvider, treeView) {
  context.subscriptions.push(
    ...registerSceneActivationCommands(),
    ...registerSceneCrudCommands(treeDataProvider),
    ...registerBreakpointMutationCommands(),
    ...registerBreakpointReorderCommands(treeDataProvider, treeView),
    registerRevealRefSourceCommand(treeView, treeDataProvider),
    registerSceneRefToggleCommand(treeDataProvider)
  );
}

// src/ui/commands/index.ts
function registerAllCommands(context, deps2) {
  setExtensionGlobalState(context.globalState);
  const commands7 = [
    // 核心场景断点命令
    ["sceneBreakpoints.addBreakpoint", addBreakpointCommand],
    ["sceneBreakpoints.applyScene", applySceneCommand],
    ["sceneBreakpoints.clearAll", clearAllCommand],
    ["sceneBreakpoints.exportScene", exportSceneCommand],
    ["sceneBreakpoints.showMenu", showMenuCommand],
    // 事故现场逆向固化：调用栈一键生成场景 (v1.2.0)
    ["sceneBreakpoints.captureCallStack", captureCallStackCommand],
    // 场景断点可视化画布与 Mermaid 导出 (v1.3.0)
    ["sceneBreakpoints.showGraph", showGraphCommand],
    ["sceneBreakpoints.exportGraphMermaid", exportGraphMermaidCommand],
    // 剪贴板快速流转与团队共享
    ["sceneBreakpoints.copySceneToClipboard", copySceneToClipboardCommand],
    ["sceneBreakpoints.importSceneFromClipboard", importSceneFromClipboardCommand],
    // AI Agent 技能集成与状态诊断
    ["sceneBreakpoints.installSkill", () => installSkillCommand(context)],
    ["sceneBreakpoints.diagnoseAiIntegration", () => diagnoseAiIntegrationCommand(context)]
  ];
  for (const [commandId, handler] of commands7) {
    context.subscriptions.push(vscode21.commands.registerCommand(commandId, handler));
  }
  context.subscriptions.push(registerResolveWarningsNotifier());
  if (deps2?.treeDataProvider) {
    registerTreeCommands(context, deps2.treeDataProvider, deps2.treeView);
  }
}

// src/infra/storage/jsonFileSceneRepository.ts
var fs3 = __toESM(require("node:fs"));
var path11 = __toESM(require("node:path"));
var vscode22 = __toESM(require("vscode"));

// src/infra/storage/echoLoopGuard.ts
var DEFAULT_CONTENT_KEY = "__default__";
var EchoLoopGuard = class {
  internalSavingTimer;
  _isInternalSaving = false;
  lastSavedContentByKey = /* @__PURE__ */ new Map();
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
   * 重置内部状态（供单元测试环境复位）
   */
  reset() {
    if (this.internalSavingTimer) {
      clearTimeout(this.internalSavingTimer);
      this.internalSavingTimer = void 0;
    }
    this._isInternalSaving = false;
    this.lastSavedContentByKey.clear();
  }
  /**
   * 记录指定键控文件最新一次内部持久化写盘的内容指纹 (v1.2.0 分层配置)
   */
  setLastSavedContentForKey(key, content) {
    this.lastSavedContentByKey.set(key, content);
  }
  getLastSavedContentForKey(key) {
    return this.lastSavedContentByKey.get(key) ?? "";
  }
  /**
   * 记录最新一次内部持久化写盘的文件内容指纹（默认键，向后兼容主文件）
   */
  setLastSavedContent(content) {
    this.setLastSavedContentForKey(DEFAULT_CONTENT_KEY, content);
  }
  getLastSavedContent() {
    return this.getLastSavedContentForKey(DEFAULT_CONTENT_KEY);
  }
  /**
   * 冷启动基线播种 (INV-031 前置)
   * 扩展启动时若指定键从未发生过内部写盘（基线为空），以磁盘现状播种基线，
   * 保证 Git Pull / 环境漂移在冷启动后仍可静默自愈，不误判为外部编辑冲突
   */
  seedBaselineForKey(key, content) {
    if (this.getLastSavedContentForKey(key) || !content) return;
    this.lastSavedContentByKey.set(key, content);
  }
  seedBaseline(content) {
    this.seedBaselineForKey(DEFAULT_CONTENT_KEY, content);
  }
  /**
   * 判定磁盘内容是否相对指定键最近一次内部写盘基线发生外部修改 (INV-031 门控信号)
   * 无基线（冷启动未播种）或空内容时一律返回 false，防止冷启动误伤
   */
  isDiskContentModifiedSinceLastSaveForKey(key, content) {
    if (!content || !this.getLastSavedContentForKey(key)) return false;
    return !this.isContentMatchingLastSavedForKey(key, content);
  }
  isDiskContentModifiedSinceLastSave(content) {
    return this.isDiskContentModifiedSinceLastSaveForKey(DEFAULT_CONTENT_KEY, content);
  }
  /**
   * 比对磁盘传入内容是否与指定键最新内部写盘内容完全一致（用于拦截自身 fileWatcher 回环）
   */
  isContentMatchingLastSavedForKey(key, content) {
    const baseline = this.getLastSavedContentForKey(key);
    if (!baseline || !content) return false;
    try {
      return JSON.stringify(JSON.parse(content)) === JSON.stringify(JSON.parse(baseline));
    } catch {
      return content.trim() === baseline.trim();
    }
  }
  isContentMatchingLastSaved(content) {
    return this.isContentMatchingLastSavedForKey(DEFAULT_CONTENT_KEY, content);
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
var echoLoopGuard = new EchoLoopGuard();

// src/infra/storage/atomicFileJsonStore.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
function logWarning(msg, err) {
  const detail = err instanceof Error ? err.message : String(err);
  console.warn(`[AtomicFileJsonStore] ${msg}: ${detail}`);
}
var AtomicFileJsonStore = class {
  /**
   * 安全原子写盘：唯一临时文件名 + renameSync 原子替换 + 异常自清理
   */
  save(filePath, data) {
    const targetDir = import_node_path.default.dirname(filePath);
    if (!import_node_fs.default.existsSync(targetDir)) {
      import_node_fs.default.mkdirSync(targetDir, { recursive: true });
    }
    const tmpName = `${import_node_path.default.basename(filePath)}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    const tmpPath = import_node_path.default.join(targetDir, tmpName);
    try {
      const serialized = JSON.stringify(data, null, 2);
      import_node_fs.default.writeFileSync(tmpPath, serialized, "utf-8");
      import_node_fs.default.renameSync(tmpPath, filePath);
    } finally {
      if (import_node_fs.default.existsSync(tmpPath)) {
        try {
          import_node_fs.default.unlinkSync(tmpPath);
        } catch (err) {
          logWarning("Failed to cleanup tmp file", err);
        }
      }
    }
  }
  /**
   * 冷启动安全加载：内嵌主文件完整性探测、灾难备份抢救自愈与孤儿文件净化
   */
  load(filePath, options) {
    const targetDir = import_node_path.default.dirname(filePath);
    const baseName = import_node_path.default.basename(filePath);
    this.pruneOrphanTmpFiles(targetDir, baseName);
    const probeResult = this.probeMainFile(filePath, options);
    if (probeResult) {
      return probeResult;
    }
    const healedResult = this.attemptRecoveryFromTmp(targetDir, baseName, filePath, options);
    if (healedResult) {
      return healedResult;
    }
    return {
      status: "fallback",
      data: options.fallback(),
      recoveryMessage: "Main file corrupted and no recoverable backup candidate found. Returned fallback."
    };
  }
  probeMainFile(filePath, options) {
    if (!import_node_fs.default.existsSync(filePath)) {
      return { status: "empty", data: options.fallback() };
    }
    try {
      const content = import_node_fs.default.readFileSync(filePath, "utf-8");
      if (!content || !content.trim()) {
        return null;
      }
      if (hasGitConflictMarkers(content)) {
        return null;
      }
      const parser = options.parse || JSON.parse;
      const parsed = parser(content);
      if (options.validate && !options.validate(parsed)) {
        return null;
      }
      return { status: "healthy", data: parsed };
    } catch (err) {
      logWarning("Main file integrity probe failed", err);
      return null;
    }
  }
  attemptRecoveryFromTmp(dir, baseName, targetFilePath, options) {
    if (!import_node_fs.default.existsSync(dir)) {
      return null;
    }
    try {
      const prefix = `${baseName}.tmp.`;
      const candidates = import_node_fs.default.readdirSync(dir).filter((f) => f.startsWith(prefix)).map((f) => import_node_path.default.join(dir, f)).map((p) => {
        try {
          return { path: p, mtime: import_node_fs.default.statSync(p).mtimeMs };
        } catch {
          return { path: p, mtime: 0 };
        }
      }).sort((a, b) => b.mtime - a.mtime);
      for (const cand of candidates) {
        const recovered = this.tryParseCandidate(cand.path, options);
        if (recovered !== null) {
          import_node_fs.default.copyFileSync(cand.path, targetFilePath);
          const msg = `Disaster recovery successful: restored configuration from [${import_node_path.default.basename(cand.path)}]`;
          options.onHealed?.(msg);
          return { status: "healed", data: recovered, recoveryMessage: msg };
        }
      }
    } catch (err) {
      logWarning("Error during candidate recovery", err);
    }
    return null;
  }
  tryParseCandidate(candPath, options) {
    try {
      const raw = import_node_fs.default.readFileSync(candPath, "utf-8");
      if (!raw || !raw.trim() || hasGitConflictMarkers(raw)) return null;
      const parser = options.parse || JSON.parse;
      const parsed = parser(raw);
      if (options.validate && !options.validate(parsed)) return null;
      return parsed;
    } catch (err) {
      logWarning(`Candidate [${candPath}] parse failed`, err);
      return null;
    }
  }
  pruneOrphanTmpFiles(dir, baseName) {
    if (!import_node_fs.default.existsSync(dir)) return;
    try {
      const prefix = `${baseName}.tmp.`;
      const now = Date.now();
      const files = import_node_fs.default.readdirSync(dir).filter((f) => f.startsWith(prefix));
      for (const file of files) {
        const full = import_node_path.default.join(dir, file);
        try {
          const stat = import_node_fs.default.statSync(full);
          if (now - stat.mtimeMs > 5e3) {
            import_node_fs.default.unlinkSync(full);
          }
        } catch (err) {
          logWarning("Prune orphan file error", err);
        }
      }
    } catch (err) {
      logWarning("Read directory for orphan prune error", err);
    }
  }
};

// src/infra/storage/jsonFileSceneRepository.ts
var defaultNotifier = {
  error: (msg) => {
    void vscode22.window.showErrorMessage(msg);
  },
  info: (msg) => {
    void vscode22.window.showInformationMessage(msg);
  },
  warn: (msg) => {
    void vscode22.window.showWarningMessage(msg);
  }
};
var activeNotifier = defaultNotifier;
function getScenesConfigPath(workspaceRoot) {
  return path11.join(workspaceRoot, ".vscode", "debug-scenes.json");
}
function getLocalScenesConfigPath(workspaceRoot) {
  return path11.join(workspaceRoot, ".vscode", "debug-scenes.local.json");
}
var stripJsonComments = stripComments;
var atomicStore = new AtomicFileJsonStore();
var lastMergedOriginByWorkspace = /* @__PURE__ */ new Map();
function readLayerConfig(configPath) {
  if (!fs3.existsSync(configPath)) {
    return { scenes: {} };
  }
  try {
    const raw = fs3.readFileSync(configPath, "utf-8");
    if (hasGitConflictMarkers(raw)) {
      activeNotifier.error(
        vscode22.l10n.t("Scene configuration has Git merge conflicts. Please resolve them first.")
      );
      return { scenes: {} };
    }
  } catch {
  }
  try {
    const report = atomicStore.load(configPath, {
      fallback: () => ({ scenes: {} }),
      parse: (text) => JSON.parse(stripJsonComments(text)),
      validate: (data) => Boolean(data && typeof data === "object"),
      onHealed: (msg) => {
        activeNotifier.info(
          vscode22.l10n.t("Scene configuration self-healed: {0}", msg)
        );
      }
    });
    if (report.status === "healed") {
      echoLoopGuard.markInternalSaving();
    }
    return sanitizeScenesConfig(report.data);
  } catch (e) {
    activeNotifier.error(vscode22.l10n.t("Failed to read debug-scenes.json: {0}", e?.message || String(e)));
    return { scenes: {} };
  }
}
function loadLayers(workspaceRoot) {
  const teamConfig = readLayerConfig(getScenesConfigPath(workspaceRoot));
  const localConfig = readLayerConfig(getLocalScenesConfigPath(workspaceRoot));
  const originByScene = {};
  for (const name of Object.keys(teamConfig.scenes || {})) {
    originByScene[name] = "team";
  }
  for (const name of Object.keys(localConfig.scenes || {})) {
    originByScene[name] = "local";
  }
  const mergedConfig = {
    ...teamConfig,
    scenes: { ...teamConfig.scenes, ...localConfig.scenes }
  };
  lastMergedOriginByWorkspace.set(getScenesConfigPath(workspaceRoot), originByScene);
  return { config: mergedConfig, originByScene };
}
function loadMergedScenesConfig(workspaceRoot) {
  return loadLayers(workspaceRoot);
}
function loadScenesConfig(workspaceRoot) {
  return loadLayers(workspaceRoot).config;
}
function writeLayerConfig(configPath, config, isTeamLayer) {
  echoLoopGuard.markInternalSaving();
  const content = JSON.stringify(config, null, 2);
  echoLoopGuard.setLastSavedContentForKey(configPath, content);
  if (isTeamLayer) {
    echoLoopGuard.setLastSavedContent(content);
  }
  atomicStore.save(configPath, config);
}
function saveScenesLayers(workspaceRoot, config, originByScene) {
  const teamScenes = {};
  const localScenes = {};
  for (const [name, items] of Object.entries(config.scenes || {})) {
    if (originByScene[name] === "local") {
      localScenes[name] = items;
    } else {
      teamScenes[name] = items;
    }
  }
  try {
    writeLayerConfig(getScenesConfigPath(workspaceRoot), { ...config, scenes: teamScenes }, true);
    if (Object.keys(localScenes).length > 0) {
      writeLayerConfig(getLocalScenesConfigPath(workspaceRoot), { scenes: localScenes }, false);
    }
  } catch (e) {
    activeNotifier.error(vscode22.l10n.t("Failed to save debug-scenes.json: {0}", e?.message || String(e)));
  }
}
function saveScenesConfig(workspaceRoot, config) {
  const originByScene = {
    ...lastMergedOriginByWorkspace.get(getScenesConfigPath(workspaceRoot)) ?? {}
  };
  for (const name of Object.keys(config.scenes || {})) {
    if (!(name in originByScene)) originByScene[name] = "local";
  }
  saveScenesLayers(workspaceRoot, config, originByScene);
}
function seedEchoLoopBaselineFromDisk(workspaceRoot) {
  try {
    for (const configPath of [getScenesConfigPath(workspaceRoot), getLocalScenesConfigPath(workspaceRoot)]) {
      if (fs3.existsSync(configPath)) {
        echoLoopGuard.seedBaselineForKey(configPath, fs3.readFileSync(configPath, "utf-8"));
      }
    }
  } catch (e) {
    console.warn("[SceneStorage] Failed to seed echo loop baseline from disk:", e);
  }
}
function isDiskContentModifiedSinceLastSaved(workspaceRoot) {
  try {
    const configPath = getScenesConfigPath(workspaceRoot);
    if (!fs3.existsSync(configPath)) return false;
    return echoLoopGuard.isDiskContentModifiedSinceLastSaveForKey(
      configPath,
      fs3.readFileSync(configPath, "utf-8")
    );
  } catch (e) {
    console.warn("[SceneStorage] Failed to detect disk config modification:", e);
    return false;
  }
}
function ensureLocalScenesGitignore(workspaceRoot) {
  const LOCAL_ENTRY = "debug-scenes.local.json";
  try {
    const gitignorePath = path11.join(workspaceRoot, ".gitignore");
    const existing = fs3.existsSync(gitignorePath) ? fs3.readFileSync(gitignorePath, "utf-8") : "";
    const alreadyIgnored = existing.split(/\r?\n/).some((line) => line.trim() === LOCAL_ENTRY || line.trim() === `.vscode/${LOCAL_ENTRY}`);
    if (alreadyIgnored) return false;
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    fs3.writeFileSync(gitignorePath, `${existing}${separator}# Scene Breakpoints personal scenes
.vscode/${LOCAL_ENTRY}
`, "utf-8");
    return true;
  } catch (e) {
    console.warn("[SceneStorage] Failed to update .gitignore for local scenes:", e);
    return false;
  }
}
var jsonFileSceneRepository = {
  loadScenesConfig,
  saveScenesConfig,
  getScenesConfigPath,
  getLocalScenesConfigPath,
  loadMergedScenesConfig,
  saveScenesLayers
};

// src/infra/storage/fileLineReader.ts
var fs4 = __toESM(require("node:fs"));
var path12 = __toESM(require("node:path"));
var FileLineReader = class {
  workspaceRoot;
  cache;
  getDocumentLines;
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot;
    this.cache = options.cache || /* @__PURE__ */ new Map();
    this.getDocumentLines = options.getDocumentLines;
  }
  async readLines(filePath) {
    if (!filePath || typeof filePath !== "string") {
      return void 0;
    }
    const fullPath = path12.isAbsolute(filePath) || !this.workspaceRoot ? filePath : path12.join(this.workspaceRoot, filePath);
    if (this.cache.has(fullPath)) {
      return this.cache.get(fullPath);
    }
    let lines;
    if (this.getDocumentLines) {
      lines = await this.getDocumentLines(fullPath);
    }
    if (!lines && fs4.existsSync(fullPath)) {
      try {
        const content = await fs4.promises.readFile(fullPath, "utf-8");
        lines = content.split(/\r?\n/);
      } catch {
        return void 0;
      }
    }
    if (lines) {
      this.cache.set(fullPath, lines);
    }
    return lines;
  }
  clearCache() {
    this.cache.clear();
  }
};
var defaultFileLineReader = new FileLineReader();

// src/infra/vscode/vscodeBreakpointBridge.ts
var fs5 = __toESM(require("node:fs"));
var path13 = __toESM(require("node:path"));
var vscode23 = __toESM(require("vscode"));

// src/infra/vscode/dapEchoGuard.ts
var DapEchoGuard = class {
  isApplying = false;
  timeoutHandle;
  isApplyingBreakpoints() {
    return this.isApplying;
  }
  setApplying(applying) {
    this.isApplying = applying;
    if (!applying && this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = void 0;
    }
  }
  reset() {
    this.setApplying(false);
  }
  async withApplyingLock(action) {
    this.isApplying = true;
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = void 0;
    }
    try {
      return await action();
    } finally {
      this.timeoutHandle = setTimeout(() => {
        this.isApplying = false;
        this.timeoutHandle = void 0;
      }, 150);
    }
  }
};
var dapEchoGuard = new DapEchoGuard();

// src/infra/vscode/vscodeBreakpointBridge.ts
async function resolveFileUri(workspaceRoot, filePath, cache) {
  if (!filePath) return void 0;
  if (cache?.has(filePath)) {
    return cache.get(filePath) || void 0;
  }
  const fullPath = path13.isAbsolute(filePath) ? filePath : path13.join(workspaceRoot, filePath);
  let targetUri;
  if (fs5.existsSync(fullPath)) {
    targetUri = vscode23.Uri.file(fullPath);
  } else {
    const found = await vscode23.workspace.findFiles(`**/${path13.basename(filePath)}`, "**/node_modules/**", 1);
    targetUri = found.length > 0 ? found[0] : null;
  }
  cache?.set(filePath, targetUri);
  return targetUri || void 0;
}
function createSourceBreakpoint(location, item, isEnabled = item.enabled ?? true) {
  switch (item.type) {
    case "condition":
      return new vscode23.SourceBreakpoint(location, isEnabled, item.condition);
    case "hitCount":
      return new vscode23.SourceBreakpoint(location, isEnabled, void 0, item.hitCondition);
    case "logpoint":
      return new vscode23.SourceBreakpoint(location, isEnabled, void 0, void 0, item.logMessage);
    case "line":
    default:
      return new vscode23.SourceBreakpoint(location, isEnabled);
  }
}
function createFunctionBreakpoint(item, isEnabled = item.enabled ?? true) {
  return new vscode23.FunctionBreakpoint(
    item.functionName.trim(),
    isEnabled,
    item.condition,
    item.hitCondition
  );
}
function findMatchingDapBreakpoint(currentBreakpoints, sceneBp, targetUri) {
  if (sceneBp.type === "function") {
    const funcItem = sceneBp;
    return currentBreakpoints.find(
      (bp) => bp instanceof vscode23.FunctionBreakpoint && bp.functionName === funcItem.functionName
    );
  }
  if (!targetUri) return void 0;
  const srcItem = sceneBp;
  const targetLineZeroBased = Math.max(0, srcItem.line - 1);
  return currentBreakpoints.find((bp) => {
    if (!(bp instanceof vscode23.SourceBreakpoint)) return false;
    return isSameFsPath(bp.location.uri.fsPath, targetUri.fsPath) && bp.location.range.start.line === targetLineZeroBased;
  });
}
function cloneDapBreakpointWithEnabled(bp, enabled) {
  if (bp instanceof vscode23.FunctionBreakpoint) {
    return new vscode23.FunctionBreakpoint(bp.functionName, enabled, bp.condition, bp.hitCondition);
  }
  const srcBp = bp;
  return new vscode23.SourceBreakpoint(
    srcBp.location,
    enabled,
    srcBp.condition,
    srcBp.hitCondition,
    srcBp.logMessage
  );
}
function isSameDapBreakpoint(a, b) {
  if (a instanceof vscode23.FunctionBreakpoint && b instanceof vscode23.FunctionBreakpoint) {
    return a.functionName === b.functionName && a.enabled === b.enabled && a.condition === b.condition && a.hitCondition === b.hitCondition;
  }
  if (a instanceof vscode23.SourceBreakpoint && b instanceof vscode23.SourceBreakpoint) {
    return isSameFsPath(a.location.uri.fsPath, b.location.uri.fsPath) && a.location.range.start.line === b.location.range.start.line && a.enabled === b.enabled && a.condition === b.condition && a.hitCondition === b.hitCondition && a.logMessage === b.logMessage;
  }
  return false;
}
function computeDapDiff(currentBreakpoints, targetBreakpoints) {
  const matchedCurrentIndices = /* @__PURE__ */ new Set();
  const matchedTargetIndices = /* @__PURE__ */ new Set();
  for (let cIdx = 0; cIdx < currentBreakpoints.length; cIdx++) {
    const curr = currentBreakpoints[cIdx];
    for (let tIdx = 0; tIdx < targetBreakpoints.length; tIdx++) {
      if (matchedTargetIndices.has(tIdx)) continue;
      const target = targetBreakpoints[tIdx];
      if (isSameDapBreakpoint(curr, target)) {
        matchedCurrentIndices.add(cIdx);
        matchedTargetIndices.add(tIdx);
        break;
      }
    }
  }
  return {
    toRemove: currentBreakpoints.filter((_, idx) => !matchedCurrentIndices.has(idx)),
    toAdd: targetBreakpoints.filter((_, idx) => !matchedTargetIndices.has(idx))
  };
}
async function buildDapBreakpoints(workspaceRoot, bpsToLoad) {
  const pathCache = /* @__PURE__ */ new Map();
  const targetBreakpoints = [];
  for (const item of bpsToLoad) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "function") {
      const funcItem = item;
      if (funcItem.functionName?.trim()) {
        targetBreakpoints.push(createFunctionBreakpoint(funcItem));
      }
      continue;
    }
    const srcItem = item;
    if (!srcItem.file || typeof srcItem.line !== "number" || isNaN(srcItem.line) || srcItem.line <= 0) {
      continue;
    }
    const targetUri = await resolveFileUri(workspaceRoot, srcItem.file, pathCache);
    if (!targetUri) continue;
    const pos = new vscode23.Position(Math.max(0, srcItem.line - 1), 0);
    targetBreakpoints.push(createSourceBreakpoint(new vscode23.Location(targetUri, pos), srcItem));
  }
  return targetBreakpoints;
}
async function applySceneBreakpoints(workspaceRoot, _targetScene, bpsToLoad) {
  return dapEchoGuard.withApplyingLock(async () => {
    const currentBreakpoints = vscode23.debug.breakpoints;
    if (!bpsToLoad?.length) {
      if (currentBreakpoints.length > 0) {
        await vscode23.debug.removeBreakpoints(currentBreakpoints);
      }
      return { loadedCount: 0, healedCount: 0 };
    }
    const targetBreakpoints = await buildDapBreakpoints(workspaceRoot, bpsToLoad);
    const { toRemove, toAdd } = computeDapDiff(currentBreakpoints, targetBreakpoints);
    if (toRemove.length > 0) await vscode23.debug.removeBreakpoints(toRemove);
    if (toAdd.length > 0) await vscode23.debug.addBreakpoints(toAdd);
    return {
      loadedCount: targetBreakpoints.length,
      healedCount: 0
    };
  });
}
async function collectCurrentBreakpoints(workspaceRoot) {
  const currentBreakpoints = vscode23.debug.breakpoints;
  const exportedBps = [];
  for (const bp of currentBreakpoints) {
    if (bp instanceof vscode23.FunctionBreakpoint) {
      exportedBps.push({
        type: "function",
        functionName: bp.functionName,
        enabled: bp.enabled,
        condition: bp.condition?.trim() || void 0,
        hitCondition: bp.hitCondition?.trim() || void 0,
        desc: void 0
      });
    } else if (bp instanceof vscode23.SourceBreakpoint) {
      const fullPath = bp.location.uri.fsPath;
      const relPath = path13.relative(workspaceRoot, fullPath).replace(/\\/g, "/");
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
        const doc = await vscode23.workspace.openTextDocument(bp.location.uri);
        contextSnippet = extractContextSnippet(doc, bp.location.range.start.line);
      } catch {
      }
      exportedBps.push({
        type: bpType,
        file: relPath,
        line,
        enabled: bp.enabled,
        condition: bp.condition?.trim() || void 0,
        hitCondition: bp.hitCondition?.trim() || void 0,
        logMessage: bp.logMessage?.trim() || void 0,
        desc: void 0,
        contextSnippet
      });
    }
  }
  return exportedBps;
}
async function applySingleBreakpointToEditor(workspaceRoot, sceneBp) {
  if (!sceneBp) return false;
  const isFunction = sceneBp.type === "function";
  const uri = !isFunction ? await resolveFileUri(workspaceRoot, sceneBp.file) : void 0;
  if (!isFunction && !uri) return false;
  if (findMatchingDapBreakpoint(vscode23.debug.breakpoints, sceneBp, uri)) {
    return false;
  }
  const newBp = isFunction ? createFunctionBreakpoint(sceneBp) : createSourceBreakpoint(
    new vscode23.Location(uri, new vscode23.Position(Math.max(0, sceneBp.line - 1), 0)),
    sceneBp
  );
  return dapEchoGuard.withApplyingLock(async () => {
    await vscode23.debug.addBreakpoints([newBp]);
    return true;
  });
}
async function clearAllBreakpoints() {
  await vscode23.debug.removeBreakpoints(vscode23.debug.breakpoints);
}
async function syncBreakpointEnabledToEditor(workspaceRoot, sceneBp, targetEnabled) {
  if (!sceneBp) return false;
  const isFunction = sceneBp.type === "function";
  const uri = !isFunction ? await resolveFileUri(workspaceRoot, sceneBp.file) : void 0;
  const matched = findMatchingDapBreakpoint(vscode23.debug.breakpoints, sceneBp, uri);
  if (!matched || matched.enabled === targetEnabled) {
    return false;
  }
  const updated = cloneDapBreakpointWithEnabled(matched, targetEnabled);
  return dapEchoGuard.withApplyingLock(async () => {
    await vscode23.debug.removeBreakpoints([matched]);
    await vscode23.debug.addBreakpoints([updated]);
    return true;
  });
}
var vscodeBreakpointBridge = {
  applySceneBreakpoints,
  collectCurrentBreakpoints,
  clearAllBreakpoints,
  applySingleBreakpointToEditor,
  syncBreakpointEnabledToEditor
};

// src/infra/vscode/listeners/debugLifecycleListener.ts
var vscode27 = __toESM(require("vscode"));

// src/domain/services/launchBindingResolver.ts
function resolveLaunchBoundScenes(config, launchName, envScene) {
  const sceneNames = Object.keys(config.scenes || {});
  const matchSceneName = (candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) return void 0;
    const lower = trimmed.toLowerCase();
    return sceneNames.find((name) => name.toLowerCase() === lower);
  };
  if (envScene && envScene.trim()) {
    const candidates = uniqueStrings(envScene);
    const matched = [];
    for (const cand of candidates) {
      const found = matchSceneName(cand);
      if (found && !matched.includes(found)) {
        matched.push(found);
      }
    }
    return matched;
  }
  if (launchName && config.bindings) {
    const mapped = config.bindings[launchName];
    if (mapped) {
      const rawCandidates = uniqueStrings(mapped);
      const matched = [];
      for (const cand of rawCandidates) {
        const found = matchSceneName(cand);
        if (found && !matched.includes(found)) {
          matched.push(found);
        }
      }
      if (matched.length > 0) return matched;
    }
  }
  if (launchName) {
    const found = matchSceneName(launchName);
    if (found) return [found];
  }
  return [];
}
var LaunchBindingResolver = class {
  static resolveScenes = resolveLaunchBoundScenes;
};

// src/infra/vscode/workspaceRoot.ts
var vscode24 = __toESM(require("vscode"));
function getWorkspaceRoot2() {
  const folders = vscode24.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath;
}

// src/infra/vscode/listeners/configFileWatcherListener.ts
var fs6 = __toESM(require("node:fs"));
var vscode26 = __toESM(require("vscode"));

// src/infra/vscode/vscodeLineReader.ts
var vscode25 = __toESM(require("vscode"));
function createVsCodeLineReader(workspaceRoot) {
  const reader = new FileLineReader({
    workspaceRoot,
    getDocumentLines: async (filePath) => {
      try {
        const uri = vscode25.Uri.file(filePath);
        const doc = await vscode25.workspace.openTextDocument(uri);
        const lines = [];
        for (let i = 0; i < doc.lineCount; i++) {
          lines.push(doc.lineAt(i).text);
        }
        return lines;
      } catch {
        return void 0;
      }
    }
  });
  if (typeof vscode25?.workspace?.onDidChangeTextDocument === "function") {
    vscode25.workspace.onDidChangeTextDocument(() => {
      reader.clearCache();
    });
  }
  return reader;
}
var vscodeLineReader = createVsCodeLineReader();

// src/infra/vscode/listeners/configFileWatcherListener.ts
async function handleExternalScenesFileChange(workspaceRoot) {
  const allowAiActivation = vscode26.workspace.getConfiguration("sceneBreakpoints").get("allowAiFileActivation", false);
  await agentSyncService.handleExternalChange(workspaceRoot, {
    allowAiActivation,
    isDebuggingActive: !!vscode26.debug.activeDebugSession,
    sceneRepository: jsonFileSceneRepository,
    breakpointBridge: vscodeBreakpointBridge,
    lineReader: vscodeLineReader,
    // INV-031：外部变更路径显式下发冲突检测标记（autoEnrich 先行落盘会洗白磁盘漂移信号）
    conflictDetection: "enabled",
    onPendingMessage: () => {
      vscode26.window.setStatusBarMessage(
        vscode26.l10n.t("$(alert) Breakpoint changes pending. Will apply on next debug session."),
        5e3
      );
    }
  });
}
function registerConfigFileWatcherService() {
  let fileChangeDebounceTimer;
  const fileWatcher = vscode26.workspace.createFileSystemWatcher("**/debug-scenes*.json");
  fileWatcher.onDidChange((uri) => {
    if (fileChangeDebounceTimer) {
      clearTimeout(fileChangeDebounceTimer);
    }
    fileChangeDebounceTimer = setTimeout(async () => {
      fileChangeDebounceTimer = void 0;
      try {
        if (fs6.existsSync(uri.fsPath)) {
          const currentDiskContent = fs6.readFileSync(uri.fsPath, "utf-8");
          if (echoLoopGuard.isContentMatchingLastSavedForKey(uri.fsPath, currentDiskContent)) {
            return;
          }
        }
      } catch {
      }
      if (echoLoopGuard.isInternalSaving()) {
        return;
      }
      const workspaceRoot = getWorkspaceRoot2();
      if (workspaceRoot) {
        try {
          await handleExternalScenesFileChange(workspaceRoot);
        } catch (err) {
          void vscode26.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        }
        appEventBus.emit("scenes:changed", { workspaceRoot, reason: "external_file_change" });
      }
    }, 100);
  });
  fileWatcher.onDidCreate(() => {
    const workspaceRoot = getWorkspaceRoot2() || "";
    appEventBus.emit("scenes:changed", { workspaceRoot, reason: "file_created" });
  });
  fileWatcher.onDidDelete(() => {
    const workspaceRoot = getWorkspaceRoot2() || "";
    appEventBus.emit("scenes:changed", { workspaceRoot, reason: "file_deleted" });
  });
  return fileWatcher;
}

// src/infra/vscode/listeners/debugLifecycleListener.ts
function registerDebugLaunchService() {
  return vscode27.debug.registerDebugConfigurationProvider("*", {
    async resolveDebugConfiguration(_folder, config) {
      const autoActivate = vscode27.workspace.getConfiguration("sceneBreakpoints").get("autoActivateOnLaunch", true);
      if (autoActivate && config) {
        const workspaceRoot = getWorkspaceRoot2();
        if (workspaceRoot) {
          const scenesConfig = loadScenesConfig(workspaceRoot);
          const targetScenes = LaunchBindingResolver.resolveScenes(
            scenesConfig,
            config.name,
            config.env?.DEBUG_SCENE
          );
          if (targetScenes.length > 0) {
            const currentActives = sceneStateManager.getActiveScenes();
            const isIdentical = currentActives.length === targetScenes.length && currentActives.every((s, idx) => s === targetScenes[idx]);
            if (!isIdentical) {
              await vscode27.commands.executeCommand("sceneBreakpoints.applyScene", targetScenes);
            }
          }
        }
      }
      return config;
    }
  });
}
function createRevealAndClearCallbacks() {
  const revealPausedBreakpoint = async (file, line) => {
    appEventBus.emit("debug:paused", { file, line });
  };
  const clearPausedBreakpoint = () => {
    appEventBus.emit("debug:resumed", void 0);
  };
  return { revealPausedBreakpoint, clearPausedBreakpoint };
}
var isCurrentPauseCapturedByDap = false;
function selectBestUserSourceFrame(frames, workspaceRoot) {
  if (!frames || frames.length === 0) return void 0;
  const userFrames = frames.filter((f) => !isInternalOrVirtualFramePath(f.source?.path));
  if (userFrames.length === 0) {
    return void 0;
  }
  if (workspaceRoot) {
    for (const f of userFrames) {
      if (f.source?.path && typeof f.line === "number") {
        if (activeBreakpointIndex.isHitInActiveScenes(f.source.path, f.line, workspaceRoot)) {
          return f;
        }
      }
    }
  }
  return userFrames[0];
}
function createDapTrackerFactory(revealPausedBreakpoint, clearPausedBreakpoint) {
  return vscode27.debug.registerDebugAdapterTrackerFactory("*", {
    createDebugAdapterTracker(session) {
      let sessionPausedThreadId;
      let hasCapturedThisPause = false;
      return {
        onDidSendMessage(msg) {
          if (msg?.type === "response" && msg.command === "stackTrace" && msg.body?.stackFrames && msg.body.stackFrames.length > 0) {
            if (hasCapturedThisPause) {
              return;
            }
            if (sessionPausedThreadId !== void 0) {
              const wsRoot = getWorkspaceRoot2();
              if (wsRoot && (activeBreakpointIndex.getNeedsSync() || activeBreakpointIndex.getAllIndexedBreakpoints().length === 0)) {
                try {
                  const cfg = loadScenesConfig(wsRoot);
                  activeBreakpointIndex.syncFromConfig(wsRoot, cfg);
                } catch {
                }
              }
              const targetFrame = selectBestUserSourceFrame(msg.body.stackFrames, wsRoot);
              if (targetFrame?.source?.path && typeof targetFrame.line === "number") {
                hasCapturedThisPause = true;
                isCurrentPauseCapturedByDap = true;
                void revealPausedBreakpoint(targetFrame.source.path, targetFrame.line);
              }
            }
          } else if (msg?.type === "event") {
            if (msg.event === "stopped") {
              hasCapturedThisPause = false;
              isCurrentPauseCapturedByDap = false;
              if (typeof msg.body?.threadId === "number") {
                sessionPausedThreadId = msg.body.threadId;
                setCapturablePauseContext({ session, threadId: msg.body.threadId });
              }
            } else if (msg.event === "continued") {
              const continuedThreadId = msg.body?.threadId;
              const allContinued = msg.body?.allThreadsContinued === true;
              if (allContinued || sessionPausedThreadId !== void 0 && continuedThreadId === sessionPausedThreadId) {
                sessionPausedThreadId = void 0;
                hasCapturedThisPause = false;
                isCurrentPauseCapturedByDap = false;
                setCapturablePauseContext(void 0);
                clearPausedBreakpoint();
              }
            } else if (msg.event === "terminated") {
              sessionPausedThreadId = void 0;
              hasCapturedThisPause = false;
              isCurrentPauseCapturedByDap = false;
              setCapturablePauseContext(void 0);
              clearPausedBreakpoint();
            }
          }
        }
      };
    }
  });
}
function createEditorCheckListener(revealPausedBreakpoint) {
  const checkEditor = (editor) => {
    if (isSourceNavigationLocked()) return;
    if (isCurrentPauseCapturedByDap) return;
    if (!vscode27.debug.activeDebugSession || !editor || editor.document.uri.scheme !== "file") return;
    const workspaceRoot = getWorkspaceRoot2();
    if (!workspaceRoot) return;
    const activeScenes = sceneStateManager.getActiveScenes();
    if (activeScenes.length === 0) return;
    const currentFile = editor.document.uri.fsPath;
    const currentLine = editor.selection.active.line + 1;
    const isHitInScene = activeBreakpointIndex.isHitInActiveScenes(currentFile, currentLine, workspaceRoot);
    if (isHitInScene) {
      void revealPausedBreakpoint(currentFile, currentLine);
    }
  };
  return [
    vscode27.window.onDidChangeActiveTextEditor(checkEditor),
    vscode27.window.onDidChangeTextEditorSelection((e) => checkEditor(e.textEditor))
  ];
}
function registerDebugPauseService() {
  const disposables = [];
  const { revealPausedBreakpoint, clearPausedBreakpoint } = createRevealAndClearCallbacks();
  disposables.push(createDapTrackerFactory(revealPausedBreakpoint, clearPausedBreakpoint));
  disposables.push(...createEditorCheckListener(revealPausedBreakpoint));
  const debugExt = vscode27.debug;
  const stackItemListener = debugExt.onDidChangeActiveStackItem?.(async (item) => {
    if (isSourceNavigationLocked() || isCurrentPauseCapturedByDap) return;
    if (item && item.source?.path && typeof item.line === "number") {
      await revealPausedBreakpoint(item.source.path, item.line);
    }
  });
  if (stackItemListener) {
    disposables.push(stackItemListener);
  }
  disposables.push(
    vscode27.debug.onDidStartDebugSession(() => {
      appEventBus.emit("debug:started", void 0);
    }),
    vscode27.debug.onDidTerminateDebugSession(() => {
      setCapturablePauseContext(void 0);
      clearPausedBreakpoint();
    })
  );
  return vscode27.Disposable.from(...disposables);
}
function registerSessionLifecycleService() {
  return vscode27.debug.onDidTerminateDebugSession(async () => {
    appEventBus.emit("debug:terminated", void 0);
    sceneStateManager.clearLastAppliedTopologyHash();
    if (sceneStateManager.isPendingTopologyUpdate()) {
      sceneStateManager.setPendingTopologyUpdate(false);
      const workspaceRoot = getWorkspaceRoot2();
      if (workspaceRoot) {
        await handleExternalScenesFileChange(workspaceRoot);
      }
    }
  });
}

// src/infra/vscode/listeners/breakpointSyncListener.ts
var vscode28 = __toESM(require("vscode"));
function registerBreakpointSyncService() {
  return vscode28.debug.onDidChangeBreakpoints(async (event) => {
    if (dapEchoGuard.isApplyingBreakpoints() || sceneStateManager.isApplyingScene()) {
      return;
    }
    const currentCount = vscode28.debug.breakpoints.length;
    if (currentCount === 0) {
      sceneStateManager.setActiveScene(void 0, 0);
      return;
    }
    if (event.changed && event.changed.length > 0) {
      const activeScenes = sceneStateManager.getActiveScenes();
      if (activeScenes.length > 0) {
        const workspaceRoot = getWorkspaceRoot2();
        if (workspaceRoot) {
          const syncItems = event.changed.map((bp) => {
            if (bp.functionName) {
              return {
                functionName: bp.functionName,
                enabled: bp.enabled ?? true
              };
            }
            if (bp.location?.uri?.fsPath && typeof bp.location?.range?.start?.line === "number") {
              return {
                file: bp.location.uri.fsPath,
                line: bp.location.range.start.line + 1,
                enabled: bp.enabled ?? true
              };
            }
            return null;
          }).filter(Boolean);
          const hasUpdated = await breakpointManager.syncBreakpointChanges(
            workspaceRoot,
            syncItems,
            activeScenes
          );
          if (hasUpdated) {
            appEventBus.emit("breakpoints:changed", { workspaceRoot });
          }
        }
      }
    }
    sceneStateManager.checkDirtyWithCount(currentCount);
  });
}

// src/infra/vscode/listeners/chatSkillListener.ts
var vscode29 = __toESM(require("vscode"));
function registerChatSkillService(context) {
  if (typeof vscode29.chat?.registerSkillProvider === "function") {
    const skillProvider = {
      onDidChangeSkills: new vscode29.EventEmitter().event,
      provideSkills() {
        return [
          {
            uri: vscode29.Uri.joinPath(
              context.extensionUri,
              "skills",
              "scene-breakpoints",
              "SKILL.md"
            )
          }
        ];
      }
    };
    try {
      return vscode29.chat.registerSkillProvider(skillProvider);
    } catch {
    }
  }
  return { dispose: () => {
  } };
}

// src/ui/views/graphCanvas/graphCanvasController.ts
var vscode30 = __toESM(require("vscode"));
var path14 = __toESM(require("node:path"));

// src/ui/views/graphCanvas/graphWebviewDocument.ts
var DEFAULT_SHELL_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src {{cspSource}} 'unsafe-inline'; script-src {{cspSource}} 'nonce-{{nonce}}'; img-src {{cspSource}} data:;">
	<link rel="stylesheet" href="{{stylesUri}}">
</head>
<body>
	<div id="app"></div>
	<script type="application/json" id="sb-payload">{{payload}}</script>
	<script nonce="{{nonce}}" src="{{libUri}}"></script>
	<script nonce="{{nonce}}" src="{{runtimeUri}}"></script>
</body>
</html>`;
function serializePayload(payload) {
  return JSON.stringify(payload).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function buildGraphWebviewDocument(input) {
  const { cspSource, libUri, runtimeUri, stylesUri, nonce, labels, initialTab, templateHtml } = input;
  const payload = serializePayload({
    snapshot: input.snapshot,
    records: input.records,
    initialTab,
    labels: {
      ...labels
    }
  });
  const template = templateHtml || DEFAULT_SHELL_TEMPLATE;
  return template.replace(/\{\{cspSource\}\}/g, cspSource).replace(/\{\{nonce\}\}/g, nonce).replace(/\{\{stylesUri\}\}/g, stylesUri).replace(/\{\{libUri\}\}/g, libUri).replace(/\{\{runtimeUri\}\}/g, runtimeUri).replace(/\{\{payload\}\}/g, payload);
}

// src/ui/views/graphCanvas/graphMessageProtocol.ts
function isWebviewToHostMessage(msg) {
  if (!msg || typeof msg !== "object") return false;
  const type = msg.type;
  if (type === "set-scope") {
    const scenes = msg.scenes;
    return Array.isArray(scenes) && scenes.every((scene) => typeof scene === "string");
  }
  if (type === "activate-scene") {
    return typeof msg.sceneName === "string";
  }
  if (type === "focus-node") {
    return typeof msg.nodeId === "string";
  }
  return type === "open-source" || type === "switch-tab" || type === "export-mermaid" || type === "clear-trace" || type === "ready";
}
function isGraphViewTab(tab) {
  return tab === "flow" || tab === "trace";
}

// src/ui/views/graphCanvas/graphCanvasController.ts
var HIGHLIGHT_DURATION_MS = 800;
function createNonce() {
  let nonce = "";
  for (let i = 0; i < 16; i++) {
    nonce += Math.floor(Math.random() * 16).toString(16);
  }
  return nonce;
}
function resolveCanvasColumn(activeEditorColumn) {
  if (activeEditorColumn !== void 0) {
    return vscode30.ViewColumn.Beside;
  }
  return vscode30.ViewColumn.Active;
}
function resolveTargetSourceColumn(panelColumn) {
  if (panelColumn === vscode30.ViewColumn.One) {
    return vscode30.ViewColumn.Beside;
  }
  return vscode30.ViewColumn.One;
}
var GraphCanvasController = class {
  constructor(options) {
    this.options = options;
    this.highlightDecoration = vscode30.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode30.ThemeColor("editor.findMatchHighlightBackground")
    });
  }
  options;
  panel;
  snapshot;
  workspaceRoot = "";
  currentTab = "flow";
  /** Scope Selector 用户选择（纯视图状态，不入业务主状态；undefined = 跟随激活集，随面板销毁重置） */
  visibleScenes;
  busDisposables = [];
  panelDisposables = [];
  highlightDecoration;
  /** 打开或聚焦画布（幂等：已开面板 reveal 并全量重发） */
  show(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    if (this.panel) {
      this.panel.reveal();
      this.resendAll();
      return;
    }
    this.createPanel();
  }
  createPanel() {
    const targetColumn = resolveCanvasColumn(vscode30.window.activeTextEditor?.viewColumn);
    const panel = vscode30.window.createWebviewPanel(
      "sceneBreakpointsGraphCanvas",
      this.options.labels.panelTitle,
      targetColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode30.Uri.joinPath(this.options.extensionUri, "media", "graph")]
      }
    );
    this.panel = panel;
    const snapshot = this.refreshSnapshot();
    panel.webview.html = this.buildHtml(panel.webview, snapshot);
    this.lastPanelVisible = panel.visible;
    this.panelDisposables.push(
      panel.webview.onDidReceiveMessage((msg) => this.handleWebviewMessage(msg)),
      panel.onDidChangeViewState((e) => {
        const isNowVisible = e.webviewPanel.visible;
        if (!this.lastPanelVisible && isNowVisible) {
          this.resendAll();
        }
        this.lastPanelVisible = isNowVisible;
      }),
      panel.onDidDispose(() => this.handlePanelDisposed())
    );
    this.subscribeBus();
  }
  handlePanelDisposed() {
    for (const d of this.busDisposables) {
      d.dispose();
    }
    this.busDisposables.length = 0;
    this.panelDisposables.length = 0;
    this.panel = void 0;
    this.visibleScenes = void 0;
  }
  debugStatus = "terminated";
  lastPanelVisible = true;
  subscribeBus() {
    this.busDisposables.push(
      sceneStateManager.onDidChangeState(() => this.resendAll()),
      appEventBus.on("scenes:changed", () => this.resendAll()),
      appEventBus.on("scene:activated", () => this.resendAll()),
      appEventBus.on("breakpoints:changed", () => this.resendAll()),
      appEventBus.on("debug:started", () => {
        this.debugStatus = "running";
        this.post({ type: "trace-clear" });
        this.post({ type: "live-clear" });
        this.post({ type: "debug-status", status: "running" });
      }),
      appEventBus.on("debug:paused", ({ file, line }) => {
        this.debugStatus = "paused";
        this.handlePaused(file, line);
        this.post({ type: "debug-status", status: "paused" });
      }),
      appEventBus.on("debug:resumed", () => {
        this.debugStatus = "running";
        this.post({ type: "live-clear" });
        this.post({ type: "debug-status", status: "running" });
      }),
      appEventBus.on("debug:terminated", () => {
        this.debugStatus = "terminated";
        this.post({ type: "live-clear" });
        this.post({ type: "debug-status", status: "terminated" });
      })
    );
  }
  /** 重建快照并刷新轨迹 nodeId 解析器（id 语义单点权威）；返回新快照供调用方窄化 */
  refreshSnapshot() {
    const snapshot = this.options.loadSnapshot(this.workspaceRoot, this.visibleScenes);
    this.snapshot = snapshot;
    debugTraceBuffer.setNodeIdResolver(createNodeIdResolver(snapshot));
    return snapshot;
  }
  /** 全量重发：render + 当前 tab + 轨迹回放（面板打开/重显/场景变更统一入口） */
  resendAll() {
    if (!this.panel) return;
    const snapshot = this.refreshSnapshot();
    this.post({ type: "render", snapshot });
    this.post({ type: "view", tab: this.currentTab });
    this.post({ type: "trace-clear" });
    for (const record of debugTraceBuffer.getRecords()) {
      this.post({ type: "trace-append", record });
    }
    this.post({ type: "debug-status", status: this.debugStatus });
  }
  /** debug:paused 双消费：执行流脉冲 + 轨迹增量（轨迹记录由 debugTraceBuffer 先行累积） */
  handlePaused(file, line) {
    if (!this.panel) return;
    const nodeId = this.snapshot ? findNodeByLocation(this.snapshot, file, line)?.id ?? null : null;
    if (nodeId) {
      this.post({ type: "live-pulse", nodeId });
    }
    const records = debugTraceBuffer.getRecords();
    const latest = records[records.length - 1];
    if (latest) {
      this.post({ type: "trace-append", record: latest });
    }
  }
  handleWebviewMessage(msg) {
    if (!isWebviewToHostMessage(msg)) return;
    switch (msg.type) {
      case "ready":
        this.resendAll();
        break;
      case "switch-tab":
        if (isGraphViewTab(msg.tab)) {
          this.currentTab = msg.tab;
        }
        break;
      case "open-source":
        void this.revealSource(msg.nodeId, msg.file, msg.line);
        break;
      case "set-scope":
        this.visibleScenes = msg.scenes;
        this.resendAll();
        break;
      case "export-mermaid":
        void vscode30.commands.executeCommand("sceneBreakpoints.exportGraphMermaid");
        break;
      case "clear-trace":
        debugTraceBuffer.clear();
        this.post({ type: "trace-clear" });
        break;
      case "activate-scene":
        void vscode30.commands.executeCommand("sceneBreakpoints.applyScene", [msg.sceneName]);
        break;
    }
  }
  /** 当前 Scope 选择（供导出命令对齐画布所见即所得；undefined = 跟随激活集） */
  getVisibleScenes() {
    return this.visibleScenes;
  }
  /** 获取当前激活的 WebviewPanel（供宿主生命周期检测与 E2E 测试断言） */
  getPanel() {
    return this.panel;
  }
  /** 转发/处理 Webview 消息（供测试仿真上报与协议消费） */
  dispatchWebviewMessage(msg) {
    this.handleWebviewMessage(msg);
  }
  /** 点击节点直达源码：优先根据文件物理坐标定位，目标行视口居中 + 光标移入 + 整行高亮 */
  async revealSource(nodeId, file, line) {
    let targetFile = file;
    let targetLine = line;
    if ((!targetFile || !targetLine) && nodeId && this.snapshot) {
      const node = findNodeById(this.snapshot, nodeId);
      if (node && node.file && node.line && node.line > 0) {
        targetFile = node.file;
        targetLine = node.line;
      }
    }
    if (!targetFile || !targetLine || targetLine <= 0) return;
    if (isInternalOrVirtualFramePath(targetFile)) return;
    const absolute = path14.isAbsolute(targetFile) ? targetFile : path14.join(this.workspaceRoot, targetFile);
    setSourceNavigationLock(true, 400);
    try {
      const targetColumn = resolveTargetSourceColumn(this.panel?.viewColumn);
      const editor = await vscode30.window.showTextDocument(vscode30.Uri.file(absolute), {
        viewColumn: targetColumn,
        preserveFocus: true
      });
      const targetPos = new vscode30.Position(targetLine - 1, 0);
      const range = new vscode30.Range(targetPos, targetPos);
      editor.selection = new vscode30.Selection(targetPos, targetPos);
      editor.revealRange(range, vscode30.TextEditorRevealType.InCenterIfOutsideViewport);
      editor.setDecorations(this.highlightDecoration, [range]);
      const timer = setTimeout(() => {
        editor.setDecorations(this.highlightDecoration, []);
      }, HIGHLIGHT_DURATION_MS);
      timer.unref?.();
    } catch {
    }
  }
  buildHtml(webview, snapshot) {
    const base = vscode30.Uri.joinPath(this.options.extensionUri, "media", "graph");
    return buildGraphWebviewDocument({
      cspSource: webview.cspSource,
      libUri: webview.asWebviewUri(vscode30.Uri.joinPath(base, "g6-bundle.js")).toString(),
      runtimeUri: webview.asWebviewUri(vscode30.Uri.joinPath(base, "graphWebview.js")).toString(),
      stylesUri: webview.asWebviewUri(vscode30.Uri.joinPath(base, "graphWebview.css")).toString(),
      nonce: createNonce(),
      snapshot,
      records: debugTraceBuffer.getRecords(),
      initialTab: this.currentTab,
      labels: this.options.labels
    });
  }
  post(message) {
    if (!this.panel) return;
    void this.panel.webview.postMessage(message);
  }
  dispose() {
    this.handlePanelDisposed();
  }
};

// src/extension.ts
function setupCompositionRoot() {
  configureDependencies({
    sceneRepository: jsonFileSceneRepository,
    breakpointBridge: vscodeBreakpointBridge,
    lineReader: vscodeLineReader,
    // INV-031：命令路径外部编辑门控信号（磁盘内容 vs 最近内部写盘基线）
    isExternalPendingEdit: () => {
      const wsRoot = getWorkspaceRoot2();
      return wsRoot ? isDiskContentModifiedSinceLastSaved(wsRoot) : false;
    },
    // INV-031：指纹冲突裁决弹窗（用户关闭弹窗时缺省磁盘行号优先）
    resolveFingerprintConflict: promptFingerprintConflict
  });
}
function buildGraphCanvasLabels() {
  return {
    panelTitle: vscode31.l10n.t("Scene Graph"),
    tabFlow: vscode31.l10n.t("Flow"),
    tabTrace: vscode31.l10n.t("Hit Trace"),
    exportButton: vscode31.l10n.t("Export Mermaid"),
    flowEmpty: vscode31.l10n.t(
      "Canvas is empty. Select scenes in the scope bar above, or activate a scene."
    ),
    traceEmpty: vscode31.l10n.t("No hit records in this debug session yet."),
    scopeLabel: vscode31.l10n.t("Scene Scope"),
    sceneInactive: vscode31.l10n.t("Not Active"),
    laneCircular: vscode31.l10n.t("Circular scene reference"),
    localLayerBadge: vscode31.l10n.t("Local"),
    localLayerTitle: vscode31.l10n.t("Local private scene (.vscode/debug-scenes.local.json)"),
    zoomIn: vscode31.l10n.t("Zoom In"),
    zoomOut: vscode31.l10n.t("Zoom Out"),
    zoomFit: vscode31.l10n.t("Fit View"),
    zoomReset: vscode31.l10n.t("Reset Zoom (1:1)"),
    unmatchedBadge: vscode31.l10n.t("Code Drifter Unmatched"),
    conditionLabel: vscode31.l10n.t("Condition:"),
    hitConditionLabel: vscode31.l10n.t("Hit Count:"),
    logMessageLabel: vscode31.l10n.t("Log Message:"),
    bpTypeLabels: {
      line: { name: vscode31.l10n.t("Line"), title: vscode31.l10n.t("Line Breakpoint") },
      condition: { name: vscode31.l10n.t("Cond"), title: vscode31.l10n.t("Conditional Breakpoint") },
      logpoint: { name: vscode31.l10n.t("Log"), title: vscode31.l10n.t("Logpoint") },
      hitCount: { name: vscode31.l10n.t("Hit"), title: vscode31.l10n.t("Hit Count Breakpoint") },
      function: { name: vscode31.l10n.t("Func"), title: vscode31.l10n.t("Function Breakpoint") },
      ref: { name: vscode31.l10n.t("Scene"), title: vscode31.l10n.t("Scene Reference") }
    },
    sceneSelectTooltip: vscode31.l10n.t("Click to switch active debug scene"),
    scenePrefix: vscode31.l10n.t("Scene:"),
    selectScenePrompt: vscode31.l10n.t("Select Scene"),
    statusActive: vscode31.l10n.t("\u25CF Active"),
    statusPreview: vscode31.l10n.t("\u25CB Preview"),
    searchScenePlaceholder: vscode31.l10n.t("Search scene name..."),
    activeScenesGroup: vscode31.l10n.t("Active Scenes"),
    inactiveScenesGroup: vscode31.l10n.t("Pending / Preview Scenes"),
    switchToSceneTooltip: vscode31.l10n.t("Switch to scene: {0}"),
    noScenesFound: vscode31.l10n.t("No matching scenes found"),
    openInEditorTooltip: vscode31.l10n.t("Open in editor (or double-click card)"),
    refPrefix: vscode31.l10n.t("Ref: {0}"),
    refScenePrefix: vscode31.l10n.t("Referenced Scene: {0}"),
    conditionExprTooltip: vscode31.l10n.t("Condition Expression: {0}"),
    hitCountTooltip: vscode31.l10n.t("Hit Count Condition: {0}"),
    logMessageTooltip: vscode31.l10n.t("Log Message: {0}"),
    codeDriftWarning: vscode31.l10n.t("Code drift exceeds safety threshold"),
    notActiveTooltip: vscode31.l10n.t("Current scene is not active in debugger"),
    expand: vscode31.l10n.t("Expand"),
    collapse: vscode31.l10n.t("Collapse"),
    breakpointFallback: vscode31.l10n.t("Breakpoint"),
    activateScene: vscode31.l10n.t("Activate Scene"),
    activateSceneTooltip: vscode31.l10n.t("Activate [{0}] and register breakpoints immediately"),
    exportMermaidTooltip: vscode31.l10n.t("Export Mermaid Flowchart"),
    flowEmptyHint: vscode31.l10n.t("Multiple scenes can be checked in the menu above for cross-flow comparison"),
    pendingActiveScene: vscode31.l10n.t("Pending Active Scene"),
    traceFilterPlaceholder: vscode31.l10n.t("Filter description, file path, or step..."),
    clearSearch: vscode31.l10n.t("Clear Search"),
    traceTotalSteps: vscode31.l10n.t("Total {0} steps"),
    traceTotalStepsTooltip: vscode31.l10n.t("{0} execution hits recorded"),
    traceLoopCollapsed: vscode31.l10n.t("Collapsed {0} loop groups"),
    traceLoopCollapsedTooltip: vscode31.l10n.t("Automatically collapsed {0} hits into {1} loops"),
    statusDebugPaused: vscode31.l10n.t("Debugger Paused"),
    statusSessionTerminated: vscode31.l10n.t("Session Terminated"),
    statusRunning: vscode31.l10n.t("Running"),
    clearTraceTooltip: vscode31.l10n.t("Clear Current Hit Trace"),
    traceLoopUnit: vscode31.l10n.t("Loop {0} times ({1} steps)"),
    tracePausedInLoop: vscode31.l10n.t("Currently paused inside loop"),
    scrollToLatest: vscode31.l10n.t("Jump to latest step \u2193"),
    jumpToSourceTooltip: vscode31.l10n.t("Click to jump and locate source line"),
    pausedHere: vscode31.l10n.t("Paused here"),
    exitPoint: vscode31.l10n.t("Exit point"),
    locateSource: vscode31.l10n.t("Locate Source"),
    expandMinimap: vscode31.l10n.t("Expand Minimap"),
    collapseMinimap: vscode31.l10n.t("Collapse Minimap"),
    minimap: vscode31.l10n.t("Minimap"),
    minimapNav: vscode31.l10n.t("Minimap Navigation")
  };
}
function setupGraphCanvas(context) {
  debugTraceBuffer.init();
  const loadGraphSnapshot = (workspaceRoot, visibleScenes) => {
    const { catalog, originByScene } = sceneManager.loadMergedCatalog(workspaceRoot);
    return buildGraphSnapshot({
      workspaceRoot,
      catalog,
      activeScenes: sceneStateManager.getActiveScenes(),
      visibleScenes,
      originByScene,
      isUnmatched: (file, line) => sceneStateManager.isBreakpointUnmatched(file, line)
    });
  };
  const graphCanvasController = new GraphCanvasController({
    extensionUri: context.extensionUri,
    labels: buildGraphCanvasLabels(),
    loadSnapshot: loadGraphSnapshot
  });
  setGraphCommandDeps({ controller: graphCanvasController, loadSnapshot: loadGraphSnapshot });
  return graphCanvasController;
}
function activate(context) {
  setupCompositionRoot();
  const wsRootSeed = getWorkspaceRoot2();
  if (wsRootSeed) {
    seedEchoLoopBaselineFromDisk(wsRootSeed);
    ensureLocalScenesGitignore(wsRootSeed);
  }
  initStatusBarItem(context);
  const inlayHintsProvider = new SceneInlayHintsProvider();
  const treeDataProvider = new SceneTreeDataProvider(context.extensionPath);
  const treeView = vscode31.window.createTreeView("sceneBreakpointsView", {
    treeDataProvider,
    showCollapseAll: true,
    dragAndDropController: treeDataProvider
  });
  registerAllCommands(context, { treeDataProvider, treeView });
  const graphCanvasController = setupGraphCanvas(context);
  context.subscriptions.push(
    // 启动项三级匹配与调试配置联动服务
    registerDebugLaunchService(),
    // 编辑器断点全双工反向同步与脏状态检测服务
    registerBreakpointSyncService(),
    // 树视图展开折叠记忆与复选框就地更新服务
    treeDataProvider.bindView(treeView),
    // 外部 debug-scenes.json 文件变更监听与防抖守卫服务
    registerConfigFileWatcherService(),
    // 调试运行时命中断点高亮、调用栈追踪与自动展开跟随服务
    registerDebugPauseService(),
    // 调试会话终止生命周期与拓扑补发服务
    registerSessionLifecycleService(),
    // AI Agent Chat Skill 动态注入服务
    registerChatSkillService(context),
    // 场景一键激活 CodeLens 透镜按钮（v1.2.0：覆盖 team 主文件与 local 私有文件）
    vscode31.languages.registerCodeLensProvider(
      [{ pattern: "**/debug-scenes.json" }, { pattern: "**/debug-scenes.local.json" }],
      new SceneCodeLensProvider()
    ),
    // 行末场景断点注解与幽灵文本透视提供者 (Inlay Hints)
    vscode31.languages.registerInlayHintsProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      inlayHintsProvider
    ),
    inlayHintsProvider,
    // Skill 官方模版虚拟文档比对提供者
    vscode31.workspace.registerTextDocumentContentProvider(
      TemplateContentProvider.scheme,
      templateContentProvider
    ),
    treeView,
    // 场景断点画布控制器：总线订阅与面板生命周期成对释放
    graphCanvasController,
    // 调试命中轨迹缓存订阅（随扩展卸载退订）
    { dispose: () => debugTraceBuffer.dispose() },
    { dispose: () => sceneStateManager.dispose() }
  );
  const wsRoot = getWorkspaceRoot2();
  if (wsRoot) {
    checkAndPromptSkillUpdates(context, wsRoot).catch(() => {
    });
  }
  return {
    treeDataProvider,
    treeView,
    getStatusBarItem,
    checkAndPromptSkillUpdates,
    sceneStateManager,
    inlayHintsProvider,
    graphCanvasController
  };
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
