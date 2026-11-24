import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasNodeType } from "../types";
import { canvasImagePreviewWidth, ImageNodeContent, VideoNodeContent, type NodeContentRendererProps } from "./canvas-node-content";

describe("canvas media preview", () => {
    it("scales preview requests down when the canvas is zoomed out", () => {
        expect(canvasImagePreviewWidth(330, 0.1, 4096)).toBe(33);
        expect(canvasImagePreviewWidth(330, 0.5, 4096)).toBe(165);
        expect(canvasImagePreviewWidth(330, 2, 4096)).toBe(330);
    });

    it("loads video metadata when the node is in the media budget", () => {
        const markup = renderToStaticMarkup(<VideoNodeContent {...({ node: { id: "video", type: CanvasNodeType.Video, metadata: { content: "/api/reference-assets/video.mp4" } }, theme: canvasThemes.light, loadImage: true } as NodeContentRendererProps)} />);
        expect(markup).toContain('preload="metadata"');
        expect(markup).toContain('src="/api/reference-assets/video.mp4"');
    });

    it("does not attach a video source outside the media budget", () => {
        const markup = renderToStaticMarkup(<VideoNodeContent {...({ node: { id: "video", type: CanvasNodeType.Video, metadata: { content: "/api/reference-assets/video.mp4" } }, theme: canvasThemes.light, loadImage: false } as NodeContentRendererProps)} />);
        expect(markup).toContain("data-canvas-video-placeholder");
        expect(markup).not.toContain('src="/api/reference-assets/video.mp4"');
    });

    it("does not use the image title as fallback text", () => {
        const markup = renderToStaticMarkup(
            <ImageNodeContent
                {...({
                    node: { id: "image", type: CanvasNodeType.Image, title: "提示词不应显示", width: 330, height: 330, metadata: { content: "/image.png" } },
                    theme: canvasThemes.light,
                    isBatchRoot: false,
                    batchCount: 0,
                    batchExpanded: false,
                    batchOpening: false,
                    batchRecovering: false,
                } as NodeContentRendererProps)}
            />,
        );
        expect(markup).toContain('alt="" aria-label="画布图片"');
        expect(markup).not.toContain('alt="提示词不应显示"');
    });
});
