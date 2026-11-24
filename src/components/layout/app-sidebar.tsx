"use client";

import { PanelLeft } from "lucide-react";
import Link from "next/link";

import { AccountRailBar } from "@/components/layout/user-status-actions";
import { SidebarNewProject, SidebarRecentProjects } from "@/components/layout/sidebar-projects";
import { SiteLogo } from "@/components/layout/site-logo";
import { WorkspaceNavList } from "@/components/layout/workspace-nav-list";
import { type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { DEFAULT_SITE_TITLE, resolveSiteTitle } from "@/lib/site-brand";
import { usePublicSessionStore } from "@/stores/use-public-session-store";

/* 折叠开关放在品牌行右侧（照参考稿），不再放在顶栏 —— 顶栏左上角只留移动端的菜单键和 logo，
 * 桌面端那块区域空出来，视觉重心回到内容。
 * 图标用最简的 PanelLeft（一个矩形 + 左侧分隔线），收起/展开不再换成带箭头的两枚图标：
 * 状态靠 aria-pressed 和 title 表达，图标本身保持同一枚，看着更安静。 */
function SidebarToggle({ expanded, onToggle, className }: { expanded: boolean; onToggle?: () => void; className?: string }) {
    return (
        <button
            type="button"
            className={cn("inline-flex shrink-0 items-center justify-center rounded-lg text-[var(--ink-2)] transition hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]", className)}
            onClick={onToggle}
            aria-label={expanded ? "收起侧边栏" : "展开侧边栏"}
            title={expanded ? "收起侧边栏" : "展开侧边栏"}
            aria-pressed={expanded}
        >
            <PanelLeft className="size-[18px]" />
        </button>
    );
}

export function AppSidebar({ activeToolSlug, expanded, onToggleExpanded }: { activeToolSlug?: NavigationToolSlug; expanded: boolean; onToggleExpanded?: () => void }) {
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: DEFAULT_SITE_TITLE, logoUrl: "/logo.svg" };
    const siteTitle = resolveSiteTitle(site.title);

    return (
        <aside className={cn("hidden h-full shrink-0 flex-col bg-[var(--surface-rail)] text-[var(--ink-1)] transition-[width] duration-200 lg:flex", expanded ? "w-[232px]" : "w-[72px]")}>
            {expanded ? (
                <div className="flex h-14 shrink-0 items-center justify-between gap-2 pl-5 pr-3">
                    <Link href="/create" className="flex min-w-0 items-center" aria-label={siteTitle}>
                        <SiteLogo logoUrl={site.logoUrl} className="size-8 shrink-0" />
                        <span className="ml-2.5 min-w-0 truncate text-[15px] font-semibold">{siteTitle}</span>
                    </Link>
                    <SidebarToggle expanded onToggle={onToggleExpanded} className="size-8" />
                </div>
            ) : (
                /* 收起态不额外占一行：折叠图标平时完全透明，指针落到品牌图标上才把它换出来
                 * （logo 淡出、图标淡入，同一个位置）。72px 塞不下两个方块，而常驻按钮
                 * 会在侧栏顶部多出一块实心方块，比导航还抢眼。键盘用户 Tab 到按钮时由 focus-visible 显形。 */
                <div className="group relative flex h-14 shrink-0 items-center justify-center px-2">
                    <Link href="/create" className="flex items-center justify-center transition-opacity group-hover:opacity-0" aria-label={siteTitle}>
                        <SiteLogo logoUrl={site.logoUrl} className="size-8 shrink-0" />
                    </Link>
                    <SidebarToggle
                        expanded={false}
                        onToggle={onToggleExpanded}
                        className="absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    />
                </div>
            )}

            {/* 新建入口与导航稍微分开：一条独立的浅底按钮，下面才是平铺的导航列。
                最近项目挂在导航列表末尾，与它共用同一条滚动容器。 */}
            <div className={cn("shrink-0 pb-3 pt-1", expanded ? "px-4" : "px-2")}>
                <SidebarNewProject expanded={expanded} />
            </div>

            <WorkspaceNavList variant="rail" activeToolSlug={activeToolSlug} expanded={expanded} footer={<SidebarRecentProjects expanded={expanded} />} />

            {/* 侧栏底部账号条：未点开就是「头像 + 名字 …… ⚡积分」一行，
             * 点开才是账户菜单（套餐/余额、账户页、钱包、外观、退出登录）。
             * 原来这里附了一行小字和一个右侧箭头，现在都去掉了 —— 这一行不再是「跳某个页面」的链接，
             * 而是账户菜单的触发器，箭头会误导成「进入下一层」。 */}
            <div className={cn("shrink-0", expanded ? "px-3 pb-3 pt-2" : "px-2 pb-2")}>
                <AccountRailBar expanded={expanded} />
            </div>
        </aside>
    );
}
