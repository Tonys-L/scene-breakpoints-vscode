import type { Hasher } from "#src/domain/ports/hasher";
export type { Hasher } from "#src/domain/ports/hasher";

/**
 * 纯 TypeScript 零外部依赖 SHA-256 实现
 * 确保在领域层无需依赖 Node.js 的 "node:crypto"，达到 100% 宿主无关
 */
export function pureSha256(ascii: string): string {
	function rightRotate(value: number, amount: number) {
		return (value >>> amount) | (value << (32 - amount));
	}

	const mathPow = Math.pow;
	const maxWord = mathPow(2, 32);
	let i: number, j: number;
	let result = "";

	const words: number[] = [];
	const asciiBitLength = ascii.length * 8;

	let hash: number[] = [];
	const k: number[] = [];
	let primeCounter = 0;

	const isComposite: Record<number, number> = {};
	for (let candidate = 2; primeCounter < 64; candidate++) {
		if (!isComposite[candidate]) {
			// 素数筛上限 313 对齐上游 geraintluff/sha256（313 ≥ 312 可正确标记全部 ≤311 复合数，
			// 保证 k[62]/k[63] 取第 63/64 个真实素数 307/311，输出与标准 SHA-256 (FIPS 180-4) 逐字节一致）
			for (i = 0; i < 313; i += candidate) {
				isComposite[i] = candidate;
			}
			hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
			k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
		}
	}

	ascii += "\x80";
	while ((ascii.length % 64) !== 56) ascii += "\x00";
	for (i = 0; i < ascii.length; i++) {
		j = ascii.charCodeAt(i);
		if (j >> 8) return ""; // 保证 ascii
		words[i >> 2] |= j << (((3 - i) % 4) * 8);
	}
	words[words.length] = (asciiBitLength / maxWord) | 0;
	words[words.length] = asciiBitLength;

	for (j = 0; j < words.length; ) {
		const w = words.slice(j, (j += 16));
		const oldHash = hash;
		hash = hash.slice(0, 8);

		for (i = 0; i < 64; i++) {
			const w15 = w[i - 15],
				w2 = w[i - 2];

			const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
			const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
			w[i] = (i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0) | 0;

			const s1_ = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
			const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
			const temp1 = (hash[7] + s1_ + ch + k[i] + w[i]) | 0;
			const s0_ = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
			const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
			const temp2 = (s0_ + maj) | 0;

			hash = [(temp1 + temp2) | 0, hash[0], hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]];
		}

		for (i = 0; i < 8; i++) {
			hash[i] = (hash[i] + oldHash[i]) | 0;
		}
	}

	for (i = 0; i < 8; i++) {
		for (j = 3; j + 1; j--) {
			const b = (hash[i] >> (j * 8)) & 255;
			result += ((b < 16 ? 0 : "") + b.toString(16));
		}
	}
	return result;
}

/**
 * 插件当前内置的最新 AI 规则资产版本号 (默认与 package.json 对齐)
 */
export const LATEST_SKILL_VERSION = "1.3.0";
export const LATEST_RULE_VERSION = LATEST_SKILL_VERSION;

/**
 * 官方历史核心正文指纹映射表 (Hash 作为 Key，O(1) 极速秒查版本)
 * 发版仪式：每次发布新版本时，必须将本版正文的指纹登记入表（键 = 版本号），
 * 以保障存量用户的本地纯正版可被识别为 CleanOutdated 并平滑升级（INV-016 版本 SSOT 联动）。
 * ⚠️ 指纹 = 规范化核心正文（剥 Frontmatter + 跨平台归一化）的标准 SHA-256 (FIPS 180-4)，
 * 必须经由领域实体管线生成（AgentRuleAsset.computeFingerprint，已可与 node:crypto 交叉验证），
 * 严禁对原始文件字节直接哈希——归一化语义（而非哈希算法）才是指纹一致性的根本契约。
 */
