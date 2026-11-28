import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public work detail (Dreamina-style)", () => {
    it("uses a full-screen layer with a 做同款 panel and a related masonry feed", async () => {
        const preview = await readFile(resolve(process.cwd(), "src/components/works/public-work-preview-modal.tsx"), "utf8");
        expect(preview).toContain("createPortal(");
        expect(preview).toContain('data-testid="public-work-detail"');
        expect(preview).toContain('aria-label="做同款"');
        expect(preview).toContain("其他指示");
        expect(preview).toContain("参考内容");
        expect(preview).toContain('data-testid="work-related"');
        expect(preview).toContain("复刻这个作品");
        expect(preview).toContain("换成自己的内容");
        // 跟随主题：颜色全部走 --wd-* 变量
        expect(preview).toContain("var(--wd-panel)");
        expect(preview).toContain('aria-label="关闭作品详情"');
        expect(preview).toContain('aria-label="分享作品"');
        expect(preview).toContain('aria-label="复制提示词"');
        expect(preview).toContain('aria-label="引用提示词到 Agent"');
        // 修改要求拼在原提示词后面一起带走
        expect(preview).toContain("修改要求：");
    });
});
