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

## 完整示例

用户请求：“帮我排查登录时密码校验失败的问题”

AI 静态分析代码后写入 `.vscode/debug-scenes.json`：

```json
{
  "$schema": "https://raw.githubusercontent.com/Tonys-L/scene-breakpoints-vscode/main/schema.json",
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

保存文件后，插件响应式捕获变更，自动卸载历史旧断点，精准点亮 `login-debug` 场景断点，用户按 F5 即刻进入调试排查心流。
