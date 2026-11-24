import type { CanvasNodeData } from "../types";

/**
 * 手动打组的纯函数集合。
 *
 * 同组节点共用一个 metadata.groupId：选中其中一个即选中整组、拖动其中一个即整组移动。
 * 它与批量生成产生的 batchChildIds 是两套机制，互不干扰。
 */

/** 取选中节点的共同 groupId；仅当所有节点都存在且属于同一个非空组时返回，否则返回 null。 */
export function commonGroupId(nodes: CanvasNodeData[], ids: Iterable<string>): string | null {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let shared: string | null = null;
    let count = 0;
    for (const id of ids) {
        const groupId = byId.get(id)?.metadata?.groupId;
        if (!groupId) return null;
        if (count === 0) shared = groupId;
        else if (shared !== groupId) return null;
        count += 1;
    }
    return count > 0 ? shared : null;
}

/** 按节点里首次出现的顺序给每个组编号：groupId -> "Group 1"、"Group 2"… */
export function buildGroupLabels(nodes: CanvasNodeData[]): Map<string, string> {
    const labels = new Map<string, string>();
    for (const node of nodes) {
        const groupId = node.metadata?.groupId;
        if (!groupId || labels.has(groupId)) continue;
        labels.set(groupId, `Group ${labels.size + 1}`);
    }
    return labels;
}

/** 取某个组的全部成员 id（保持 nodes 中的顺序）。 */
export function groupMemberIds(nodes: CanvasNodeData[], groupId: string): string[] {
    return nodes.filter((node) => node.metadata?.groupId === groupId).map((node) => node.id);
}

/** 选中集扩展：把选中节点所在组的其它成员一并纳入选中。 */
export function expandGroupSelection(nodes: CanvasNodeData[], ids: Iterable<string>): Set<string> {
    const result = new Set(ids);
    const groups = new Set<string>();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const id of result) {
        const groupId = byId.get(id)?.metadata?.groupId;
        if (groupId) groups.add(groupId);
    }
    if (!groups.size) return result;
    for (const node of nodes) {
        if (node.metadata?.groupId && groups.has(node.metadata.groupId)) result.add(node.id);
    }
    return result;
}

/**
 * 生成打组 / 解组后的节点数组。
 * groupId 传字符串表示打组（写入所有选中节点），传 null 表示解组（仅清除选中节点的 groupId）。
 */
export function applyNodeGroup(nodes: CanvasNodeData[], ids: Iterable<string>, groupId: string | null): CanvasNodeData[] {
    const targets = new Set(ids);
    return nodes.map((node) => {
        if (!targets.has(node.id)) return node;
        const metadata = { ...node.metadata };
        if (groupId === null) delete metadata.groupId;
        else metadata.groupId = groupId;
        return { ...node, metadata };
    });
}