export const OFFICIAL_SKILL_HISTORY: Record<string, string> = {
	"f026e091703950315e7b7ca2e55a3650af729c2a9512e49bd82e5e695be5ffea": "1.0.3",
	"be86d3a35575f137d075f49867c9a8ead61e60d7c7e43e2f05d26a13c1d21a42": "1.0.8",
	"fa60dde5fac4cf2ca521867909765ed653e41148de1cea824758274753bc39d5": "1.1.0",
	"05a7af959099f4dd4c45e78f2384bd0117b997ce158c20d80358e706a684c902": "1.2.0",
	"8abab22b8137395c6452faea2e611b3b0f0a9ec196acbc12ef41d0f5351dadd5": "1.3.0",
};
export const OFFICIAL_RULE_HISTORY = OFFICIAL_SKILL_HISTORY;

export type RuleLifecycleStatus = "UpToDate" | "CleanOutdated" | "CustomModified";
export type SkillStatus = RuleLifecycleStatus;

export interface RuleLifecycleResult {
	status: RuleLifecycleStatus;
	detectedVersion?: string;
	localHash: string;
	latestHash: string;
}
export type SkillLifecycleResult = RuleLifecycleResult;

/**
 * AI 规则/指令资产领域实体 (AgentRuleAsset Entity)
 * 职责：封装跨平台 (Cursor Rules / Windsurf / Claude Skill / Copilot Instructions) 的规则资产模型、核心正文归一化、唯一哈希指纹提取与三态生命周期评估
 * 纯 TS 实现，零 Node.js crypto 依赖
 */
export class AgentRuleAsset {
	public readonly targetPath: string;
	public readonly rawContent: string;

	constructor(targetPath: string, rawContent: string) {
		this.targetPath = targetPath;
		this.rawContent = rawContent || "";
	}

	/**
	 * 剥离开头的 YAML / MDC Frontmatter 元数据头，提取纯 Markdown 规则正文
	 */
	public getCoreBody(): string {
		return this.rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, "");
	}

	/**
	 * 跨操作系统归一化文本（消除 CRLF/LF 与行末空格干扰，严格保障指纹一致性）
	 */
	public getNormalizedBody(): string {
		return this.getCoreBody()
			.replace(/\r\n/g, "\n")
			.split("\n")
			.map((line) => line.trimEnd())
			.join("\n")
			.trim();
	}

	/**
	 * 计算规范化核心正文的 SHA-256 唯一指纹
	 * 默认使用纯 TS 实现，亦可通过 hasher 端口注入外部实现
	 */
	public computeFingerprint(hasher?: Hasher): string {
		const normalized = this.getNormalizedBody();
		if (typeof hasher === "function") {
			return hasher(normalized);
		}
		if (hasher && typeof hasher.sha256 === "function") {
			return hasher.sha256(normalized);
		}
		// 使用 utf-8 编码为 ascii 字节流后求 SHA-256
		const utf8Str = unescape(encodeURIComponent(normalized));
		return pureSha256(utf8Str);
	}

	/**
	 * 评估规则文件在工作区中的生命周期状态
	 */
	public evaluateLifecycle(
		latestTemplate: string,
		hasherOrVersion?: Hasher | string,
		hasher?: Hasher,
	): RuleLifecycleResult {
		const targetVersion = typeof hasherOrVersion === "string" ? hasherOrVersion : LATEST_RULE_VERSION;
		const actualHasher = typeof hasherOrVersion === "function" || (typeof hasherOrVersion === "object" && hasherOrVersion !== null && "sha256" in hasherOrVersion)
			? hasherOrVersion
			: hasher;

		const localHash = this.computeFingerprint(actualHasher);
		const latestAsset = new AgentRuleAsset("builtin-template", latestTemplate);
		const latestHash = latestAsset.computeFingerprint(actualHasher);

		// 1. 完全对齐最新版本
		if (localHash === latestHash) {
			return {
				status: "UpToDate",
				detectedVersion: targetVersion,
				localHash,
				latestHash,
			};
		}

		// 2. 命中官方历史发布的纯正旧版本
		if (OFFICIAL_RULE_HISTORY[localHash]) {
			return {
				status: "CleanOutdated",
				detectedVersion: OFFICIAL_RULE_HISTORY[localHash],
				localHash,
				latestHash,
			};
		}

		// 3. 用户或 AI 发生了非官方的个性化定制改动
		return {
			status: "CustomModified",
			localHash,
			latestHash,
		};
	}
}
