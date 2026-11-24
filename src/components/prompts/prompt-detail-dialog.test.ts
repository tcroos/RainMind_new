import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 详情弹窗的布局约束：固定高度 + 正文内部滚动，不折叠、不出现分隔线。
 */
describe("prompt detail dialog layout", () => {
    const read = () => readFile(resolve(process.cwd(), "src/components/prompts/prompt-detail-dialog.tsx"), "utf8");

    it("locks the dialog height and scrolls the full prompt inside it", async () => {
        const dialog = await read();

        expect(dialog).toContain("h-[min(82dvh,640px)]");
        expect(dialog).toContain("max-h-[calc(100dvh-32px)]");
        expect(dialog).toContain("overflow-y-auto overscroll-contain");
        expect(dialog).toContain("whitespace-pre-wrap break-words");
        // 用户明确要去掉「展开全部」：全文直出，靠内部滚动阅读
        expect(dialog).not.toContain("展开全部");
        expect(dialog).not.toContain("line-clamp-6");
    });

    it("shows a draggable thin scroll indicator only when the content overflows", async () => {
        const dialog = await read();

        expect(dialog).toContain('role="scrollbar"');
        expect(dialog).toContain("scrollHeight - clientHeight");
        expect(dialog).toContain("thumb.visible");
        expect(dialog).toContain("onPointerDown");
        expect(dialog).toContain("seekTo");
        expect(dialog).toContain("[scrollbar-width:none]");
    });

    it("reuses the list thumbnail and falls back to the original source", async () => {
        const dialog = await read();

        expect(dialog).toContain("previewUrl ||");
        expect(dialog).toContain("originalImageSourceUrl");
        expect(dialog).toContain("object-contain");
        expect(dialog).not.toContain("border-b");
        expect(dialog).not.toContain("border-t");
    });
});
