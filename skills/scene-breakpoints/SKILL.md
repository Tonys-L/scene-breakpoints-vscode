---
name: scene-breakpoints
description: Orchestrate and declare breakpoint scenes in .vscode/debug-scenes.json for debugging workflows, bug diagnosis, call chain tracing, and code reading tours.
---

# Skill: scene-breakpoints

## 何时使用

当用户在对话中表达以下意图或提出类似需求时，必须使用此 Skill：

1. **Bug 排查与异常诊断**：
   - “帮我调试下这个报错 / 异常 / 崩溃”
   - “这个接口返回的数据不对，帮我排查原因并在关键代码打好断点”
   - “分析调用栈，帮我在可疑路径上设置断点”
2. **源码研读与业务导览（Code Tour）**：
   - “带我看下这个项目的登录/结算核心执行流程”
   - “我刚接手这个新模块，帮我梳理一条从入口到数据库的代码执行主干”
   - “顺着调用链路帮我布置一套导览断点”
3. **复杂条件与边缘分支探测**：
   - “这个循环执行了成千上万次，只在满足特定条件时帮我停下（条件断点）”
   - “在不打断程序运行的前提下，实时打印某个变量的变化日志（日志断点 Logpoint）”
   - “只有在处理超过特定次数时才触发拦截（命中计数断点 Hit Count）”
4. **断点分组整理与场景隔离**：
   - “我现在要开始查另一个模块的 Bug，帮我把当前这组断点存为场景”
   - “为某个独立功能（如支付流程、鉴权流程）建立专属断点场景”
5. **明确指令触发**：
   - 用户提到“生成场景断点”、“配置 debug-scenes”、“切换断点场景”等直接指令时

## 文件路径

工作区根目录：`.vscode/debug-scenes.json`

## 数据格式与断点类型规范

> ⚠️ **核心语法硬规则：条件断点的 type 必须是 `"condition"`，绝对严禁写成 `"conditional"`！**  
> ❌ 错误：`{ "type": "conditional", "condition": "x > 5" }` → 条件表达式会被底层静默丢失，退化为普通断点  
> ✅ 正确：`{ "type": "condition", "condition": "x > 5" }`

### 断点类型矩阵

| type 类型 | 关键属性 | 语法示例 | 说明 |
| :--- | :--- | :--- | :--- |
| `line` | `file`, `line` | `{ "type": "line", "file": "src/app.ts", "line": 10 }` | 普通物理行断点 |
| `condition` | `file`, `line`, `condition` | `{ "type": "condition", "condition": "retryCount > 3" }` | 条件断点（计算为 true 时暂停） |
| `hitCount` | `file`, `line`, `hitCondition` | `{ "type": "hitCount", "hitCondition": ">10" }` | 命中频次断点（如 `">5"`, `"%2==0"`） |
| `logpoint` | `file`, `line`, `logMessage` | `{ "type": "logpoint", "logMessage": "用户登录: {user.name}" }` | 日志断点（控制台输出，不暂停） |
| `function` | `functionName` | `{ "type": "function", "functionName": "verifyPassword" }` | 跨文件函数入口拦截断点 |

### 通用可观测性增强：变量监视锚点 (Watch Anchors · v1.5.0)

任何类型的断点（`line`、`condition`、`hitCount` 等）均可附带以下可选监视属性：

| 可选属性 | 类型 | 语法示例 | 说明 |
| :--- | :--- | :--- | :--- |
| `watch` | `string[]` | `"watch": ["user.id", "order.status"]` | 断点命中时，插件通过 DAP 自动只读求值这些变量（免手动输入 Watch 窗口） |
| `expected` | `object` | `"expected": { "order.status": "PAID" }` | 键值对照期望值。命中时插件自动比对并高亮结果（✅ 匹配、❌ Mismatch） |

- **AI 制图指引**：当排查“某个状态值为什么不对”或“期望返回值是否符合预期”时，**优先声明 `watch` 与 `expected`**。人类在断点暂停时无需手动往 Watch 面板敲变量，侧边栏与悬浮卡片中一览无余。

### 断点物理行选定铁律（避坑必读 ⚠️）

> ❌ **严禁打在纯函数声明/签名行**：例如 `function foo(...) {`、`export async function bar(...) {` 或 `const baz = (...) => {`。  
> **底层原因**：在 V8 虚拟机和 DAP（Debug Adapter Protocol）协议中，纯函数声明行本身没有可执行字节码指令（Opcode）。若将断点打在声明行，极易导致调试器发生**断点漂移（自动弹跳到内部）**或直接沦为**灰色空心圆（Unverified Breakpoint 无法验证）**，导致调试滑过而不触发暂停！  
> ✅ **必须打在函数体内部的第一条真实可执行语句上**：例如函数内部第一行的 `const x = ...`、`if (...)` 或具体方法调用。

