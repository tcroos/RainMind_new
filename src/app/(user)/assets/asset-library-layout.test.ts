import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 素材库外壳的结构约束：三段内容共用一个标题、一组 tab、一个滚动容器。
 * 之前把提示词「硬塞」进来的症状就是两个 h1、两个 <main>、两条滚动条。
 */
describe("asset library shell", () => {
    const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

    it("keeps exactly one page header, one main and one tab list", async () => {
        const page = await read("src/app/(user)/assets/page.tsx");

        expect(page.match(/<h1/g)).toHaveLength(1);
        expect(page.match(/<main/g)).toHaveLength(1);
        expect(page).toContain("<LibraryTabs");
        expect(page).not.toContain("<LibraryTab ");
        // 页头只有标题 + tab，不再挂逐 tab 的营销副标题
        expect(page).not.toContain("发现公共提示词");
        expect(page).not.toContain("把调好的提示词存成自己的库");
        expect(page).not.toContain("集中管理创作中复用的内容");
    });

    it("keeps the empty-state showcase compact", async () => {
        const ui = await read("src/components/library/library-ui.tsx");

        expect(ui).toContain("max-w-[380px]");
        expect(ui).toContain("aspect-[2/1]");
        await access("public/library/asset-empty-banner.webp");
        // 「示例：……」那行说明与冗长描述已经删掉
        expect(ui).not.toContain("示例：把常用的字体");
    });

    it("exposes three tabs in the agreed order and defaults to the public library", async () => {
        const page = await read("src/app/(user)/assets/page.tsx");

        const order = ['label: "公共词库"', 'label: "我的提示词"', 'label: "我的素材"'].map((label) => page.indexOf(label));
        expect(order.every((index) => index >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);

        expect(page).toContain('rawTab === "mine" || rawTab === "prompts"');
        expect(page).toContain('rawTab === "assets" ? "assets" : "public"');
    });

    it("keeps the toolbar clean: import/export gone, new asset button stays in the toolbar", async () => {
        const page = await read("src/app/(user)/assets/page.tsx");

        expect(page).not.toContain("导出全部素材");
        expect(page).not.toContain("从压缩包导入");
        expect(page).not.toContain("importAssetZip");
        expect(page).not.toContain("exportAllAssets");
        expect(page).toContain("新增素材");
    });

    it("matches the large controls of the other tabs and has one empty-state CTA", async () => {
        const page = await read("src/app/(user)/assets/page.tsx");
        const css = await read("src/app/styles/global-library.css");

        expect(page).not.toContain('size="middle"');
        expect(page).toContain('size="large"');
        expect(css).toContain("min-height: 40px");
        // 完全空白时隐藏工具栏的新增按钮，只在下方引导区保留一个入口
        expect(page).toContain("(loading || assets.length > 0)");
        expect(page).toContain("LibraryShowcaseEmptyState");
        await access("public/library/asset-empty-banner.webp");
    });

    it("switches tabs through history state instead of an RSC navigation", async () => {
        const page = await read("src/app/(user)/assets/page.tsx");
        const tabs = await read("src/components/library/library-ui.tsx");

        expect(page).toContain("window.history.pushState");
        expect(page).toContain("<LibraryTabs tabs={LIBRARY_TABS} active={tab} onSelect={selectTab}");
        expect(tabs).toContain("onSelect");
        expect(tabs).toContain("event.preventDefault()");
    });

    it("preloads the my-prompts panel so switching tabs never flashes a skeleton", async () => {
        const page = await read("src/app/(user)/assets/page.tsx");

        // my-prompts 常驻挂载，靠 hidden 切换显示：首次进入素材库就开始取自己的数据
        expect(page).toContain('<div className={tab === "mine" ? "" : "hidden"}');
        expect(page).toContain("<MyPromptsPage />");
        expect(page).not.toContain('tab === "mine" ? (\n                        <MyPromptsPage />');
    });

    it("does not show pagination on an empty library", async () => {
        const page = await read("src/app/(user)/assets/page.tsx");

        expect(page).toContain("!loading && assets.length > 0 && total > pageSize");
    });

    it("keeps the sidebar free of flyout menus", async () => {
        const nav = await read("src/components/layout/workspace-nav-list.tsx");
        const config = await read("src/constant/navigation-tools.ts");

        expect(nav).not.toContain("Popover");
        expect(nav).not.toContain("NavFlyout");
        expect(config).not.toContain("children:");
    });
});
