import { describe, expect, it } from "vitest";

import { computeReferencePreviewAnchor, computeReferencePreviewSize, REFERENCE_PREVIEW_MAX } from "./canvas-reference-preview-layout";

describe("canvas reference preview layout", () => {
    it.each([
        [180, 320, 90, 160],
        [320, 180, 220, 124],
        [100, 100, 100, 100],
        [4000, 3000, 213, 160],
    ])("fits %i×%i into the preview as %i×%i", (width, height, expectedWidth, expectedHeight) => {
        expect(computeReferencePreviewSize(width, height)).toEqual({ width: expectedWidth, height: expectedHeight });
    });

    it("uses a 4:3 placeholder for unknown dimensions", () => {
        expect(computeReferencePreviewSize(undefined, undefined)).toEqual({ width: 213, height: 160 });
        expect(computeReferencePreviewSize(0, 10)).toEqual({ width: 213, height: 160 });
    });

    it("keeps the card inside the viewport and flips above to below when needed", () => {
        const anchor = computeReferencePreviewAnchor(
            { left: 1200, top: 4, right: 1240, bottom: 24, width: 40, height: 20 },
            { width: 90, height: 160 },
            { width: 1280, height: 800 },
        );

        expect(anchor.placement).toBe("below");
        expect(anchor.left).toBeGreaterThanOrEqual(8);
        expect(anchor.left + anchor.cardWidth).toBeLessThanOrEqual(1280 - 8);
        expect(anchor.top).toBeGreaterThanOrEqual(8);
        expect(anchor.top + anchor.cardHeight).toBeLessThanOrEqual(800 - 8);
    });

    it("uses the requested below placement when there is room", () => {
        const anchor = computeReferencePreviewAnchor(
            { left: 400, top: 100, right: 440, bottom: 120, width: 40, height: 20 },
            { width: 213, height: 160 },
            { width: REC_VIEWPORT.width, height: REC_VIEWPORT.height },
            { placement: "below" },
        );

        expect(anchor.placement).toBe("below");
        expect(anchor.top).toBe(128);
    });
});

const REC_VIEWPORT = { width: 1280, height: 800 };
