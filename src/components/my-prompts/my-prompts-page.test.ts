import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 「我的提示词」的展示约束。
 * 原来是一张 antd Table：小屏挤、卡片信息层级也弱。现在与词库共用一套卡片。
 */
describe("my prompts page layout", () => {
    const read = () => readFile(resolve(process.cwd(), "src/components/my-prompts/my-prompts-page.tsx"), "utf8");

    it("uses the shared prompt cards instead of a table", async () => {
        const page = await read();

        expect(page).toContain("PromptCard");
        expect(page).not.toContain("<Table");
        expect(page).toContain("lg:grid-cols-3 xl:grid-cols-4");
    });

    it("keeps search, category chips and a clear action", async () => {
        const page = await read();

        expect(page).toContain("搜索标题或提示词内容");
        expect(page).toContain("prompt-filter-tag");
        expect(page).toContain("清除筛选");
    });

    it("uses the showcase empty state with a single create action", async () => {
        const page = await read();

        expect(page).toContain("LibraryShowcaseEmptyState");
        expect(page).toContain("还没有提示词");
        expect(page).toContain("添加第一个提示词");
        // 首屏只用一行文案占位，不铺假卡片；切 tab 时不会再有「骨架 → 空状态」闪动
        expect(page).not.toContain("MyPromptGridSkeleton");
        expect(page).toContain("正在加载提示词");
        // 空白态工具栏不再重复「添加提示词」按钮，只留下方引导区一个入口
        expect(page).toContain("loading || items.length ?");
    });

    it("asks for confirmation before deleting", async () => {
        const page = await read();

        expect(page).toContain("Popconfirm");
        expect(page).toContain("删除后无法恢复");
    });
});
