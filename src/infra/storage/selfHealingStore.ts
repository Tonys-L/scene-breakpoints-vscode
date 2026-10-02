/**
 * 自愈审计结果报告
 */
export interface StorageIntegrityReport<T> {
	/** 状态：健康直出 / 灾难自愈成功 / 彻底损坏回退默认 / 初始空配置 */
	status: "healthy" | "healed" | "fallback" | "empty";
	/** 最终交付给业务的合法数据实体 */
	data: T;
	/** 自愈审计诊断信息（用于日志和用户提示） */
	recoveryMessage?: string;
}

/**
 * 存储恢复与自愈选项
 */
export interface StoreRecoveryOptions<T> {
	/** 数据合法性校验断言（可选） */
	validate?: (data: unknown) => data is T;
	/** 自定义内容反序列化/预处理函数（如支持 JSONC 注释剥离，缺省为 JSON.parse） */
	parse?: (rawText: string) => any;
	/** 遇到彻底损坏且无任何备份可救时的安全默认回退值构造器 */
	fallback: () => T;
	/** 自愈成功触发回调（用于抛出通知或遥测） */
	onHealed?: (message: string) => void;
}

/**
 * 通用冷启动自愈存储机制契约 (The Mechanism Interface)
 * 屏蔽物理介质（本地单文件、SQLite、云端对象存储），向业务层提供统一的三相自愈与安全写入保证
 */
export interface ISelfHealingStore<T, TTarget = string> {
	/**
	 * 冷启动安全读取 (内嵌完整性探测、灾难仲裁自愈与孤儿碎片环境净化)
	 */
	load(target: TTarget, options: StoreRecoveryOptions<T>): StorageIntegrityReport<T>;

	/**
	 * 原子/事务安全写入 (保证物理写入过程崩溃时，原数据毫发无损)
	 */
	save(target: TTarget, data: T): void;
}
