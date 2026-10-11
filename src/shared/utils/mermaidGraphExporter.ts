/**
 * Mermaid 图形导出器 (Mermaid Graph Exporter, v1.3.0)
 * 职责：将画布快照导出为可被 Mermaid 渲染器直接渲染的 flowchart TD 文本（零落盘、零运行时图形库）。
 * 分层约束：shared 层零业务依赖 —— 输入采用本地最小结构契约（与 application 层 GraphSnapshot
 * 结构兼容，由 TypeScript 结构化类型天然适配），严禁反向 import application/domain。
 */

/** 导出节点最小结构契约（GraphSnapshot.GraphNode 的结构子集） */
export interface MermaidExportNode {
	readonly id: string;
	readonly kind: string;
	readonly refPath?: readonly string[];
	readonly file?: string;
	readonly line?: number;
	readonly functionName?: string;
	readonly refName?: string;
	readonly desc?: string;
	readonly enabled: boolean;
	readonly status: string;
}

/** 导出泳道最小结构契约（GraphSnapshot.GraphLane 的结构子集） */
export interface MermaidExportLane {
	readonly id: string;
	readonly sceneName: string;
	readonly nodes: readonly MermaidExportNode[];
}

export interface MermaidGraphSource {
	readonly lanes: readonly MermaidExportLane[];
}

interface ExportGroup {
	title: string;
	children: Array<MermaidExportNode | ExportGroup>;
}

/** 清洗 Mermaid 标签非法字符：引号转义为单引号，换行折叠为空格 */
function escapeMermaidText(text: string): string {
	return text.replace(/\s*\r?\n\s*/g, " ").replace(/"/g, "'");
}

/** 节点标签：desc 优先，未匹配加 ⚠，禁用加 ⛔（符号化表达，规避 shared 层语言耦合） */
function buildNodeLabel(node: MermaidExportNode): string {
	let label: string;
	if (node.kind === "scene-ref") {
		label = `🔗 ${node.refName ?? "?"}`;
	} else if (node.functionName) {
		label = node.desc ?? `ƒ ${node.functionName}`;
	} else if (node.file !== undefined && node.line !== undefined) {
		label = node.desc ?? `${node.file}:${node.line}`;
	} else {
		label = node.desc ?? node.id;
	}
	if (node.status === "unmatched") {
		label = `⚠ ${label}`;
	}
	if (!node.enabled) {
		label = `⛔ ${label}`;
	}
	return label;
}

/** 按引用链将泳道节点聚合为嵌套分组树（refPath[0] 为根场景即泳道本身，自段 1 起逐层嵌套） */
function buildGroupTree(lane: MermaidExportLane): ExportGroup {
	const root: ExportGroup = { title: lane.sceneName, children: [] };
	const groupIndex = new Map<string, ExportGroup>();
	for (const node of lane.nodes) {
		const path = node.refPath?.slice(1) ?? [];
		let parent = root;
		for (let i = 0; i < path.length; i++) {
			const key = `${i}:${path[i]}`;
			let group = groupIndex.get(key);
			if (!group) {
				group = { title: path[i], children: [] };
				groupIndex.set(key, group);
				parent.children.push(group);
			}
			parent = group;
		}
		parent.children.push(node);
	}
	return root;
}

function renderGroup(
	group: ExportGroup,
	indent: string,
	lines: string[],
	idOf: Map<string, string>,
	nextNodeId: () => string,
	nextGroupId: () => string,
): void {
	for (const child of group.children) {
		if ("children" in child) {
			lines.push(`${indent}subgraph ${nextGroupId()}["🔗 ${escapeMermaidText(child.title)}"]`);
			renderGroup(child, `${indent}    `, lines, idOf, nextNodeId, nextGroupId);
			lines.push(`${indent}end`);
			continue;
		}
		const mermaidId = nextNodeId();
		idOf.set(child.id, mermaidId);
		lines.push(`${indent}${mermaidId}["${escapeMermaidText(buildNodeLabel(child))}"]`);
	}
}

/**
 * 导出 Mermaid 文本：泳道 = subgraph、引用链 = 嵌套 subgraph、相邻声明序节点连线。
 * Live 脉冲与命中轨迹等瞬时态不参与导出。空快照兜底返回 bare `flowchart TD`。
 */
export function exportGraphToMermaid(source: MermaidGraphSource): string {
	const lines: string[] = ["flowchart TD"];
	const idOf = new Map<string, string>();
	let nodeSeq = 0;
	let groupSeq = 0;
	const nextNodeId = () => `n${nodeSeq++}`;
	const nextGroupId = () => `s${groupSeq++}`;

	for (const lane of source.lanes) {
		lines.push(`    subgraph ${nextGroupId()}["${escapeMermaidText(lane.sceneName)}"]`);
		renderGroup(buildGroupTree(lane), "        ", lines, idOf, nextNodeId, nextGroupId);
		lines.push("    end");

		const laneIds = lane.nodes
			.map((node) => idOf.get(node.id))
			.filter((id): id is string => id !== undefined);
		for (let i = 1; i < laneIds.length; i++) {
			lines.push(`    ${laneIds[i - 1]} --> ${laneIds[i]}`);
		}
	}

	return lines.join("\n");
}
