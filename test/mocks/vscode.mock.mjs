import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 测试专用 vscode API Mock
 *
 * 由 test/register.mjs 的 resolve 钩子将裸导入 "vscode" 重定向到本模块，
 * 使 Node.js 单元测试可以真实导入 src/ 下依赖 vscode 的模块（如 jsonFileSceneRepository、
 * vscodeBreakpointBridge、statusBarView），且业务逻辑全部走真实源码。
 *
 * 原则：仅覆盖单元测试实际触达的 API 表面；未触达的 API 提供可安全调用的空实现。
 */

export class Disposable {
	constructor(dispose) {
		this._dispose = dispose;
	}
	dispose() {
		if (typeof this._dispose === "function") {
			this._dispose();
			this._dispose = undefined;
		}
	}
	static from(...disposables) {
		return new Disposable(() => {
			for (const d of disposables) {
				if (d && typeof d.dispose === "function") {
					d.dispose();
				}
			}
		});
	}
}

export class EventEmitter {
	constructor() {
		this._listeners = new Set();
	}
	get event() {
		return (listener) => {
			this._listeners.add(listener);
			return new Disposable(() => this._listeners.delete(listener));
		};
	}
	fire(data) {
		for (const listener of this._listeners) {
			listener(data);
		}
	}
	dispose() {
		this._listeners.clear();
	}
}

// ---------- 基础几何类型 ----------

export class Position {
	constructor(line, character) {
		this.line = line;
		this.character = character;
	}
}

export class Range {
	constructor(start, end) {
		this.start = start;
		this.end = end;
	}
}

export class Selection {
	constructor(anchor, active) {
		this.anchor = anchor;
		this.active = active;
	}
	get start() {
		return this.anchor.line <= this.active.line ? this.anchor : this.active;
	}
	get end() {
		return this.anchor.line <= this.active.line ? this.active : this.anchor;
	}
}

export const TextEditorRevealType = {
	First: 1,
	InCenter: 2,
	InCenterIfOutsideViewport: 3,
	Last: 4,
};

export class Uri {
	constructor(fsPath, pathStr) {
		this.fsPath = fsPath;
		this.path = pathStr || fsPath;
	}
	static file(p) {
		return new Uri(p, p);
	}
	static parse(val) {
		try {
			const u = new URL(val);
			return new Uri(u.pathname, u.pathname);
		} catch {
			const cleaned = String(val).replace(/^[^:]+:\/?/, "/");
			return new Uri(cleaned, cleaned);
		}
	}
	static joinPath(base, ...segments) {
		const combined = `${base.fsPath}/${segments.join("/")}`;
		return new Uri(combined, combined);
	}
	toString() {
		return `file://${this.fsPath}`;
	}
}

export class Location {
	constructor(uri, rangeOrPosition) {
		this.uri = uri;
		this.range = rangeOrPosition instanceof Range ? rangeOrPosition : new Range(rangeOrPosition, rangeOrPosition);
	}
}

// ---------- 断点类型（保证 instanceof 语义一致） ----------

export class Breakpoint {
	constructor(enabled = true) {
		this.enabled = enabled;
	}
}

export class SourceBreakpoint extends Breakpoint {
	constructor(location, enabled, condition, hitCondition, logMessage) {
		super(enabled);
		this.location = location;
		this.condition = condition;
		this.hitCondition = hitCondition;
		this.logMessage = logMessage;
	}
}

export class FunctionBreakpoint extends Breakpoint {
	constructor(functionName, enabled, condition, hitCondition) {
		super(enabled);
		this.functionName = functionName;
		this.condition = condition;
		this.hitCondition = hitCondition;
	}
}

// ---------- 调试运行时 ----------

const debugBreakpoints = [];
const _breakpointsEmitter = new EventEmitter();
const _sessionTerminateEmitter = new EventEmitter();
const _sessionStartEmitter = new EventEmitter();

export const debug = {
	/** 当前宿主调试器中的断点快照（Mock 内存态） */
	breakpoints: debugBreakpoints,
	addBreakpoints: async (breakpoints) => {
		debugBreakpoints.push(...breakpoints);
	},
	removeBreakpoints: async (breakpoints) => {
		const toRemove = new Set(breakpoints);
		for (let i = debugBreakpoints.length - 1; i >= 0; i--) {
			if (toRemove.has(debugBreakpoints[i])) {
				debugBreakpoints.splice(i, 1);
			}
		}
	},
	activeDebugSession: undefined,
	onDidChangeBreakpoints: _breakpointsEmitter.event,
	fireDidChangeBreakpoints: (e) => _breakpointsEmitter.fire(e),
	onDidStartDebugSession: _sessionStartEmitter.event,
	fireDidStartDebugSession: (e) => _sessionStartEmitter.fire(e),
	onDidTerminateDebugSession: _sessionTerminateEmitter.event,
	fireDidTerminateDebugSession: (e) => _sessionTerminateEmitter.fire(e),
	_trackerFactories: [],
	_configProviders: [],
	registerDebugConfigurationProvider: (_type, provider) => {
		debug._configProviders.push(provider);
		return new Disposable(() => {
			const idx = debug._configProviders.indexOf(provider);
			if (idx >= 0) debug._configProviders.splice(idx, 1);
		});
	},
	registerDebugAdapterTrackerFactory: (_type, factory) => {
		debug._trackerFactories.push(factory);
		return new Disposable(() => {
			const idx = debug._trackerFactories.indexOf(factory);
			if (idx >= 0) debug._trackerFactories.splice(idx, 1);
		});
	},
};

