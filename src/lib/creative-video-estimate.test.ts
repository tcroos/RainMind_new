import { describe, expect, it } from "vitest";

import { estimateCreativeVideoCost } from "./creative-video-estimate";

describe("creative video cost estimate", () => {
    const config = {
        apiSource: "system" as const,
        modelPointCosts: { "seedance-2.0-mini": 23, "seedance-2.0-fast": 38, "minimax-h3-768p": 15, "minimax-h3-1440p": 23 },
        generationPointMultipliers: { imageQuality: {}, videoQuality: { "720": 1, "768": 1, "1440": 1 }, videoSeconds: {} },
        logicalModels: [],
        videoSeconds: "10",
        vquality: "720",
    };
    const model = (id: string, resolution: string, minDurationSeconds?: number) => ({
        id,
        name: id,
        capability: "video" as const,
        capabilityProfile: { resolutions: [resolution], minDurationSeconds, maxDurationSeconds: 15, videoBilling: { mode: "duration" as const, baseSeconds: 1 } },
    });

    it.each([
        [model("seedance-2.0-mini", "720", 5), 230],
        [model("seedance-2.0-fast", "720", 5), 380],
        [model("minimax-h3-768p", "768", 10), 150],
        [model("minimax-h3-1440p", "1440", 10), 230],
    ])("shows a model-specific per-second estimate", (selectedModel, expected) => {
        expect(estimateCreativeVideoCost(config, [selectedModel], { video: { seconds: 10 } })).toBe(expected);
    });

    it.each([
        [model("seedance-2.0-mini", "720", 5), 115],
        [model("seedance-2.0-fast", "720", 5), 190],
        [model("minimax-h3-768p", "768", 10), 150],
        [model("minimax-h3-1440p", "1440", 10), 230],
    ])("matches the parameter panel's default duration for %s", (selectedModel, expected) => {
        expect(estimateCreativeVideoCost(config, [selectedModel], {})).toBe(expected);
    });

    it("sums the cost of selected video models using the backend output allocation", () => {
        const mini = model("seedance-2.0-mini", "720", 5);
        const fast = model("seedance-2.0-fast", "720", 5);
        expect(estimateCreativeVideoCost(config, [mini, fast], { video: { seconds: 10 } })).toBe(610);
        expect(estimateCreativeVideoCost(config, [mini, fast], { video: { seconds: 10, count: 4 } })).toBe(1220);
        expect(estimateCreativeVideoCost(config, [model("minimax-h3-768p", "768", 10), model("minimax-h3-1440p", "1440", 10)], { video: { seconds: 10, count: 3 } })).toBe(530);
    });
});
