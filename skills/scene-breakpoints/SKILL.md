---
name: scene-breakpoints
description: Orchestrate and declare breakpoint scenes in .vscode/debug-scenes.json for debugging workflows and code reading
---

# Skill: scene-breakpoints

## 何时使用

- 用户提出“调试某功能”、“排查某报错”、“分析调用栈”时
- 用户提出“帮我看下这个项目的执行流程”时
- 用户明确提出“为 xx 功能建立断点场景”时

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

### 断点说明（desc）编写指引

`desc` 应当填写该断点的“观察意图”，而非代码物理位置描述：
- ✅ **好的示例**："检查 user 实体是否为 null"、"观察 retryCount 是否超限"、"验证 Token 解密后角色权限"
- ❌ **坏的示例**："第 45 行"、"if 语句"、"函数入口"

## 操作流程

1. **读取配置**：先读取 `.vscode/debug-scenes.json`，检查是否已有可复用场景。
2. **分析链路**：静态分析用户关注的业务函数入口、关键判断条件分支、循环体与错误抛出点。
3. **写入断点**：
   - 将新场景命名（如 `auth-login-flow`），写入 `scenes["auth-login-flow"]` 数组；
   - 断点只需提供 `type`、`file`、`line` 以及表达观察意图的 `desc`；
   - ⚠️ **自愈指纹 `contextSnippet` 留空无需填写**：插件会在激活并保存时自动从实际源码提取并闭环补齐；
   - 断点尽量按执行先后顺序排列。
4. **激活场景**：将根级 `"activeScenes": ["auth-login-flow"]` 设置为目标场景名并保存文件。
5. **引导调试**：告知用户断点已就绪，提示用户按 **F5** 启动调试直接命中现场。

## 场景激活的三种途径（AI 协同策略）

生成断点场景后，AI 可根据工作区环境选择以下三种途径让断点生效：

### 途径 1：`launch.json` 自动联动绑定（推荐，体验最丝滑 ⭐⭐⭐）
- **适用场景**：工作区中已存在 `.vscode/launch.json`，用户习惯按 **F5** 启动调试。
- **操作方式**：检查 `launch.json`，获取启动项配置名称（如 `"Launch Program"`），在 `debug-scenes.json` 的 `bindings` 中配置映射：
  ```json
  "bindings": {
    "Launch Program": ["auth-login-flow"]
  }
  ```
- **核心优势**：**完全无需额外配置权限**！用户一按 F5，插件在调试器启动瞬间全自动加载对应场景断点并清理杂散断点，开箱即用。

### 途径 2：声明式即时自动激活（AI 静默打点 ⭐⭐）
- **适用场景**：AI 刚生成完场景，希望用户一保存文件，编辑器中的代码行就能立刻看到打上的红点。
- **操作方式**：在 `debug-scenes.json` 根级写入 `"activeScenes": ["auth-login-flow"]`。
- **前置前提**：插件设有安全防误触守卫，需确保工作区 `.vscode/settings.json` 中开启了权限：
  ```json
  {
    "sceneBreakpoints.allowAiFileActivation": true
  }
  ```
  *(AI 可在首次为用户初始化断点时，顺手在 settings.json 中配置此项)*。

### 途径 3：侧边栏视觉手动切换（通用兜底 ⭐）
- **适用场景**：用户习惯在界面上点选，或工作区未配置自动激活权限时。
- **引导话术**：告知用户“已为您生成场景 `auth-login-flow`，您可以在 VS Code 左侧【运行与调试】面板展开【Scene Breakpoints】，点击该场景后面的 **▶（激活）** 按钮即可生效”。

---

## 完整示例

用户请求：“帮我排查登录时密码校验失败的问题”

AI 静态分析代码后写入 `.vscode/debug-scenes.json`：

```json
{
  "$schema": "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
  "bindings": {
    "Launch App": ["login-debug"]
  },
  "activeScenes": ["login-debug"],
  "scenes": {
    "login-debug": [
      {
        "type": "line",
        "file": "src/auth.ts",
        "line": 45,
        "enabled": true,
        "desc": "检查 user 实体是否为 null"
      },
      {
        "type": "condition",
        "file": "src/auth.ts",
        "line": 52,
        "condition": "retryCount > 3",
        "desc": "观察重试超限分支"
      },
      {
        "type": "logpoint",
        "file": "src/token.ts",
        "line": 88,
        "logMessage": "Token 生成成功, payload: {payload.sub}",
        "desc": "观测生成 Token 载荷"
      }
    ]
  }
}
```

保存文件后，断点已准备就绪；若配置了联动绑定，用户按 **F5** 即刻进入调试排查心流。
