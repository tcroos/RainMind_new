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

    it("水平排列：同一 y、等间距递增，且整体保持原选区中心", () => {
        const updates = arrangeCanvasNodes(nodes, ["a", "b", "c"], "row");
        expect(updates).toHaveLength(3);
        expect(new Set(updates.map((update) => update.position.y)).size).toBe(1);
        const xs = updates.map((update) => update.position.x);
        expect(xs[1]).toBe(xs[0] + 124);
        expect(xs[2]).toBe(xs[1] + 124);
        // 原选区 x 范围 0~700，中心 350；排布后 x 范围 xs[0]~xs[2]+100
        expect((xs[0] + xs[2] + 100) / 2).toBeCloseTo(350);
    });

    it("垂直排列：同一 x、等间距递增，且整体保持原选区中心", () => {
        const updates = arrangeCanvasNodes(nodes, ["a", "b"], "column");
        expect(updates).toHaveLength(2);
        expect(updates[0].position.x).toBe(updates[1].position.x);
        expect(updates[1].position.y).toBe(updates[0].position.y + 124);
        // 原选区 y 范围 0~150，中心 75
        expect((updates[0].position.y + updates[1].position.y + 100) / 2).toBeCloseTo(75);
    });

    it("宫格排列：四个节点排成 2x2，格子不重叠且以选区中心为锚", () => {
        const updates = arrangeCanvasNodes(nodes, ["a", "b", "c", "d"], "grid");
        expect(updates).toHaveLength(4);
        const positions = new Map(updates.map((update) => [update.id, update.position]));
        const a = positions.get("a")!;
        const b = positions.get("b")!;
        const c = positions.get("c")!;
        const d = positions.get("d")!;
        expect(b.x).toBe(a.x + 124);
        expect(c.y).toBe(a.y + 124);
        expect(d).toEqual({ x: a.x + 124, y: a.y + 124 });
        // 原选区中心 (500, 80)
        expect((a.x + b.x + 100) / 2).toBeCloseTo(500);
        expect((a.y + c.y + 100) / 2).toBeCloseTo(80);
    });

    it("不同尺寸节点也会按格子居中且不重叠", () => {
        const mixed = [node("a", 0, 0, 200, 80), node("b", 400, 0, 100, 120)];
        const updates = arrangeCanvasNodes(mixed, ["a", "b"], "grid");
        expect(updates[1].position.x - updates[0].position.x).toBeGreaterThanOrEqual(200 + 24);
    });

    it("不改变入参", () => {
        const original = nodes[0].position;
        arrangeCanvasNodes(nodes, ["a", "b"], "row");
        expect(nodes[0].position).toBe(original);
    });
});
