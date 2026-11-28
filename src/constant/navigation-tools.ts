import { Blocks, Braces, Clapperboard, Compass, House, Images, Maximize2, MessageSquareText } from "lucide-react";

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
 * 「主页 / 钱包」不再占侧栏位置，统一从左下账户弹窗进入，
 * 「个人」这一组只留对外接口（API）与反馈。 */
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
        /* 素材、我的提示词、公共词库统一成一个「素材」入口。
         * 不再做 hover 浮层：那是在用「菜单」伪装「切换内容」，与全站极简语言冲突，
         * 用户也反馈过弹窗突兀。切换全部发生在页面内的三个 tab，侧栏只保留一个入口。
         * /prompts 与 /my-prompts 保留为重定向，旧链接与代码里的深链不断。 */
        slug: "assets",
        label: "素材",
        description: "素材、提示词与词库",
        group: "assets",
        icon: Images,
    },
    {
        slug: "community",
        label: "广场",
        description: "发现公开作品",
        group: "assets",
        icon: Compass,
    },
    {
        /* 官方 Skill 广场：浏览、了解并一键带着 Skill 去 Agent 画布 */
        slug: "skills",
        label: "Skill",
        description: "官方创作 Skill",
        group: "assets",
        icon: Blocks,
    },
    /* 「主页 / 钱包」两个入口已从侧栏移除：账号条点开的弹窗里已有
     * 「账户管理」和「钱包」，侧栏再放一遍是重复占位。页面路由 /me、/wallet 保留，
     * 旧链接与弹窗入口不断，只是不再出现在工作空间导航里。 */
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
    /* 合并前的旧路由在重定向发生前也要保持「素材」高亮，避免侧栏闪一下无选中。 */
    if (slug === "prompts" || slug === "my-prompts") return navigationTools.find((tool) => tool.slug === "assets");
    return navigationTools.find((tool) => tool.slug === slug);
}
