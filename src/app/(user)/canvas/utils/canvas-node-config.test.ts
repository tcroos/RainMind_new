import { describe, expect, it } from "vitest";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { connectedCanvasNodeMetadata, resolveCanvasGenerationModel } from "./canvas-node-config";

const config: AiConfig = {
    ...defaultConfig,
    model: "image-main",
    imageModel: "image-main",
    videoModel: "studio-motion",
    textModel: "writer-main",
    audioModel: "voice-main",
    models: ["image-main", "image-alt", "studio-motion", "writer-main", "voice-main"],
    imageModels: ["image-main", "image-alt"],
    videoModels: ["studio-motion"],
    textModels: ["writer-main"],
    audioModels: ["voice-main"],
};

describe("connected canvas node parameters", () => {
    const source: CanvasNodeData = {
        id: "source",
        type: CanvasNodeType.Image,
        title: "source",
        width: 330,
        height: 587,
        position: { x: 0, y: 0 },
        metadata: { size: "9:16", sizeLocked: true, model: "image-alt", quality: "high", count: 3, imageResolution: "2K", prompt: "private prompt", content: "/image.png", imageTask: { id: "old", kind: "generation", model: "image-alt" } },
    };

    it("inherits image settings without copying content, prompt or task identity", () => {
        const inherited = connectedCanvasNodeMetadata(config, source, CanvasNodeType.Image);
        expect(inherited).toMatchObject({ size: "9:16", model: "image-alt", quality: "high", count: 3, imageResolution: "2K" });
        expect(inherited).not.toHaveProperty("prompt");
        expect(inherited).not.toHaveProperty("content");
        expect(inherited).not.toHaveProperty("imageTask");
    });

    it("only inherits size when switching media capability", () => {
        expect(connectedCanvasNodeMetadata(config, source, CanvasNodeType.Video)).toEqual({ size: "9:16", sizeLocked: true });
    });

    it("inherits video duration and resolution into video and configuration nodes", () => {
        const video = { ...source, type: CanvasNodeType.Video, metadata: { size: "16:9", model: "studio-motion", seconds: "10", vquality: "1080" } };
        expect(connectedCanvasNodeMetadata(config, video, CanvasNodeType.Video)).toMatchObject({ model: "studio-motion", seconds: "10", vquality: "1080" });
        expect(connectedCanvasNodeMetadata(config, video, CanvasNodeType.Config)).toMatchObject({ generationMode: "video", model: "studio-motion", seconds: "10" });
    });

    it("uses real media dimensions when upload metadata has no generation size", () => {
        expect(connectedCanvasNodeMetadata(config, { ...source, metadata: { naturalWidth: 2880, naturalHeight: 2880 } }, CanvasNodeType.Image)).toMatchObject({ size: "1:1", imageSizeMode: "ratio", sizeLocked: true, model: "image-main" });
    });

    it("uses ratios for generated pixel dimensions but preserves explicit custom sizes", () => {
        expect(connectedCanvasNodeMetadata(config, { ...source, metadata: { size: "2880x2880", sizeLocked: false } }, CanvasNodeType.Image)).toMatchObject({ size: "1:1", sizeLocked: true, imageSizeMode: "ratio" });
        expect(connectedCanvasNodeMetadata(config, { ...source, metadata: { size: "1824x1024", imageSizeMode: "custom" } }, CanvasNodeType.Image)).toMatchObject({ size: "1824x1024", imageSizeMode: "custom" });
        expect(connectedCanvasNodeMetadata(config, { ...source, metadata: { size: "1080x1920", imageSizeMode: "custom" } }, CanvasNodeType.Video)).toMatchObject({ size: "9:16", sizeLocked: true });
    });

    it("falls back to defaults without a source and leaves text nodes untouched", () => {
        expect(connectedCanvasNodeMetadata(config, undefined, CanvasNodeType.Image)).toEqual({ size: "16:9", sizeLocked: false });
        expect(connectedCanvasNodeMetadata(config, source, CanvasNodeType.Text)).toBeUndefined();
    });
});

describe("resolveCanvasGenerationModel", () => {
    it("switches to the first model exposed by the selected capability", () => {
        expect(resolveCanvasGenerationModel(config, "video", "image-alt")).toBe("studio-motion");
        expect(resolveCanvasGenerationModel(config, "text", "studio-motion")).toBe("writer-main");
        expect(resolveCanvasGenerationModel(config, "audio", "writer-main")).toBe("voice-main");
    });

    it("preserves a model that belongs to the selected capability", () => {
        expect(resolveCanvasGenerationModel(config, "image", "IMAGE-ALT")).toBe("image-alt");
    });

    it("does not show an unavailable model when the capability has no configured model", () => {
        expect(resolveCanvasGenerationModel({ ...config, videoModels: [] }, "video", "image-main")).toBe("");
    });
});
