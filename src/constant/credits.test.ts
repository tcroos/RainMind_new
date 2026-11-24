import { describe, expect, it } from "vitest";
import { generationParameterMultiplier, requestCreditCost } from "./credits";

describe("requestCreditCost", () => {
    it("shares normalized video units and preserves a configured free multiplier", () => {
        const options = { kind: "video" as const, videoQuality: "720p", videoSeconds: 12, generationPointMultipliers: { imageQuality: {}, videoQuality: { "720": 2 }, videoSeconds: { "12": 0 } } };
        expect(generationParameterMultiplier(options)).toBe(0);
        expect(requestCreditCost({ ...options, apiSource: "system", model: "video", modelPointCosts: { video: 10 } })).toBe(0);
        expect(generationParameterMultiplier({ ...options, videoSeconds: 8 })).toBe(2);
    });
    it("calculates system-channel image cost and keeps custom channels free", () => {
        const options = { model: "gpt-image", modelPointCosts: { "gpt-image": 2 }, kind: "image" as const, count: 3 };
        expect(requestCreditCost({ ...options, apiSource: "system" })).toBe(6);
        expect(requestCreditCost({ ...options, apiSource: "custom" })).toBe(0);
    });
    it("免费图片档位让该模型的图片生成报价为 0，但不影响其他能力", () => {
        const logicalModels = [{ id: "gpt-image", name: "gpt-image", capability: "image" as const, enabled: true, tier: "free", bindings: [] }];
        const imageTiers = [{ id: "free", free: true, enabled: true }];
        const options = { apiSource: "system" as const, model: "gpt-image", modelPointCosts: { "gpt-image": 2 }, count: 3, logicalModels, imageTiers };
        expect(requestCreditCost({ ...options, kind: "image" })).toBe(0);
        expect(requestCreditCost({ ...options, kind: "video", videoQuality: "720", videoSeconds: "5" })).toBeGreaterThan(0);
        expect(requestCreditCost({ ...options, kind: "image", imageTiers: [{ id: "free", free: false, enabled: true }] })).toBe(6);
    });
});
