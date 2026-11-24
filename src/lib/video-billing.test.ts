import { describe, expect, it } from "vitest";
import { logicalVideoBillingRule, normalizeVideoBillingRule, videoBillingDurationMultiplier, videoBillingSnapshot } from "./video-billing";
import { requestCreditCost } from "@/constant/credits";

describe("explicit video billing", () => {
    it("rounds each reference occurrence upward and never deduplicates its charge", () => {
        const rule = { mode: "duration" as const, baseSeconds: 1, referenceVideoSeconds: true };
        const snapshot = videoBillingSnapshot(rule, 5, [{ storageKey: "same", durationMs: 2300 }, { storageKey: "same", durationMs: 2300 }]);
        expect(snapshot).toMatchObject({ outputSeconds: 5, referenceSeconds: 6, totalSeconds: 11 });
        expect(requestCreditCost({ apiSource: "system", model: "video", modelPointCosts: { video: 400 }, kind: "video", videoSeconds: videoBillingSnapshot(rule, 5, [{ storageKey: "ref", durationMs: 15000 }]).totalSeconds, videoBilling: rule })).toBe(8000);
        expect(videoBillingSnapshot({ mode: "fixed" }, 5, [{ storageKey: "ref", durationMs: 15000 }]).totalSeconds).toBe(5);
        expect(() => videoBillingSnapshot(rule, 5, [{ storageKey: "ref", durationMs: NaN }])).toThrow("可信时长");
        expect(normalizeVideoBillingRule(rule)).toEqual(rule);
    });
    it("charges fixed models once and duration models relative to their configured base", () => {
        expect(videoBillingDurationMultiplier({ mode: "fixed" }, 15, 3)).toBe(1);
        expect(videoBillingDurationMultiplier({ mode: "duration", baseSeconds: 10 }, 15, 1)).toBe(1.5);
        expect(videoBillingDurationMultiplier(undefined, 15, 3)).toBe(3);
        expect(() => videoBillingDurationMultiplier({ mode: "duration", baseSeconds: 10 }, undefined, 1)).toThrow("有效生成时长");
        expect(normalizeVideoBillingRule({ mode: "duration", baseSeconds: 0 })).toBeUndefined();
    });
    it("uses the same explicit duration price in expected credits", () => {
        expect(requestCreditCost({ apiSource: "system", model: "video", kind: "video", modelPointCosts: { video: 100 }, videoSeconds: 15, videoBilling: { mode: "duration", baseSeconds: 10 } })).toBe(150);
    });
    it("retains the primary logical model price when routing falls back", () => {
        const models = [
            {
                id: "video",
                bindings: [
                    { enabled: true, priority: 2, capabilityProfile: { videoBilling: { mode: "fixed" as const } } },
                    { enabled: true, priority: 1, capabilityProfile: { videoBilling: { mode: "duration" as const, baseSeconds: 10 } } },
                ],
            },
        ];
        expect(logicalVideoBillingRule(models, "video")).toEqual({ mode: "duration", baseSeconds: 10 });
    });
});
