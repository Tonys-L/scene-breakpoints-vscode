import assert from "node:assert";
import {
	cleanLine,
	stripTrailingComment,
	calculateSimilarity,
} from "#src/shared/utils/stringSimilarity.ts";
import {
	countIndent,
	findPrevNonEmptyLine,
	findNextNonEmptyLine,
	findGeometricParent,
	extractScopeAnchor,
	findScopeAnchorLine,
} from "#src/shared/utils/textUtils.ts";
import {
	extractContextSnippetFromLines,
	extractContextSnippet,
	HealingEngine,
	calculateCandidateLineScore,
} from "#src/domain/services/healingEngine.ts";

export function resolveHealedLineInMemory(lines, item) {
	if (!item || !item.line) {
		return { healedLine: item?.line ?? 1, isHealed: false, status: "matched" };
	}
	return HealingEngine.heal(lines, item.line, item.contextSnippet);
}

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
	extractContextSnippetFromLines,
	extractContextSnippet,
};

export async function runHealingTests() {
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

	// 35. 【变异斩杀】healWithReader 专用异步端口异常与自愈测试
	{
		const engine = new HealingEngine();
		const sampleFp = { current: "const a = 1;", indent: 0 };

		// (1) reader 返回 null/undefined 时安全回退
		const nullReader = { readLines: async () => null };
		const nullRes = await engine.healWithReader(nullReader, "test.ts", 10, sampleFp);
		assert.strictEqual(nullRes.healedLine, 10);
		assert.strictEqual(nullRes.isHealed, false);
		assert.strictEqual(nullRes.status, "unmatched");

		// (2) reader 返回空数组 [] 时安全回退
		const emptyReader = { readLines: async () => [] };
		const emptyRes = await engine.healWithReader(emptyReader, "test.ts", 5, sampleFp);
		assert.strictEqual(emptyRes.healedLine, 5);
		assert.strictEqual(emptyRes.isHealed, false);
		assert.strictEqual(emptyRes.status, "unmatched");

		// (3) reader 正常读取并成功触发自愈
		const validReader = { readLines: async () => ["// header", "const a = 1;"] };
		const validRes = await engine.healWithReader(validReader, "test.ts", 1, sampleFp);
		assert.strictEqual(validRes.healedLine, 2);
		assert.strictEqual(validRes.isHealed, true);
		assert.strictEqual(validRes.status, "healed");
	}

	// 36. 【变异斩杀】原地吻合 (Fast Path / matched) 状态枚举与标志位强制断言
	{
		const lines = ["const x = 100;"];
		const fp = { current: "const x = 100;", indent: 0 };
		const res = HealingEngine.heal(lines, 1, fp);
		assert.strictEqual(res.healedLine, 1);
		assert.strictEqual(res.isHealed, false, "原地吻合时 isHealed 必须严格为 false");
		assert.strictEqual(res.status, "matched", "原地吻合时 status 必须严格为 'matched'");
		assert.strictEqual(res.confidence, 1.0, "原地吻合置信度必须严格为 1.0");
	}

	// 37. 【变异斩杀】作用域巡航 Phase 2 内部多候选打分与 Python 缩进边界
	{
		const pyLines = [
			"def process_data():",
			"    # step 1",
			"    x = prepare()",
			"    y = calculate()",
			"def next_func():", // 同层缩进，必须阻断巡航
			"    y = calculate()",
		];
		// 目标在 process_data 内部的 y = calculate()
		const pyFp = {
			current: "y = calculate()",
			scopeAnchor: "process_data",
			indent: 4,
		};
		// 从第 50 行（超出原文件）触发跨度重锚定
		const pyRes = HealingEngine.heal(pyLines, 50, pyFp);
		assert.strictEqual(pyRes.healedLine, 4, "必须精准落在 process_data 内，不得越界至 next_func");
		assert.strictEqual(pyRes.status, "healed");
		assert.strictEqual(pyRes.isHealed, true);
		assert.ok(pyRes.confidence > 0.5);

		// 验证更近距离惩罚生效：相同内容更近者胜出
		const multiLines = [
			"function testScope() {",
			"    const target = 1;", // line 2 (distance = 2 from line 4)
			"    // spacer",
			"    // spacer", // line 4
			"    const target = 1;", // line 5 (distance = 1 from line 4)
			"}",
		];
		const multiFp = { current: "const target = 1;", scopeAnchor: "testScope", indent: 4 };
		const multiRes = HealingEngine.heal(multiLines, 4, multiFp);
		assert.strictEqual(multiRes.healedLine, 5, "距离更近的候选行 (line 5) 必须在微惩罚下胜出");
		assert.strictEqual(multiRes.status, "healed");
		assert.strictEqual(multiRes.isHealed, true);
	}

	// 38. 【变异斩杀】阈值判定临界门槛 (12.5 分与 60% 置信度)
	{
		// 构造一个仅本体相同且无任何伴随信息的指纹 (maxPossibleScore = 10)
		// 此时最高得分为 10 分，confidenceRatio = 10/10 = 1.0 >= 0.6，即便得分 10 < 12.5，也因 ratio 达标而自愈
		const singleLineFile = ["// comment", "const lonely = true;"];
		const singleFp = { current: "const lonely = true;" }; // 只有 current
		const singleRes = HealingEngine.heal(singleLineFile, 1, singleFp);
		assert.strictEqual(singleRes.healedLine, 2);
		assert.strictEqual(singleRes.status, "healed");
		assert.strictEqual(singleRes.isHealed, true);

		// 构造一个完全不匹配本体的用例：hasDirectMatch = false，即使上下文有干扰也必须拒绝
		const noMatchLines = ["function test() {", "    const other = 2;", "}"];
		const noMatchFp = { current: "const totallyDifferent = 999;", scopeAnchor: "test", indent: 4 };
		const noMatchRes = HealingEngine.heal(noMatchLines, 2, noMatchFp);
		assert.strictEqual(noMatchRes.healedLine, 2);
		assert.strictEqual(noMatchRes.status, "unmatched");
		assert.strictEqual(noMatchRes.isHealed, false);
	}

	// 39. 【变异斩杀】非法参数全面防空兜底
	{
		const lines = ["console.log('hi');"];
		assert.deepStrictEqual(HealingEngine.heal(lines, 0), { healedLine: 1, isHealed: false, status: "matched" });
		assert.deepStrictEqual(HealingEngine.heal(lines, -5), { healedLine: -5, isHealed: false, status: "matched" });
		assert.deepStrictEqual(HealingEngine.heal(lines, NaN), { healedLine: 1, isHealed: false, status: "matched" });
		assert.deepStrictEqual(HealingEngine.heal(lines, "5"), { healedLine: "5", isHealed: false, status: "matched" });
		assert.deepStrictEqual(HealingEngine.heal(lines, {}), { healedLine: {}, isHealed: false, status: "matched" });
		assert.deepStrictEqual(HealingEngine.heal([], 1), { healedLine: 1, isHealed: false, status: "unmatched" });
		assert.deepStrictEqual(HealingEngine.heal(lines, 1, null), { healedLine: 1, isHealed: false, status: "matched" });
	}

	// 40. 【变异斩杀】calculateCandidateLineScore 维度加权与布尔门禁原子级狙杀
	{
		const testLines = [
			"function doWork() {", // 0
			"    // spacer comment", // 1
			"    const prevStmt = true;", // 2
			"    const targetStmt = 123; // trailing comment", // 3
			"    const nextStmt = false;", // 4
			"}", // 5
		];

		const dummyScope = () => "doWork";

		// (1) 精确匹配：score 基础分 10 分
		const exactRes = calculateCandidateLineScore(
			["const x = 1;"],
			0,
			{ targetCurrent: "const x = 1;" },
			dummyScope,
			0,
		);
		assert.strictEqual(exactRes.score, 10);
		assert.strictEqual(exactRes.hasDirectMatch, true);

		// (2) 行尾注释容错匹配：score 9 分，hasDirectMatch 必须为 true
		const commentRes = calculateCandidateLineScore(
			testLines,
			3,
			{ targetCurrent: "const targetStmt = 123; // old comment" },
			dummyScope,
			0,
		);
		assert.strictEqual(commentRes.score, 9);
		assert.strictEqual(commentRes.hasDirectMatch, true);

		// (2.1) 软相似度打分测试 (>= 0.70 触发 round(sim * 6) 且 hasDirectMatch=true)
		// 构造当前行微变：const targetStmt = 124; 与 const targetStmt = 123;
		const simHighRes = calculateCandidateLineScore(
			testLines,
			3,
			{
				targetCurrent: "const targetStmt = 124;",
				targetPrev: "const prevStmt = true;", // 贡献 5 分使 hasContextMatch 为 true
			},
			dummyScope,
			0,
		);
		// 伴随行 5 分 + 软相似度得分，且 hasDirectMatch 必须被激活
		assert.ok(simHighRes.score > 5);
		assert.strictEqual(simHighRes.hasDirectMatch, true, "软相似度 >= 0.70 且有上下文时必须激活 hasDirectMatch");

		// 相似度过低 (< 0.70) 绝不激活
		const simLowRes = calculateCandidateLineScore(
			testLines,
			3,
			{
				targetCurrent: "totallyDifferentFunc();",
				targetPrev: "const prevStmt = true;", // 贡献 5 分
			},
			dummyScope,
			0,
		);
		assert.strictEqual(simLowRes.score, 5);
		assert.strictEqual(simLowRes.hasDirectMatch, false, "相似度低于 0.70 严禁赋予 hasDirectMatch");

		// (3) 纯注释行打分（cleanLine 剔除注释后为空，安全得分为 0，杜绝纯注释伪自愈）
		const pureCommentRes = calculateCandidateLineScore(
			["// just comment"],
			0,
			{ targetCurrent: "// just comment" },
			dummyScope,
			0,
		);
		assert.strictEqual(pureCommentRes.score, 0);
		assert.strictEqual(pureCommentRes.hasDirectMatch, false);

		// (4) 伴随行拓扑与双侧夹逼门禁
		// 单侧 prev 匹配：有伴随但无 directMatch
		const singlePrevRes = calculateCandidateLineScore(
			testLines,
			3,
			{ targetCurrent: "nonexistent();", targetPrev: "const prevStmt = true;" },
			dummyScope,
			0,
		);
		assert.strictEqual(singlePrevRes.score, 5);
		assert.strictEqual(singlePrevRes.hasDirectMatch, false, "仅单侧前伴随匹配严禁赋予 hasDirectMatch");

		// 单侧 next 匹配：有伴随但无 directMatch
		const singleNextRes = calculateCandidateLineScore(
			testLines,
			3,
			{ targetCurrent: "nonexistent();", targetNext: "const nextStmt = false;" },
			dummyScope,
			0,
		);
		assert.strictEqual(singleNextRes.score, 5);
		assert.strictEqual(singleNextRes.hasDirectMatch, false, "仅单侧后伴随匹配严禁赋予 hasDirectMatch");

		// 双侧伴随闭环（夹逼定理）：prev && next 均匹配，必须激活 hasDirectMatch！
		const doubleContextRes = calculateCandidateLineScore(
			testLines,
			3,
			{
				targetCurrent: "nonexistent();",
				targetPrev: "const prevStmt = true;",
				targetNext: "const nextStmt = false;",
			},
			dummyScope,
			0,
		);
		assert.strictEqual(doubleContextRes.score, 10);
		assert.strictEqual(doubleContextRes.hasDirectMatch, true, "双侧拓扑夹逼成功必须激活 hasDirectMatch");

		// (5) 缩进打分：完全相等 +3，两倍或半倍 +2，不匹配 +0
		const indentExact = calculateCandidateLineScore(
			testLines,
			3,
			{ targetCurrent: "const targetStmt = 123; // old comment", targetIndent: 4 },
			dummyScope,
			0,
		);
		assert.strictEqual(indentExact.score, 9 + 3); // 9(注释容错) + 3(缩进吻合)

		const indentDouble = calculateCandidateLineScore(
			testLines,
			3,
			{ targetCurrent: "const targetStmt = 123; // old comment", targetIndent: 2 },
			dummyScope,
			0,
		);
		assert.strictEqual(indentDouble.score, 9 + 2); // 4 与 2 倍数关系，+2

		const indentHalf = calculateCandidateLineScore(
			testLines,
			3,
			{ targetCurrent: "const targetStmt = 123; // old comment", targetIndent: 8 },
			dummyScope,
			0,
		);
		assert.strictEqual(indentHalf.score, 9 + 2); // 4 与 8 半倍关系，+2

		const indentMismatch = calculateCandidateLineScore(
			testLines,
			3,
			{ targetCurrent: "const targetStmt = 123; // old comment", targetIndent: 3 },
			dummyScope,
			0,
		);
		assert.strictEqual(indentMismatch.score, 9 + 0); // 4 与 3 无倍数关系，+0

		// (6) 作用域打分加成门槛（基础分必须 >= 5 才能加 5 分）
		const scopeLowScore = calculateCandidateLineScore(
			testLines,
			3,
			{ targetCurrent: "nonexistent();", targetScope: "doWork", targetIndent: 3 }, // 只有缩进 0 分
			dummyScope,
			0,
		);
		assert.strictEqual(scopeLowScore.score, 0, "基础分低于 5 分时严禁叠加作用域 5 分加成");

		const scopeHighScore = calculateCandidateLineScore(
			testLines,
			3,
			{
				targetCurrent: "nonexistent();",
				targetPrev: "const prevStmt = true;", // 贡献 5 分基础分
				targetScope: "doWork",
			},
			dummyScope,
			0,
		);
		assert.strictEqual(scopeHighScore.score, 5 + 5, "基础分达标 5 分时必须叠加作用域 5 分加成");

		// (6.1) 作用域名称不匹配时严禁加分 (斩杀 candidateScope && true 变异体)
		const scopeMismatch = calculateCandidateLineScore(
			testLines,
			3,
			{
				targetCurrent: "nonexistent();",
				targetPrev: "const prevStmt = true;", // 贡献 5 分基础分
				targetScope: "otherDifferentScope",   // 作用域不匹配
			},
			() => "someUnrelatedFunction",
			0,
		);
		assert.strictEqual(scopeMismatch.score, 5, "作用域名称不匹配时严禁叠加 5 分");

		// (6.2) candidateScope 为 undefined，仅凭 candParent.includes 成功加 5 分 (斩杀 false 变异体)
		const parentMatchLines = [
			"export class OrderManager {", // 0 (candParent 包含 'OrderManager')
			"    // spacer",               // 1
			"    const targetInClass = 1;",// 2
			"}",
		];
		const parentRes = calculateCandidateLineScore(
			parentMatchLines,
			2,
			{
				targetCurrent: "const targetInClass = 1;", // 基础分 10 分 >= 5
				targetScope: "OrderManager",
				targetIndent: 4,                          // 提供缩进基准以正确向上探测几何父结构
			},
			() => undefined, // candidateScope 返回 undefined，强制走 candParent 路径
			0,
		);
		assert.strictEqual(parentRes.score, 10 + 3 + 5, "仅凭 candParent 包含 targetScope 必须成功叠加 5 分");

		// (7) 距离惩罚计算
		const penaltyRes = calculateCandidateLineScore(
			["const a = 1;"],
			0,
			{ targetCurrent: "const a = 1;" },
			dummyScope,
			0.75,
		);
		assert.strictEqual(penaltyRes.score, 10 - 0.75, "距离惩罚必须从总分中严格扣减");
	}

	// 41. 【变异斩杀】HealingEngine 实例参数与快路径覆盖
	{
		const customEngine = new HealingEngine(0.75, 15, 80);
		assert.strictEqual(customEngine.confidenceThreshold, 0.75);
		assert.strictEqual(customEngine.searchWindow, 15);
		assert.strictEqual(customEngine.scopeBodyWindow, 80);

		// 原地命中快路径：验证 confidence 严格为 1.0，isHealed 严格为 false
		const fastPathRes = customEngine.heal(["const x = 1;"], 1, { current: "const x = 1;" });
		assert.strictEqual(fastPathRes.healedLine, 1);
		assert.strictEqual(fastPathRes.status, "matched");
		assert.strictEqual(fastPathRes.isHealed, false);
		assert.strictEqual(fastPathRes.confidence, 1.0);
	}

	// 42. 【变异斩杀】滑动窗口 searchWindow 边界值严格阻断测试
	{
		// 构造一个在 offset = 30 行处与 offset = 31 行处的对比
		const windowLines = [];
		for (let i = 1; i <= 70; i++) {
			windowLines.push(`// spacer line ${i}`);
		}
		// 原始断点在第 20 行，目标行移到了第 50 行（偏移量恰好 +30）
		windowLines[49] = "const targetAt30 = true;";
		const fp = { current: "const targetAt30 = true;" };

		const engine30 = new HealingEngine(0.6, 30);
		const resHit30 = engine30.heal(windowLines, 20, fp);
		assert.strictEqual(resHit30.healedLine, 50, "偏移量恰好等于 searchWindow 30 时应成功探测命中");
		assert.strictEqual(resHit30.isHealed, true);

		// 目标行移到了第 51 行（偏移量 +31，超出窗口 30）且无 scopeAnchor
		windowLines[49] = "// spacer line 50";
		windowLines[50] = "const targetAt30 = true;";
		const resMiss31 = engine30.heal(windowLines, 20, fp);
		assert.strictEqual(resMiss31.status, "unmatched", "超出 searchWindow 且无作用域锚点时必须判定为 unmatched");
		assert.strictEqual(resMiss31.healedLine, 20);
	}

	// 43. 【变异斩杀】Phase 2 作用域巡航 Python 缩进退出与顶格注释穿透全路径狙杀
	{
		const pyCode = [
			"def main_task():", // 0
			"    # 顶格放置的大面积注释块，不得误阻断", // 1
			"    # line 2", // 2
			"# 甚至无缩进的全局/顶格注释，也必须跳过不能终止作用域！", // 3
			"    target_call()", // 4
			"def next_task():", // 5 (同级缩进，必须终止)
			"    target_call()", // 6 (这里绝不能跳过来)
		];

		const pyFp = {
			current: "target_call()",
			scopeAnchor: "main_task",
			indent: 4,
		};

		// 原始断点在 100 行（迫使 Phase 1 扫描不到，进入 Phase 2）
		const pyHealed = HealingEngine.heal(pyCode, 100, pyFp);
		assert.strictEqual(pyHealed.healedLine, 5, "必须穿透顶格注释并在第 5 行命中，严禁受注释干扰或越界至 next_task");
		assert.strictEqual(pyHealed.isHealed, true);

		// 如果函数签名不是 Python 风格（无冒号），不会按缩进 break
		const nonPyCode = [
			"function jsTask() {",
			"    let a = 1;",
			"    target_stmt();",
			"}",
		];
		const nonPyFp = { current: "target_stmt();", scopeAnchor: "jsTask", indent: 4 };
		const nonPyRes = HealingEngine.heal(nonPyCode, 50, nonPyFp);
		assert.strictEqual(nonPyRes.healedLine, 3);
	}

	// 44. 【变异斩杀】Phase 2 多候选两侧距离惩罚测试 (绝对斩杀 Math.abs(i - origIdx) 变异为 i + origIdx)
	{
		const scopeLines = [
			"function runner() {", // 0 (line 1)
			"    // spacer", // 1 (line 2)
			"    calc();", // 2 (line 3, 候选 A: i = 2, 与原行 5 的减法距离为 2, 加法距离为 6)
			"    // spacer", // 3 (line 4)
			"    // orig bp line 5", // 4 (line 5: origIdx = 4)
			"    calc();", // 5 (line 6, 候选 B: i = 5, 与原行 5 的减法距离为 1, 加法距离为 9)
			"}",
		];
		const runnerFp = { current: "calc();", scopeAnchor: "runner", indent: 4 };
		// searchWindow=0 迫使直达 Phase 2 距离计算，原断点在第 5 行 (origIdx = 4)
		const engine = new HealingEngine(0.6, 0, 50);
		const runnerRes = engine.heal(scopeLines, 5, runnerFp);
		// 真实减法距离：候选 B 距离 1 < 候选 A 距离 2，因此候选 B (第 6 行) 胜出！
		// 变异加法距离：候选 A 距离 6 < 候选 B 距离 9，变异体会错误选择候选 A (第 3 行)！
		assert.strictEqual(runnerRes.healedLine, 6, "必须由距离最近的候选 B (第 6 行) 胜出，严禁因加法变异误判至第 3 行");
		assert.strictEqual(runnerRes.status, "healed");
	}

	// 45. 【变异斩杀】Fingerprint 非法对象容错
	{
		const lines = ["const valid = 1;"];
		// 当前行为空字符串的无效指纹
		assert.strictEqual(HealingEngine.heal(lines, 1, { current: "" }).status, "matched");
		// 纯空对象
		assert.strictEqual(HealingEngine.heal(lines, 1, {}).status, "matched");
	}

	// 46. 【变异斩杀】Phase 2 判定门槛单极独立达标与双否拒绝
	{
		// (1) 独立达标 A：score >= 12.5 但 ratio < threshold (通过将阈值调高至 0.95 迫使 ratio 不达标)
		const scopeLinesA = [
			"function calculateSum() {", // 0
			"    // spacer", // 1
			"    const result = computeTotal();", // 2 (line 3)
			"}",
		];
		// fp 包含 scope 与 indent，得分为 10(精确) + 3(缩进) = 13 分 >= 12.5 分
		// maxPossibleScore = 10 + 5(prev) + 5(next) + 3(indent) = 23 分，ratio = 13/23 = 0.565 < 0.95
		const fpA = {
			current: "const result = computeTotal();",
			targetPrev: "nonexistentPrev",
			targetNext: "nonexistentNext",
			scopeAnchor: "calculateSum",
			indent: 4,
		};
		const engineHighThreshold = new HealingEngine(0.95, 0, 50); // searchWindow=0 迫使直达 Phase 2
		const resA = engineHighThreshold.heal(scopeLinesA, 10, fpA);
		assert.strictEqual(resA.healedLine, 3, "Phase 2 即使 ratio 未达 0.95，凭 score >= 12.5 必须独立自愈成功");
		assert.strictEqual(resA.isHealed, true);
		assert.strictEqual(resA.status, "healed");

		// (2) 独立达标 B：score < 12.5 但 ratio >= threshold (仅有 current，maxScore=10，得分 10 < 12.5 但 ratio=1.0)
		const scopeLinesB = [
			"function runSingle() {",
			"    const targetOnly = true;", // line 2
			"}",
		];
		const fpB = {
			current: "const targetOnly = true;",
			scopeAnchor: "runSingle",
		};
		const engineB = new HealingEngine(0.60, 0, 50); // searchWindow=0 迫使直达 Phase 2
		const resB = engineB.heal(scopeLinesB, 10, fpB);
		assert.strictEqual(resB.healedLine, 2, "Phase 2 即使 score < 12.5，凭 ratio 1.0 >= 0.6 必须独立自愈成功");
		assert.strictEqual(resB.isHealed, true);
		assert.strictEqual(resB.status, "healed");

		// (3) 双否拒绝：score < 12.5 且 ratio < 0.60，严格判定为 unmatched
		const fpC = {
			current: "totallyDifferent();",
			scopeAnchor: "runSingle",
		};
		const resC = engineB.heal(scopeLinesB, 10, fpC);
		assert.strictEqual(resC.status, "unmatched", "Phase 2 分数与置信度双不达标时严禁自愈，必须标记为 unmatched");
		assert.strictEqual(resC.isHealed, false);
		assert.strictEqual(resC.healedLine, 10);
	}

	// 47. 【变异斩杀】Phase 2 原地吻合 status: 'matched' 与 isHealed: false 严密断言
	{
		const inPlaceLines = [
			"function worker() {",
			"    const sameLine = 1; // updated comment", // line 2 (带注释，避开 FastPath 精确匹配)
			"}",
		];
		const inPlaceFp = {
			current: "const sameLine = 1; // old comment",
			scopeAnchor: "worker",
			indent: 4,
		};
		// searchWindow=0 迫使跳过 Phase 1 直达 Phase 2，目标行正好就是第 2 行
		const zeroEngine = new HealingEngine(0.6, 0, 50);
		const inPlaceRes = zeroEngine.heal(inPlaceLines, 2, inPlaceFp);
		assert.strictEqual(inPlaceRes.healedLine, 2);
		assert.strictEqual(inPlaceRes.isHealed, false, "Phase 2 原地吻合时 isHealed 必须严格为 false");
		assert.strictEqual(inPlaceRes.status, "matched", "Phase 2 原地吻合时 status 必须严格为 'matched'，不得为空或 healed");
	}

	// 48. 【变异斩杀】Phase 2 假候选干扰拦截与首选稳定性
	{
		const fakeLines = [
			"function guardDemo() {",
			"    const prevStmt = 1;", // 1 (line 2)
			"    const fakeStmt = 999;", // 2 (line 3, 上下文匹配但本体不匹配，贡献 10 分)
			"    const nextStmt = 2;", // 3 (line 4)
			"    const realStmt = 42;", // 4 (line 5, 真实本体，无伴随，贡献 10 分但距离更远)
			"}",
		];
		const fakeFp = {
			current: "const realStmt = 42;",
			prev: "const prevStmt = 1;",
			next: "const nextStmt = 2;",
			scopeAnchor: "guardDemo",
		};
		// searchWindow=0 迫使直达 Phase 2
		const guardEngine = new HealingEngine(0.6, 0, 50);
		const guardRes = guardEngine.heal(fakeLines, 10, fakeFp);
		assert.strictEqual(guardRes.healedLine, 5, "严禁将上下文高分但本体不符的伪候选误认为最佳匹配");
		assert.strictEqual(guardRes.status, "healed");

		// 首选稳定性（相同分数不被 >= 覆盖）
		const twinLines = [
			"function twinDemo() {",
			"    const same = 1;", // line 2
			"    const same = 1;", // line 3
			"}",
		];
		const twinFp = { current: "const same = 1;", scopeAnchor: "twinDemo", indent: 4 };
		const twinRes = guardEngine.heal(twinLines, 2, twinFp);
		assert.strictEqual(twinRes.healedLine, 2, "相同打分下优先保持首个候选");
	}

	// 49. 【变异斩杀】Phase 2 Python 顶格注释穿透与缩进边界极限压测
	{
		const pyIndents = [
			"def root_job():", // line 1 (indent 0)
			"# 纯顶格单字符井号注释", // line 2
			"#", // line 3 (极简单字符)
			"    # 缩进井号注释", // line 4
			"    valid_line()", // line 5
			"def sibling_job():", // line 6 (indent 0 <= headerIndent 0, 必须阻断)
			"    valid_line()", // line 7
		];
		const pyFp = { current: "valid_line()", scopeAnchor: "root_job", indent: 4 };
		const pyEngine = new HealingEngine(0.6, 0, 50);
		const pyRes = pyEngine.heal(pyIndents, 50, pyFp);
		assert.strictEqual(pyRes.healedLine, 5, "必须穿透各类单字符与缩进注释，且在 sibling_job 处阻断");
		assert.strictEqual(pyRes.isHealed, true);
	}

	// 50. 【变异斩杀】阶段一 (Phase 1) score >= 12.5 单极达标独立自愈与除法精度
	{
		const p1Lines = [
			"// Line 1: Header",
			"const lonelyCore = 42;", // 原在第 2 行，现在下移到了第 3 行 (offset = +1)
			"const footer = true;",
		];
		const p1Fp = {
			current: "const lonelyCore = 42;",
			prev: "nonexistentPrev",
			next: "nonexistentNext",
			indent: 0,
		};
		const p1Engine = new HealingEngine(0.90, 30, 0); // threshold = 0.90 迫使 ratio 不达标
		const p1Res = p1Engine.heal(p1Lines, 1, p1Fp);
		assert.strictEqual(p1Res.healedLine, 2, "阶段一在 ratio 未达标时凭借 score >= 12.5 必须独立自愈成功");
		assert.strictEqual(p1Res.isHealed, true);
		assert.strictEqual(p1Res.status, "healed");

		// 验证阶段一除法 confidenceRatio = bestScore / maxPossibleScore (斩杀乘法变异)
		const singleLineFile = ["// comment", "const onlyStatement = 1;"];
		const singleEngine = new HealingEngine(0.60, 30, 0);
		// 原断点在第 1 行，目标在第 2 行 (offset = 1, distance = 1, penalty = 0.05, score = 10 - 0.05 = 9.95 < 12.5)
		// maxPossibleScore = 10, confidence = 9.95 / 10 = 0.995 >= 0.60
		const singleRes = singleEngine.heal(singleLineFile, 1, { current: "const onlyStatement = 1;" });
		assert.strictEqual(singleRes.healedLine, 2);
		assert.ok(Math.abs(singleRes.confidence - 0.995) < 1e-6, "阶段一置信度必须严格由除法得出，绝不能变为乘法 (99.5)");
	}

	// 51. 【变异斩杀】阶段二末行边界 searchEnd 触达 (斩杀 i <= searchEnd 变异为 < 的变异体)
	{
		const endLines = [
			"function lastScope() {",
			"    // spacer 1",
			"    // spacer 2",
			"    const veryLastLine = 999;", // 正好是数组末行 (index = 3, lines.length - 1)
		];
		const endFp = { current: "const veryLastLine = 999;", scopeAnchor: "lastScope", indent: 4 };
		// 原始断点在第 50 行，迫使 Phase 1 扫描不到，直达 Phase 2 巡航
		const endRes = HealingEngine.heal(endLines, 50, endFp);
		assert.strictEqual(endRes.healedLine, 4, "阶段二必须触达并命中数组末行 (lines.length - 1)");
		assert.strictEqual(endRes.isHealed, true);
	}

	// 52. 【变异斩杀】Python 同级缩进阻断与高分候选竞争 (真实代码伴随行斩杀所有 Python 作用域变异体)
	{
		const pyTwinLines = [
			"def first_action():", // 0 (line 1, headerIndent = 0)
			"    run_action()", // 1 (line 2, 本函数内的低分候选，仅 current 匹配，得分 13)
			"def second_action():", // 2 (line 3, 同级函数 headerIndent = 0，必须阻断巡航！)
			"    const prevA = 1;", // 3 (line 4)
			"    run_action()", // 4 (line 5, 带有完整代码伴随行的高分候选，得分 23)
			"    const nextA = 1;", // 5 (line 6)
		];
		const pyTwinFp = {
			current: "run_action()",
			prev: "const prevA = 1;",
			next: "const nextA = 1;",
			scopeAnchor: "first_action",
			indent: 4,
		};
		// 从第 100 行发起自愈，迫使进入 Phase 2
		const pyTwinRes = HealingEngine.heal(pyTwinLines, 100, pyTwinFp);
		// 若任何 Python 阻断逻辑变异（endsWith, countIndent <=, trimmed startsWith 等），
		// 巡航将越界扫描到第 5 行，并被其 23 分的高分覆盖导致错误返回第 5 行！
		// 正确逻辑必须严格在第 3 行阻断，并锁定 first_action 内的第 2 行！
		assert.strictEqual(pyTwinRes.healedLine, 2, "必须被 first_action 作用域边界严格截断，绝对禁止越界命中 second_action 内的高分候选");
		assert.strictEqual(pyTwinRes.isHealed, true);
	}

	// 53. 【变异斩杀】阶段一首选稳定性与阶段二除法精度
	{
		// (1) 阶段一首选稳定性 (斩杀 score >= bestScore 变异体)
		const p1TwinLines = [
			"const dupe = 1;", // line 1 (offset = -1 from bp line 2)
			"// orig line 2",  // line 2
			"const dupe = 1;", // line 3 (offset = +1 from bp line 2)
		];
		// offsets 顺序为 +1, -1；因此先探测到 line 3 (offset +1)，后探测到 line 1 (offset -1)
		// 两者距离惩罚相同且得分相同，必须优先保留先探测到的 line 3
		const p1TwinRes = HealingEngine.heal(p1TwinLines, 2, { current: "const dupe = 1;" });
		assert.strictEqual(p1TwinRes.healedLine, 3, "阶段一相同得分必须保留先探测到的候选，阻断 >= 覆盖");

		// (2) 阶段二除法精度验证 (斩杀 p2BestScore * maxPossibleScore 乘法变异体)
		const p2DivLines = [
			"function divDemo() {",
			"    const divTarget = 1;", // line 2 (offset = 0 from header line 1, distance = 48 from line 50)
			"}",
		];
		// distance = 48, penalty = 0.48, score = 10(当前行) + 5(作用域) - 0.48 = 14.52
		// maxPossibleScore = 10 + 5 = 15, confidence = 14.52 / 15 = 0.968
		const p2DivEngine = new HealingEngine(0.60, 0, 50);
		const p2DivRes = p2DivEngine.heal(p2DivLines, 50, { current: "const divTarget = 1;", scopeAnchor: "divDemo" });
		assert.ok(Math.abs(p2DivRes.confidence - 0.968) < 1e-4, "阶段二置信度必须严格由除法得出，绝不能变为乘法 (217.8)");
	}

	// 54. 【变异斩杀】全维权重分母累加精度 (斩杀 targetPrev, targetNext, targetIndent 维度的 += 与 -= 变异体)
	{
		const fullLines = [
			"function fullScope() {",
			"    const p = 1;", // line 2
			"    const c = 2;", // line 3 (目标行，offset = 1)
			"    const n = 3;", // line 4
			"}",
		];
		// 构造五维全满指纹：10 + 5(prev) + 5(next) + 5(scope) + 3(indent) = 28 分
		const fullFp = {
			current: "const c = 2;",
			prev: "const p = 1;",
			next: "const n = 3;",
			scopeAnchor: "fullScope",
			indent: 4,
		};
		// 原断点在第 2 行，目标在第 3 行 (offset = 1, distance = 1, penalty = 0.05)
		// 得分 = 10 + 5 + 5 + 5 + 3 - 0.05 = 27.95
		// 置信度 = 27.95 / 28 = 0.9982142857
		const fullEngine = new HealingEngine(0.60, 30, 50);
		const fullRes = fullEngine.heal(fullLines, 2, fullFp);
		assert.strictEqual(fullRes.healedLine, 3);
		// 一旦任何一个维度的分母累加被篡改（如 -= 或被跳过），分母将变为 18/23/25，计算值严重偏离！
		assert.ok(Math.abs(fullRes.confidence - 27.95 / 28) < 1e-5, "五维置信度分母必须为严格满分 28，杜绝任何权重累加篡改");
	}

	// 55. 【变异斩杀】首行探测阻断与第 1 行命中 (斩杀 i <= 0 与 i < 0 变异体)
	{
		const lineOneFile = [
			"const headerTarget = 123;", // line 1 (目标行)
			"// orig bp line 2",        // line 2 (原断点)
			"const otherLine = 456;",
		];
		// 原断点在第 2 行，offset = -1 时 i = 1 - 1 = 0 (即第 1 行)
		// 若变异为 i <= 0 continue，将错误跳过第 1 行导致无法命中！
		const lineOneEngine = new HealingEngine(0.60, 30, 0);
		const lineOneRes = lineOneEngine.heal(lineOneFile, 2, { current: "const headerTarget = 123;" });
		assert.strictEqual(lineOneRes.healedLine, 1, "必须精确探测并自愈至文件第 1 行 (i = 0)，绝不能被 i <= 0 错误跳过");
		assert.strictEqual(lineOneRes.isHealed, true);
	}

	// 56. 【变异斩杀】Phase 2 scopeBodyWindow 严格截断 (斩杀 Math.min 变异为 Math.max)
	{
		// 构造一个 120 行的大文件，函数头在第 1 行，scopeBodyWindow 设为 30
		const bigFile = ["function longTask() {"];
		for (let i = 1; i <= 100; i++) {
			bigFile.push(`    const spacer${i} = ${i};`);
		}
		// 目标代码放在第 80 行（远超出 scopeBodyWindow = 30）
		bigFile[79] = "    const deepTarget = 'secret';";
		bigFile.push("}");

		const bigFp = { current: "const deepTarget = 'secret';", scopeAnchor: "longTask", indent: 4 };
		// 设定 scopeBodyWindow = 30，searchWindow = 0
		const windowEngine = new HealingEngine(0.60, 0, 30);
		const bigRes = windowEngine.heal(bigFile, 200, bigFp);
		// Math.min(bigFile.length - 1, 0 + 30) = 30，只能扫描到第 31 行，第 80 行绝不可被扫描到！
		// 若变异为 Math.max(102, 30) = 102，就会错误扫描到第 80 行！
		assert.strictEqual(bigRes.status, "unmatched", "超出 scopeBodyWindow 的深层候选严禁扫描，必须安全返回 unmatched");
		assert.strictEqual(bigRes.isHealed, false);
	}

	// 57. 【变异斩杀】FastPath 越界防御与单行文件双侧窗口越界安全 (斩杀 origIdx < lines.length 与 i 越界判定变异体)
	{
		const tinyFile = ["const soloLine = 1;"]; // lines.length = 1

		// (1) targetLine 恰好等于 lines.length + 1 (origIdx = 1 === lines.length)
		// 若变异为 origIdx <= lines.length，它会访问 lines[1] (undefined)
		// 若目标指纹当前行为 "" (空)，cleanLine(undefined) === "" 就会误判 FastPath 命中！
		const overflowTargetRes = HealingEngine.heal(tinyFile, 2, { current: "" });
		assert.strictEqual(overflowTargetRes.status, "matched");
		// 严禁赋予 confidence = 1.0 (因为没有命中 FastPath)
		assert.strictEqual(overflowTargetRes.confidence, undefined, "行号超出文件末尾时严禁被误判为 FastPath 吻合");

		// (2) targetLine = 0 严格断言
		const zeroLineRes = HealingEngine.heal(tinyFile, 0);
		assert.strictEqual(zeroLineRes.healedLine, 1);
		assert.strictEqual(zeroLineRes.status, "matched");

		// (3) 单行文件中 offset = +1 与 -1 的双侧安全阻断 (斩杀 i < 0 与 i >= lines.length 变异体)
		const missRes = HealingEngine.heal(tinyFile, 1, { current: "totallyNonexistent();" });
		assert.strictEqual(missRes.status, "unmatched");
		assert.strictEqual(missRes.isHealed, false);
		assert.strictEqual(missRes.healedLine, 1);
	}

	// 58. 【变异斩杀】Python 作用域行尾冒号空格容错与同级/反缩进 break 阻断 (斩杀 trim().endsWith(":") 与 break 变异体)
	{
		const pyCode = [
			"def calculate_total():   ", // line 1 (以冒号加空格结尾，必须被 trim().endsWith(':') 识别)
			"    item = fetch_item()",
			"    target_sum = 100",      // line 3 (函数内部正确候选)
			"print('done')",             // line 4 (函数外部反缩进，必须被 countIndent <= headerIndent 触发 break!)
			"target_sum = 100",          // line 5 (若未 break 则可能扫描到的同名代码)
		];
		// 设定 searchWindow = 0 强制走 Phase 2 作用域巡航
		const pyEngine = new HealingEngine(0.60, 0, 50);
		const pyRes = pyEngine.heal(pyCode, 10, { current: "target_sum = 100", scopeAnchor: "calculate_total" });
		assert.strictEqual(pyRes.healedLine, 3, "Python 作用域遇外层反缩进必须立即 break 截断，锁定函数体内目标行");
		assert.strictEqual(pyRes.isHealed, true);
		assert.strictEqual(pyRes.status, "healed");
	}

	// 59. 【变异斩杀】Phase 2 命中 targetLine 时 isHealed 与 status 严格区分 (斩杀 isHealed = true 与 status 变异体)
	{
		// 构造原行 line 2 因软相似度避开 FastPath，但被 Phase 2 作用域巡航命中的场景
		const sameLineCode = [
			"function runTask() {",  // line 1 (scope anchor)
			"    a b cdefg",         // line 2 (targetLine = 2)
			"    const next = 1;",   // line 3
			"}",
		];
		const sameFp = {
			current: "a b cccxx", // 与 line 2 相似度恰好为 0.70
			prev: "function runTask() {",
			scopeAnchor: "runTask",
		};
		// 设定 searchWindow = 0 强制 Phase 2
		const sameEngine = new HealingEngine(0.60, 0, 50);
		const sameRes = sameEngine.heal(sameLineCode, 2, sameFp);
		assert.strictEqual(sameRes.healedLine, 2);
		assert.strictEqual(sameRes.isHealed, false, "Phase 2 命中 targetLine 时 isHealed 必须严格为 false");
		assert.strictEqual(sameRes.status, "matched", "Phase 2 命中 targetLine 且 isHealed 为 false 时，status 必须为 matched");
	}

	// 60. 【变异斩杀】Phase 2 候选对抗与先到先得 (斩杀 hasDirectMatch || score > p2BestScore 与 score >= p2BestScore 变异体)
	{
		// (1) 伪候选（无直接本体匹配，但上下文得分高）对抗真候选
		const fakeVersusReal = [
			"function execBlock() {",
			"    const prevMarker = 1;",
			"    completelyFakeLine();", // line 3 (伪候选：具有匹配的上下文，但本体完全不匹配)
			"    const nextMarker = 2;",
			"    actualTargetCode();",   // line 5 (真候选：本体精确匹配)
			"}",
		];
		const fakeVsRealEngine = new HealingEngine(0.60, 0, 50);
		const resFake = fakeVsRealEngine.heal(fakeVersusReal, 20, {
			current: "actualTargetCode();",
			prev: "const prevMarker = 1;",
			next: "const nextMarker = 2;",
			scopeAnchor: "execBlock",
		});
		assert.strictEqual(resFake.healedLine, 5, "严禁将无直接本体匹配证据的伪候选判定为最佳候选");
		assert.strictEqual(resFake.isHealed, true);

		// (2) 对称距离严格同分双候选先到先得 (斩杀 score >= p2BestScore)
		const tieCandidates = [
			"function runBatch() {",   // line 1 (idx 0)
			"    sameInstruction();",   // line 2 (idx 1, distance = 1)
			"    // center line 3",     // line 3 (idx 2, targetLine = 3)
			"    sameInstruction();",   // line 4 (idx 3, distance = 1)
			"}",
		];
		// 设定 searchWindow = 0 强制 Phase 2
		const tieEngine = new HealingEngine(0.60, 0, 50);
		const tieRes = tieEngine.heal(tieCandidates, 3, {
			current: "sameInstruction();",
			scopeAnchor: "runBatch",
		});
		assert.strictEqual(tieRes.healedLine, 2, "对称距离同分候选出现时必须严格保留首个命中的候选 (保持 > 比较，杜绝 >= 覆盖)");
	}

	// 61. 【变异斩杀】软相似度 sim >= 0.70 精确数学边界 (斩杀 sim > 0.70 变异体)
	{
		const linesSim = [
			"const header = 0;",
			"    a b cdefg", // line 2 (lineText = "a b cdefg")
			"const footer = 0;",
		];
		// "a b cdefg" 与 "a b cccxx" 的 Jaccard 相似度严格等于 0.7000000000000001 (>= 0.70 为 true, > 0.70 极易失效)
		const candScoreResult = calculateCandidateLineScore(
			linesSim,
			1,
			{
				targetCurrent: "a b cccxx",
				targetPrev: "const header = 0;",
			},
			() => undefined,
			0,
		);
		assert.strictEqual(candScoreResult.hasDirectMatch, true, "相似度达到 0.70 门槛时必须赋予 hasDirectMatch = true");
		assert.strictEqual(candScoreResult.score, 9, "匹配伴随行 5 分 + 相似度 0.70 换算 4 分 = 9 分");
	}

	// 62. 【变异斩杀】几何缩进深度成倍加分验证 (覆盖 candIndent === targetIndent * 2 与 targetIndent === candIndent * 2)
	{
		const indentLines = [
			"    twoIndentLine();",     // line 1 (4 spaces = indent 4)
			"  halfIndentLine();",      // line 2 (2 spaces = indent 2)
		];
		// (1) candIndent (4) === targetIndent (2) * 2
		const doubleIndentScore = calculateCandidateLineScore(
			indentLines,
			0,
			{ targetCurrent: "twoIndentLine();", targetIndent: 2 },
			() => undefined,
			0,
		);
		// 当前行 10 分 + 缩进加倍 2 分 = 12 分
		assert.strictEqual(doubleIndentScore.score, 12, "候选行缩进恰好为目标 2 倍时应加 2 分");

		// (2) targetIndent (4) === candIndent (2) * 2
		const halfIndentScore = calculateCandidateLineScore(
			indentLines,
			1,
			{ targetCurrent: "halfIndentLine();", targetIndent: 4 },
			() => undefined,
			0,
		);
		// 当前行 10 分 + 缩进减半 2 分 = 12 分
		assert.strictEqual(halfIndentScore.score, 12, "候选行缩进恰好为目标一半时应加 2 分");
	}

	// 63. 【变异斩杀】Phase 1 步进范围全覆盖与双侧极值
	{
		const searchFile = [
			"const line0 = 0;",
			"const line1 = 1;",
			"const line2 = 2;",
			"const line3 = 3;",
		];
		// targetLine 为 2 (origIdx = 1), 目标在 line 3 (i = 2, step = 1, offset = +1)
		const stepOneEngine = new HealingEngine(0.60, 1, 0);
		const stepOneRes = stepOneEngine.heal(searchFile, 2, { current: "const line2 = 2;" });
		assert.strictEqual(stepOneRes.healedLine, 3);
		assert.strictEqual(stepOneRes.isHealed, true);
	}

	// 64. 【变异斩杀】extractContextSnippet 鸭子对象与边界越界判定 (斩杀 Array.isArray 变异与 i <= lineCount 变异体)
	{
		let callCount = 0;
		const mockDoc = {
			lineCount: 3,
			lineAt(line) {
				callCount++;
				if (line < 0 || line >= 3) {
					throw new RangeError("line index out of range: " + line);
				}
				const texts = ["import * as os from 'os';", "const port = 8080;", "export default port;"];
				return { text: texts[line] };
			},
		};
		// (1) 传入鸭子对象提取第 2 行 (0-based 1)
		const snippet = extractContextSnippet(mockDoc, 1);
		assert.strictEqual(snippet.current, "const port = 8080;");
		assert.strictEqual(snippet.prev, "import * as os from 'os';");
		assert.strictEqual(callCount, 3, "必须严格按 i < docOrLines.lineCount 读取 3 行，杜绝 i <= 越界读取");

		// (2) 传入纯文本数组提取：必须走 Array.isArray 快路径
		const arrSnippet = extractContextSnippet(["const alpha = 1;", "const beta = 2;"], 0);
		assert.strictEqual(arrSnippet.current, "const alpha = 1;");
	}

	// 65. 【变异斩杀】伴随行不匹配时严格阻断加分 (斩杀 candPrev === targetPrev 与 candNext === targetNext 变异为 true)
	{
		const diffLines = [
			"const actualPrev = 1;",
			"targetLineContent();", // line 2 (idx 1)
			"const actualNext = 2;",
		];
		// 目标指纹声明了不同的 prev 和 next
		const mismatchScore = calculateCandidateLineScore(
			diffLines,
			1,
			{
				targetCurrent: "targetLineContent();",
				targetPrev: "totallyDifferentPrev();",
				targetNext: "totallyDifferentNext();",
			},
			() => undefined,
			0,
		);
		// 仅命中当前行精确匹配 10 分，伴随行不匹配绝不可加分
		assert.strictEqual(mismatchScore.score, 10, "伴随行不匹配时严禁赋予 5 分加权");
	}

	console.log("  ✅ [Healing] 自愈算法全维边界套件（含 Stryker 变异斩杀边界）全部通过！");
}

if (process.argv[1]?.endsWith("healing_engine.test.mjs")) {
	runHealingTests();
}
