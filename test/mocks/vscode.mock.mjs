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
	registerDebugConfigurationProvider: (_type, _provider) => new Disposable(() => {}),
	registerDebugAdapterTrackerFactory: (_type, factory) => {
		debug._trackerFactories.push(factory);
		return new Disposable(() => {
			const idx = debug._trackerFactories.indexOf(factory);
			if (idx >= 0) debug._trackerFactories.splice(idx, 1);
		});
	},
};

// ---------- 窗口与消息 ----------

export const window = {
	/** 记录所有 show* 消息，供测试断言错误提示路径 */
	messages: [],
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
	openTextDocument: async () => {
		throw new Error("vscode.mock: openTextDocument 未在单元测试中实现");
	},
	onDidChangeTextDocument: () => new Disposable(() => {}),
	onDidSaveTextDocument: () => new Disposable(() => {}),
	onDidChangeWorkspaceFolders: () => new Disposable(() => {}),
	getConfiguration: () => ({
		get: (_key, defaultValue) => defaultValue,
		update: async () => {},
	}),
	applyEdit: async () => true,
	asRelativePath: (p) => String(p),
	createFileSystemWatcher: () => ({
		onDidChange: () => new Disposable(() => {}),
		onDidCreate: () => new Disposable(() => {}),
		onDidDelete: () => new Disposable(() => {}),
		dispose() {},
	}),
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

export const env = {
	language: "en",
	appName: "vscode-mock",
	clipboard: {
		writeText: async () => {},
		readText: async () => "",
	},
};

export const extensions = {
	getExtension: () => undefined,
	all: [],
};

// ---------- 测试辅助 ----------

/** 重置 Mock 可变状态（断点列表、消息记录、调试会话），每个测试块前调用 */
export function __resetMockVscodeState() {
	debugBreakpoints.length = 0;
	window.messages.length = 0;
	debug.activeDebugSession = undefined;
	debug._trackerFactories.length = 0;
	workspace.workspaceFolders.length = 0;
	_registeredCommands.clear();
}
