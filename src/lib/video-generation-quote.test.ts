import { describe, expect, it } from "vitest";
import type { VideoGenerationReference } from "./video-reference-contract";
import { isVideoQuoteExpired, videoBillingInputIdentity, videoCharge, videoGenerationSemanticIdentity, videoQuoteKey, videoReferenceIdentity } from "./video-generation-quote";

describe("video quote and consumption contract", () => {
    it("requires reconfirmation when a quote is expired or has no trusted expiry", () => {
        expect(isVideoQuoteExpired({ expiresAt: 1 }, 2)).toBe(true);
        expect(isVideoQuoteExpired({ expiresAt: 2 }, 2)).toBe(true);
        expect(isVideoQuoteExpired({ expiresAt: 3 }, 2)).toBe(false);
        expect(isVideoQuoteExpired({})).toBe(true);
    });
    it("preserves more than 1000 units and rounds units before pricing", () => {
        expect(videoCharge(1200, 400)).toEqual({ units: 1200, points: 480000 });
        expect(videoCharge(1.234, 400)).toEqual({ units: 1.23, points: 492 });
        expect(videoCharge(0, 400)).toEqual({ units: 0, points: 0 });
        expect(() => videoCharge(3000, 400)).toThrow("支持范围");
    });
    it("normalizes managed signatures without removing meaningful external query", () => {
        expect(videoReferenceIdentity("https://site.test/api/reference-assets/clip?signature=old", "https://site.test")).toBe("/api/reference-assets/clip");
        expect(videoReferenceIdentity("https://external.test/api/reference-assets/clip?version=2", "https://site.test")).toContain("?version=2");
        const config = { model: "video" };
        expect(videoQuoteKey(config, [{ type: "video", url: "/api/reference-assets/clip?signature=1" }])).toBe(videoQuoteKey(config, [{ type: "video", url: "/api/reference-assets/clip?signature=2" }]));
        expect(videoQuoteKey(config, [{ type: "video", url: "/api/reference-assets/clip" }])).not.toBe(videoQuoteKey(config, [{ type: "video", url: "/api/reference-assets/clip" }, { type: "video", url: "/api/reference-assets/clip" }]));
        expect(videoQuoteKey(config, [{ type: "video", url: "/api/reference-assets/a" }, { type: "video", url: "/api/reference-assets/b" }])).not.toBe(videoQuoteKey(config, [{ type: "video", url: "/api/reference-assets/b" }, { type: "video", url: "/api/reference-assets/a" }]));
        expect(videoQuoteKey({ ...config, videoGenerateAudio: "true" }, [])).not.toBe(videoQuoteKey({ ...config, videoGenerateAudio: "false" }, []));
    });
    it("binds billing confirmation semantics to model parameters and ordered video sources, independent of task id", () => {
        const config = { model: "video", size: "16:9", vquality: "720", videoSeconds: "5", videoGenerateAudio: "true" };
        const refs = [{ type: "video" as const, url: "/api/reference-assets/clip?signature=one" }];
        const identity = videoBillingInputIdentity(config, refs);
        expect(identity).toBe(videoBillingInputIdentity({ ...config, videoGenerateAudio: "false" }, [{ ...refs[0], url: "/api/reference-assets/clip?signature=two" }]));
        expect(identity).not.toBe(videoBillingInputIdentity({ ...config, model: "other" }, refs));
        expect(identity).not.toBe(videoBillingInputIdentity({ ...config, videoSeconds: "10" }, refs));
        expect(identity).not.toBe(videoBillingInputIdentity(config, [{ type: "video", url: "/api/reference-assets/other" }]));
        expect(identity).not.toBe(videoBillingInputIdentity(config, [{ type: "video", url: "/api/reference-assets/clip", role: "first_frame" }]));
    });
    it("binds generation semantics to every reference and generation option while ignoring signed media query refresh", () => {
        const config = { model: "video", size: "16:9", videoGenerateAudio: "true", videoWatermark: "false" };
        const references: VideoGenerationReference[] = [
            { type: "image" as const, role: "first_frame", url: "/api/reference-assets/frame.png?signature=old" },
            { type: "video" as const, role: "reference", url: "/api/reference-assets/clip.mp4" },
            { type: "audio" as const, role: "reference", url: "/api/reference-assets/voice.wav" },
        ];
        const identity = videoGenerationSemanticIdentity(config, references);
        expect(identity).toBe(videoGenerationSemanticIdentity(config, [{ ...references[0], url: "/api/reference-assets/frame.png?signature=new" }, ...references.slice(1)]));
        expect(identity).not.toBe(videoGenerationSemanticIdentity({ ...config, videoWatermark: "true" }, references));
        expect(identity).not.toBe(videoGenerationSemanticIdentity(config, [{ ...references[0], url: "/api/reference-assets/other.png" }, ...references.slice(1)]));
        expect(identity).not.toBe(videoGenerationSemanticIdentity(config, [references[1], references[0], references[2]]));
    });
});
