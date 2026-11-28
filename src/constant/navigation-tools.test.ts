import { describe, expect, it } from "vitest";

import { FEEDBACK_FORM_URL } from "./site-links";
import { landingNavigationTools, navigationGroups, navigationToolForPathname, navigationToolHref, navigationTools } from "./navigation-tools";

describe("user navigation order", () => {
    it("keeps the landing page entries in their dedicated order", () => {
        expect(landingNavigationTools).toEqual([
            { slug: "create", label: "Agent" },
            { slug: "drama", label: "短剧" },
            { slug: "gallery", label: "广场" },
        ]);
    });

    it("keeps the unified Agent as the only generation entry in workspace navigation", () => {
        expect(navigationGroups.map((group) => group.label)).toEqual(["创作", "项目", "资产", "个人"]);
        expect(navigationTools.map((tool) => tool.slug)).not.toContain("image");
        expect(navigationTools.map((tool) => tool.slug)).not.toContain("video");
    });

    it("puts public works into assets and keeps only external links under personal", () => {
        expect(navigationTools.filter((tool) => tool.group === "assets").map((tool) => tool.label)).toEqual(["素材", "广场", "Skill"]);
        // 素材 / 我的提示词 / 公共词库全部收进「素材」单入口 + 页面内 tab，侧栏不再有任何浮层子项
        const assets = navigationTools.find((tool) => tool.slug === "assets");
        expect(assets && "children" in assets).toBe(false);
        // 广场是「别人的作品」，归资产；「社区」这个分组随之取消
        expect(navigationTools.find((tool) => tool.slug === "community")?.group).toBe("assets");
        expect(navigationGroups.map((group) => group.id)).not.toContain("community");
        // 「主页 / 钱包」已从侧栏移除，账号相关入口统一收进左下账户弹窗
        expect(navigationTools.filter((tool) => tool.group === "personal").map((tool) => tool.label)).toEqual(["API", "反馈"]);
        expect(navigationTools.map((tool) => tool.slug)).not.toContain("profile");
        expect(navigationTools.map((tool) => tool.slug)).not.toContain("me");
        expect(navigationTools.map((tool) => tool.slug)).not.toContain("wallet");
    });

    it("keeps legacy prompt paths highlighting the merged library entry", () => {
        expect(navigationToolForPathname("/prompts")?.slug).toBe("assets");
        expect(navigationToolForPathname("/my-prompts")?.slug).toBe("assets");
        expect(navigationToolForPathname("/assets")?.slug).toBe("assets");
        // /me 与 /wallet 页面仍在（账户弹窗、作品链接会跳过去），但侧栏已无对应高亮项
        expect(navigationToolForPathname("/wallet")).toBeUndefined();
        expect(navigationToolForPathname("/me")).toBeUndefined();
    });

    it("links the feedback entry to the Feishu form right after API", () => {
        const slugs = navigationTools.filter((tool) => tool.group === "personal").map((tool) => tool.slug);
        const feedback = navigationTools.find((tool) => tool.slug === "feedback");

        // 位置：紧挨 API 下方
        expect(slugs.indexOf("feedback")).toBe(slugs.indexOf("api") + 1);
        expect(feedback && "external" in feedback && feedback.external).toBe(true);
        expect(feedback && navigationToolHref(feedback)).toBe(FEEDBACK_FORM_URL);
        expect(FEEDBACK_FORM_URL).toContain("feishu.cn");
    });

    it("links the API entry to the public gateway in a new window", () => {
        const api = navigationTools.find((tool) => tool.slug === "api");

        expect(api?.group).toBe("personal");
        expect(api && "external" in api && api.external).toBe(true);
        expect(api && navigationToolHref(api)).toBe("https://api.rainmind.net");
    });
});
