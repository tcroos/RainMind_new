import { describe, expect, it } from "vitest";

import { imageApiSize, resolveImageApiQuality, resolveImageApiRequestSize, resolveImageApiSizeMode } from "./image-task-openai-request";

type TaskConfig = Parameters<typeof resolveImageApiRequestSize>[0];

const imageOptions = { sizeModes: ["auto", "ratio", "custom"], resolutions: ["1K", "2K", "4K"], qualities: ["auto", "low", "high"] };

function config(overrides: Record<string, unknown>): TaskConfig {
    return {
        model: "gpt-image-2.5",
        capabilityProfile: {
            aspectRatios: ["1:1", "9:16", "3:4"],
            resolutions: ["1K", "2K", "4K"],
            imageOptions,
        },
        ...overrides,
    } as unknown as TaskConfig;
}

describe("resolveImageApiRequestSize", () => {
    it("derives the ratio mode when the client omits sizeMode", () => {
        expect(resolveImageApiSizeMode({ size: "9:16" } as never)).toBe("ratio");
        expect(resolveImageApiSizeMode({ size: "1536x1024" } as never)).toBe("custom");
        expect(resolveImageApiSizeMode({ size: "auto" } as never)).toBe("auto");
        expect(resolveImageApiSizeMode({ size: "3:4", sizeMode: "custom" } as never)).toBe("custom");
    });

    it("returns a usable size for edits, which previously sent none", () => {
        expect(resolveImageApiRequestSize(config({ size: "9:16", sizeMode: "ratio" }))).toBe("768x1360");
        expect(resolveImageApiRequestSize(config({ size: "9:16", sizeMode: "ratio", resolution: "2K" }))).toBe("1536x2720");
        expect(resolveImageApiRequestSize(config({ size: "1536x1024", sizeMode: "custom" }))).toBe("1536x1024");
        expect(resolveImageApiRequestSize(config({ size: "auto", sizeMode: "auto" }))).toBeUndefined();
    });

    it("passes ratio strings through for channels that reject pixel sizes", () => {
        const ratioConfig = config({ size: "16:9", sizeMode: "ratio" });
        (ratioConfig.capabilityProfile as Record<string, unknown>).sizeFormat = "ratio";
        expect(resolveImageApiRequestSize(ratioConfig)).toBe("16:9");
        expect(resolveImageApiRequestSize({ ...ratioConfig, size: "3:4", resolution: "2K" })).toBe("3:4");
        // 自定义像素尺寸仍然照常下发
        expect(resolveImageApiRequestSize({ ...ratioConfig, size: "1536x1024", sizeMode: "custom" })).toBe("1536x1024");
    });

    it("only forwards qualities the channel declares", () => {
        expect(resolveImageApiQuality(config({ quality: "high" }))).toBe("high");
        expect(resolveImageApiQuality(config({ quality: "auto" }))).toBeUndefined();
        // 未声明的画质是配置错误，应显式失败而不是静默丢弃
        expect(() => resolveImageApiQuality(config({ quality: "ultra" }))).toThrow();
    });
});

describe("imageApiSize", () => {
    it("omits the size only for auto mode", () => {
        expect(imageApiSize("auto", "9:16", "2K")).toBeUndefined();
    });

    it("scales the long edge by area so 1K keeps a sensible short side", () => {
        // 未声明分辨率时沿用平台默认短边 1024
        expect(imageApiSize("ratio", "9:16")).toBe("1024x1824");
        expect(imageApiSize("ratio", "9:16", "1K")).toBe("768x1360");
        expect(imageApiSize("ratio", "16:9", "1K")).toBe("1360x768");
        expect(imageApiSize("ratio", "1:1", "1K")).toBe("1024x1024");
    });

    it("maps 2K and 4K to the medium and high bases", () => {
        expect(imageApiSize("ratio", "9:16", "2K")).toBe("1536x2720");
        expect(imageApiSize("ratio", "16:9", "2K")).toBe("2720x1536");
        expect(imageApiSize("ratio", "9:16", "4K")).toBe("2160x3840");
        expect(imageApiSize("ratio", "4:3", "4K")).toBe("3312x2480");
    });

    it("keeps wide ratios above the minimum pixel budget", () => {
        expect(imageApiSize("ratio", "21:9", "1K")).toBe("1552x672");
    });

    it("passes explicit dimensions through after validation", () => {
        expect(imageApiSize("custom", "1536x1024")).toBe("1536x1024");
        expect(() => imageApiSize("custom", "auto")).toThrow();
        expect(() => imageApiSize("custom", "abc")).toThrow();
    });

    it("rejects an unsupported ratio", () => {
        expect(() => imageApiSize("ratio", "nope")).toThrow();
    });
});