### 断点说明（desc）编写指引 (Writer 质量规范)

`desc` 是场景地图给人类开发者和未来 AI 消费的核心语义契约，**必须填写“业务验证意图与假设”，严禁写物理位置或代码废话**：

| 评价维度 | ❌ 低质量 / 负面范例 (反模式) | ✅ 高质量 / 推荐范例 (业务意图) | 质量价值说明 |
| :--- | :--- | :--- | :--- |
| **物理位置罗列** | `"第 45 行"`、`"第 2 步"` | `"检查 user 实体是否为 null，防未登录穿透"` | 告诉读者“停在这里要看什么” |
| **代码语法复述** | `"if 判断"`、`"try catch"` | `"排查重试计数超过上限后的降级补偿分支"` | 说明分支背后的业务逻辑与异常场景 |
| **函数名字面** | `"调用 verifyPassword"` | `"观察前端明文与数据库加盐哈希的比对结果"` | 阐明输入输出与期望核验点 |
| **模糊无意图** | `"打个断点看看"`、`"临时测试"` | `"验证 Token 载荷中的 role 是否包含 admin 权限"` | 明确断点命中时的排查假设 |

> 💡 **关键分支显式化**：涉及特定异常值、循环边缘或偶发 Bug 排查时，优先采用 `type: "condition"` 显式声明触发条件表达式（如 `"condition": "order.amount < 0"`），让代码逻辑在地图中一眼即明。

## 模块地图（Scene Composition / 场景组合）

当目标调试链路横跨多个模块时，**不要平铺重复断点**——先画模块地图，再组合引用。

### 三步生成法

1. **识别通用链路**：认证、数据库连接、消息队列、日志等基础设施代码，
   沉入底层场景（命名惯例 `xxx-core`）：

    ```json
    "auth-core": [
      { "type": "line", "file": "src/auth.ts", "line": 12, "desc": "token 校验入口" },
      { "type": "line", "file": "src/session.ts", "line": 45, "desc": "会话续期" }
    ]
    ```

2. **业务场景组合引用**：业务调试场景用 `{"type":"scene"}` 引用通用链路，
   只补充业务特有断点：

    ```json
    "payment-debug": [
      { "type": "scene", "name": "auth-core", "desc": "支付前必过认证" },
      { "type": "line", "file": "src/payment.ts", "line": 40, "desc": "下单入口" },
      { "type": "condition", "file": "src/payment.ts", "line": 88,
        "condition": "amount > 1000", "desc": "大额支付风控" }
    ]
    ```

3. **声明顺序 = 执行顺序**：引用与断点穿插排列，激活时按声明位置深度优先展开，
   时序 100% 保真。

### 引用硬规则（违反将导致激活失败或降级）

- 被引用场景必须**先在本文件中声明**（同文件内按 name 解析，不支持跨文件引用）
- **禁止自引用与任何形式的环**：A→B→A 会在激活时报错并显示完整环路径
- 引用条目可 `"enabled": false` 临时摘除整棵子场景（不删配置）
- 引用悬空（name 不存在）→ 激活时警告并跳过，其余断点正常下发

### 收益

- 通用链路断点只维护一处，改一处全场景生效
- AI 生成配置省 Token 60%+（一行引用替代 N 行断点）
- 激活时自动按模块去重（先到先得）

## 场景消费工作流：读图五步法 (Scene Breakpoints Reader)

当用户提出**代码研读、流程梳理或 Bug 根因分析**时，AI Agent 必须优先遵循“读图五步法”，按图索骥精准定位，严禁一开始就盲目全盘扫描代码库：

1. **【第一步：前置廉价探测 (Existence Probe)】**：
   - 检查工作区是否存在 `.vscode/debug-scenes.json`（或 `.vscode/debug-scenes.local.json`）；
   - 若文件不存在或当前问题与执行流程完全无关，立即静默放弃，杜绝无意义的 Token 开销与过度触发。
2. **【第二步：场景语义匹配 (Relevance Match)】**：
   - 读取配置中的 `scenes` 字典键名与各断点的 `desc` 说明；
   - 快速比对用户诉求是否命中已有业务场景（如 `auth:login`、`order:create` 或 `arch:*` 架构场景）。
3. **【第三步：递归展开子场景 (Expand References)】**：
   - 若命中场景包含 `{ "type": "scene", "name": "..." }`，递归展开子场景引用，拼接出完整的时序调用链路，厘清模块间依赖关系。
