import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { fitNodeAspectRatio, nodeSizeFromAspect, resizeImageNodeToNaturalRatio, videoNodeSizeFromNatural } from "./canvas-node-size";

const imageNode: CanvasNodeData = {
    id: "image",
    type: CanvasNodeType.Image,
    title: "图片",
    position: { x: 100, y: 200 },
    width: 340,
    height: 240,
    metadata: { content: "/image.png" },
};

describe("Canvas video node sizing", () => {
    it("matches generated video nodes for common uploaded ratios", () => {
        expect(videoNodeSizeFromNatural(1280, 720)).toEqual({ width: 587, height: 330 });
        expect(videoNodeSizeFromNatural(720, 1280)).toEqual({ width: 330, height: 587 });
        expect(videoNodeSizeFromNatural(1024, 1024)).toEqual({ width: 330, height: 330 });
    });

    it("caps extreme ratios to the video frame", () => {
        expect(videoNodeSizeFromNatural(3840, 480)).toEqual({ width: 640, height: 80 });
    });
});

describe("Canvas image node sizing", () => {
    it.each([256, 1024, 2048])("uses the canvas scale for a %ipx square regardless of source resolution", (pixels) => {
        expect(nodeSizeFromAspect(pixels, pixels)).toEqual({ width: 330, height: 330 });
    });

    it("fits a square image to a square frame without side gutters", () => {
        expect(fitNodeAspectRatio(1024, 1024, 340, 340)).toEqual({ width: 340, height: 340 });
    });

    it("keeps the node center while correcting a saved frame ratio", () => {
        const resized = resizeImageNodeToNaturalRatio(imageNode, 1024, 1024);

        expect(resized).toMatchObject({ width: 340, height: 340, position: { x: 100, y: 150 }, metadata: { naturalWidth: 1024, naturalHeight: 1024 } });
    });

    it("preserves an intentional free-resize frame", () => {
        const resized = resizeImageNodeToNaturalRatio({ ...imageNode, metadata: { ...imageNode.metadata, freeResize: true } }, 1024, 1024);

        expect(resized).toMatchObject({ width: 340, height: 240, position: { x: 100, y: 200 } });
    });

    it("returns the original node after dimensions and ratio are already synchronized", () => {
        const squareNode = { ...imageNode, width: 340, height: 340, metadata: { ...imageNode.metadata, naturalWidth: 1024, naturalHeight: 1024 } };

        expect(resizeImageNodeToNaturalRatio(squareNode, 1024, 1024)).toBe(squareNode);
    });
});
