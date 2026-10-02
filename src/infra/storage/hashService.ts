import * as crypto from "node:crypto";
import type { IHashService } from "#src/domain/ports/hasher";

/**
 * 基于 Node.js crypto 模块实现的哈希计算基础设施
 */
export class NodeHashService implements IHashService {
	public sha256(content: string): string {
		return crypto.createHash("sha256").update(content, "utf8").digest("hex");
	}
}

export const defaultHashService = new NodeHashService();
