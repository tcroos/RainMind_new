"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { AnnouncementMarquee } from "@/components/layout/announcement-marquee";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { isFullscreenWorkspacePath } from "@/components/layout/app-workspace-path";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { SiteLogo } from "@/components/layout/site-logo";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { navigationToolForPathname } from "@/constant/navigation-tools";
import { appStorageKey } from "@/lib/storage-keys";
import { DEFAULT_SITE_TITLE, resolveSiteTitle } from "@/lib/site-brand";
import { usePublicSessionStore } from "@/stores/use-public-session-store";

/* 折叠偏好落在 localStorage 而不是 zustand persist：只有一个布尔值，
 * 为它建一个 store 反而多一层订阅。键名走统一的 appStorageKey 前缀，
 * 和 theme_store 等既有的本地状态保持同一命名空间。 */
const SIDEBAR_EXPANDED_STORAGE_KEY = appStorageKey("sidebar_expanded");

export function AppWorkspaceShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [sidebarExpanded, setSidebarExpanded] = useState(true);
    /* 壳是持久布局，站内跳转不会丢折叠态；丢的是硬刷新、新开标签、重新登录这些冷启动。
     * 首帧仍按展开态渲染，保证服务端与客户端首帧一致（不然会报 hydration 不一致），
     * 挂载之后再把上一次的选择读回来。 */
    useEffect(() => {
        let stored: string | null = null;
        try {
            stored = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
        } catch {
            return;
        }
        if (stored === "collapsed") setSidebarExpanded(false);
    }, []);

    const toggleSidebarExpanded = () => {
        const next = !sidebarExpanded;
        setSidebarExpanded(next);
        try {
            window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, next ? "expanded" : "collapsed");
        } catch {
            /* 隐私模式或配额写满：偏好留不住，但不该影响收起这个动作本身 */
        }
    };
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: DEFAULT_SITE_TITLE, logoUrl: "/logo.svg" };
    const siteTitle = resolveSiteTitle(site.title);
    const tool = navigationToolForPathname(pathname);
    const fullscreen = isFullscreenWorkspacePath(pathname);
    const rootSlug = pathname.split("/").filter(Boolean)[0] || "";
    /* 创作页要「背景顶到最上面」：页头是透明的，如果背景画在 <main> 里，
     * 就只能从页头下沿开始，64px 处会留一道横向接缝。
     * 所以把环境光挂到外壳这一层：外壳 isolate 成一个层叠上下文，
     * 背景走 z-index:-1，正好压在底色之上、页头/侧栏/内容之下。 */
    const ambientBackdrop = rootSlug === "create";

    if (fullscreen) return <div className="h-dvh min-h-0 overflow-hidden">{children}</div>;

    return (
        <div className="workspace-shell relative isolate flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--surface-canvas)] text-foreground">
            {ambientBackdrop ? <div className="create-ambient" aria-hidden data-testid="create-ambient" /> : null}
            <AnnouncementMarquee />
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <AppSidebar activeToolSlug={tool?.slug} expanded={sidebarExpanded} onToggleExpanded={toggleSidebarExpanded} />
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between gap-3 px-3 sm:px-4 lg:px-7">
                        <div className="flex min-w-0 items-center gap-2.5">
                            <button
                                type="button"
                                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)] lg:hidden"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>
                            <Link href="/create" className="inline-flex shrink-0 items-center lg:hidden" aria-label={siteTitle}>
                                <SiteLogo logoUrl={site.logoUrl} className="size-6" />
                            </Link>
                        </div>
                        <div className="min-w-0 max-w-[calc(100vw-6.5rem)] shrink-0 overflow-visible sm:max-w-[calc(100vw-8rem)] lg:max-w-none">
                            <UserStatusActions showAccountCluster={false} />
                        </div>
                    </header>
                    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
                </div>
            </div>
            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={tool?.slug} onClose={() => setMobileNavOpen(false)} />
        </div>
    );
}
