import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { edgePath, expandCanvasDragNodeIds, findConnectionTarget, isBlockedConnectionDrop, isCanvasVideoControlPoint, nodeAnchor, previewPath, samePosition, selectNodesInBounds, worldFromScreen } from "./canvas-surface-geometry";

const source: CanvasNodeData = { id: "source", type: CanvasNodeType.Text, title: "来源", position: { x: 100, y: 120 }, width: 240, height: 160, metadata: {} };
const target: CanvasNodeData = { id: "target", type: CanvasNodeType.Image, title: "目标", position: { x: 500, y: 220 }, width: 300, height: 200, metadata: {} };

describe("canvas surface geometry", () => {
    it("converts screen coordinates through the viewport transform", () => {
        expect(worldFromScreen(330, 250, { x: 80, y: 40, k: 2 }, { left: 10, top: 10 })).toEqual({ x: 120, y: 100 });
    });

    it("keeps the video picture draggable while reserving the native control strip", () => {
        const rect = { bottom: 300, height: 200 };
        expect(isCanvasVideoControlPoint(rect, 200)).toBe(false);
        expect(isCanvasVideoControlPoint(rect, 270)).toBe(true);
    });

    it("uses node-side centers as connection anchors", () => {
        expect(nodeAnchor(source, "source")).toEqual({ x: 340, y: 200 });
        expect(nodeAnchor(target, "target")).toEqual({ x: 500, y: 320 });
        expect(edgePath(source, target)).toBe("M 340 200 C 420 200, 420 320, 500 320");
    });

    it("keeps long forward connections on midpoint Bezier controls", () => {
        const longTarget = { ...target, position: { x: 1400, y: 620 } };
        expect(edgePath(source, longTarget)).toBe("M 340 200 C 870 200, 870 720, 1400 720");
    });

    it("turns vertically stacked connections into a single smooth stem", () => {
        const alignedTarget = { ...target, position: { x: 340, y: 600 } };
        expect(edgePath(source, alignedTarget)).toBe("M 340 200 C 340 450, 340 450, 340 700");

        const slightlyOffsetTarget = { ...target, position: { x: 320, y: 600 } };
        const path = edgePath(source, slightlyOffsetTarget);
        expect(path).toBe("M 340 200 C 340 450, 320 450, 320 700");
        expect(path.match(/ C /g)).toHaveLength(1);
    });

    it("routes backward connections through a clear vertical gap", () => {
        const lowerTarget = { ...target, position: { x: 320, y: 280 }, width: 340, height: 240 };
        const shorterSource = { ...source, position: { x: 0, y: 0 }, width: 340, height: 210 };
        const path = edgePath(shorterSource, lowerTarget);

        expect(path).toContain(" C ");
        expect(path).not.toMatch(/ [LQ] /);
        expect(previewPath(nodeAnchor(shorterSource, "source"), nodeAnchor(lowerTarget, "target"), "source")).toBe(path);
    });

    it("routes backward connections outside overlapping node bounds", () => {
        const from = { ...source, position: { x: 0, y: 0 }, width: 340, height: 240 };
        const to = { ...target, position: { x: 280, y: 80 }, width: 340, height: 240 };
        const path = edgePath(from, to);

        expect(path).toContain(" C ");
        expect(path).not.toMatch(/ [LQ] /);
    });

    it("keeps the smooth curve even when a node sits on the default connection path", () => {
        // Node cards paint above the connection layer, so overlapping geometry must
        // not change the path; any detour made dense boards unreadable.
        expect(edgePath(source, target)).toBe("M 340 200 C 420 200, 420 320, 500 320");
        expect(edgePath(source, target)).not.toContain(" Q ");
    });

    it("builds previews in the direction of the active handle", () => {
        expect(previewPath({ x: 0, y: 20 }, { x: 100, y: 60 }, "source")).toBe("M 0 20 C 50 20, 50 60, 100 60");
        expect(previewPath({ x: 100, y: 60 }, { x: 0, y: 20 }, "target")).toBe("M 0 20 C 50 20, 50 60, 100 60");
        expect(previewPath({ x: 100, y: 60 }, { x: 160, y: 20 }, "target")).toContain(" C ");
    });

    it("targets node bodies and nearby handles without selecting the origin", () => {
        expect(findConnectionTarget({ x: 510, y: 300 }, { nodeId: source.id, handleType: "source" }, [source, target], 1)).toBe(target.id);
        expect(findConnectionTarget({ x: 100, y: 200 }, { nodeId: source.id, handleType: "source" }, [source, target], 1)).toBeNull();
        expect(findConnectionTarget({ x: 449, y: 320 }, { nodeId: source.id, handleType: "source" }, [source, target], 1)).toBe(target.id);
    });

    it("uses identical final geometry when dragging from either end for reverse and vertical links", () => {
        for (const position of [
            { x: -200, y: 120 },
            { x: 340, y: 400 },
            { x: 100, y: 120 },
        ]) {
            const destination = { ...target, position };
            const start = nodeAnchor(source, "source");
            const end = nodeAnchor(destination, "target");
            expect(previewPath(start, end, "source")).toBe(edgePath(source, destination));
            expect(previewPath(end, start, "target")).toBe(edgePath(source, destination));
            expect(edgePath(source, destination)).not.toMatch(/ [LQ] |NaN|Infinity/);
        }
    });

    it("keeps same-height reverse bends compact even across distant nodes", () => {
        const path = previewPath({ x: 2000, y: 100 }, { x: 0, y: 100 }, "source");
        expect(path).toBe("M 2000 100 C 2032 100, 2032 132, 1000 132 C -32 132, -32 100, 0 100");
    });

    it("blocks connection creation menus on the origin and invalid config sources", () => {
        const config = { ...target, id: "config", type: CanvasNodeType.Config };

        expect(isBlockedConnectionDrop({ x: 110, y: 180 }, { nodeId: source.id, handleType: "source" }, [source, config], 1)).toBe(true);
        expect(findConnectionTarget({ x: 510, y: 300 }, { nodeId: source.id, handleType: "target" }, [source, config], 1)).toBeNull();
        expect(isBlockedConnectionDrop({ x: 510, y: 300 }, { nodeId: source.id, handleType: "target" }, [source, config], 1)).toBe(true);
        expect(isBlockedConnectionDrop({ x: 900, y: 700 }, { nodeId: source.id, handleType: "source" }, [source, config], 1)).toBe(false);
    });

    it("tolerates subpixel position differences only", () => {
        expect(samePosition({ x: 10, y: 20 }, { x: 10.005, y: 20.005 })).toBe(true);
        expect(samePosition({ x: 10, y: 20 }, { x: 10.02, y: 20 })).toBe(false);
    });

    it("adds box hits to an existing multi-selection", () => {
        expect(selectNodesInBounds([source, target], { x: 450, y: 180 }, { x: 820, y: 440 }, [source.id])).toEqual(new Set([source.id, target.id]));
    });

    it("moves hidden image-batch children with the selected root", () => {
        const root = { ...source, metadata: { batchChildIds: ["child-a", "child-b"] } };
        expect(expandCanvasDragNodeIds([root, target], [root.id, target.id])).toEqual([root.id, target.id, "child-a", "child-b"]);
    });

    it("moves the whole manual group when only one member is dragged", () => {
        const other = { ...source, id: "ungrouped", metadata: {} };
        const grouped = [
            { ...source, metadata: { groupId: "g1" } },
            { ...target, metadata: { groupId: "g1" } },
            other,
        ];
        expect(expandCanvasDragNodeIds(grouped, [source.id]).sort()).toEqual([source.id, target.id]);
    });
});
