import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AtomicFileJsonStore } from "#src/infra/storage/atomicFileJsonStore";

export async function runAtomicFileJsonStoreTests() {
	console.log("  ▶ [AtomicFileJsonStore] 运行冷启动自愈与原子存储机制单元测试...");
	const tmpDir = path.join(os.tmpdir(), `test-atomic-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	fs.mkdirSync(tmpDir, { recursive: true });

	const store = new AtomicFileJsonStore();
	const targetFile = path.join(tmpDir, "data.json");

	const capturedWarnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => {
		capturedWarnings.push(args.join(" "));
		originalWarn(...args);
	};

	try {
		// 1. 初始不存在时安全返回 empty
		const initialReport = store.load(targetFile, {
			fallback: () => ({ count: 0 }),
		});
		assert.strictEqual(initialReport.status, "empty");
		assert.strictEqual(initialReport.data.count, 0);

		// 2. 正常原子保存与读取
		store.save(targetFile, { count: 42 });
		assert.strictEqual(fs.existsSync(targetFile), true);

		const healthyReport = store.load(targetFile, {
			fallback: () => ({ count: 0 }),
		});
		assert.strictEqual(healthyReport.status, "healthy");
		assert.strictEqual(healthyReport.data.count, 42);

		// 3. 递归自动创建不存在的深层子目录
		const deepFile = path.join(tmpDir, "sub", "deep", "dir", "nested.json");
		store.save(deepFile, { nested: true });
		assert.strictEqual(fs.existsSync(deepFile), true);
		const deepReport = store.load(deepFile, { fallback: () => ({ nested: false }) });
		assert.strictEqual(deepReport.status, "healthy");
		assert.strictEqual(deepReport.data.nested, true);

		// 4. save 过程中 write 成功但 renameSync 失败时，finally 必须执行 unlinkSync 清理真实写入的 tmp 文件
		const conflictDirAsFile = path.join(tmpDir, "conflict-dir-target");
		fs.mkdirSync(conflictDirAsFile, { recursive: true });
		// 将目标文件指向一个已存在的目录，在 Node 中 renameSync 会失败抛出 EISDIR/EPERM
		assert.throws(() => {
			store.save(conflictDirAsFile, { test: "should-fail-on-rename" });
		});
		// 验证临时文件已被 finally 块的 unlinkSync 真正清理干净
		const remainingTmps = fs.readdirSync(tmpDir).filter((f) => f.includes(".tmp."));
		assert.strictEqual(remainingTmps.length, 0, "renameSync 失败时 finally 块必须真正清理已落盘的临时文件");

		// 序列化异常测试
		const circularObj = {};
		circularObj.self = circularObj;
		assert.throws(() => {
			store.save(targetFile, circularObj);
		});

		// 5. 灾难自愈：主文件变成 0 字节时，从有效的 .tmp 候选自愈恢复
		const tmpCandidate = path.join(tmpDir, `data.json.tmp.${process.pid}.${Date.now() - 100}.12345`);
		fs.writeFileSync(tmpCandidate, JSON.stringify({ count: 99 }), "utf-8");
		fs.writeFileSync(targetFile, "", "utf-8"); // 模拟断电导致 0 字节损坏

		let healedMessage = "";
		const healedReport = store.load(targetFile, {
			fallback: () => ({ count: 0 }),
			onHealed: (msg) => {
				healedMessage = msg;
			},
		});

		assert.strictEqual(healedReport.status, "healed");
		assert.strictEqual(healedReport.data.count, 99);
		assert.ok(healedMessage.includes("Disaster recovery successful"));
		// 验证主文件已被自愈覆盖修复
		const restoredContent = JSON.parse(fs.readFileSync(targetFile, "utf-8"));
		assert.strictEqual(restoredContent.count, 99);

		// 6. 主文件仅含空白字符（空格/换行）时判定损坏并触发自愈（使用宽松 parse 避免被 JSON.parse 语法错误误杀）
		const looseParseOptions = {
			parse: (raw) => ({ parsedLen: raw.length }),
			fallback: () => ({ fallbackInvoked: true }),
		};

		// 6.1 纯空白文本测试：此时存在 tmpCandidate，所以应当自愈并抢救 tmpCandidate
		fs.writeFileSync(targetFile, "   \n\t  \n  ", "utf-8");
		const whitespaceReport = store.load(targetFile, looseParseOptions);
		assert.strictEqual(whitespaceReport.status, "healed", "纯空白文本必须被 trim 守卫拦截并触发从候选自愈");

		// 6.2 0 字节空文本测试
		fs.writeFileSync(targetFile, "", "utf-8");
		const emptyFileReport = store.load(targetFile, looseParseOptions);
		assert.strictEqual(emptyFileReport.status, "healed", "0 字节文件必须被 !content 守卫拦截并触发自愈");

		// 7. Git 冲突标记识别与自愈触发 (INV-025)
		const conflictMarkers = [
			"<<<<<<< HEAD\nline1\n=======\nline2\n>>>>>>> branch\n",
			"=======\nsome content\n",
			">>>>>>> commit-hash\n",
			"<<<<<<<   \t   multi-whitespace\n",
		];
		for (const marker of conflictMarkers) {
			fs.writeFileSync(targetFile, marker, "utf-8");
			const conflictReport = store.load(targetFile, looseParseOptions);
			assert.strictEqual(
				conflictReport.status,
				"healed",
				`冲突标记应被 CONFLICT_REGEX 拦截并触发自愈: ${marker.slice(0, 10)}`
			);
		}

		// 7.2 伪冲突文本守卫：行内普通小于号、非行首标记不应被误判为冲突 (击杀 CONFLICT_REGEX 变异)
		const pseudoConflictContent = JSON.stringify({
			lessThan: "if (a < b) return true;",
			inlineMarker: "text with <<<<<<< inside line",
			equals: "value = 7777777;",
			greater: "if (x > y) return false;",
		});
		fs.writeFileSync(targetFile, pseudoConflictContent, "utf-8");
		const pseudoReport = store.load(targetFile, { fallback: () => null });
		assert.strictEqual(pseudoReport.status, "healthy", "合法伪冲突字符绝不能被误判为 Git 冲突标记");
		assert.strictEqual(pseudoReport.data.lessThan, "if (a < b) return true;");

		// 8. 候选临时副本按修改时间 (mtime) 降序仲裁与坏候选跳过
		if (fs.existsSync(tmpCandidate)) fs.unlinkSync(tmpCandidate);

		// 构造 4 个候选副本测试仲裁与解析守卫：
		// - cOld: 4 秒前创建，合法，count: 10
		// - cMiddle: 2 秒前创建，合法，count: 20
		// - cNewestEmpty: 1.5 秒前创建，纯空白（应当被 tryParseCandidate 拦截）
		// - cNewestConflict: 1 秒前创建，冲突标记（应当被 tryParseCandidate 拦截）
		const cOld = path.join(tmpDir, `data.json.tmp.${process.pid}.${Date.now() - 4000}.111`);
		const cMiddle = path.join(tmpDir, `data.json.tmp.${process.pid}.${Date.now() - 2000}.222`);
		const cNewestEmpty = path.join(tmpDir, `data.json.tmp.${process.pid}.${Date.now() - 1500}.333`);
		const cNewestConflict = path.join(tmpDir, `data.json.tmp.${process.pid}.${Date.now() - 1000}.444`);

		fs.writeFileSync(cOld, JSON.stringify({ count: 10 }), "utf-8");
		fs.writeFileSync(cMiddle, JSON.stringify({ count: 20 }), "utf-8");
		fs.writeFileSync(cNewestEmpty, "   \n  ", "utf-8");
		fs.writeFileSync(cNewestConflict, "<<<<<<< HEAD\nbad conflict\n", "utf-8");

		const tOld = new Date(Date.now() - 4000);
		const tMiddle = new Date(Date.now() - 2000);
		const tEmpty = new Date(Date.now() - 1500);
		const tConflict = new Date(Date.now() - 1000);
		fs.utimesSync(cOld, tOld, tOld);
		fs.utimesSync(cMiddle, tMiddle, tMiddle);
		fs.utimesSync(cNewestEmpty, tEmpty, tEmpty);
		fs.utimesSync(cNewestConflict, tConflict, tConflict);

		// 主文件置为损坏
		fs.writeFileSync(targetFile, "CORRUPTED_JSON", "utf-8");

		const arbitratedReport = store.load(targetFile, {
			fallback: () => ({ count: -1 }),
		});
		assert.strictEqual(arbitratedReport.status, "healed");
		// 应当跳过最新的冲突和空文件，选中合法且最新的 cMiddle (count: 20)
		assert.strictEqual(arbitratedReport.data.count, 20, "必须按 mtime 降序仲裁并跳过坏候选抢救次新有效副本");

		// 8.2 在候选解析阶段使用 validate 校验拦截候选
		const validateOptions = {
			fallback: () => ({ count: -1 }),
			validate: (d) => d.count === 10, // 仅允许 count 为 10 的候选通过
		};
		const validatedHealedReport = store.load(targetFile, validateOptions);
		assert.strictEqual(validatedHealedReport.status, "healed");
		assert.strictEqual(validatedHealedReport.data.count, 10, "候选副本 validate 失败必须被跳过，选用满足校验的候选");

		// 8.3 宽松 parse 下，验证 tryParseCandidate 阶段的空白与冲突守卫有效拦截 (击杀 tryParseCandidate 守卫变异)
		const cLooseBadEmpty = path.join(tmpDir, `data.json.tmp.${process.pid}.${Date.now() - 500}.555`);
		const cLooseBadConflict = path.join(tmpDir, `data.json.tmp.${process.pid}.${Date.now() - 400}.666`);
		const cLooseGood = path.join(tmpDir, `data.json.tmp.${process.pid}.${Date.now() - 600}.777`);
		fs.writeFileSync(cLooseBadEmpty, "   ", "utf-8");
		fs.writeFileSync(cLooseBadConflict, "<<<<<<< HEAD\nconflict\n", "utf-8");
		fs.writeFileSync(cLooseGood, "valid-loose-content", "utf-8");
		fs.utimesSync(cLooseBadEmpty, new Date(Date.now() - 500), new Date(Date.now() - 500));
		fs.utimesSync(cLooseBadConflict, new Date(Date.now() - 400), new Date(Date.now() - 400));
		fs.utimesSync(cLooseGood, new Date(Date.now() - 600), new Date(Date.now() - 600));

		// 主文件置为空 0 字节，迫使其走候选副本自愈
		fs.writeFileSync(targetFile, "", "utf-8");
		const looseCandidateReport = store.load(targetFile, {
			parse: (raw) => ({ text: raw }),
			fallback: () => ({ text: "fallback" }),
		});
		assert.strictEqual(looseCandidateReport.status, "healed");
		assert.strictEqual(looseCandidateReport.data.text, "valid-loose-content", "tryParseCandidate 必须拦截空白与冲突候选");
		fs.unlinkSync(cLooseBadEmpty);
		fs.unlinkSync(cLooseBadConflict);
		fs.unlinkSync(cLooseGood);

		// 清理候选
		fs.unlinkSync(cOld);
		fs.unlinkSync(cMiddle);
		fs.unlinkSync(cNewestEmpty);
		fs.unlinkSync(cNewestConflict);

		// 9. 自定义 parse 与 validate 校验器触发主文件回退
		const customParseTarget = path.join(tmpDir, "custom.json");
		fs.writeFileSync(customParseTarget, "12345", "utf-8");
		const customParseReport = store.load(customParseTarget, {
			parse: (raw) => ({ customValue: parseInt(raw, 10) }),
			fallback: () => ({ customValue: 0 }),
		});
		assert.strictEqual(customParseReport.status, "healthy");
		assert.strictEqual(customParseReport.data.customValue, 12345);

		// validate 校验失败触发自愈/回退
		fs.writeFileSync(targetFile, JSON.stringify({ count: -99 }), "utf-8");
		const validatedReport = store.load(targetFile, {
			fallback: () => ({ count: 9999 }),
			validate: (obj) => typeof obj?.count === "number" && obj.count >= 0,
		});
		assert.strictEqual(validatedReport.status, "fallback", "validate 不通过时必须拒绝该文件并回退");
		assert.strictEqual(validatedReport.data.count, 9999);

		// 10. 彻底损坏且无任何候选副本时，安全回退 fallback
		fs.writeFileSync(targetFile, "INVALID_SYNTAX_###", "utf-8");
		const fallbackReport = store.load(targetFile, {
			fallback: () => ({ count: -1 }),
		});
		assert.strictEqual(fallbackReport.status, "fallback");
		assert.strictEqual(fallbackReport.data.count, -1);
		assert.ok(fallbackReport.recoveryMessage.includes("Returned fallback"));

		// 11. 孤儿临时碎片精确 5 秒生命周期与非临时文件保护
		const oldOrphan = path.join(tmpDir, `data.json.tmp.${process.pid}.${Date.now() - 10000}.old`);
		const freshTmp = path.join(tmpDir, `data.json.tmp.${process.pid}.${Date.now() - 1000}.fresh`);
		const nonTmpFile = path.join(tmpDir, `data.json.backup.json`);

		fs.writeFileSync(oldOrphan, "{}", "utf-8");
		fs.writeFileSync(freshTmp, "{}", "utf-8");
		fs.writeFileSync(nonTmpFile, "{}", "utf-8");

		// 修改 oldOrphan 为 8 秒前，freshTmp 为 1 秒前
		const past8s = new Date(Date.now() - 8000);
		const past1s = new Date(Date.now() - 1000);
		fs.utimesSync(oldOrphan, past8s, past8s);
		fs.utimesSync(freshTmp, past1s, past1s);

		// 11.2 前缀隔离保护：其他前缀的临时文件即使过期也不得被误删 (击杀 prefix 与 filter 变异)
		const otherPrefixOld = path.join(tmpDir, `other_doc.json.tmp.${process.pid}.${Date.now() - 10000}.old`);
		fs.writeFileSync(otherPrefixOld, "{}", "utf-8");
		fs.utimesSync(otherPrefixOld, new Date(Date.now() - 10000), new Date(Date.now() - 10000));

		// 执行 load 触发 pruneOrphanTmpFiles
		store.load(targetFile, { fallback: () => ({ count: 0 }) });

		assert.strictEqual(fs.existsSync(oldOrphan), false, "超过 5 秒的孤儿临时文件必须被自动清理");
		assert.strictEqual(fs.existsSync(freshTmp), true, "未超过 5 秒的合法活跃临时文件绝不能被误杀");
		assert.strictEqual(fs.existsSync(nonTmpFile), true, "非临时文件绝不能被误删");
		assert.strictEqual(fs.existsSync(otherPrefixOld), true, "非当前文件 baseName 前缀的临时文件绝对不能被删除");
		fs.unlinkSync(otherPrefixOld);

		// 12. 不存在目录防灾容错
		const nonExistentTarget = path.join(tmpDir, "ghost-dir", "no-file.json");
		const ghostReport = store.load(nonExistentTarget, { fallback: () => ({ ghost: true }) });
		assert.strictEqual(ghostReport.status, "empty");
		assert.strictEqual(ghostReport.data.ghost, true);

		// 12.2 目录完全不存在时 attemptRecoveryFromTmp 与 prune 安全放行
		const nonDirStoreReport = store.load("D:/non-existent-dir-12345/missing.json", {
			fallback: () => ({ safe: true }),
		});
		assert.strictEqual(nonDirStoreReport.status, "empty");
		assert.strictEqual(nonDirStoreReport.data.safe, true);

		// 13. 警告日志链路完整性断言 (击杀 logWarning 及其内部模板变异)
		assert.ok(
			capturedWarnings.some((w) => w.includes("[AtomicFileJsonStore]") && w.includes("Main file integrity probe failed")),
			"必须正确输出主文件健康度探测失败的格式化警告"
		);

		console.log("  ✅ [AtomicFileJsonStore] 冷启动自愈与原子存储机制单元测试通过！\n");
	} finally {
		console.warn = originalWarn;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

if (process.argv[1]?.endsWith("atomic_file_json_store.test.mjs")) {
	runAtomicFileJsonStoreTests();
}
