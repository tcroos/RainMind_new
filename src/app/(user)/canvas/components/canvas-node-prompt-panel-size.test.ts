import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function source(name: string) {
    return readFile(resolve(process.cwd(), `src/app/(user)/canvas/components/${name}`), "utf8");
}

describe("Canvas prompt panel reference sizing", () => {
    it("sizes the panel from the node width instead of a fixed 960px panel", async () => {
        const node = await source("canvas-node.tsx");
        expect(node).toContain("Math.max(685, Math.min(760, data.width))");
        expect(node).toContain('minHeight: "238px"');
        expect(node).not.toContain("w-[960px]");
    });

    it("keeps three lines compact and expands to exactly four larger lines", async () => {
        const panel = await source("canvas-node-prompt-panel.tsx");
        expect(panel).toContain("rounded-[20px] p-2");
        expect(panel).toContain("const maxHeight = 172.8");
        expect(panel).toContain("Math.max(144");
        expect(panel).toContain('overflowY: "auto"');
        expect(panel).toContain('scrollbarGutter: "stable both-edges"');
        expect(panel).toContain("const promptFontSize = 16");
        expect(panel).toContain("const promptLineHeight = 28.8");
        expect(panel).toContain("flex-nowrap");
        expect(panel).toContain('width="46vw"');
        expect(panel).toContain("h-[68dvh]");
    });

    it("uses the shared cancellable hover timer for reference media previews", async () => {
        const panel = await source("canvas-node-prompt-panel.tsx");
        const mentions = await source("canvas-resource-mention-textarea.tsx");
        expect(panel).toContain("scheduleCanvasHoverPreview");
        expect(mentions).toContain("scheduleCanvasHoverPreview");
    });
});
