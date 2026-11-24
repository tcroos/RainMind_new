import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "./store-foundation";
import { normalizeGenerationControl } from "./store-normalizers";

describe("normalizeGenerationControl", () => {
    it("缺失时回落到当前线上默认", () => {
        const control = normalizeGenerationControl(undefined);
        expect(control.rateLimits.image).toEqual({ maxRequests: 60, windowMs: 60000 });
        expect(control.rateLimits.video.maxRequests).toBe(12);
        expect(control.rateLimits.text.maxRequests).toBe(120);
        expect(control.retry).toEqual({ maxAttempts: 4, sameChannelRetry: true, autoRefund: true });
    });

    it("保留合法配置并 clamping 非法值", () => {
        const control = normalizeGenerationControl({
            rateLimits: {
                image: { maxRequests: 5, windowMs: 30000 },
                video: { maxRequests: 0, windowMs: 10 },
            } as never,
            retry: { maxAttempts: 8, sameChannelRetry: false, autoRefund: false },
        });
        expect(control.rateLimits.image).toEqual({ maxRequests: 5, windowMs: 30000 });
        expect(control.rateLimits.video).toEqual(DEFAULT_SETTINGS.generationControl.rateLimits.video);
        expect(control.retry).toEqual({ maxAttempts: 8, sameChannelRetry: false, autoRefund: false });
    });
});
