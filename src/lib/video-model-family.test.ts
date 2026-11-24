import { describe, expect, it } from "vitest";
import { videoModelFamily } from "./video-model-family";
import { normalizeVideoBillingRule } from "./video-billing";
import { requestCreditCost } from "@/constant/credits";

describe("first video families", () => {
    it("keeps Mini, Fast, and Seedance families separate", () => {
        expect(videoModelFamily("sd2.0-mini933-720p-x15s")?.id).toBe("seedance-2.0-mini");
        expect(videoModelFamily("sd2.0-933-720p-fast-x10s")?.id).toBe("seedance-2.0-fast");
        expect(videoModelFamily("doubao-seedance-2.0-mini")?.id).toBe("seedance-2.0-mini");
        expect(videoModelFamily("doubao-seedance-2.0-fast")?.id).toBe("seedance-2.0-fast");
        expect(videoModelFamily("doubao-seedance-2.0")?.id).toBe("seedance-2.0");
        expect(videoModelFamily("doubao-seedance-2.5")?.id).toBe("seedance-2.5");
    });
    it("merges every MiniMax H3 upstream name into one logical model", () => {
        const expected = "minimax-h3-768p";
        for (const name of [
            "MiniMax-H3",
            "minimax-h3-768p",
            "Minimax-H3-768p-933-10s-15s",
            "MiniMax-H3-933-1440p-10-15s",
            "minimax-h3-720p",
            "minimax-h3-1080p",
            "minimax-h3-2k",
            "minimax-h3-ref",
            "minimax-h3-480p",
        ]) {
            expect(videoModelFamily(name)?.id, name).toBe(expected);
        }
        expect(videoModelFamily("MiniMax-H3")?.name).toBe("MiniMax H3");
        expect(videoModelFamily("MiniMax-H3-MAX")).toBeUndefined();
    });
    it("merges xhaay H3 discount clarity variants into one model", () => {
        for (const name of ["MiniMaxH3-480p-sec", "MiniMaxH3-720p-sec", "MiniMaxH3-2k-sec"]) {
            expect(videoModelFamily(name)?.id, name).toBe("minimax-h3-discount");
            expect(videoModelFamily(name)?.name, name).toBe("MiniMax H3");
        }
        expect(videoModelFamily("MiniMaxH3-480p-realistic-sec")?.id).toBe("minimax-h3-realistic");
    });
    it("groups xhaay H3 request and realistic variants into their own models", () => {
        for (const name of ["MiniMaxH3-480p", "MiniMaxH3-720p", "MiniMaxH3-2k"]) {
            expect(videoModelFamily(name)?.id, name).toBe("minimax-h3-request");
        }
        for (const name of ["MiniMaxH3-480p-realistic-sec", "MiniMaxH3-720p-realistic-sec"]) {
            expect(videoModelFamily(name)?.id, name).toBe("minimax-h3-realistic");
        }
        for (const name of ["MiniMaxH3-480p-realistic", "MiniMaxH3-720p-realistic"]) {
            expect(videoModelFamily(name)?.id, name).toBe("minimax-h3-realistic-request");
        }
    });
    it("quotes each clarity with its resolution multiplier", () => {
        const rule = normalizeVideoBillingRule({ mode: "duration", baseSeconds: 1, resolutionMultipliers: { "480": 10, "768": 15, "1440": 23 } });
        const costs = { "minimax-h3-768p": 1 };
        expect(requestCreditCost({ apiSource: "system", model: "minimax-h3-768p", modelPointCosts: costs, kind: "video", videoQuality: "768", videoSeconds: 10, videoBilling: rule })).toBe(150);
        expect(requestCreditCost({ apiSource: "system", model: "minimax-h3-768p", modelPointCosts: costs, kind: "video", videoQuality: "1440", videoSeconds: 15, videoBilling: rule })).toBe(345);
        expect(requestCreditCost({ apiSource: "system", model: "minimax-h3-768p", modelPointCosts: costs, kind: "video", videoQuality: "480", videoSeconds: 5, videoBilling: rule })).toBe(50);
    });
});
