import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizePositiveInteger, normalizePositiveNumber, normalizeVideoQuality } from "@/components/creative-generation-preference-fields";
import {
    generationDurationOptions,
    generationDurationRange,
    generationCountSelectionOptions,
    generationImageQualityOptions,
    generationImageQualitySelection,
    generationPreferenceSummary,
    generationRatioOptions,
    generationResolutionOptions,
    normalizeGenerationCount,
} from "@/components/creative-generation-preferences";

describe("generationPreferenceSummary", () => {
    it("uses administrator duration bounds and snaps to supported discrete model durations", () => {
        const continuous = generationDurationRange({ minDurationSeconds: 4, maxDurationSeconds: 15 });
        expect([continuous.min, continuous.max, continuous.normalize(2), continuous.normalize(20)]).toEqual([4, 15, 4, 15]);
        const rangedBindings = { durationSeconds: [10, 15], minDurationSeconds: 5, maxDurationSeconds: 15 };
        const seedanceRange = generationDurationRange(rangedBindings);
        expect([seedanceRange.min, seedanceRange.max, seedanceRange.normalize(8)]).toEqual([5, 15, 8]);
        expect(generationDurationOptions(rangedBindings).map((option) => option.value)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        expect(generationDurationOptions({ durationSeconds: [10, 15], minDurationSeconds: 10, maxDurationSeconds: 15 }).map((option) => option.value)).toEqual([10, 11, 12, 13, 14, 15]);
        const discrete = generationDurationRange({ durationSeconds: [10, 5, 15] });
        expect([discrete.min, discrete.max, discrete.normalize(6), discrete.normalize(30)]).toEqual([5, 15, 10, 15]);
    });
    it("keeps image, video and audio settings readable in one compact label", () => {
        expect(generationPreferenceSummary("image", {})).toBe("智能参数");
        expect(generationPreferenceSummary("video", { video: { size: "16:9", quality: "2160", seconds: 60, count: 3, generateAudio: false, watermark: true } })).toBe("16:9 · 2160P · 60秒 · 无声 · 带水印 · 3条");
        expect(generationPreferenceSummary("image", { image: { size: "1024x1536", quality: "high", count: 2 } })).toBe("1024×1536 · 高画质 · 2张");
        expect(generationPreferenceSummary("audio", { audio: { voice: "nova", format: "wav", speed: 1.25 } })).toBe("Nova · WAV · 1.25x");
        expect(generationPreferenceSummary("video", {})).toBe("智能参数 · 5秒 · 有声 · 无水印");
        expect(generationPreferenceSummary("video", {}, { minDurationSeconds: 10, maxDurationSeconds: 15, resolutions: ["768"] })).toBe("智能参数 · 10秒 · 有声 · 无水印");
    });

    it("hides automatic image quality and displays low until a quality is chosen", () => {
        const profile = { imageOptions: { sizeModes: ["auto", "ratio"] as Array<"auto" | "ratio">, resolutions: ["1K", "2K"], qualities: ["auto", "low", "medium", "high"] } };
        const options = generationImageQualityOptions(profile);

        expect(options.map((option) => option.value)).toEqual(["low", "medium", "high"]);
        expect(generationImageQualitySelection("auto", options)).toBe("low");
        expect(generationImageQualitySelection(undefined, options)).toBe("low");
        expect(generationImageQualitySelection("high", options)).toBe("high");
        expect(generationPreferenceSummary("image", { image: { size: "1:1", sizeMode: "ratio", resolution: "2K", quality: "auto" } }, profile)).toBe("2K · 1:1 · 低");
    });

    it("accepts custom generation counts within the server contract", () => {
        expect(normalizeGenerationCount("6")).toBe(6);
        expect(normalizeGenerationCount(10)).toBe(10);
        expect(normalizeGenerationCount(11)).toBe(11);
        expect(normalizeGenerationCount("0")).toBe(0);
        expect(normalizeGenerationCount("6份")).toBe(0);
    });

    it("keeps image count dropdown options within the model limit", () => {
        expect(generationCountSelectionOptions(3).map((option) => option.value)).toEqual([1, 2, 3]);
        expect(generationCountSelectionOptions(6).map((option) => option.value)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(generationCountSelectionOptions(undefined, 6).map((option) => option.value)).toEqual([1, 2, 3, 4, 6]);
    });

    it("accepts open-ended video and audio values without inventing capability ceilings", () => {
        expect(normalizeVideoQuality(" 8K ")).toBe("8K");
        expect(normalizePositiveInteger(60)).toBe(60);
        expect(normalizePositiveInteger(1.5)).toBe(0);
        expect(normalizePositiveNumber(8)).toBe(8);
        expect(normalizePositiveNumber(0)).toBe(0);
    });

    it("keeps intelligent ratio and hides smart quality for a single fixed resolution", () => {
        expect(generationRatioOptions("image", { aspectRatios: ["9:16"] }).map((option) => option.value)).toEqual(["auto", "9:16"]);
        expect(generationResolutionOptions("video", { resolutions: ["1080P"] }).map((option) => option.value)).toEqual(["1080P"]);
        expect(generationResolutionOptions("video", { resolutions: ["768"] }).map((option) => option.label)).toEqual(["768P"]);
        expect(generationResolutionOptions("video", { resolutions: ["1440"] }).map((option) => option.label)).toEqual(["1440P"]);
        expect(generationRatioOptions("image", { aspectRatios: ["1:1", "1024x1024"] }).map((option) => option.value)).toEqual(["auto", "1:1", "1024x1024"]);
    });

    it("does not expose custom pixel inputs", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/creative-generation-preferences.tsx"), "utf8");

        expect(source).not.toContain("CustomMediaSizeEditor");
        expect(source).not.toContain("DimensionInput");
    });

    it("keeps declared size presets without exposing duplicate resolution presets", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/creative-generation-preferences.tsx"), "utf8");

        expect(source).not.toContain("高分辨率");
        expect(source).not.toContain('label: "2K 16:9"');
        expect(source).not.toContain('label: "4K 9:16"');
        expect(source).toContain("pixelSizes.map");
        expect(source).not.toContain('label: "自定义"');
    });

    it("keeps media type above one compact parameter panel without section headings", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/creative-generation-preferences.tsx"), "utf8");

        expect(source.indexOf("availableCapabilities.map")).toBeLessThan(source.indexOf("<PreferencePanel"));
        expect(source).not.toContain(">画面与尺寸</div>");
        expect(source).not.toContain(">输出与生成</div>");
        expect(source).not.toContain('label="尺寸模式"');
        expect(source).not.toContain("预计尺寸");
        expect(source).not.toContain("previewImageDimensions");
        expect(source).toContain("icon: ratioPreviewIcon(option)");
        expect(source).toContain('label="数量" ariaLabel="选择图片生成数量"');
        expect(source).toContain("onChange={(nextCount) => onChange({ count: nextCount })}");
    });
});
