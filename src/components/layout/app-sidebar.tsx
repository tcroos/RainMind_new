"use client";

import { ChevronRight } from "lucide-react";
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

export function AppSidebar({ activeToolSlug, expanded }: { activeToolSlug?: NavigationToolSlug; expanded: boolean }) {
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
            <Link href="/create" className={cn("flex h-16 shrink-0 items-center px-3", expanded ? "justify-start px-5" : "justify-center")} aria-label={siteTitle}>
                <SiteLogo logoUrl={site.logoUrl} className="size-8" />
                {expanded ? <span className="ml-3 min-w-0 truncate text-[17px] font-semibold">{siteTitle}</span> : null}
            </Link>

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
