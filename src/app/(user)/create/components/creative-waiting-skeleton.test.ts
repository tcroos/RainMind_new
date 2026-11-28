import { describe, expect, it } from "vitest";

import type { CreativeAgentRun } from "@/services/api/creative";

import { creativeWaitingSkeleton } from "./creative-generation-waiting";

describe("creativeWaitingSkeleton", () => {
    it("uses the chosen ratio and count for image rounds", () => {
        const run = { tasks: [], generationPreferences: { image: { size: "3:4", count: 2 } } } as unknown as CreativeAgentRun;
        const skeleton = creativeWaitingSkeleton(run, "image");
        expect(skeleton.count).toBe(2);
        expect(skeleton.ratio).toBeCloseTo(0.75);
    });

    it("falls back to 16:9 for video and hides for text", () => {
        expect(creativeWaitingSkeleton(undefined, "video").ratio).toBeCloseTo(16 / 9);
        expect(creativeWaitingSkeleton(undefined, "audio").count).toBe(0);
    });
});