// ---------- 窗口与消息 ----------

export const DecorationRangeBehavior = {
	OpenOpen: 1,
	ClosedClosed: 2,
	OpenClosed: 3,
	ClosedOpen: 4,
};

export const window = {
	/** 记录所有 show* 消息，供测试断言错误提示路径 */
	messages: [],
	/** 当前可见文本编辑器列表（测试可注入模拟编辑器） */
	visibleTextEditors: [],
	/** 装饰类型构造桩：返回可 dispose 的空装饰类型 */
	createTextEditorDecorationType: (_options) => ({ dispose() {} }),
	showErrorMessage: (message) => {
		window.messages.push({ level: "error", message });
		return Promise.resolve(undefined);
	},
	showWarningMessage: (message) => {
		window.messages.push({ level: "warning", message });
		return Promise.resolve(undefined);
	},
	showInformationMessage: (message) => {
		window.messages.push({ level: "info", message });
		return Promise.resolve(undefined);
	},
	setStatusBarMessage: (message) => {
		window.messages.push({ level: "status", message });
	},
	createStatusBarItem: (alignment, priority) => ({
		text: "",
		color: undefined,
		tooltip: undefined,
		command: undefined,
		alignment,
		priority,
		show() {},
		hide() {},
		dispose() {},
	}),
	showQuickPick: async () => undefined,
	showInputBox: async () => undefined,
	createQuickPick: () => {
		let _items = [];
		let _activeItems = [];
		let _selectedItems = [];
		const _acceptListeners = [];
		const _hideListeners = [];
		const qp = {
			get items() { return _items; },
			set items(val) { _items = val; },
			get activeItems() { return _activeItems; },
			set activeItems(val) { _activeItems = val; },
			get selectedItems() { return _selectedItems; },
			set selectedItems(val) { _selectedItems = val; },
			placeholder: "",
			matchOnDescription: false,
			matchOnDetail: false,
			show() {},
			hide() {
				for (const cb of _hideListeners) cb();
			},
			dispose() {},
			onDidAccept: (cb) => {
				_acceptListeners.push(cb);
				return new Disposable(() => {});
			},
			onDidHide: (cb) => {
				_hideListeners.push(cb);
				return new Disposable(() => {});
			},
			_triggerAccept: async (item) => {
				qp.selectedItems = item ? [item] : [];
				for (const cb of _acceptListeners) {
					await cb();
				}
			},
		};
		window._lastQuickPick = qp;
		return qp;
	},
	showTextDocument: async () => ({}),
	withProgress: async (_options, task) => task({ report() {} }),
	createOutputChannel: () => ({
		appendLine() {},
		append() {},
		show() {},
		dispose() {},
	}),
	activeTextEditor: undefined,
	onDidChangeActiveTextEditor: () => new Disposable(() => {}),
	onDidChangeTextEditorSelection: () => new Disposable(() => {}),
};

// ---------- 工作区 ----------

export const workspace = {
	workspaceFolders: [],
	findFiles: async () => [],
	textDocuments: [],
	openTextDocument: async (uriOrPath) => {
		const filePath = typeof uriOrPath === "string" ? uriOrPath : uriOrPath.fsPath || String(uriOrPath);
		let content = "";
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			content = "";
		}
		const lines = content.split(/\r?\n/);
		return {
			uri: Uri.file(filePath),
			fileName: filePath,
			lineCount: lines.length,
			lineAt: (i) => ({ text: lines[i] ?? "" }),
			getText: () => content,
		};
	},
	onDidChangeTextDocument: () => new Disposable(() => {}),
	onDidSaveTextDocument: () => new Disposable(() => {}),
	onDidChangeWorkspaceFolders: () => new Disposable(() => {}),
	getConfiguration: () => ({
		get: (_key, defaultValue) => defaultValue,
		update: async () => {},
	}),
	getWorkspaceFolder: () => workspace.workspaceFolders[0],
	applyEdit: async () => true,
	asRelativePath: (p) => String(p),
	_lastWatcher: undefined,
	createFileSystemWatcher: () => {
		const watcher = {
			_changeCbs: [],
			_createCbs: [],
			_deleteCbs: [],
			onDidChange: (cb) => {
				watcher._changeCbs.push(cb);
				return new Disposable(() => {});
			},
			onDidCreate: (cb) => {
				watcher._createCbs.push(cb);
				return new Disposable(() => {});
			},
			onDidDelete: (cb) => {
				watcher._deleteCbs.push(cb);
				return new Disposable(() => {});
			},
			dispose() {},
		};
		workspace._lastWatcher = watcher;
		return watcher;
	},
	fs: {
		readFile: async (uri) => {
			const filePath = uri.fsPath || String(uri);
			return fs.readFileSync(filePath);
		},
		writeFile: async (uri, content) => {
			const filePath = uri.fsPath || String(uri);
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, content);
		},
		createDirectory: async (uri) => {
			const dirPath = uri.fsPath || String(uri);
			fs.mkdirSync(dirPath, { recursive: true });
		},
	},
};

