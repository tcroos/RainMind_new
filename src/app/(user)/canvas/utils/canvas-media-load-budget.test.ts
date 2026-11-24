import { describe, expect, it } from "vitest";

import { CANVAS_MEDIA_LOW_ZOOM, CANVAS_MEDIA_MID_ZOOM, canvasMediaLoadBudget, selectCanvasMediaLoadIds } from "./canvas-media-load-budget";

describe("canvas media load budget", () => {
    it("loads a full visible image batch at the 30% minimum zoom", () => {
        expect(canvasMediaLoadBudget(0.16)).toBe(80);
        expect(canvasMediaLoadBudget(CANVAS_MEDIA_LOW_ZOOM - 0.01)).toBe(80);
    });

    it("caps media requests at typical and close zoom", () => {
        expect(canvasMediaLoadBudget(CANVAS_MEDIA_LOW_ZOOM)).toBe(40);
        expect(canvasMediaLoadBudget(CANVAS_MEDIA_MID_ZOOM - 0.01)).toBe(40);
        expect(canvasMediaLoadBudget(CANVAS_MEDIA_MID_ZOOM)).toBe(80);
        expect(canvasMediaLoadBudget(2)).toBe(80);
    });

    it("fails closed for invalid scale values", () => {
        expect(canvasMediaLoadBudget(Number.NaN)).toBe(0);
        expect(canvasMediaLoadBudget(Number.POSITIVE_INFINITY)).toBe(0);
    });
});

describe("selectCanvasMediaLoadIds", () => {
    it("caps forced selection nodes inside the budget", () => {
        const candidates = Array.from({ length: 200 }, (_, index) => ({
            id: `node-${index}`,
            distance: index,
            forced: index < 50,
        }));
        const ids = selectCanvasMediaLoadIds(0.1, candidates);
        expect(ids.size).toBe(80);
        expect([...ids].filter((id) => Number(id.replace("node-", "")) < 50)).toHaveLength(50);
    });

    it("prefers forced nodes then nearest viewport nodes", () => {
        const ids = selectCanvasMediaLoadIds(0.1, [
            { id: "far", distance: 900, forced: false },
            { id: "near", distance: 1, forced: false },
            { id: "selected", distance: 5000, forced: true },
        ]);
        expect([...ids]).toEqual(["selected", "near", "far"]);
    });

    it("never exceeds the tier budget with a large canvas", () => {
        const candidates = Array.from({ length: 716 }, (_, index) => ({
            id: `image-${index}`,
            distance: index,
            forced: index < 3,
        }));
        expect(selectCanvasMediaLoadIds(0.1, candidates).size).toBe(80);
        expect(selectCanvasMediaLoadIds(0.5, candidates).size).toBe(40);
        expect(selectCanvasMediaLoadIds(1, candidates).size).toBe(80);
    });

    it("returns nothing for an invalid scale", () => {
        expect(selectCanvasMediaLoadIds(Number.NaN, [{ id: "a", distance: 0, forced: true }]).size).toBe(0);
    });
});
