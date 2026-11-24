import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { applyNodeGroup, commonGroupId, expandGroupSelection, groupMemberIds } from "./canvas-node-group";

const node = (id: string, groupId?: string): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Image,
    title: id,
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
    metadata: groupId ? { groupId } : {},
});

describe("canvas node group", () => {
    it("打组把同一个 groupId 写到所有选中节点，不影响其他节点", () => {
        const nodes = [node("a"), node("b"), node("c")];
        const next = applyNodeGroup(nodes, ["a", "c"], "g1");
        expect(next.find((item) => item.id === "a")?.metadata?.groupId).toBe("g1");
        expect(next.find((item) => item.id === "c")?.metadata?.groupId).toBe("g1");
        expect(next.find((item) => item.id === "b")?.metadata?.groupId).toBeUndefined();
        expect(nodes[0].metadata?.groupId).toBeUndefined(); // 不修改入参
    });

    it("解组只清除选中节点的 groupId", () => {
        const nodes = [node("a", "g1"), node("b", "g1"), node("c", "g2")];
        const next = applyNodeGroup(nodes, ["a"], null);
        expect(next.find((item) => item.id === "a")?.metadata?.groupId).toBeUndefined();
        expect(next.find((item) => item.id === "b")?.metadata?.groupId).toBe("g1");
        expect(next.find((item) => item.id === "c")?.metadata?.groupId).toBe("g2");
    });

    it("commonGroupId 仅在同一非空组时返回组号", () => {
        const nodes = [node("a", "g1"), node("b", "g1"), node("c", "g2"), node("d")];
        expect(commonGroupId(nodes, ["a", "b"])).toBe("g1");
        expect(commonGroupId(nodes, ["a", "c"])).toBeNull();
        expect(commonGroupId(nodes, ["a", "d"])).toBeNull();
        expect(commonGroupId(nodes, ["a"])).toBe("g1");
        expect(commonGroupId(nodes, [])).toBeNull();
        expect(commonGroupId(nodes, ["missing"])).toBeNull();
    });

    it("groupMemberIds 返回整组成员", () => {
        const nodes = [node("a", "g1"), node("b", "g2"), node("c", "g1")];
        expect(groupMemberIds(nodes, "g1")).toEqual(["a", "c"]);
        expect(groupMemberIds(nodes, "none")).toEqual([]);
    });

    it("expandGroupSelection 由任一成员扩展到整组", () => {
        const nodes = [node("a", "g1"), node("b", "g2"), node("c", "g1"), node("d")];
        expect([...expandGroupSelection(nodes, ["a"])].sort()).toEqual(["a", "c"]);
        expect([...expandGroupSelection(nodes, ["a", "b"])].sort()).toEqual(["a", "b", "c"]);
        expect([...expandGroupSelection(nodes, ["d"])]).toEqual(["d"]);
    });
});