// ---------- 命令与杂项 ----------

const _registeredCommands = new Map();

export const commands = {
	registerCommand: (commandId, handler) => {
		const disposable = new Disposable(() => {
			_registeredCommands.delete(commandId);
		});
		_registeredCommands.set(commandId, { handler, disposable });
		return disposable;
	},
	registerTextEditorCommand: (commandId, handler) => {
		return commands.registerCommand(commandId, handler);
	},
	executeCommand: async (commandId, ...args) => {
		const entry = _registeredCommands.get(commandId);
		if (entry) {
			return await entry.handler(...args);
		}
		return undefined;
	},
	getCommands: async () => Array.from(_registeredCommands.keys()),
	_registered: _registeredCommands,
};

export const l10n = {
	t: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? "")),
};

export const StatusBarAlignment = { Left: 1, Right: 2 };
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const TreeItemCheckboxState = { Unchecked: 0, Checked: 1 };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
export const QuickPickItemKind = { Separator: -1, Default: 0 };

export class DataTransferItem {
	constructor(value) {
		this.value = value;
	}
}

export class TreeItem {
	constructor(label, collapsibleState) {
		this.label = label;
		this.collapsibleState = collapsibleState;
	}
}

export class ThemeIcon {
	constructor(id) {
		this.id = id;
	}
	static get File() {
		return new ThemeIcon("file");
	}
	static get Folder() {
		return new ThemeIcon("folder");
	}
}

export class ThemeColor {
	constructor(id) {
		this.id = id;
	}
}

export class MarkdownString {
	constructor(value = "") {
		this.value = value;
	}
	appendMarkdown(value) {
		this.value += value;
		return this;
	}
}

export class CodeLens {
	constructor(range, command) {
		this.range = range;
		this.command = command;
	}
}

export const InlayHintKind = { Type: 1, Parameter: 2 };

export class InlayHint {
	constructor(position, label, kind) {
		this.position = position;
		this.label = label;
		this.kind = kind;
		this.paddingLeft = false;
		this.paddingRight = false;
		this.tooltip = undefined;
	}
}

export const languages = {
	registerCodeLensProvider: () => new Disposable(() => {}),
	registerInlayHintsProvider: () => new Disposable(() => {}),
};

export class CancellationTokenSource {
	constructor() {
		this._cancelled = false;
	}
	get token() {
		return { isCancellationRequested: this._cancelled, onCancellationRequested: () => new Disposable(() => {}) };
	}
	cancel() {
		this._cancelled = true;
	}
	dispose() {}
}

let _clipboardText = "";

export const env = {
	language: "en",
	appName: "vscode-mock",
	clipboard: {
		writeText: async (text) => {
			_clipboardText = String(text);
		},
		readText: async () => _clipboardText,
	},
};

export const extensions = {
	getExtension: () => undefined,
	all: [],
};

export const chat = {
	registerSkillProvider: undefined,
};

// ---------- 测试辅助 ----------

/** 重置 Mock 可变状态（断点列表、消息记录、调试会话），每个测试块前调用 */
export function __resetMockVscodeState() {
	chat.registerSkillProvider = undefined;
	debugBreakpoints.length = 0;
	window.messages.length = 0;
	window.showErrorMessage = (message) => {
		window.messages.push({ level: "error", message });
		return Promise.resolve(undefined);
	};
	window.showWarningMessage = (message) => {
		window.messages.push({ level: "warning", message });
		return Promise.resolve(undefined);
	};
	window.showInformationMessage = (message) => {
		window.messages.push({ level: "info", message });
		return Promise.resolve(undefined);
	};
	window.showQuickPick = async () => undefined;
	window.showInputBox = async () => undefined;
	window.activeTextEditor = undefined;
	window.visibleTextEditors.length = 0;
	debug.activeDebugSession = undefined;
	debug._trackerFactories.length = 0;
	debug._configProviders.length = 0;
	workspace.workspaceFolders.length = 0;
	workspace._lastWatcher = undefined;
	_clipboardText = "";
	_registeredCommands.clear();
}
