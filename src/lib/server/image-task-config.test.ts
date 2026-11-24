import { describe, expect, it } from "vitest";

import { resolveImageGenerationCount, resolveImageTaskOptions } from "./image-task-config";

describe("resolveImageTaskOptions", () => {
    const defaults = { imageQuality: "high", imageSize: "9:16" };

    it("uses backend defaults when image parameters are missing", () => {
        expect(resolveImageTaskOptions({}, defaults)).toEqual({ quality: "high", size: "9:16", sizeMode: "ratio" });
    });

    it("keeps explicit image parameters", () => {
        expect(resolveImageTaskOptions({ quality: "medium", size: "1:1" }, defaults)).toEqual({ quality: "medium", size: "1:1", sizeMode: "ratio" });
    });

    it("keeps only the explicit transparent output mode", () => {
        expect(resolveImageTaskOptions({ outputBackground: "transparent" }, defaults)).toEqual({ quality: "high", size: "9:16", sizeMode: "ratio", outputBackground: "transparent" });
        expect(resolveImageTaskOptions({ outputBackground: "unknown" }, defaults)).toEqual({ quality: "high", size: "9:16", sizeMode: "ratio" });
    });

    it("keeps only the explicit layer output mode", () => {
        expect(resolveImageTaskOptions({ outputMode: "layers" }, defaults)).toEqual({ quality: "high", size: "9:16", sizeMode: "ratio", outputMode: "layers" });
        expect(resolveImageTaskOptions({ outputMode: "unknown" }, defaults)).toEqual({ quality: "high", size: "9:16", sizeMode: "ratio" });
    });

    it("treats blank image parameters as missing", () => {
        expect(resolveImageTaskOptions({ quality: " ", size: "" }, defaults)).toEqual({ quality: "high", size: "9:16", sizeMode: "ratio" });
    });

    it("derives the size mode from the size or an explicit override", () => {
        expect(resolveImageTaskOptions({ size: "auto" }, defaults).sizeMode).toBe("auto");
        expect(resolveImageTaskOptions({ size: "1536x1024" }, defaults).sizeMode).toBe("custom");
        expect(resolveImageTaskOptions({ size: "3:2", sizeMode: "custom" }, defaults).sizeMode).toBe("custom");
        expect(resolveImageTaskOptions({ size: "3:2", sizeMode: "bogus" }, defaults).sizeMode).toBe("ratio");
    });

    it("falls back to auto when the backend defaults are missing", () => {
        expect(resolveImageTaskOptions({}, {} as never)).toEqual({ quality: "auto", size: "auto", sizeMode: "auto" });
    });
});

describe("resolveImageGenerationCount", () => {
    it("keeps the effective backend or user count without an unconfigured cap", () => {
        expect(resolveImageGenerationCount("3")).toBe(3);
        expect(resolveImageGenerationCount(20)).toBe(20);
        expect(resolveImageGenerationCount(0)).toBe(1);
    });
});
