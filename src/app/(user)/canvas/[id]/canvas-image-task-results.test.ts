import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { applyCanvasImageLayerTaskResults, applyCanvasImageTaskResults } from "./canvas-image-task-results";

describe("canvas image task results", () => {
    it("keeps task billing on the primary node but never copies it to extra batch results", () => {
        const target: CanvasNodeData = { id: "target", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 320, height: 320, metadata: { task: { taskId: "batch", power: 12, status: "running", refundStatus: "pending" } } };
        const images = ["first", "second"].map(name => ({ width: 512, height: 512, metadata: { content: `/${name}.png`, status: "success" as const } }));
        const results = applyCanvasImageTaskResults([target], { nodeId: "target", taskId: "batch", model: "model", images });
        expect(results[0].metadata?.task).toEqual(target.metadata?.task);
        expect(results[1].metadata?.task).toBeUndefined();
        const layers = applyCanvasImageLayerTaskResults([target], { nodeId: "target", taskId: "batch", model: "model", images });
        expect(layers[1].metadata?.task).toBeUndefined();
    });
    it("preserves a resized target scale for every result in a batch", () => {
        const target: CanvasNodeData = { id: "target", type: CanvasNodeType.Image, title: "图片", position: { x: 40, y: 60 }, width: 480, height: 480, metadata: { status: "loading" } };
        const results = applyCanvasImageTaskResults([target], { nodeId: "target", taskId: "batch", model: "model", images: [1024, 2048].map((pixels) => ({ width: pixels, height: pixels, metadata: { status: "success", content: "/image.png" } })) });
        expect(results.map(({ width, height }) => ({ width, height }))).toEqual([
            { width: 480, height: 480 },
            { width: 480, height: 480 },
        ]);
        expect(results[0].position).toEqual(target.position);
    });

    it("keeps the same display size for 1K and 4K results with the same aspect ratio", () => {
        const target: CanvasNodeData = { id: "target", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 330, height: 587, metadata: { status: "loading" } };
        const complete = (width: number, height: number) => applyCanvasImageTaskResults([target], { nodeId: "target", taskId: "task", model: "model", images: [{ width, height, metadata: { content: "/image.png", status: "success" } }] })[0];
        const low = complete(768, 1376);
        const high = complete(3072, 5504);
        expect(low.width).toBe(330);
        expect(high.width).toBe(low.width);
        expect(high.height).toBe(low.height);
        expect(high.position).toEqual(low.position);
    });

    it("keeps every upstream image and replays the same task idempotently", () => {
        const target: CanvasNodeData = {
            id: "target",
            type: CanvasNodeType.Image,
            title: "生成图片",
            position: { x: 0, y: 0 },
            width: 320,
            height: 320,
            metadata: { status: "loading", imageTask: { id: "task-one", kind: "edit", model: "image-model" } },
        };
        const input = {
            nodeId: target.id,
            taskId: "task-one",
            model: "image-model",
            size: "16:9",
            images: [
                { width: 1600, height: 900, metadata: { content: "/api/generation-log-assets/first.png", status: "success" as const } },
                { width: 900, height: 1600, metadata: { content: "/api/generation-log-assets/second.png", status: "success" as const } },
            ],
        };

        const first = applyCanvasImageTaskResults([target], input);
        const replay = applyCanvasImageTaskResults(first, input);

        expect(first).toHaveLength(2);
        expect(first[0]?.metadata).toMatchObject({ content: "/api/generation-log-assets/first.png", imageTask: undefined });
        expect(first[1]).toMatchObject({ id: "image-result-task-one-2", metadata: { content: "/api/generation-log-assets/second.png" } });
        expect(first[1]?.position.x).toBeGreaterThanOrEqual((first[0]?.position.x || 0) + (first[0]?.width || 0));
        expect(replay).toHaveLength(2);
    });

    it("creates one independent node per upstream layer and replays idempotently", () => {
        const target: CanvasNodeData = {
            id: "layers",
            type: CanvasNodeType.Image,
            title: "商品图 · 分层中",
            position: { x: 0, y: 0 },
            width: 420,
            height: 320,
            metadata: { status: "loading", imageOutputMode: "layers", imageTask: { id: "task-layers", kind: "edit", model: "layer-model" } },
        };
        const input = {
            nodeId: target.id,
            taskId: "task-layers",
            model: "layer-model",
            images: [
                { width: 800, height: 800, metadata: { content: "/api/generation-log-assets/layer-a.png", storageKey: "layer-a.png", status: "success" as const } },
                { width: 800, height: 800, metadata: { content: "/api/generation-log-assets/layer-b.png", storageKey: "layer-b.png", status: "success" as const } },
            ],
        };

        const first = applyCanvasImageLayerTaskResults([target], input);
        const replay = applyCanvasImageLayerTaskResults(first, input);

        expect(first).toHaveLength(2);
        expect(first[0]).toMatchObject({ id: "layers", title: "图层 1", metadata: { storageKey: "layer-a.png", imageOutputMode: "layers", imageLayerTaskId: "task-layers", imageLayerResultIndex: 0, imageTask: undefined } });
        expect(first[1]).toMatchObject({ id: "image-layer-task-layers-2", title: "图层 2", metadata: { storageKey: "layer-b.png", imageLayerTaskId: "task-layers", imageLayerResultIndex: 1 } });
        expect(first[1]?.position.x).toBeGreaterThanOrEqual((first[0]?.position.x || 0) + (first[0]?.width || 0));
        expect(replay).toEqual(first);
    });
});
