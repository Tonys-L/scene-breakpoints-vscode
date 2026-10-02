/**
 * 哈希计算能力契约端口 (Port)
 * 职责：领域层与平台底层加密库解耦，领域层仅面向此接口计算内容指纹
 */
export interface IHashService {
	/**
	 * 计算给定文本的 SHA-256 哈希值 (hex 编码字符串)
	 */
	sha256(content: string): string;
}
