import assert from "node:assert";
import {
	cleanLine,
	stripTrailingComment,
	countIndent,
	findPrevNonEmptyLine,
	findNextNonEmptyLine,
	findGeometricParent,
	extractScopeAnchor,
	findScopeAnchorLine,
	calculateSimilarity,
	resolveHealedLineFromLines as resolveHealedLineInMemory,
	extractContextSnippetFromLines,
	extractContextSnippet,
} from "../../../src/domain/healingEngine.ts";

export {
	cleanLine,
	stripTrailingComment,
	countIndent,
	findPrevNonEmptyLine,
	findNextNonEmptyLine,
	findGeometricParent,
	extractScopeAnchor,
	findScopeAnchorLine,
	calculateSimilarity,
	resolveHealedLineInMemory,
	extractContextSnippetFromLines,
	extractContextSnippet,
};

export function runHealingTests() {
	console.log("  ▶ [Healing] 运行自愈算法全维边界测试套件...");

	// 1. 文件第 1 行断点（首行极值：无上一行、无回溯作用域）
	{
		const bpLine1 = {
			file: "main.ts",
			line: 1,
			contextSnippet: {
				current: "import * as os from 'os';",
				next: "import * as fs from 'fs';",
				indent: 0,
			},
		};
		const newLines = [
			"// Added license banner",
			"import * as os from 'os';", // 漂移到第 2 行
			"import * as fs from 'fs';",
		];
		const res = resolveHealedLineInMemory(newLines, bpLine1);
		assert.strictEqual(res.healedLine, 2, "首行断点下移应准确自愈到第 2 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 2. 文件最后一行断点（末行极值：无下一行）
	{
		const bpLast = {
			file: "main.ts",
			line: 3,
			contextSnippet: {
				prev: "const app = createApp();",
				current: "export default app;",
				indent: 0,
			},
		};
		const newLines = [
			"const app = createApp();",
			"// Extra log inserted",
			"const app2 = createApp();",
			"export default app;", // 漂移到第 4 行
		];
		const res = resolveHealedLineInMemory(newLines, bpLast);
		assert.strictEqual(res.healedLine, 4, "末行断点下移应准确自愈到第 4 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 3. 代码行被彻底删除（必须安全回退原行，严禁乱飘）
	{
		const bpDeleted = {
			file: "del.ts",
			line: 3,
			contextSnippet: {
				prev: "const x = 1;",
				current: "const debugToken = 'dead-code-to-remove';",
				next: "const y = 2;",
			},
		};
		const newLines = [
			"const x = 1;",
			"const y = 2;",
			"return x + y;",
		];
		const res = resolveHealedLineInMemory(newLines, bpDeleted);
		assert.strictEqual(res.healedLine, 3, "代码删除后无法达标应平滑回退原行号");
		assert.strictEqual(res.isHealed, false);
	}

	// 4. 超大跨度偏移（超出 ±30 行窗口限制，必须安全回退）
	{
		const bpFar = {
			file: "far.ts",
			line: 5,
			contextSnippet: {
				current: "const TARGET_STMT = true;",
			},
		};
		const newLines = [];
		// 插入 50 行注释使原先第 5 行变为第 55 行 (超出 30 步窗口)
		for (let k = 0; k < 50; k++) {
			newLines.push(`// Spacer comment ${k}`);
		}
		newLines.push("const TARGET_STMT = true;");

		const res = resolveHealedLineInMemory(newLines, bpFar);
		assert.strictEqual(res.healedLine, 5, "超出滑动窗口步长限制应安全回退");
		assert.strictEqual(res.isHealed, false);
	}

	// 5. 异常空值与无效入参守卫 (Null-safety & Boundary)
	{
		assert.strictEqual(resolveHealedLineInMemory([], { line: 10 }).isHealed, false);
		assert.strictEqual(resolveHealedLineInMemory(["a", "b"], null).isHealed, false);
		assert.strictEqual(resolveHealedLineInMemory(["a", "b"], { line: 0 }).isHealed, false);
		assert.strictEqual(resolveHealedLineInMemory(["a", "b"], { line: -10 }).isHealed, false);
		assert.strictEqual(resolveHealedLineInMemory(["a", "b"], { line: NaN }).isHealed, false);
		assert.strictEqual(resolveHealedLineInMemory(["a", "b"], { line: 2, contextSnippet: undefined }).isHealed, false);
	}

	// 6. 超长代码行截断 (>140 字符)
	{
		const ultraLong = "const svgData = '" + "A".repeat(200) + "';";
		const cleaned = cleanLine(ultraLong);
		assert.strictEqual(cleaned.length, 140, "超长代码行必须安全截断为 140 字符");
	}

	// 7. 多语言作用域提取模式测试
	{
		// (1) Go 语言带 receiver 方法: func (r *Repo) Query(ctx context.Context)
		const goLines = [
			"package main",
			"func (r *Repo) Query(ctx context.Context) error {",
			"    return nil",
		];
		assert.strictEqual(extractScopeAnchor(goLines, 2), "Query", "Go 方法 Receiver 正确识别函数名");

		// (2) Rust 公共异步函数: pub async fn handle(req: Request) -> Result<()>
		const rustLines = [
			"pub async fn handle(req: Request) -> Result<()> {",
			"    let x = 10;",
		];
		assert.strictEqual(extractScopeAnchor(rustLines, 1), "handle", "Rust pub async fn 正确识别函数名");

		// (3) TS 类成员私有方法与箭头函数: private onClick = (e) =>
		const tsLines = [
			"class Button {",
			"    private onClick = (e: Event) => {",
			"        console.log(e);",
		];
		assert.strictEqual(extractScopeAnchor(tsLines, 2), "onClick", "TS 类成员箭头函数名正确识别");
	}

	// 8. 软容错上下文硬门禁（当前行更名但上下文全失配时严禁自愈）
	{
		const lines = [
			"function render() {",
			"    const targetTitle = 'home';",
			"    return null;",
			"}",
		];
		const bp = {
			file: "render.ts",
			line: 2,
			contextSnippet: {
				prev: "function notMatch() {",
				current: "const title = 'home';",
				next: "return undefined;",
			},
		};
		const res = resolveHealedLineInMemory(lines, bp);
		assert.strictEqual(res.healedLine, 2);
		assert.strictEqual(res.isHealed, false, "上下文全未匹配时严禁给当前行软容错分");
	}

	// 9. 控制流保留字穿透与作用域锚点提取 (if, for, while, switch, catch, 多层嵌套)
	{
		// (1) if 语句穿透
		const ifLines = [
			"export function processPayment(amount: number) {",
			"    if (amount <= 0) {",
			"        throw new Error('Invalid');",
			"    }",
			"}",
		];
		assert.strictEqual(extractScopeAnchor(ifLines, 1), "processPayment", "if 语句本身应正确穿透找到外层函数");
		assert.strictEqual(extractScopeAnchor(ifLines, 2), "processPayment", "if 块内语句应正确穿透找到外层函数");

		// (2) for 循环穿透
		const forLines = [
			"async function calculateTotals(items: Item[]) {",
			"    for (const item of items) {",
			"        total += item.price;",
			"    }",
			"}",
		];
		assert.strictEqual(extractScopeAnchor(forLines, 1), "calculateTotals", "for 循环本身应正确穿透找到外层函数");
		assert.strictEqual(extractScopeAnchor(forLines, 2), "calculateTotals", "for 循环内部应正确穿透找到外层函数");

		// (3) while 与 switch 穿透
		const whileSwitchLines = [
			"class StateMachine {",
			"    public handleEvent(event: Event) {",
			"        while (this.hasEvents()) {",
			"            switch (event.type) {",
			"                case 'INIT':",
			"                    this.init();",
			"            }",
			"        }",
			"    }",
			"}",
		];
		assert.strictEqual(extractScopeAnchor(whileSwitchLines, 2), "handleEvent", "while 循环应穿透至类方法名");
		assert.strictEqual(extractScopeAnchor(whileSwitchLines, 3), "handleEvent", "switch 语句应穿透至类方法名");
		assert.strictEqual(extractScopeAnchor(whileSwitchLines, 5), "handleEvent", "case 分支应穿透至类方法名");

		// (4) try / catch / finally 穿透
		const tryCatchLines = [
			"function executeSafe() {",
			"    try {",
			"        doTask();",
			"    } catch (err) {",
			"        console.error(err);",
			"    } finally {",
			"        cleanup();",
			"    }",
			"}",
		];
		assert.strictEqual(extractScopeAnchor(tryCatchLines, 3), "executeSafe", "catch 语句应穿透至外层函数");
		assert.strictEqual(extractScopeAnchor(tryCatchLines, 4), "executeSafe", "catch 块内语句应穿透至外层函数");
		assert.strictEqual(extractScopeAnchor(tryCatchLines, 6), "executeSafe", "finally 块内语句应穿透至外层函数");
	}

	// 10. 用户实战回归用例：断点上方插入空行与新代码行（行号由 15 漂移至 18）
	{
		const userBp = {
			file: "demo/healing-demo.ts",
			line: 15,
			enabled: true,
			contextSnippet: {
				prev: "console.log(`[Order] Customer name: ${order.customer}`);",
				current: "if (order.amount <= 0) {",
				next: "throw new Error(\"Invalid order payment amount!\");",
				indent: 2,
				scopeAnchor: "processOrderPayment",
			},
		};

		// 模拟用户在第 15 行插入空行和一行打印代码，将目标行推移至第 18 行
		const modifiedLines = [
			"export interface OrderInfo {",
			"    id: string;",
			"    customer: string;",
			"    amount: number;",
			"}",
			"",
			"export function processOrderPayment(order: OrderInfo): { success: boolean; message: string } {",
			"    console.log(`[Order] Preparing to process payment for order ${order.id}`);",
			"    console.log(`[Order] Customer name: ${order.customer}`);",
			"",
			"    console.log(\"scene-breakpoints-vscode self-healing test line \");",
			"",
			"    if (order.amount <= 0) {", // 当前在第 13 行 (0-indexed 为 12)
			"        throw new Error(\"Invalid order payment amount!\");",
			"    }",
			"}",
		];

		// 在更逼近用户 30 行真实文件的结构下测试
		const fullFileLines = [
			"/**",
			" * Scene Breakpoints 代码行号自愈能力演示源码",
			" * 预设场景断点位置：第 15 行",
			" */",
			"",
			"export interface OrderInfo {",
			"    id: string;",
			"    customer: string;",
			"    amount: number;",
			"}",
			"",
			"export function processOrderPayment(order: OrderInfo): { success: boolean; message: string } {",
			"    console.log(`[Order] Preparing to process payment for order ${order.id}`);",
			"    console.log(`[Order] Customer name: ${order.customer}`);",
			"",
			"    console.log(\"scene-breakpoints-vscode self-healing test line \");",
			"",
			"    if (order.amount <= 0) {", // 漂移到第 18 行！
			"        throw new Error(\"Invalid order payment amount!\");",
			"    }",
			"",
			"    const transactionId = `TX-${Date.now()}`;",
			"    console.log(`[Order] Payment successful! Transaction: ${transactionId}`);",
			"",
			"    return {",
			"        success: true;",
			"        message: `Transaction ${transactionId} confirmed`,",
			"    };",
			"}",
		];

		const res = resolveHealedLineInMemory(fullFileLines, userBp);
		assert.strictEqual(res.healedLine, 18, "断点上方插入空行与代码后应准确自愈至第 18 行");
		assert.strictEqual(res.isHealed, true, "应成功判定为自愈");
	}

	// 11. 代码向上漂移（删除断点上方的代码，例如删除 4 行，原 20 行变为 16 行）
	{
		const bpUp = {
			file: "up.ts",
			line: 20,
			contextSnippet: {
				prev: "const cleaned = prepareInput();",
				current: "const result = calculate(cleaned);",
				next: "return result;",
				indent: 4,
				scopeAnchor: "compute",
			},
		};

		const linesUp = [];
		for (let i = 1; i <= 14; i++) {
			linesUp.push(`// Line ${i}`);
		}
		linesUp.push("function compute() {");
		linesUp.push("    const cleaned = prepareInput();"); // 第 16 行 (0-indexed 15)
		linesUp.push("    const result = calculate(cleaned);"); // 第 17 行 (0-indexed 16)
		linesUp.push("    return result;");
		linesUp.push("}");

		const res = resolveHealedLineInMemory(linesUp, bpUp);
		assert.strictEqual(res.healedLine, 17, "上方代码删除后断点应向上滑动自愈至第 17 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 12. 缩进 2 空格 ↔ 4 空格全局格式化与 Tab 互转弹性容错
	{
		const bpIndent = {
			file: "indent.ts",
			line: 5,
			contextSnippet: {
				prev: "function format() {",
				current: "  const a = 100;", // 2 空格缩进
				next: "  return a;",
				indent: 2,
				scopeAnchor: "format",
			},
		};

		// 格式化为 4 空格缩进，且中间插入一行注释
		const formattedLines = [
			"// Prettier reformatted",
			"function format() {",
			"    // notice",
			"    const a = 100;", // 4 空格缩进，漂移到第 4 行
			"    return a;",
			"}",
		];

		const res = resolveHealedLineInMemory(formattedLines, bpIndent);
		assert.strictEqual(res.healedLine, 4, "2 空格转 4 空格格式化后应正常命中并自愈至第 4 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 13. 同一函数内多处同名高频代码（3 处 return false 精准消歧）
	{
		const bpTargetSecond = {
			file: "check.ts",
			line: 7, // 原始断点在第 2 处 return false
			contextSnippet: {
				prev: "if (!user.isActive) {",
				current: "    return false;",
				next: "}",
				indent: 4,
				scopeAnchor: "validateUser",
			},
		};

		const disambiguateLines = [
			"function validateUser(user: User) {",
			"    if (!user) {",
			"        return false;", // 第 1 处 (第 3 行)
			"    }",
			"",
			"    // 插入一行新检查",
			"    console.log('validating active state...');",
			"",
			"    if (!user.isActive) {", // 第 9 行
			"        return false;", // 目标第 2 处！漂移到了第 10 行！
			"    }",
			"",
			"    if (user.isExpired) {",
			"        return false;", // 第 3 处 (第 14 行)
			"    }",
			"    return true;",
			"}",
		];

		const res = resolveHealedLineInMemory(disambiguateLines, bpTargetSecond);
		assert.strictEqual(res.healedLine, 10, "必须精准命中第 2 处 return false，绝不能误判到第 1 处或第 3 处");
		assert.strictEqual(res.isHealed, true);
	}

	// 14. 紧贴函数声明的首行代码漂移
	{
		const bpFirstStmt = {
			file: "first.ts",
			line: 2,
			contextSnippet: {
				prev: "export function handleRequest() {",
				current: "    const reqId = generateId();",
				next: "    validate(reqId);",
				indent: 4,
				scopeAnchor: "handleRequest",
			},
		};

		const linesFirst = [
			"export function handleRequest() {",
			"    // Added auth check at start",
			"    checkAuth();",
			"    const reqId = generateId();", // 漂移到第 4 行
			"    validate(reqId);",
			"}",
		];

		const res = resolveHealedLineInMemory(linesFirst, bpFirstStmt);
		assert.strictEqual(res.healedLine, 4, "函数首行语句偏移应准确自愈");
		assert.strictEqual(res.isHealed, true);
	}

	// 15. Python 语言缩进冒号体系与 if / with 穿透测试
	{
		const pyBp = {
			file: "service.py",
			line: 6,
			contextSnippet: {
				prev: "print(f'processing order {order.id}')",
				current: "if (order.amount <= 0):",
				next: "raise ValueError('invalid amount')",
				indent: 8,
				scopeAnchor: "handle_payment",
			},
		};

		const pyLines = [
			"class OrderProcessor:",
			"    def handle_payment(self, order):",
			"        # AI 在断点上方插入了参数检查与空行",
			"        print(f'processing order {order.id}')",
			"        # 空行",
			"        ",
			"        log_metric('payment_start')",
			"        ",
			"        if (order.amount <= 0):", // 漂移到第 9 行 (0-indexed 8)
			"            raise ValueError('invalid amount')",
		];

		const res = resolveHealedLineInMemory(pyLines, pyBp);
		assert.strictEqual(res.healedLine, 9, "Python 冒号结尾 if 语句断点应准确自愈至第 9 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 16. Go 语言 Receiver 方法与带有初始化语句的 if 控制流测试
	{
		const goBp = {
			file: "order.go",
			line: 4,
			contextSnippet: {
				prev: "log.Println('validating order')",
				current: "if err := s.validate(ctx, order); err != nil {",
				next: "return fmt.Errorf('validate failed: %w', err)",
				indent: 4,
				scopeAnchor: "ProcessOrder",
			},
		};

		const goLines = [
			"package service",
			"",
			"func (s *OrderService) ProcessOrder(ctx context.Context, order *Order) error {",
			"    // 插入前置日志与链路追踪",
			"    span := tracer.Start(ctx, 'ProcessOrder')",
			"    defer span.End()",
			"",
			"    log.Println('validating order')",
			"",
			"    if err := s.validate(ctx, order); err != nil {", // 漂移到第 10 行
			"        return fmt.Errorf('validate failed: %w', err)",
			"    }",
			"    return nil",
			"}",
		];

		const res = resolveHealedLineInMemory(goLines, goBp);
		assert.strictEqual(res.healedLine, 10, "Go 语言 Receiver 与复杂 if 语句断点应准确自愈至第 10 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 17. Rust 语言复杂生命周期/泛型签名与模式匹配 match 测试
	{
		const rustBp = {
			file: "processor.rs",
			line: 4,
			contextSnippet: {
				prev: "println!(\"dispatching task: {}\", task.id);",
				current: "TaskStatus::Pending => {",
				next: "process_pending(task).await?;",
				indent: 12,
				scopeAnchor: "execute_task",
			},
		};

		const rustLines = [
			"pub async fn execute_task<'a, T: TaskHandler>(task: &'a Task) -> Result<()> {",
			"    // 插入空行与前置检查",
			"    metric_counter!(\"task_executed\");",
			"",
			"    println!(\"dispatching task: {}\", task.id);",
			"    match task.status {",
			"        TaskStatus::Pending => {", // 漂移到第 7 行
			"            process_pending(task).await?;",
			"        }",
			"        _ => ()",
			"    }",
			"    Ok(())",
			"}",
		];

		const res = resolveHealedLineInMemory(rustLines, rustBp);
		assert.strictEqual(res.healedLine, 7, "Rust 泛型函数与 match 块内断点应准确自愈至第 7 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 18. Java / C# 强类型面向对象：泛型返回类型与类方法穿透
	{
		const javaBp = {
			file: "OrderController.java",
			line: 5,
			contextSnippet: {
				prev: "logger.info(\"payment requested\");",
				current: "if (dto.getAmount() <= 0) {",
				next: "throw new IllegalArgumentException(\"Amount must be positive\");",
				indent: 8,
				scopeAnchor: "handlePayment",
			},
		};

		const javaLines = [
			"public class OrderController {",
			"    public static CompletableFuture<Result<Order>> handlePayment(OrderDto dto) {",
			"        // 插入前置参数校验与空行",
			"        Objects.requireNonNull(dto);",
			"",
			"        logger.info(\"payment requested\");",
			"",
			"        if (dto.getAmount() <= 0) {", // 漂移到第 8 行
			"            throw new IllegalArgumentException(\"Amount must be positive\");",
			"        }",
			"        return CompletableFuture.completedFuture(Result.ok());",
			"    }",
			"}",
		];

		const res = resolveHealedLineInMemory(javaLines, javaBp);
		assert.strictEqual(res.healedLine, 8, "Java 泛型返回类型方法内断点应准确自愈至第 8 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 19. 前后双侧突变极端测试：AI 上下同时插入代码 (prev 与 next 均断裂，但当前行与几何缩进命中)
	{
		const doubleBp = {
			file: "mutate.ts",
			line: 10,
			contextSnippet: {
				prev: "const oldBefore = true;", // 被 AI 删掉或重写
				current: "const targetCore = executeCoreLogic();",
				next: "const oldAfter = true;", // 被 AI 删掉或重写
				indent: 4,
				scopeAnchor: "runPipeline",
			},
		};

		const mutateLines = [
			"function runPipeline() {",
			"    // 上下文全部被 AI 替换为全新代码",
			"    const newAuditLog = createAuditSession();",
			"    const span = startTracer();",
			"    ",
			"    const targetCore = executeCoreLogic();", // 漂移到第 6 行，前后两行与指纹完全不同！
			"    ",
			"    span.finish();",
			"    return newAuditLog;",
			"}",
		];

		const res = resolveHealedLineInMemory(mutateLines, doubleBp);
		assert.strictEqual(res.healedLine, 6, "即使前后伴随行双侧突变，凭借当前行精确匹配与几何作用域依然必须自愈成功");
		assert.strictEqual(res.isHealed, true);
	}

	// 20. 5 类断点元数据（条件、命中计数、日志、禁用态）往返保真测试
	{
		const complexBreakpoints = [
			{
				type: "condition",
				file: "calc.ts",
				line: 5,
				condition: "user.age >= 18",
				contextSnippet: { current: "processAdultUser();" },
			},
			{
				type: "hitCount",
				file: "calc.ts",
				line: 10,
				hitCondition: ">= 100",
				contextSnippet: { current: "logHighFrequencyAccess();" },
			},
			{
				type: "logpoint",
				file: "calc.ts",
				line: 15,
				logMessage: "User {user.name} logged in",
				contextSnippet: { current: "triggerLoginHook();" },
			},
			{
				type: "line",
				file: "calc.ts",
				line: 20,
				enabled: false,
				contextSnippet: { current: "optionalCleanup();" },
			},
		];

		const fileLines = [
			"// Line 1: Header",
			"// Line 2: Inserted comment",
			"// Line 3: Inserted comment",
			"processAdultUser();", // 原第 5 行 -> 现第 4 行
			"// spacer",
			"logHighFrequencyAccess();", // 原第 10 行 -> 现第 6 行
			"// spacer",
			"triggerLoginHook();", // 原第 15 行 -> 现第 8 行
			"// spacer",
			"optionalCleanup();", // 原第 20 行 -> 现第 10 行
		];

		for (const bp of complexBreakpoints) {
			const res = resolveHealedLineInMemory(fileLines, bp);
			assert.strictEqual(res.isHealed, true, `断点 ${bp.type} 必须成功自愈`);
			// 验证元数据属性未受任何篡改
			if (bp.type === "condition") assert.strictEqual(bp.condition, "user.age >= 18");
			if (bp.type === "hitCount") assert.strictEqual(bp.hitCondition, ">= 100");
			if (bp.type === "logpoint") assert.strictEqual(bp.logMessage, "User {user.name} logged in");
			if (bp.enabled !== undefined) assert.strictEqual(bp.enabled, false);
		}
	}

	// 21. 单文件 5 个断点并发批量下移自愈测试
	{
		const originalBps = [
			{ file: "batch.ts", line: 5, contextSnippet: { current: "const step1 = true;" } },
			{ file: "batch.ts", line: 10, contextSnippet: { current: "const step2 = true;" } },
			{ file: "batch.ts", line: 15, contextSnippet: { current: "const step3 = true;" } },
			{ file: "batch.ts", line: 20, contextSnippet: { current: "const step4 = true;" } },
			{ file: "batch.ts", line: 25, contextSnippet: { current: "const step5 = true;" } },
		];

		// 在文件头部插入 10 行注释，导致全部断点统一向下偏移 10 行
		const batchLines = [];
		for (let i = 1; i <= 10; i++) batchLines.push(`// Header note ${i}`);
		for (let i = 1; i <= 30; i++) {
			if (i === 5) batchLines.push("const step1 = true;");
			else if (i === 10) batchLines.push("const step2 = true;");
			else if (i === 15) batchLines.push("const step3 = true;");
			else if (i === 20) batchLines.push("const step4 = true;");
			else if (i === 25) batchLines.push("const step5 = true;");
			else batchLines.push(`const row${i} = ${i};`);
		}

		for (const bp of originalBps) {
			const res = resolveHealedLineInMemory(batchLines, bp);
			const expectedLine = bp.line + 10;
			assert.strictEqual(res.healedLine, expectedLine, `批量断点原行 ${bp.line} 应自愈至 ${expectedLine}`);
			assert.strictEqual(res.isHealed, true);
		}
	}

	// 22. AI 添加/删除行尾注释与分号微调容错
	{
		const bpTrailing = {
			file: "trailing.ts",
			line: 4,
			contextSnippet: {
				prev: "const user = getCurrentUser();",
				current: "const total = calculateTotal();", // 原来无尾部注释
				next: "return total;",
				indent: 4,
				scopeAnchor: "checkout",
			},
		};

		const trailingLines = [
			"function checkout() {",
			"    // 插入一行新逻辑",
			"    checkAuth();",
			"    const user = getCurrentUser();",
			"    const total = calculateTotal(); // added comments by AI", // 漂移到第 5 行，且带有行尾注释
			"    return total;",
			"}",
		];

		const res = resolveHealedLineInMemory(trailingLines, bpTrailing);
		assert.strictEqual(res.healedLine, 5, "带行尾注释的当前行微调应成功自愈至第 5 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 23. 单双引号与反引号字符串互换容错测试
	{
		const bpQuote = {
			file: "quote.ts",
			line: 3,
			contextSnippet: {
				prev: "const env = process.env.NODE_ENV;",
				current: "const mode = \"production\";", // 双引号
				next: "initApp(mode);",
				indent: 4,
				scopeAnchor: "bootstrap",
			},
		};

		const quoteLines = [
			"function bootstrap() {",
			"    // AI 把双引号改为了单引号，并插入了注释",
			"    const env = process.env.NODE_ENV;",
			"    const mode = 'production';", // 单引号，漂移到第 4 行
			"    initApp(mode);",
			"}",
		];

		const res = resolveHealedLineInMemory(quoteLines, bpQuote);
		assert.strictEqual(res.healedLine, 4, "单双引号互换微调应成功自愈至第 4 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 24. 同文件双胞胎完全相同循环体 (Twin Loops) 抗跳偏测试
	{
		// 目标断点在第 1 个循环的第 3 行
		const bpFirstLoop = {
			file: "twin.ts",
			line: 3,
			contextSnippet: {
				prev: "for (const item of items) {",
				current: "    processItem(item);",
				next: "}",
				indent: 4,
				scopeAnchor: "syncData",
			},
		};

		const twinLines = [
			"function syncData(items: Item[]) {",
			"    // 顶部插入新代码使第 1 个循环下移",
			"    preparePipeline();",
			"    for (const item of items) {",
			"        processItem(item);", // 目标位置！漂移到第 5 行
			"    }",
			"",
			"    // 下方存在一个结构完全一模一样的孪生循环",
			"    for (const item of items) {",
			"        processItem(item);", // 严禁跳偏到这个第 10 行的循环！
			"    }",
			"}",
		];

		const res = resolveHealedLineInMemory(twinLines, bpFirstLoop);
		assert.strictEqual(res.healedLine, 5, "必须命中第 1 个循环（第 5 行），严禁跳偏到第 2 个孪生循环");
		assert.strictEqual(res.isHealed, true);
	}

	// 25. 多行链式调用中间行断点测试 (Fluent API / Method Chaining)
	{
		const bpChain = {
			file: "chain.ts",
			line: 4, // 原断点在 .map 这一行
			contextSnippet: {
				prev: "    .filter(x => x.active)",
				current: "    .map(x => x.id)",
				next: "    .join(\",\");",
				indent: 4,
				scopeAnchor: "formatIds",
			},
		};

		const chainLines = [
			"function formatIds(users: User[]) {",
			"    // 插入前置过滤与空行",
			"    validate(users);",
			"",
			"    return users",
			"        .filter(x => x.active)",
			"        .map(x => x.id)", // 漂移到第 7 行
			"        .join(\",\");",
			"}",
		];

		const res = resolveHealedLineInMemory(chainLines, bpChain);
		assert.strictEqual(res.healedLine, 7, "多行链式调用中间行断点应准确自愈至第 7 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 26. 极端深层嵌套代码自愈测试 (16+ 空格缩进，4~5 层控制流嵌套)
	{
		const bpDeep = {
			file: "deep.ts",
			line: 6,
			contextSnippet: {
				prev: "if (cell.isValid) {",
				current: "    commitMatrixCell(cell);",
				next: "}",
				indent: 20,
				scopeAnchor: "renderComplexMatrix",
			},
		};

		const deepLines = [
			"function renderComplexMatrix(matrix: Matrix) {",
			"    // 插入 2 行代码",
			"    const version = 2;",
			"    initRenderer();",
			"    for (const row of matrix.rows) {",
			"        for (const cell of row.cells) {",
			"            if (cell.enabled) {",
			"                if (cell.isValid) {",
			"                    commitMatrixCell(cell);", // 漂移到第 9 行，缩进 20 空格
			"                }",
			"            }",
			"        }",
			"    }",
			"}",
		];

		const res = resolveHealedLineInMemory(deepLines, bpDeep);
		assert.strictEqual(res.healedLine, 9, "深层 20 空格缩进嵌套代码应稳定自愈至第 9 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 27. 跨越多行 JSDoc / 块注释穿透自愈测试
	{
		const bpDoc = {
			file: "doc.ts",
			line: 4,
			contextSnippet: {
				prev: "const config = load();",
				current: "const result = execute(config);",
				next: "return result;",
				indent: 4,
				scopeAnchor: "startWorker",
			},
		};

		const docLines = [
			"function startWorker() {",
			"    const config = load();",
			"    /**",
			"     * @description AI 插入的大面积多行块注释",
			"     * @example execute(config)",
			"     * @param {Config} config",
			"     */",
			"    const result = execute(config);", // 漂移到第 8 行，上方隔着多行注释
			"    return result;",
			"}",
		];

		const res = resolveHealedLineInMemory(docLines, bpDoc);
		assert.strictEqual(res.healedLine, 8, "穿透多行 JSDoc 注释块应准确自愈至第 8 行");
		assert.strictEqual(res.isHealed, true);
	}

	// 28. 全角标点、中文与 Emoji 字符自愈测试
	{
		const bpI18n = {
			file: "i18n.ts",
			line: 3,
			contextSnippet: {
				prev: "logger.info('Starting...');",
				current: "console.log(\"🎉 支付确认成功！【订单号】：\" + txId);",
				next: "return true;",
				indent: 4,
				scopeAnchor: "notifyUser",
			},
		};

		const i18nLines = [
			"function notifyUser(txId: string) {",
			"    // 插入新提示",
			"    console.log('Sending push notification...');",
			"    logger.info('Starting...');",
			"    console.log(\"🎉 支付确认成功！【订单号】：\" + txId);", // 漂移到第 5 行
			"    return true;",
			"}",
		];

		const res = resolveHealedLineInMemory(i18nLines, bpI18n);
		assert.strictEqual(res.healedLine, 5, "包含中文全角标点与 Emoji 的代码行应 100% 精确自愈至第 5 行");
		assert.strictEqual(res.isHealed, true);
		assert.strictEqual(res.status, "healed");
	}

	// 29. 破坏性重构或代码彻底删除时的脱靶（unmatched）判定
	{
		const bpDeleted = {
			file: "service.ts",
			line: 10,
			contextSnippet: {
				prev: "const a = 1;",
				current: "this.obsoleteMethodCall(a, b, c);",
				next: "return a + b;",
				indent: 4,
				scopeAnchor: "calculateSum",
			},
		};

		// 整个 calculateSum 方法已被彻底重写，旧语句无踪影
		const refactoredLines = [
			"function calculateSum(items: number[]) {",
			"    return items.reduce((acc, curr) => acc + curr, 0);",
			"}",
		];

		const res = resolveHealedLineInMemory(refactoredLines, bpDeleted);
		assert.strictEqual(res.status, "unmatched", "无法匹配的代码行必须标记为 unmatched 脱靶状态");
		assert.strictEqual(res.isHealed, false, "脱靶断点不得错误标记为 isHealed");
		assert.strictEqual(res.healedLine, 10, "脱靶断点必须平滑回退至原始记录行号");
	}

	// 30. 原行号未变动时的精确 matched 状态判定
	{
		const bpUnchanged = {
			file: "config.ts",
			line: 2,
			contextSnippet: {
				prev: "export const VERSION = '1.0';",
				current: "export const TIMEOUT = 5000;",
				next: "export const RETRY = 3;",
				indent: 0,
			},
		};

		const unchangedLines = [
			"export const VERSION = '1.0';",
			"export const TIMEOUT = 5000;",
			"export const RETRY = 3;",
		];

		const res = resolveHealedLineInMemory(unchangedLines, bpUnchanged);
		assert.strictEqual(res.status, "matched", "原行号吻合的代码行必须标记为 matched");
		assert.strictEqual(res.isHealed, false, "原行号吻合不得标记为 isHealed");
		assert.strictEqual(res.healedLine, 2);
	}

	// 31. 大跨度位移下移测试 (漂移 65 行，突破默认 ±30 行滑动窗口)
	{
		const bpLongDrift = {
			file: "billing.ts",
			line: 10,
			contextSnippet: {
				prev: "const tax = calculateTax(subtotal);",
				current: "const total = subtotal + tax;",
				next: "return finalizeInvoice(total);",
				indent: 4,
				scopeAnchor: "calculateBillingTotal",
			},
		};

		// 模拟休眠期团队在前方插入了 65 行全局工具与配置代码
		const longLines = [];
		for (let i = 1; i <= 65; i++) {
			longLines.push(`// Feature flag or config item ${i}`);
		}
		longLines.push("export function calculateBillingTotal(subtotal: number) {");
		longLines.push("    console.log('[Billing] calculating...');");
		longLines.push("    const tax = calculateTax(subtotal);");
		longLines.push("    const total = subtotal + tax;"); // 实际位于第 69 行 (前 65 行注释 + 4 行代码)
		longLines.push("    return finalizeInvoice(total);");
		longLines.push("}");

		const res = resolveHealedLineInMemory(longLines, bpLongDrift);
		assert.strictEqual(res.healedLine, 69, "大跨度漂移 (从第10行漂移至第69行) 必须由阶段二作用域巡航精准自愈至第 69 行");
		assert.strictEqual(res.isHealed, true);
		assert.strictEqual(res.status, "healed");
	}

	// 32. 大跨度位移上移测试 (向上缩回 80 行，突破默认 ±30 行滑动窗口)
	{
		const bpUpDrift = {
			file: "user.go",
			line: 95,
			contextSnippet: {
				prev: "log.Println(\"Authenticating user...\")",
				current: "if user.Token == \"\" {",
				next: "return ErrInvalidToken",
				indent: 4,
				scopeAnchor: "AuthenticateSession",
			},
		};

		// 模拟休眠期前方删除了 80 行废弃代码，函数上移至顶部
		const upLines = [
			"package auth",
			"",
			"func (s *AuthService) AuthenticateSession(user *User) error {",
			"    log.Println(\"Authenticating user...\")",
			"    if user.Token == \"\" {", // 实际在第 5 行 (从原 95 行上移 90 行)
			"        return ErrInvalidToken",
			"    }",
			"    return nil",
			"}",
		];

		const res = resolveHealedLineInMemory(upLines, bpUpDrift);
		assert.strictEqual(res.healedLine, 5, "大跨度向上缩回 (90行) 必须由阶段二作用域巡航精准自愈至第 5 行");
		assert.strictEqual(res.isHealed, true);
		assert.strictEqual(res.status, "healed");
	}

	// 33. 当前行本体守卫测试 (Target Existence Guard)：目标行被彻底删除，严禁依据邻近上下文误自愈
	{
		const bpDeleted = {
			file: "demo/healing-demo.py",
			line: 11,
			contextSnippet: {
				prev: "# AI 插入的货币与前置参数检查（测试控制流关键字防误判与行号漂移）",
				current: "if not order.get(\"id\"):",
				next: "raise ValueError(\"Order ID missing\")",
				scopeAnchor: "process_transaction",
				indent: 8,
			},
		};

		// 模拟用户将 if not order.get("id"): 和 raise ValueError(...) 彻底删除
		// 此时第 11 行递补为 currency = order.get("currency", "USD")
		const linesWithDeletedTarget = [
			"# Scene Breakpoints Python 语言自愈演示源码",
			"# 目标测试断点在第 9 行：if (order[\"amount\"] <= 0):",
			"",
			"class PaymentGateway:",
			"    def process_transaction(self, order: dict) -> dict:",
			"        print(f\"[Python] Received order: {order.get('id')}\")",
			"        print(f\"[Python] Customer: {order.get('customer')}\")",
			"",
			"",
			"        # AI 插入的货币与前置参数检查（测试控制流关键字防误判与行号漂移）",
			"        currency = order.get(\"currency\", \"USD\")",
			"        print(f\"[Python] Currency detected: {currency}\")",
			"",
			"        if (order[\"amount\"] <= 0):",
			"            raise ValueError(\"Payment amount must be greater than zero!\")",
			"",
			"        tx_id = f\"PY-TX-998\"",
			"        print(f\"[Python] Success! TxId: {tx_id}\")",
			"        return {\"status\": \"SUCCESS\", \"tx_id\": tx_id}",
		];

		const res = resolveHealedLineInMemory(linesWithDeletedTarget, bpDeleted);
		assert.strictEqual(res.status, "unmatched", "目标代码行被彻底删除后，绝对禁止误自愈到邻近的 currency 行，必须安全标记为 unmatched");
		assert.strictEqual(res.isHealed, false, "未匹配断点 isHealed 必须为 false");
		assert.strictEqual(res.healedLine, 11, "脱靶断点必须平滑回退至原行号 11");
	}

	// 34. 纯领域函数 extractContextSnippetFromLines 与 extractContextSnippet 纯行数组单测 (0 VS Code 依赖)
	{
		const sampleLines = [
			"export class OrderService {",
			"    // 初始化订单状态",
			"    async createOrder(params: CreateOrderDto) {",
			"",
			"        validateParams(params);",
			"        const order = await this.repo.save(params);", // 目标行 index = 5 (0-based)
			"",
			"        return order;",
			"    }",
			"}",
		];

		// 1. 使用 extractContextSnippetFromLines 直接传原生 string[]
		const snippet1 = extractContextSnippetFromLines(sampleLines, 5);
		assert.strictEqual(snippet1.current, "const order = await this.repo.save(params);");
		assert.strictEqual(snippet1.prev, "validateParams(params);", "必须穿透空行提取前序非空有效伴随行");
		assert.strictEqual(snippet1.next, "return order;", "必须穿透空行提取后序非空有效伴随行");
		assert.strictEqual(snippet1.indent, 8, "前导缩进应精确统计为 8 空格");
		assert.strictEqual(snippet1.scopeAnchor, "createOrder", "向上回溯必须精准抓取最近的函数作用域 createOrder");

		// 2. 使用 extractContextSnippet 鸭子对象重载验证等价性
		const duckDoc = {
			lineCount: sampleLines.length,
			lineAt: (i) => ({ text: sampleLines[i] }),
		};
		const snippet2 = extractContextSnippet(duckDoc, 5);
		assert.deepStrictEqual(snippet1, snippet2, "string[] 模式与鸭子对象模式输出的指纹必须 100% 绝对一致");

		// 3. 首行与末行边界防护测试
		const snippetFirst = extractContextSnippetFromLines(sampleLines, 0);
		assert.strictEqual(snippetFirst.prev, undefined, "首行前序伴随行必须安全为 undefined");
		assert.strictEqual(snippetFirst.current, "export class OrderService {");

		const snippetLast = extractContextSnippetFromLines(sampleLines, sampleLines.length - 1);
		assert.strictEqual(snippetLast.next, undefined, "末行后序伴随行必须安全为 undefined");
		assert.strictEqual(snippetLast.current, "}");
	}

	console.log("  ✅ [Healing] 自愈算法全维边界套件（34 大全场景极限测试套件，含纯领域行数组提取与大跨度突破）全部通过！");
}
