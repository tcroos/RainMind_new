import { CanvasNodeType, type CanvasNodeData, type Position, type ViewportTransform } from "../types";
import { expandGroupSelection } from "./canvas-node-group";

const HANDLE_CLEARANCE = 32;
const FORWARD_GAP = HANDLE_CLEARANCE * 2;

export function worldFromScreen(clientX: number, clientY: number, viewport: ViewportTransform, rect: Pick<DOMRect, "left" | "top">): Position {
    return { x: (clientX - rect.left - viewport.x) / viewport.k, y: (clientY - rect.top - viewport.y) / viewport.k };
}

export function isCanvasVideoControlPoint(rect: Pick<DOMRect, "bottom" | "height">, clientY: number) {
    const controlsHeight = Math.max(40, Math.min(72, rect.height * 0.22));
    return clientY >= rect.bottom - controlsHeight;
}

export function nodeAnchor(node: CanvasNodeData, handleType: "source" | "target"): Position {
    return { x: handleType === "source" ? node.position.x + node.width : node.position.x, y: node.position.y + node.height / 2 };
}

/**
 * Connections never detour around other nodes. Node cards render above the
 * connection layer, so a curve that passes behind a node is hidden naturally;
 * detouring instead produced long orthogonal zig-zags whenever any node
 * overlapped the path, which made dense boards unreadable.
 */
export function edgePath(from: CanvasNodeData, to: CanvasNodeData) {
    const start = nodeAnchor(from, "source");
    const end = nodeAnchor(to, "target");
    return connectionCurve(start, end);
}

export function previewPath(start: Position, end: Position, handleType: "source" | "target") {
    return handleType === "source" ? connectionCurve(start, end) : connectionCurve(end, start);
}

function connectionCurve(start: Position, end: Position) {
    const dx = end.x - start.x;
    if (dx >= FORWARD_GAP) return forwardCurve(start, end).path;
    const dy = end.y - start.y;
    // Vertical stacks should read as a single smooth stem, not a sideways loop.
    // When the nodes are nearly aligned on X this collapses to a straight line.
    if (Math.abs(dy) >= Math.abs(dx)) {
        const middleY = (start.y + end.y) / 2;
        return `M ${format(start.x)} ${format(start.y)} C ${format(start.x)} ${format(middleY)}, ${format(end.x)} ${format(middleY)}, ${format(end.x)} ${format(end.y)}`;
    }
    const bend = HANDLE_CLEARANCE;
    const middleX = (start.x + end.x) / 2;
    const middleY = (start.y + end.y) / 2 + bend * Math.max(0, 1 - Math.abs(end.y - start.y) / FORWARD_GAP);
    return `M ${format(start.x)} ${format(start.y)} C ${format(start.x + bend)} ${format(start.y)}, ${format(start.x + bend)} ${format(middleY)}, ${format(middleX)} ${format(middleY)} C ${format(end.x - bend)} ${format(middleY)}, ${format(end.x - bend)} ${format(end.y)}, ${format(end.x)} ${format(end.y)}`;
}

export function samePosition(a: Position, b: Position) {
    return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

export function selectNodesInBounds(nodes: CanvasNodeData[], start: Position, end: Position, initialNodeIds: Iterable<string> = []) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const selected = new Set(initialNodeIds);
    for (const node of nodes) {
        if (node.position.x < maxX && node.position.x + node.width > minX && node.position.y < maxY && node.position.y + node.height > minY) selected.add(node.id);
    }
    return selected;
}

export function expandCanvasDragNodeIds(nodes: CanvasNodeData[], selectedNodeIds: Iterable<string>) {
    // 手动打组的成员作为一个整体拖动：先把选中集扩展到整组，再叠加批量生成的子节点。
    const dragNodeIds = expandGroupSelection(nodes, selectedNodeIds);
    for (const node of nodes) {
        if (!dragNodeIds.has(node.id)) continue;
        node.metadata?.batchChildIds?.forEach((childId) => dragNodeIds.add(childId));
    }
    return [...dragNodeIds];
}

export function findConnectionTarget(world: Position, draft: { nodeId: string; handleType: "source" | "target" }, nodes: CanvasNodeData[], scale: number) {
    const tolerance = 52 / Math.max(scale, 0.1);
    let best: { id: string; distance: number } | null = null;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (node.id === draft.nodeId || (draft.handleType === "target" && node.type === CanvasNodeType.Config)) continue;
        const anchor = nodeAnchor(node, draft.handleType === "source" ? "target" : "source");
        const inside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
        const distance = Math.hypot(world.x - anchor.x, world.y - anchor.y);
        if (!inside && distance > tolerance) continue;
        if (!best || distance < best.distance) best = { id: node.id, distance };
    }
    return best?.id || null;
}

export function isBlockedConnectionDrop(world: Position, draft: { nodeId: string; handleType: "source" | "target" }, nodes: CanvasNodeData[], scale: number) {
    const tolerance = 52 / Math.max(scale, 0.1);
    return nodes.some((node) => {
        const blocked = node.id === draft.nodeId || (draft.handleType === "target" && node.type === CanvasNodeType.Config);
        if (!blocked) return false;
        const anchor = nodeAnchor(node, draft.handleType === "source" ? "target" : "source");
        const inside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
        return inside || Math.hypot(world.x - anchor.x, world.y - anchor.y) <= tolerance;
    });
}

function forwardCurve(start: Position, end: Position) {
    const centerX = (start.x + end.x) / 2;
    const controlStart = { x: centerX, y: start.y };
    const controlEnd = { x: centerX, y: end.y };
    return { path: `M ${format(start.x)} ${format(start.y)} C ${format(controlStart.x)} ${format(controlStart.y)}, ${format(controlEnd.x)} ${format(controlEnd.y)}, ${format(end.x)} ${format(end.y)}`, start, controlStart, controlEnd, end };
}

function format(value: number) {
    return Number(value.toFixed(2));
}
