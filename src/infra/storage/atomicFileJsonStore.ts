import fs from "node:fs";
import path from "node:path";
import type { ISelfHealingStore, StorageIntegrityReport, StoreRecoveryOptions } from "./selfHealingStore.js";

const CONFLICT_REGEX = /^(<{7}|={7}|>{7})\s+/m;

function logWarning(msg: string, err: unknown): void {
	const detail = err instanceof Error ? err.message : String(err);
	console.warn(`[AtomicFileJsonStore] ${msg}: ${detail}`);
}

/**
 * 基于原子替换与临时文件自愈策略的 JSON 文件存储实现
 */
export class AtomicFileJsonStore<T> implements ISelfHealingStore<T, string> {
	/**
	 * 安全原子写盘：唯一临时文件名 + renameSync 原子替换 + 异常自清理
	 */
	public save(filePath: string, data: T): void {
		const targetDir = path.dirname(filePath);
		if (!fs.existsSync(targetDir)) {
			fs.mkdirSync(targetDir, { recursive: true });
		}

		const tmpName = `${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
		const tmpPath = path.join(targetDir, tmpName);

		try {
			const serialized = JSON.stringify(data, null, 2);
			fs.writeFileSync(tmpPath, serialized, "utf-8");
			fs.renameSync(tmpPath, filePath);
		} finally {
			if (fs.existsSync(tmpPath)) {
				try {
					fs.unlinkSync(tmpPath);
				} catch (err: any) {
					logWarning("Failed to cleanup tmp file", err);
				}
			}
		}
	}

	/**
	 * 冷启动安全加载：内嵌主文件完整性探测、灾难备份抢救自愈与孤儿文件净化
	 */
	public load(filePath: string, options: StoreRecoveryOptions<T>): StorageIntegrityReport<T> {
		const targetDir = path.dirname(filePath);
		const baseName = path.basename(filePath);

		// 1. 净化同目录下过期的孤儿临时碎片 (清理 5 秒前的旧残留)
		this.pruneOrphanTmpFiles(targetDir, baseName);

		// 2. 主文件健康度探测
		const probeResult = this.probeMainFile(filePath, options);
		if (probeResult) {
			return probeResult;
		}

		// 3. 灾难仲裁自愈：主文件损坏/冲突/0字节，尝试从遗留的 *.tmp 副本中抢救
		const healedResult = this.attemptRecoveryFromTmp(targetDir, baseName, filePath, options);
		if (healedResult) {
			return healedResult;
		}

		// 4. 彻底损坏且无药可救，安全回退默认数据
		return {
			status: "fallback",
			data: options.fallback(),
			recoveryMessage: "Main file corrupted and no recoverable backup candidate found. Returned fallback.",
		};
	}

	private probeMainFile(filePath: string, options: StoreRecoveryOptions<T>): StorageIntegrityReport<T> | null {
		if (!fs.existsSync(filePath)) {
			return { status: "empty", data: options.fallback() };
		}

		try {
			const content = fs.readFileSync(filePath, "utf-8");
			if (!content || !content.trim()) {
				return null; // 0 字节文件触发自愈
			}
			if (CONFLICT_REGEX.test(content)) {
				return null; // 检测到 Git 冲突标记，触发自愈或防灾
			}

			const parser = options.parse || JSON.parse;
			const parsed = parser(content);
			if (options.validate && !options.validate(parsed)) {
				return null; // 校验器未通过，触发自愈
			}

			return { status: "healthy", data: parsed as T };
		} catch (err: any) {
			logWarning("Main file integrity probe failed", err);
			return null;
		}
	}

	private attemptRecoveryFromTmp(
		dir: string,
		baseName: string,
		targetFilePath: string,
		options: StoreRecoveryOptions<T>,
	): StorageIntegrityReport<T> | null {
		if (!fs.existsSync(dir)) {
			return null;
		}

		try {
			const prefix = `${baseName}.tmp.`;
			const candidates = fs.readdirSync(dir)
				.filter((f) => f.startsWith(prefix))
				.map((f) => path.join(dir, f))
				.map((p) => {
					try {
						return { path: p, mtime: fs.statSync(p).mtimeMs };
					} catch {
						return { path: p, mtime: 0 };
					}
				})
				.sort((a, b) => b.mtime - a.mtime);

			for (const cand of candidates) {
				const recovered = this.tryParseCandidate(cand.path, options);
				if (recovered !== null) {
					// 原子将抢救出的候选副本覆盖修复为主配置文件
					fs.copyFileSync(cand.path, targetFilePath);
					const msg = `Disaster recovery successful: restored configuration from [${path.basename(cand.path)}]`;
					options.onHealed?.(msg);
					return { status: "healed", data: recovered, recoveryMessage: msg };
				}
			}
		} catch (err: any) {
			logWarning("Error during candidate recovery", err);
		}
		return null;
	}

	private tryParseCandidate(candPath: string, options: StoreRecoveryOptions<T>): T | null {
		try {
			const raw = fs.readFileSync(candPath, "utf-8");
			if (!raw || !raw.trim() || CONFLICT_REGEX.test(raw)) return null;
			const parser = options.parse || JSON.parse;
			const parsed = parser(raw);
			if (options.validate && !options.validate(parsed)) return null;
			return parsed as T;
		} catch (err: any) {
			logWarning(`Candidate [${candPath}] parse failed`, err);
			return null;
		}
	}

	private pruneOrphanTmpFiles(dir: string, baseName: string): void {
		if (!fs.existsSync(dir)) return;
		try {
			const prefix = `${baseName}.tmp.`;
			const now = Date.now();
			const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix));
			for (const file of files) {
				const full = path.join(dir, file);
				try {
					const stat = fs.statSync(full);
					// 清理创建时间超过 5 秒的孤儿残留
					if (now - stat.mtimeMs > 5000) {
						fs.unlinkSync(full);
					}
				} catch (err: any) {
					logWarning("Prune orphan file error", err);
				}
			}
		} catch (err: any) {
			logWarning("Read directory for orphan prune error", err);
		}
	}
}
