import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("drama project entry", () => {
    it("keeps the create modal compact and separates labels from Ant Design controls", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/drama/page.tsx"), "utf8");

        expect(source).toContain("width={520}");
        expect(source).toContain('maxWidth: "calc(100vw - 24px)"');
        expect(source).toContain('htmlFor="drama-project-title"');
        expect(source).toContain('<div className="min-w-0">');
        expect(source).not.toContain('<label className="block space-y-2.5">');
        /* 无线条语言：弹窗自绘底栏、字段复用浅底无描边控件，列表不摆虚线框。 */
        expect(source).toContain("footer={null}");
        expect(source).toContain("library-input");
        expect(source).toContain("library-segmented");
        expect(source).not.toContain("border-dashed");
        expect(source).not.toContain("border-b border-border");
        /* 页头只留标题 + 新建按钮：眉标、副标题、统计胶囊都是重复信息。 */
        expect(source).not.toContain("短剧生产线");
        expect(source).not.toContain("从故事简介到分镜成片");
        expect(source).not.toContain("个项目</span>");
        /* 卡片缩到画布节点量级，与新建卡同高。 */
        expect(source).toContain("min-h-[152px]");
        expect(source).toContain("xl:grid-cols-4");
    });

    it("uses a whole-card project link while keeping publish and delete as independent actions", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/drama/components/drama-project-card.tsx"), "utf8");

        expect(source).toContain("href={`/drama/${project.id}`}");
        expect(source).toContain("aria-label={`进入短剧项目：${project.title}`}");
        expect(source).toContain('aria-label="删除项目"');
        expect(source).toContain("sourceType=drama");
        expect(source).not.toContain("继续制作");
        /* 卡片靠实底与落影浮起，不套描边；操作行不再画分割横线。 */
        expect(source).toContain("rounded-2xl");
        expect(source).not.toContain("border border-[var(--hairline)]");
        expect(source).not.toContain("border-t border-[var(--hairline)]");
        expect(source).not.toContain("ring-1");
        /* 与新建卡同造型同高度：浅底整卡，不再铺封面带和四枚统计胶囊。 */
        expect(source).toContain("min-h-[152px]");
        expect(source).not.toContain("h-[112px]");
        expect(source).toContain("bg-[var(--surface-inset)]");
    });
});
