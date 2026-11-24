import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Canvas video tier picker", () => {
    it("renders its menu in a body portal so panel overflow cannot clip it", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-video-tier-picker.tsx"), "utf8");
        expect(source).toContain("createPortal");
        expect(source).toContain("document.body");
        expect(source).toContain('position: "fixed"');
        expect(source).not.toContain("absolute bottom-full");
    });
});
