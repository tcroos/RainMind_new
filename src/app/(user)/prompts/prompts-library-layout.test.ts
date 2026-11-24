import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 公共词库面板的结构约束。
 * 只有一排分类胶囊，没有「分类」小字、没有标签下拉；计数与胶囊同一行齐高。
 * 面板从独立页面搬进素材库外壳后，断言读的是面板文件而不是路由壳（路由只剩重定向）。
 */
describe("prompt library layout", () => {
    const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

    it("keeps a single chip row with the total aligned on the same line", async () => {
        const panel = await read("src/components/prompts/public-prompts-panel.tsx");

        expect(panel).not.toContain(">分类<");
        expect(panel).not.toContain('aria-label="提示词标签"');
        expect(panel).not.toContain("<Select");
        expect(panel).toContain("prompt-filter-tag");
        // 计数与分类胶囊共用一行：胶囊是 flex-1，计数是 shrink-0
        expect(panel).toContain('mt-3 flex min-w-0 items-center gap-3');
        expect(panel).toContain("共 {totalPrompts} 条");
        // 搜索框用浅底无线条控件，不再是一圈 antd 描边
        expect(panel).toContain("library-input");
    });

    it("is a panel without its own page header or scroll container", async () => {
        const panel = await read("src/components/prompts/public-prompts-panel.tsx");

        expect(panel).not.toContain("<main");
        expect(panel).not.toContain("<h1");
        expect(panel).not.toContain("overflow-y-auto");
    });

    it("renders covers without the brand logo placeholder or lazy-load grey blocks", async () => {
        const card = await read("src/components/prompts/prompt-card.tsx");

        // 无封面条目很多，一排 Logo 水印会被读成「图片全挂了」
        expect(card).not.toContain("@/components/media/lazy-media-image");
        expect(card).toContain("aspect-[16/9]");
        expect(card).toContain('status === "error"');
        // 首屏不再懒加载：否则下半屏停在灰占位上，看起来像「没有公共提示词」
        expect(card).not.toContain('loading="lazy"');
        expect(card).toContain("img?.complete");
        // 分类压在封面上，标签行不重复分类；模型名（gpt image 2 等）也不显示
        expect(card).toContain("tag !== item.category && !isModelTag(tag)");
        expect(card).toContain("function isModelTag");
    });

    it("shows a skeleton grid instead of a lone spinner while loading", async () => {
        const panel = await read("src/components/prompts/public-prompts-panel.tsx");

        expect(panel).toContain("PromptGridSkeleton");
        expect(panel).not.toContain("h-32 items-center justify-center");
    });

    it("renders the detail dialog as one borderless sheet with shared library buttons", async () => {
        const dialog = await read("src/components/prompts/prompt-detail-dialog.tsx");

        // 详情弹窗里不再有 header / 分栏 / footer 三条分隔线，也不再有 antd 描边 Tag
        expect(dialog).not.toContain("border-b");
        expect(dialog).not.toContain("border-t");
        expect(dialog).not.toContain("border-r");
        expect(dialog).not.toContain("<Tag");
        // 操作按钮和素材库用同一套浅底/橙色控件，不再出现 antd 默认黑按钮
        expect(dialog).toContain("library-primary");
        expect(dialog).toContain("library-tool");
        expect(dialog).toContain("width={1080}");
    });

    it("shows the full prompt with a thin scroll indicator only when it overflows", async () => {
        const dialog = await read("src/components/prompts/prompt-detail-dialog.tsx");

        expect(dialog).not.toContain("展开全部");
        expect(dialog).not.toContain("CLAMP_LENGTH");
        expect(dialog).toContain("whitespace-pre-wrap break-words");
        expect(dialog).toContain('role="scrollbar"');
        expect(dialog).toContain("scrollHeight - clientHeight");
        expect(dialog).toContain("thumb.visible");
        expect(dialog).toContain("[scrollbar-width:none]");
    });
});
