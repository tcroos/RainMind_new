import { readFile } from "node:fs/promises";
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
    });

    it("exposes three tabs in one URL-driven state", async () => {
        const page = await read("src/app/(user)/assets/page.tsx");

        for (const label of ['label: "素材"', 'label: "我的提示词"', 'label: "公共词库"']) {
            expect(page).toContain(label);
        }
        expect(page).toContain('rawTab === "mine" || rawTab === "prompts"');
        expect(page).toContain('rawTab === "public"');
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