4. **【第四步：精准行级跳读 (Precise Navigation)】**：
   - **以最低 Token 消耗建立代码空间感**：仅针对场景中标记的 3~5 个关键节点（`file` + `line` 附近 10~20 行）进行定点定向读取；
   - 彻底省去全文 Grep 和几十个无关文件的茫茫扫读，Token 消耗直降 70%+。
5. **【第五步：场景拓扑清单化回答 (Topology Presentation)】**：
   - **以场景组织回答，而非以生硬代码组织回答**：向用户汇报排查或研读结果时，优先列出结构化的关键步骤清单：
     - *“已顺着架构场景为您梳理出 4 个核心步骤：① 参数校验 (src/auth.ts:45) → ② 权限比对 (src/rbac.ts:80) → ③ 业务执行 (src/order.ts:120) → ④ 事务提交 (src/dao.ts:60)”*；
     - 提示用户需要深入探索或调试哪一步骤。

### 协作闭环 (Human-in-the-Loop)
- **场景缺失时**：若发现当前业务流程在 `debug-scenes.json` 中尚属空白，AI **主动向用户建议**：*“检测到该链路尚未沉淀为场景地图，是否为您在 `.vscode/debug-scenes.json` 中绘制并固化此流程断点？”*；
- **用户确认后**：获得用户明确确认后再转入【场景生成 (Writer)】工作流，严禁擅自胡乱写盘。

## 场景生成工作流：规范制图与沉淀 (Scene Breakpoints Writer)

当用户明确要求生成断点、或在排查/新功能开发收尾确认后，AI 执行标准的制图沉淀：

1. **链路静态分析**：分析核心主干（入口 → 校验 → 核心业务分支 → 存盘/返回）；
2. **物理行号定位**：严格执行【断点物理行选定铁律】，落在**函数内部首条真实可执行语句**，严禁打在纯签名声明行；
3. **意图标注撰写**：每个断点必须撰写清晰的 `desc` 业务意图，杜绝物理描述；
4. **写入场景配置**：
   - 根据场景性质选择目标文件（团队资产写主文件，临时测试写 local 层）；
   - ⚠️ **严格禁止手动填写指纹**：切勿添加 `contextSnippet` 字段，保持缺省以触发插件首次激活时的自动化拓扑提取与持久化；
5. **场景激活策略**：根据环境通过 `launch.json` 联动、`activeScenes` 声明式激活或引导用户在调试面板 ▶ 激活。

## 配置分层与调用栈固化 (v1.2.0)

### 团队/个人双层配置（写哪个文件？）

| 场景性质 | 目标文件 | 说明 |
| :--- | :--- | :--- |
| **团队公共资产**（`feat:*` / `arch:*` 等长期沉淀、Code Tour 导览） | `.vscode/debug-scenes.json` | 入 Git，全队共享，**默认选择** |
| **个人临时现场**（一次性 crash 复现、私有排查草稿） | `.vscode/debug-scenes.local.json` | 自动入 `.gitignore`，不污染仓库 |

- 同名场景 **local 覆盖 team**（合并视图）；`activeScenes` 与 `bindings` 无论场景在哪个文件，**一律写在主文件**；
- 【平台写入护栏】对 local 文件同样生效，兜底流程相同；
- 两种格式的断点条目语法完全一致。

### 调用栈一键固化（Capture Call Stack，IDE 侧能力）

调试器**暂停**时，用户可在编辑器右键菜单或命令面板执行 **"Save Current Call Stack as Scene"**，插件自动将当前线程堆栈帧（过滤工作区源码帧、按 file+line 去重、携带上下文指纹）固化为 **local 层**新场景。

- **AI 协同话术**：命中断点后可提示用户"右键 → 固化调用栈为场景"，零手工录入；
- 固化产物出现在 `debug-scenes.local.json`，AI 可随后读取该场景：补全 `desc` 观察意图、或将其转正（复制到主文件）沉淀为团队资产。

## 画布与 Mermaid 导出协同 (AI 须知)

- ⚠️ **只读防幻觉铁律**：全景画布、节点脉冲与命中轨迹均为运行时只读前端呈现，AI **无需且无法**在 JSON 配置中寻找或写入任何画布与轨迹字段；
- **Mermaid 文本联动**：若需生成 PR 拓扑或链路排查报告，可引导用户执行 `Scene: Export Scene Graph as Mermaid`，将剪贴板中的 `flowchart TD` 文本粘贴给 AI 直接解读；
- **排查协同指引**：调试暂停时，可提示用户查看副侧边栏常驻画布中的脉冲高亮节点与执行轨迹。


## 平台护栏：写入被拒时的兜底 (Platform Write Guard)

部分 AI IDE（如 Trae）的 Agent 工具层会默认保护 `.vscode/` 目录下的配置文件，直接写入可能被拒绝（`Access denied ... restricted to user edits`）——**这是平台权限限制，与插件无关**。遇到时按以下顺序兜底：

