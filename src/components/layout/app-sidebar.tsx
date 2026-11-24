"use client";

import { ChevronRight, PanelLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { SiteLogo } from "@/components/layout/site-logo";
import { WorkspaceNavList } from "@/components/layout/workspace-nav-list";
import { type NavigationToolSlug } from "@/constant/navigation-tools";
import { userAvatarInitial } from "@/lib/user-avatar";
import { cn } from "@/lib/utils";
import { DEFAULT_SITE_TITLE, resolveSiteTitle } from "@/lib/site-brand";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { useUserStore } from "@/stores/use-user-store";

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
    const pathname = usePathname();
    const router = useRouter();
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: DEFAULT_SITE_TITLE, logoUrl: "/logo.svg" };
    const siteTitle = resolveSiteTitle(site.title);
    const user = useUserStore((state) => state.user);
    const avatarUrl = user?.avatarUrl?.trim();
    const accountName = user?.displayName || user?.username || "未登录";
    const avatarInitial = userAvatarInitial(accountName);
    const accountActive = pathname.startsWith("/profile");

    return (
        <aside className={cn("hidden h-full shrink-0 flex-col bg-[var(--surface-rail)] text-[var(--ink-1)] transition-[width] duration-200 lg:flex", expanded ? "w-52" : "w-[72px]")}>
            {expanded ? (
                <div className="flex h-16 shrink-0 items-center justify-between gap-2 pl-5 pr-3">
                    <Link href="/create" className="flex min-w-0 items-center" aria-label={siteTitle}>
                        <SiteLogo logoUrl={site.logoUrl} className="size-8 shrink-0" />
                        <span className="ml-2.5 min-w-0 truncate text-[17px] font-semibold">{siteTitle}</span>
                    </Link>
                    <SidebarToggle expanded onToggle={onToggleExpanded} className="size-8" />
                </div>
            ) : (
                /* 收起态不额外占一行：折叠图标平时完全透明，指针落到品牌图标上才把它换出来
                 * （logo 淡出、图标淡入，同一个位置）。72px 塞不下两个方块，而常驻按钮
                 * 会在侧栏顶部多出一块实心方块，比导航还抢眼。键盘用户 Tab 到按钮时由 focus-visible 显形。 */
                <div className="group relative flex h-16 shrink-0 items-center justify-center px-2">
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

            <WorkspaceNavList variant="rail" activeToolSlug={activeToolSlug} expanded={expanded} />

            {/* 侧栏底部固定账号入口：和右上角账户面板构成双入口，任何页面都能一步回到个人中心。 */}
            <div className={cn("shrink-0", expanded ? "px-3 pb-3 pt-3" : "p-2")}>
                <Link
                    href="/profile"
                    prefetch
                    title={`${accountName} · 个人中心`}
                    onMouseEnter={() => router.prefetch("/profile")}
                    onFocus={() => router.prefetch("/profile")}
                    className={cn(
                        "flex min-h-12 items-center rounded-lg text-[var(--ink-2)] transition-colors duration-150 hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]",
                        expanded ? "gap-2.5 px-2" : "justify-center px-2",
                        accountActive && "bg-[var(--surface-inset)] text-[var(--ink-1)]",
                    )}
                    aria-current={accountActive ? "page" : undefined}
                >
                    <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#f6b181_0%,#e2671f_100%)] text-[11px] font-semibold text-white ring-1 ring-black/5 dark:ring-white/15">
                        {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : avatarInitial}
                    </span>
                    {expanded ? (
                        <>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13.5px] font-medium leading-5">{accountName}</span>
                                <span className="block truncate text-[11px] leading-4 text-[var(--ink-3)]">个人中心</span>
                            </span>
                            <ChevronRight className="size-4 shrink-0 text-[var(--ink-3)]" />
                        </>
                    ) : null}
                </Link>
            </div>
        </aside>
    );
}
