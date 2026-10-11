import type { TraceRecord } from "#src/application/debugTraceBuffer";

/**
 * 命中轨迹时间线条目形态
 */
export interface TimelineSingleStep {
	readonly kind: "single";
	readonly record: TraceRecord;
	readonly isLatest: boolean;
}

export interface TimelineLoopChunk {
	readonly kind: "loop";
	/** 循环唯一标识（基于模式与首记录序号） */
	readonly id: string;
	/** 循环模式键值列表 */
	readonly patternKeys: readonly string[];
	/** 循环迭代次数（>= 2） */
	readonly iterations: number;
	/** 本循环所包含的全部底层命中记录（扁平数组） */
	readonly records: readonly TraceRecord[];
	/** 是否包含当前整个会话中最新的一条命中记录 */
	readonly containsLatest: boolean;
}

export type TimelineItem = TimelineSingleStep | TimelineLoopChunk;

/**
 * 提取轨迹记录的唯一位置键
 */
export function recordLocationKey(record: TraceRecord): string {
	return record.nodeId || `${record.file}:${record.line}`;
}

const DEFAULT_MAX_PATTERN_LEN = 5;

/**
 * 循环节序列智能折叠算法 (Loop Chunk Collapse)
 * 纯函数：将连续平铺的 TraceRecord 列表折叠压缩为包含循环块的时间线条目
 * - 支持单断点连续重复 (A, A, A...)
 * - 支持循环体内多断点交替交叠 (A, B, A, B... 或 A, B, C, A, B, C...)
 * - 贪心匹配最大覆盖区间的最小正周期
 */
export function collapseTraceRecords(
	records: readonly TraceRecord[],
	maxPatternLen = DEFAULT_MAX_PATTERN_LEN,
): TimelineItem[] {
	if (records.length === 0) {
		return [];
	}

	const result: TimelineItem[] = [];
	const total = records.length;
	const keys = records.map(recordLocationKey);
	const latestRecord = records[total - 1];

	let i = 0;
	while (i < total) {
		let bestPatternLen = 0;
		let bestIterations = 0;
		let bestCoverage = 0;

		const remaining = total - i;
		const maxL = Math.min(maxPatternLen, Math.floor(remaining / 2));

		for (let L = 1; L <= maxL; L++) {
			let iterations = 1;
			while (i + (iterations + 1) * L <= total) {
				let match = true;
				for (let offset = 0; offset < L; offset++) {
					if (keys[i + offset] !== keys[i + iterations * L + offset]) {
						match = false;
						break;
					}
				}
				if (!match) {
					break;
				}
				iterations++;
			}

			if (iterations >= 2) {
				const coverage = L * iterations;
				// 优先选择覆盖更多记录的模式；同等覆盖下优先选择最小正周期
				if (coverage > bestCoverage) {
					bestCoverage = coverage;
					bestPatternLen = L;
					bestIterations = iterations;
				}
			}
		}

		if (bestCoverage > 0 && bestIterations >= 2) {
			const chunkRecords = records.slice(i, i + bestCoverage);
			const patternKeys = keys.slice(i, i + bestPatternLen);
			const containsLatest = chunkRecords.some((r) => r.seq === latestRecord.seq);

			result.push({
				kind: "loop",
				id: `loop-${chunkRecords[0].seq}-${patternKeys.join("-")}`,
				patternKeys,
				iterations: bestIterations,
				records: chunkRecords,
				containsLatest,
			});
			i += bestCoverage;
		} else {
			const rec = records[i];
			result.push({
				kind: "single",
				record: rec,
				isLatest: rec.seq === latestRecord.seq,
			});
			i++;
		}
	}

	return result;
}
