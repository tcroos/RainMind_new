import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 画布库的结构约束。
 * 参照 lovart.ai/projects：入口就是网格的第一格，卡是「封面 + 标题 + 时间」，
 * 不画分割线，靠缩略图本身撑起版面；批量选择靠标题旁的小按钮进入，复选框落在卡片右上角。
 * 这些断言防止以后被改回一堆边框文字卡、或把搜索框/文字按钮又塞回头部。
 */
describe("canvas library layout", () => {
    const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

    it("puts the create entry as the first tile of the same grid", async () => {
        const page = await read("src/app/(user)/canvas/page.tsx");
        const grid = page.slice(page.indexOf("<div className={cn(\"grid grid-cols-2"));
        expect(page).toContain("CanvasCreateCard");
        expect(grid.indexOf("<CanvasCreateCard")).toBeLessThan(grid.indexOf("projects.map("));

        // 新建卡和项目卡同构：16:10 封面 + 标题行；整格撑满会把封面拉成方块
        const createCard = await read("src/app/(user)/canvas/components/canvas-project-create-card.tsx");
        expect(createCard).toContain("aspect-[16/10]");
        expect(createCard).not.toContain("min-h-[220px]");
        // 一行最多 5 列：再多就退化成缩略图墙
        expect(page).toContain("xl:grid-cols-5");
        expect(page).not.toContain("2xl:grid-cols-6");
    });

    it("keeps the checkbox readable on both light and dark covers", async () => {
        const card = await read("src/app/(user)/canvas/components/canvas-project-card.tsx");

        // 复选框在封面右上角、16px 见方；白底 + 细边在深色封面上也读得清
        expect(card).toContain("right-2 top-2 grid size-4");
        expect(card).toContain("bg-white/85");
        expect(card).not.toContain("bg-[rgba(17,17,19,0.45)]");
        // 勾选态用品牌橙填充 + 白勾，和未选中的描边框拉开差距
        expect(card).toContain("outline-[var(--brand-500)]");
        expect(card).toContain("bg-[var(--brand-500)]");
        // 旧版把复选框放在左上角 24px 白底浮块，压封面又抢视线，不允许回来
        expect(card).not.toContain("left-2 size-6 rounded-md");
    });

    it("enters a freshly created canvas without flashing a new tile first", async () => {
        const [page, store] = await Promise.all([read("src/app/(user)/canvas/page.tsx"), read("src/app/(user)/canvas/stores/use-canvas-store.ts")]);

        expect(store).toContain("insertIntoList");
        expect(store).toContain("options?.insertIntoList !== false");
        // 新建 / 自动打开都直接进画布，不往列表插卡片
        expect(page).toContain("{ insertIntoList: false }");
    });

    it("renders real thumbnails from canvas previews instead of text-only cards", async () => {
        const [card, cover] = await Promise.all([read("src/app/(user)/canvas/components/canvas-project-card.tsx"), read("src/app/(user)/canvas/components/canvas-project-cover.tsx")]);
        expect(card).toContain("CanvasProjectCover");
        expect(card).toContain("project.previews ?? []");
        expect(card).toContain("aspect-[16/10]");
        // 封面只放第一张素材、整块铺满，不再做拼图
        expect(cover).toContain("const cover = previews[0]");
        expect(cover).toContain("object-cover");
        expect(cover).not.toContain("grid-cols-2");
        expect(cover).not.toContain("MAX_TILES");
        // 没有素材时不摆假图
        expect(cover).toContain("CanvasCoverPlaceholder");
        // 素材挂了也要留一块渐变，不能塌成空白
        expect(cover).toContain("failed");
    });

    it("keeps the header down to a title and one selection toggle", async () => {
        const page = await read("src/app/(user)/canvas/page.tsx");
        expect(page).not.toContain("border-b border-border");
        expect(page).not.toContain("删除当前页");
        // 多选入口在标题右侧，点击进入批量选择
        expect(page).toContain('aria-label={selectMode ? "退出多选" : "多选"}');
        // 搜索框与导入按钮已按需求移除，不允许被顺手加回头部
        expect(page).not.toContain('placeholder="搜索画布"');
        expect(page).not.toContain('aria-label="导入画布"');
    });

    it("keeps the create tile and an empty canvas on the same surface token", async () => {
        const [createCard, cover] = await Promise.all([
            read("src/app/(user)/canvas/components/canvas-project-create-card.tsx"),
            read("src/app/(user)/canvas/components/canvas-project-cover.tsx"),
        ]);

        // 两格并排必须是同一块灰：之前一个 surface-soft 一个 surface-inset，深浅两套主题下都看得出色差
        expect(createCard).toContain("bg-[var(--surface-inset)]");
        expect(cover).toContain("bg-[var(--surface-inset)]");
        // 底色不能参与过渡。切主题时 background-color 会被插值，这张大卡从浅灰渐变到深灰，
        // 中间那几帧就是用户看到的「闪一下白光」；项目卡封面没有 transition 所以从不闪。
        expect(createCard).not.toContain("transition-colors");
        expect(createCard).toContain("transition-[border-color,color]");
    });

    it("floats the batch bar at the bottom with select-all and cancel", async () => {
        const page = await read("src/app/(user)/canvas/page.tsx");
        expect(page).toContain("pointer-events-none fixed inset-x-0 bottom-6");
        expect(page).toContain("全选（{projects.length}）");
        expect(page).toContain("取消");
        // 选中后才出现导出 / 删除，未选中时只留全选与取消
        expect(page).toContain("导出");
        expect(page).toContain("删除（{selectedIds.length}）");
    });

    it("exposes search and a busy flag without blanking the list on refetch", async () => {
        const store = await read("src/app/(user)/canvas/stores/use-canvas-store.ts");
        expect(store).toContain("summaryKeyword");
        expect(store).toContain("summaryBusy");
        expect(store).toContain("searchProjects");
        expect(store).toContain("const warm = get().hydrated && get().hydratedUserId === userId");
    });
});