1. **改写临时文件**：将完整场景 JSON 输出到工程外的临时文件（如系统 Temp 目录），提示用户手动复制覆盖 `.vscode/debug-scenes.json`；
2. **提示用户解除保护**：引导用户在 IDE 设置（如 Trae → Permission & Approval → Custom Configuration）中将该文件加入 AI 可编辑白名单；
3. **降级为指令输出**：将待写入的场景 JSON 完整输出在回复正文中，由用户复制粘贴。

⚠️ 无论何种兜底，严禁因此跳过【断点物理行选定铁律】与【严禁手动填写指纹】约束。

## 场景激活的三种途径（AI 协同策略）

生成断点场景后，AI 可根据工作区环境选择以下三种途径让断点生效：

### 途径 1：`launch.json` 自动联动绑定（推荐，体验最丝滑 ⭐⭐⭐）
- **适用场景**：工作区中已存在 `.vscode/launch.json`，用户习惯按 **F5** 启动调试。
- **操作方式**：检查 `launch.json`，获取启动项配置名称（如 `"Launch Program"`），在 `debug-scenes.json` 的 `bindings` 中配置映射：
  ```json
  "bindings": {
    "Launch Program": ["payment-flow"]
  }
  ```
- **核心优势**：**完全无需额外配置权限**！用户一按 F5，插件在调试器启动瞬间全自动加载对应场景断点并清理杂散断点，开箱即用。

### 途径 2：声明式即时自动激活（AI 静默打点 ⭐⭐）
- **适用场景**：AI 刚生成完场景，希望用户一保存文件，编辑器中的代码行就能立刻看到打上的红点。
- **操作方式**：在 `debug-scenes.json` 根级写入 `"activeScenes": ["payment-flow"]`。
- **前置前提**：插件设有安全防误触守卫，需确保工作区 `.vscode/settings.json` 中开启了权限：
  ```json
  {
    "sceneBreakpoints.allowAiFileActivation": true
  }
  ```
  *(AI 可在首次为用户初始化断点时，顺手在 settings.json 中配置此项)*。

### 途径 3：侧边栏视觉手动切换（通用兜底 ⭐）
- **适用场景**：用户习惯在界面上点选，或工作区未配置自动激活权限时。
- **引导话术**：告知用户“已为您生成场景 `payment-flow`，您可以在 VS Code 左侧【运行与调试】面板展开【Scene Breakpoints】，点击该场景后面的 **▶（激活）** 按钮即可生效”。

---

## 完整示例

用户请求：“帮我排查支付链路中大额订单密码比对与风控失败的问题”

AI 静态分析代码后写入 `.vscode/debug-scenes.json`（展示了场景组合与各类断点高质量意图描述）：

```json
{
  "$schema": "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
  "bindings": {
    "Launch App": ["payment-flow"]
  },
  "activeScenes": ["payment-flow"],
  "scenes": {
    "auth-core": [
      {
        "type": "line",
        "file": "src/auth.ts",
        "line": 45,
        "enabled": true,
        "desc": "检查 Token 解密后 user 实体合法性，防未登录穿透"
      },
      {
        "type": "function",
        "functionName": "verifyPassword",
        "desc": "拦截密码校验函数入口，观察明文与数据库哈希比对结果"
      }
    ],
    "payment-flow": [
      {
        "type": "scene",
        "name": "auth-core",
        "desc": "步骤 1: 支付前置身份鉴权与密码安全验证"
      },
      {
        "type": "line",
        "file": "src/payment.ts",
        "line": 40,
        "desc": "步骤 2: 订单入参解析与幂等性 Key 校验"
      },
      {
        "type": "condition",
        "file": "src/payment.ts",
        "line": 88,
        "condition": "amount > 1000",
        "desc": "步骤 3: 触发大额支付风控与二次安全审核分支",
        "watch": ["order.userId", "order.riskScore", "order.status"],
        "expected": {
          "order.status": "PENDING_REVIEW"
        }
      },
      {
        "type": "hitCount",
        "file": "src/payment.ts",
        "line": 120,
        "hitCondition": ">3",
        "desc": "步骤 4: 仅在扣款重试达到第 4 次及以上时暂停排查超时"
      },
      {
        "type": "logpoint",
        "file": "src/notify.ts",
        "line": 32,
        "logMessage": "支付完成，订单号: {order.id}, 状态: {order.status}",
        "desc": "步骤 5: 控制台非侵入式打印支付成功通知日志"
      }
    ]
  }
}
```

保存文件后，断点已准备就绪；若配置了联动绑定，用户按 **F5** 即刻进入调试排查心流。
