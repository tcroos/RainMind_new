import { BookMarked, Braces, Clapperboard, Compass, FileText, GalleryVerticalEnd, House, Images, Maximize2, MessageSquareText, UserRound, Wallet } from "lucide-react";

import { FEEDBACK_FORM_URL } from "./site-links";

export { FEEDBACK_FORM_URL };

export const navigationGroups = [
    { id: "create", label: "创作" },
    { id: "projects", label: "项目" },
    { id: "assets", label: "资产" },
    { id: "personal", label: "个人" },
] as const;

export const landingNavigationTools = [
    { slug: "create", label: "Agent" },
    { slug: "drama", label: "短剧" },
    { slug: "gallery", label: "广场" },
] as const;

/* 分组逻辑：能做什么（创作）→ 在做什么（项目）→ 存了什么（资产）→ 我是谁（个人）。
 * 广场从「社区」挪进「资产」，因为它是作品，只是别人的；
 * 「个人」这一组才是账号相关：我的主页、钱、账号设置、对外接口。 */
export const navigationTools = [
    {
        slug: "create",
        label: "首页",
        description: "统一创作入口",
        group: "create",
        /* 图标用「房子」：这是工作台的入口/首页，不是「生成」功能。
         * 之前用 Sparkles，和积分符号、生成按钮的星芒撞在一起，分不清语义。 */
        icon: House,
        primary: true,
    },
    {
        slug: "canvas",
        label: "画布",
        description: "节点式多媒体创作",
        group: "projects",
        icon: Maximize2,
    },
    {
        slug: "drama",
        label: "短剧",
        description: "剧本、分镜与成片",
        group: "projects",
        icon: Clapperboard,
    },
    {
        /* 素材与提示词合并成一个入口：二级面板里切换「素材 / 提示词」。
         * 两者是同一件事的两面 —— 一个存媒体、一个存文本，各占一格侧栏只会让人来回跳。
         * /my-prompts 保留为到 /assets?tab=prompts 的重定向，旧链接不断。 */
        slug: "assets",
        label: "素材",
        description: "素材与提示词",
        group: "assets",
        icon: Images,
        children: [
            { slug: "assets", label: "素材", description: "图片、视频与音频", href: "/assets", icon: Images },
            { slug: "prompts-mine", label: "我的提示词", description: "个人提示词库", href: "/assets?tab=prompts", icon: BookMarked },
            { slug: "prompts", label: "公共词库", description: "发现与复用优质提示词", href: "/prompts", icon: FileText },
        ],
    },
    {
        slug: "community",
        label: "广场",
        description: "发现公开作品",
        group: "assets",
        icon: Compass,
    },
    {
        slug: "me",
        label: "主页",
        description: "已发布与我的喜欢",
        group: "personal",
        icon: UserRound,
    },
    {
        slug: "wallet",
        label: "钱包",
        description: "积分、套餐与账单",
        group: "personal",
        icon: Wallet,
    },
    {
        slug: "api",
        label: "API",
        description: "开放接口与文档",
        group: "personal",
        icon: Braces,
        href: "https://api.rainmind.net",
        external: true,
    },
    {
        slug: "feedback",
        label: "反馈",
        description: "问题反馈与改进建议",
        group: "personal",
        icon: MessageSquareText,
        href: FEEDBACK_FORM_URL,
        external: true,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
export type NavigationGroupId = (typeof navigationGroups)[number]["id"];

export function navigationToolHref(tool: (typeof navigationTools)[number]) {
    return "href" in tool && tool.href ? tool.href : `/${tool.slug}`;
}

export function isExternalTool(tool: (typeof navigationTools)[number]) {
    return "external" in tool && Boolean(tool.external);
}

export function navigationToolForPathname(pathname: string) {
    const slug = pathname.split("/").filter(Boolean)[0];
    /* 二级面板的子项路径（如 /prompts）没有自己的顶层导航项，
     * 命中父项才能让侧栏保持高亮；子项自身的勾选由 NavFlyout 按 href 判断。 */
    const direct = navigationTools.find((tool) => tool.slug === slug);
    if (direct) return direct;
    return navigationTools.find((tool) => "children" in tool && tool.children?.some((child) => child.href?.split("?")[0] === `/${slug}`));
}
