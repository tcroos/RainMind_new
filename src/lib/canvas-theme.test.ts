import { describe, expect, it } from "vitest";

import { canvasThemes } from "./canvas-theme";

describe("canvas theme backgrounds", () => {
    it("uses a white light workspace and a dark workspace", () => {
        expect(canvasThemes.light.canvas.background).toBe("#fafafa");
        expect(canvasThemes.light.canvas.backdrop).toBe("#fafafa");
        expect(canvasThemes.dark.canvas.background).toBe("#1b1b1d");
        expect(canvasThemes.dark.canvas.backdrop).toBe("#1b1b1d");
    });

    it("keeps the established light palette and neutral dark workspace", () => {
        expect(canvasThemes.light.node.fill).toBe("#eef6fb");
        expect(canvasThemes.light.node.stroke).toBe("#d9e7ee");
        expect(canvasThemes.light.toolbar.itemHover).toBe("#eef6fb");
        expect(canvasThemes.light.node.activeStroke).toBe("#0f172a");
        expect(canvasThemes.dark.node.fill).toBe("#202023");
        expect(canvasThemes.dark.node.activeStroke).toBe("#ffffff");
    });

    it("exposes separate edge states for idle, hover, selection, and flow", () => {
        expect(canvasThemes.dark.edge).toEqual({
            idle: "#c0c8d0",
            hover: "#c0c8d0",
            selected: "#e0e4e8",
            flow: "#64b4ff",
        });
        expect(canvasThemes.light.edge).toEqual({
            idle: "#c0c8d0",
            hover: "#c0c8d0",
            selected: "#e0e4e8",
            flow: "#64b4ff",
        });
    });
});
