import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signVideoQuote, signedVideoBillingHeaders, verifiedVideoBillingSnapshot, verifyVideoQuote } from "./system-ai-billing";
import { videoBillingSnapshot } from "@/lib/video-billing";

describe("signed video billing", () => {
    it("binds the billing snapshot to user, route, business identity and exact body", () => {
        const input = { userId: "user", channelId: "channel", model: "video", upstreamModel: "upstream", businessRequestId: "request", body: JSON.stringify({ seconds: 5 }), snapshot: videoBillingSnapshot({ mode: "duration", baseSeconds: 1, referenceVideoSeconds: true }, 5, [{ storageKey: "clip", durationMs: 2300 }]) };
        const headers = new Headers(signedVideoBillingHeaders(input));
        const expected = { ...input, bodyDigest: createHash("sha256").update(input.body).digest("hex") };
        expect(verifiedVideoBillingSnapshot(headers, expected)).toEqual(input.snapshot);
        expect(() => verifiedVideoBillingSnapshot(headers, { ...expected, userId: "other" })).toThrow("不一致");
        expect(() => verifiedVideoBillingSnapshot(headers, { ...expected, bodyDigest: "changed" })).toThrow("不一致");
        const key = [...headers.keys()][0];
        headers.set(key, `${headers.get(key)}x`);
        expect(() => verifiedVideoBillingSnapshot(headers, expected)).toThrow("签名");
    });

    it("binds video quote confirmation to its user, identity and expiration", () => {
        const quote = signVideoQuote("user-one", "quote-identity", 1_000);

        expect(quote.expiresAt).toBeGreaterThan(1_000);
        expect(verifyVideoQuote(quote.confirmation, "user-one", "quote-identity", 1_001)).toBe(true);
        expect(verifyVideoQuote(quote.confirmation, "user-two", "quote-identity", 1_001)).toBe(false);
        expect(verifyVideoQuote(quote.confirmation, "user-one", "changed", 1_001)).toBe(false);
        expect(verifyVideoQuote(quote.confirmation, "user-one", "quote-identity", quote.expiresAt)).toBe(false);
    });
});
