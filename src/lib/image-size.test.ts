import { describe, expect, it } from "vitest";

import { extractImageOrientationFromPrompt, imageSizeMatchesOrientation, normalizeImageSizeValue, parseImageDimensions, resolveImageRequestSize } from "./image-size";

describe("image size input", () => {
    it("normalizes supported dimension separators", () => {
        expect(parseImageDimensions("1080*1213")).toEqual({ width: 1080, height: 1213 });
        expect(normalizeImageSizeValue("1080×1213")).toBe("1080x1213");
    });

    it("ignores numeric dimensions extracted from natural-language prompts", () => {
        const base = { prompt: "生成 1280x720 图片", configuredSize: "1824x1024", configuredSizeExplicit: true, referenceWidth: 1024, referenceHeight: 1536, plannedSize: "1:1", defaultSize: "4:3" };
        expect(resolveImageRequestSize(base)).toBe("1824x1024");
        expect(resolveImageRequestSize({ ...base, prompt: "商品卖点 80×40CM", configuredSize: "1:1" })).toBe("1:1");
        expect(resolveImageRequestSize({ ...base, prompt: "生成 1280x720 图片", configuredSize: "auto" })).toBe("2:3");
    });

    it("recognizes orientation wording without forcing it to a fixed ratio", () => {
        expect(extractImageOrientationFromPrompt("把当前图片换成横屏尺寸")).toBe("landscape");
        expect(extractImageOrientationFromPrompt("不要横版，改成竖屏")).toBe("portrait");
        expect(extractImageOrientationFromPrompt("输出一张方形主图")).toBe("square");
        expect(imageSizeMatchesOrientation("1824x1024", "landscape")).toBe(true);
        expect(imageSizeMatchesOrientation("2:3", "landscape")).toBe(false);
    });

    it("resolves custom dimensions, reference ratio, planner, and defaults in order", () => {
        const base = { prompt: "生成图片", configuredSize: "1824x1024", referenceWidth: 1024, referenceHeight: 1536, plannedSize: "1:1", defaultSize: "4:3" };

        expect(resolveImageRequestSize(base)).toBe("1824x1024");
        expect(resolveImageRequestSize({ ...base, configuredSize: "1:1" })).toBe("2:3");
        expect(resolveImageRequestSize({ ...base, configuredSize: "1:1", referenceWidth: undefined, referenceHeight: undefined })).toBe("1:1");
        expect(resolveImageRequestSize({ ...base, configuredSize: "auto", referenceWidth: undefined, referenceHeight: undefined, plannedSize: undefined })).toBe("auto");
    });

    it("keeps a user-locked ratio ahead of reference image inference", () => {
        const input = { prompt: "生成图片", configuredSize: "16:9", configuredSizeExplicit: true, referenceWidth: 1024, referenceHeight: 1024, defaultSize: "1:1" };

        expect(resolveImageRequestSize(input)).toBe("16:9");
        expect(resolveImageRequestSize({ ...input, configuredSize: "auto", configuredSizeExplicit: false })).toBe("1:1");
    });
});
