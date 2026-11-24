import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 公共词库面板的结构约束。
 * 分类只有 7 个，用一排胶囊比两个下拉更快扫读；标签留一个下拉，避免两排一模一样的胶囊。
 * 面板从独立页面搬进素材库外壳后，断言读的是面板文件而不是路由壳（路由只剩重定向）。
 */
describe("prompt library layout", () => {
    const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

    it("keeps one category chip row plus a tag dropdown in the toolbar", async () => {
        const panel = await read("src/components/prompts/public-prompts-panel.tsx");

        expect(panel).toContain(">分类<");
        expect(panel).not.toContain('label="标签"');
        expect(panel).toContain('aria-label="提示词标签"');
        expect(panel).toContain("prompt-filter-tag");
        // 搜索框与下拉用浅底无线条控件，不再是一圈 antd 描边
        expect(panel).toContain("library-input");
        expect(panel).toContain("library-select");
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
        expect(card).toContain("aspect-[16/10]");
        expect(card).toContain('status === "error"');
        // 首屏不再懒加载：否则下半屏停在灰占位上，看起来像「没有公共提示词」
        expect(card).not.toContain('loading="lazy"');
        expect(card).toContain("img?.complete");
        // 分类压在封面上，标签行不再重复同一个词
        expect(card).toContain("item.tags.filter((tag) => tag !== item.category)");
    });

    it("shows a skeleton grid instead of a lone spinner while loading", async () => {
        const panel = await read("src/components/prompts/public-prompts-panel.tsx");

        expect(panel).toContain("PromptGridSkeleton");
        expect(panel).not.toContain("h-32 items-center justify-center");
    });
});
