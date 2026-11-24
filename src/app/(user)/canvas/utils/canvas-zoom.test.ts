import { describe, expect, it } from "vitest";

import { CANVAS_MIN_ZOOM } from "./canvas-zoom";

describe("canvas zoom limits", () => {
    it("keeps the canvas at or above 30% zoom", () => {
        expect(CANVAS_MIN_ZOOM).toBe(0.3);
    });
});
