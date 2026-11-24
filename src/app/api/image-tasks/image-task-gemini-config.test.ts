import { describe, expect, it } from "vitest";
import { geminiImageConfig } from "./image-task-gemini-config";

describe("Gemini image parameters", () => {
    it.each(["1K", "2K", "4K"])("sends %s resolution with both orientations", (quality) => {
        for (const aspectRatio of ["9:16", "16:9"]) expect(geminiImageConfig(aspectRatio, quality)).toEqual({ aspectRatio, imageSize: quality });
    });

    it("preserves automatic parameters and explicit template constants", () => {
        expect(geminiImageConfig()).toEqual({});
        expect(geminiImageConfig("auto", "auto", { imageSize: "4K", personGeneration: "allow_adult" })).toEqual({ imageSize: "4K", personGeneration: "allow_adult" });
        expect(geminiImageConfig("16:9", "low", { imageSize: "4K", aspectRatio: "1:1" })).toEqual({ aspectRatio: "16:9", imageSize: "4K" });
        expect(geminiImageConfig("1536x1024", "medium")).toEqual({ aspectRatio: "3:2", imageSize: "2K" });
    });
});
