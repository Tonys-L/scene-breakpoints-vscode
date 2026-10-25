import type { WatchEvaluationResult } from "#src/domain/types";
import { isFilePathMatch } from "#src/shared/utils/pathUtils";
import { appEventBus, type IDisposable } from "./eventBus";

/**
 * 调试命中轨迹缓存 (Debug Trace Buffer, v1.3.0)
 * 职责：会话级累积 debug:paused 命中记录，供画布命中轨迹时间线呈现。
 * 生命周期（会话级易失，不落盘不入 debug-scenes.json）：
 * - debug:paused → 追加 TraceRecord（seq 单调递增，nodeId 经注入解析器匹配）
 * - debug:watch-evaluated → 富化对应断点步的变量监视快照 (watches)
 * - debug:resumed → 保留（轨迹跨多次暂停累积，故不订阅该事件）
 * - debug:terminated → 全量清空
 * 对齐 debugPauseContext 先例：应用层小状态实体，事件驱动写入/清除，UI 只读消费。
 */

export interface TraceRecord {
	/** 命中序号（会话内单调递增，从 1 开始） */
	readonly seq: number;
	/** 对应执行流节点 id（经快照位置匹配；未匹配记 null） */
	readonly nodeId: string | null;
	readonly file: string;
	readonly line: number;
	/** 相对会话首次命中的毫秒时间戳（首次命中为 0） */
	readonly ts: number;
	/** 绝对壁钟时间戳（Date.now() 毫秒），便于与控制台及服务端日志对齐 */
	readonly wallTime?: number;
	/** 变量追踪求值结果快照 (v1.5.0) */
	readonly watches?: readonly WatchEvaluationResult[];
}

/** nodeId 解析器：由画布快照派生（sceneGraphProjection.createNodeIdResolver），保证 id 语义单点权威 */
export type NodeIdResolver = (file: string, line: number) => string | null;

export class DebugTraceBuffer {
	private records: TraceRecord[] = [];
	private nextSeq = 1;
	private startTs: number | null = null;
	private nodeIdResolver: NodeIdResolver | null;
	private readonly disposables: IDisposable[] = [];
	private needsSessionReset = false;

	constructor(nodeIdResolver: NodeIdResolver | null = null) {
		this.nodeIdResolver = nodeIdResolver;
	}

	/** 注入/更新 nodeId 解析器（画布快照重建时由控制器刷新） */
	public setNodeIdResolver(resolver: NodeIdResolver | null): void {
		this.nodeIdResolver = resolver;
	}

	/** 订阅调试事件（扩展装配时调用，与 dispose 成对；幂等守卫） */
	public init(): void {
		if (this.disposables.length > 0) return;
		this.disposables.push(
			appEventBus.on("debug:started", () => {
				// 新会话启动，立即彻底清空上一轮轨迹
				this.clear();
				this.needsSessionReset = false;
			}),
			appEventBus.on("debug:paused", ({ file, line }) => {
				this.append(file, line);
			}),
			appEventBus.on("debug:watch-evaluated", ({ file, line, results }) => {
				this.updateLatestWatches(file, line, results);
			}),
			appEventBus.on("debug:terminated", () => {
				// 会话终止保留轨迹供复盘；标记新会话就绪，下次命中时自动重置
				this.needsSessionReset = true;
			}),
		);
	}

	/** 更新最近一条命中记录的变量求值快照 */
	public updateLatestWatches(file: string, line: number, watches: WatchEvaluationResult[]): void {
		for (let i = this.records.length - 1; i >= 0; i--) {
			const r = this.records[i];
			if (r.line === line && isFilePathMatch(r.file, file)) {
				this.records[i] = {
					...r,
					watches: [...watches],
				};
				break;
			}
		}
	}

	/** 追加一条命中记录（seq 递增；ts 相对会话首次命中） */
	public append(file: string, line: number): TraceRecord {
		if (this.needsSessionReset) {
			this.clear();
			this.needsSessionReset = false;
		}
		const now = Date.now();
		const last = this.records[this.records.length - 1];
		if (
			last &&
			last.file === file &&
			last.line === line &&
			now - (last.wallTime ?? (this.startTs! + last.ts)) < 500
		) {
			return last;
		}
		if (this.startTs === null) {
			this.startTs = now;
		}
		const record: TraceRecord = {
			seq: this.nextSeq++,
			nodeId: this.nodeIdResolver?.(file, line) ?? null,
			file,
			line,
			ts: now - this.startTs,
			wallTime: now,
		};
		this.records.push(record);
		return record;
	}

	/** 只读副本（外部变异不影响内部状态） */
	public getRecords(): TraceRecord[] {
		return this.records.map((record) => ({ ...record }));
	}

	public getSize(): number {
		return this.records.length;
	}

	/** 全量清空（会话终止时触发；resumed 不清空） */
	public clear(): void {
		this.records = [];
		this.nextSeq = 1;
		this.startTs = null;
	}

	/** 退订事件并清空状态（扩展卸载时调用） */
	public dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables.length = 0;
		this.clear();
	}
}

export const debugTraceBuffer = new DebugTraceBuffer();
