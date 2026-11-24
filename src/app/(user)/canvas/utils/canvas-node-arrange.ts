import type { CanvasNodeData, Position } from "../types";
import { canvasNodesBounds } from "./canvas-spatial-index";

export type CanvasArrangeMode = "grid" | "row" | "column";

export type CanvasNodePositionUpdate = { id: string; position: Position };

const ARRANGE_GAP = 24;

/**
 * 把选中的节点按指定模式重新排布，返回位置更新（不修改入参）。
 *
 * - grid：按近似正方形列数排成宫格，格子尺寸取所选节点中最大的宽高
 * - row：同一行，垂直居中对齐在选区原有垂直中心
 * - column：同一列，水平居中对齐在选区原有水平中心
 *
 * 行/列/宫格都以选区原有边界为锚点，整体不会漂移到画布别处。
 */
export function arrangeCanvasNodes(nodes: CanvasNodeData[], ids: Iterable<string>, mode: CanvasArrangeMode): CanvasNodePositionUpdate[] {
    const idSet = new Set(ids);
    const selected = nodes.filter((node) => idSet.has(node.id));
    if (selected.length < 2) return [];

    const base = canvasNodesBounds(selected, 0, 0);
    const centerX = (base.left + base.right) / 2;
    const centerY = (base.top + base.bottom) / 2;
    const maxWidth = Math.max(...selected.map((node) => node.width));
    const maxHeight = Math.max(...selected.map((node) => node.height));

    if (mode === "row") {
        let x = base.left;
        return selected.map((node) => {
            const update = { id: node.id, position: { x, y: centerY - node.height / 2 } };
            x += node.width + ARRANGE_GAP;
            return update;
        });
    }

    if (mode === "column") {
        let y = base.top;
        return selected.map((node) => {
            const update = { id: node.id, position: { x: centerX - node.width / 2, y } };
            y += node.height + ARRANGE_GAP;
            return update;
        });
    }

    const columns = Math.ceil(Math.sqrt(selected.length));
    return selected.map((node, index) => ({
        id: node.id,
        position: {
            x: base.left + (index % columns) * (maxWidth + ARRANGE_GAP) + (maxWidth - node.width) / 2,
            y: base.top + Math.floor(index / columns) * (maxHeight + ARRANGE_GAP) + (maxHeight - node.height) / 2,
        },
    }));
}
