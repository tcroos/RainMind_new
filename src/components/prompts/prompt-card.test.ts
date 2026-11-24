import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 提示词卡片约束：无封面时也要有一块成形的文字封面，
 * 而不是一个 24px 小图标 + 分类碎片的「空壳」观感。
 */
describe("prompt card layout", () => {
    const read = () => readFile(resolve(process.cwd(), "src/components/prompts/prompt-card.tsx"), "utf8");

    it("gives coverless prompts a designed quote cover", async () => {
        const card = await read();

        expect(card).toContain("aspect-[16/9]");
        expect(card).toContain("var(--brand-soft)");
        expect(card).not.toContain('className="grid size-6 shrink-0 place-items-center rounded-lg bg-[var(--brand-soft)]');
    });

    it("shows only title, summary and actions without extra labels", async () => {
        const card = await read();

        expect(card).not.toContain("未添加标签");
        expect(card).not.toContain("我的提示词");
        expect(card).not.toContain("公共词库");
        expect(card).not.toContain("formatPromptDate");
        expect(card).not.toContain("查看提示词");
    });

    it("uses compact circular actions like the asset cards", async () => {
        const card = await read();

        expect(card).toContain('shape="circle"');
        expect(card).toContain('className="library-card-action"');
        expect(card).toContain("<Tooltip title={actionLabel}>");
    });
});
