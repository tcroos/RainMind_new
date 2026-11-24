import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { arrangeCanvasNodes } from "./canvas-node-arrange";

const node = (id: string, x: number, y: number, width = 100, height = 100): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Image,
    title: id,
    position: { x, y },
    width,
    height,
});

describe("arrangeCanvasNodes", () => {
    const nodes = [node("a", 0, 0), node("b", 300, 50), node("c", 600, 10), node("d", 900, 60)];

    it("不足两个节点时不排布", () => {
        expect(arrangeCanvasNodes(nodes, ["a"], "grid")).toEqual([]);
    });

    it("水平排列：同一 y、x 依次递增且保持原选区中心", () => {
        const updates = arrangeCanvasNodes(nodes, ["a", "b", "c"], "row");
        expect(updates).toHaveLength(3);
        expect(new Set(updates.map((update) => update.position.y)).size).toBe(1);
        expect(updates[0].position.x).toBe(0);
        expect(updates[1].position.x).toBe(124);
        expect(updates[2].position.x).toBe(248);
    });

    it("垂直排列：同一 x、y 依次递增", () => {
        const updates = arrangeCanvasNodes(nodes, ["a", "b"], "column");
        expect(updates).toHaveLength(2);
        expect(updates[0].position.x).toBe(updates[1].position.x);
        expect(updates[1].position.y).toBe(updates[0].position.y + 124);
    });

    it("宫格排列：四个节点排成 2x2，格子不重叠", () => {
        const updates = arrangeCanvasNodes(nodes, ["a", "b", "c", "d"], "grid");
        expect(updates).toHaveLength(4);
        const positions = new Map(updates.map((update) => [update.id, update.position]));
        expect(positions.get("a")).toEqual({ x: 0, y: 0 });
        expect(positions.get("b")).toEqual({ x: 124, y: 0 });
        expect(positions.get("c")).toEqual({ x: 0, y: 124 });
        expect(positions.get("d")).toEqual({ x: 124, y: 124 });
    });

    it("不改变入参", () => {
        const original = nodes[0].position;
        arrangeCanvasNodes(nodes, ["a", "b"], "row");
        expect(nodes[0].position).toBe(original);
    });
});
