/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		// 1. 全局禁止循环依赖
		{
			name: "no-circular",
			severity: "error",
			comment: "严禁模块间循环依赖，避免模块初始化未就绪与死锁",
			from: { path: "^src" },
			to: { circular: true },
		},

		// 2. 领域层纯净边界：Domain 层只能引用 Domain 和 Shared，严禁依赖外界与平台 I/O
		{
			name: "domain-isolation",
			severity: "error",
			comment: "领域层必须保持 100% 纯内聚，严禁依赖上层 Application、Infra、UI",
			from: { path: "^src/domain" },
			to: {
				path: "^src/(application|infra|ui)",
			},
		},
		{
			name: "domain-no-host-or-io",
			severity: "error",
			comment: "领域层严禁依赖 VS Code 宿主 API 或底层平台文件 I/O (必须遵循 DIP)",
			from: { path: "^src/domain" },
			to: {
				path: "^(vscode|node:fs|node:child_process|fs|child_process)$",
			},
		},

		// 3. 应用层倒置边界：Application 层严禁直接依赖 Infra 或 UI 或 vscode
		{
			name: "application-no-infra",
			severity: "error",
			comment: "应用层严禁直接引用基础设施层具体实现，必须通过领域端口 Ports 依赖倒置注入 (DIP)",
			from: { path: "^src/application" },
			to: { path: "^src/infra" },
		},
		{
			name: "application-no-ui",
			severity: "error",
			comment: "应用层严禁反向依赖 UI 展示层",
			from: { path: "^src/application" },
			to: { path: "^src/ui" },
		},
		{
			name: "application-no-vscode",
			severity: "error",
			comment: "应用层严禁直接引用宿主 vscode API",
			from: { path: "^src/application" },
			to: { path: "^vscode$" },
		},

		// 4. 基础设施层单向边界：Infra 层严禁反向依赖 UI 展示层
		{
			name: "infra-no-ui",
			severity: "error",
			comment: "基础设施层严禁反向引用 UI 展示层 (底层绝对不能感知界面控件)",
			from: { path: "^src/infra" },
			to: { path: "^src/ui" },
		},

		// 5. 展示层严格闭合边界：UI 严禁跨层穿透调用 Infra 基础设施实现
		{
			name: "ui-no-infra",
			severity: "error",
			comment: "展示层严禁跨层直连 Infra 基础设施 (严禁绕过应用层直接读写磁盘或直接操作 DAP 桥接器)",
			from: { path: "^src/ui" },
			to: { path: "^src/infra" },
		},

		// 6. 工具层纯净边界：Shared 层严禁依赖任何业务层
		{
			name: "shared-pure",
			severity: "error",
			comment: "纯工具函数库严禁依赖任何领域或业务层",
			from: { path: "^src/shared" },
			to: { path: "^src/(domain|application|infra|ui)" },
		},
	],
	options: {
		doNotFollow: {
			path: "node_modules",
		},
		tsConfig: {
			fileName: "./tsconfig.json",
		},
		reporterOptions: {
			text: {
				highlightFocused: true,
			},
		},
	},
};
