/**
 * 清洗并装箱非空唯一字符串数组 (纯工具)
 */
export function uniqueStrings(raw: unknown): string[] {
	let arr: string[] = [];
	if (typeof raw === "string") {
		arr = raw.split(",");
	} else if (Array.isArray(raw)) {
		arr = raw.flatMap((item) => (typeof item === "string" ? item.split(",") : []));
	}
	const cleaned = arr.map((s) => s.trim()).filter((s) => s.length > 0);
	return Array.from(new Set(cleaned));
}

/**
 * 无序集合相等性比对 (纯算法)
 */
export function arrayEqualsIgnoreOrder(a: string[], b: string[]): boolean {
	if (!Array.isArray(a) || !Array.isArray(b)) return false;
	if (a.length !== b.length) return false;
	const sortedA = [...a].sort();
	const sortedB = [...b].sort();
	return sortedA.every((val, idx) => val === sortedB[idx]);
}
