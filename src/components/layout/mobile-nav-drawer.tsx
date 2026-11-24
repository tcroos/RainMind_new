"use client";

import { Drawer } from "antd";
import { Globe } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { SiteLogo } from "@/components/layout/site-logo";
import { drawerNavItemClass, WorkspaceNavList } from "@/components/layout/workspace-nav-list";
import { type NavigationToolSlug } from "@/constant/navigation-tools";
import { userAvatarInitial } from "@/lib/user-avatar";
import { cn } from "@/lib/utils";
import { DEFAULT_SITE_TITLE, resolveSiteTitle } from "@/lib/site-brand";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { useUserStore } from "@/stores/use-user-store";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const pathname = usePathname();
    const router = useRouter();
    const previousPathnameRef = useRef(pathname);
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: DEFAULT_SITE_TITLE, logoUrl: "/logo.svg" };
    const siteTitle = resolveSiteTitle(site.title);
    const user = useUserStore((state) => state.user);
    const avatarUrl = user?.avatarUrl?.trim();
    const accountName = user?.displayName || user?.username || "未登录";
    const avatarInitial = userAvatarInitial(accountName);
    const accountActive = pathname.startsWith("/profile");
    /* 条目样式统一由 workspace-nav-list 提供，和侧栏同一套令牌与同一份渲染逻辑；
     * 这些 text-/bg- 工具类本身压不过 antd 的无层级 a 规则，
     * 真正生效的覆盖在 global-surfaces.css 的 .workspace-mobile-nav 段。 */
    const itemClass = drawerNavItemClass;

    useEffect(() => {
        if (previousPathnameRef.current === pathname) return;
        previousPathnameRef.current = pathname;
        onClose();
    }, [onClose, pathname]);

    return (
        <Drawer
            title={
                <Link href="/create" onClick={onClose} className="inline-flex min-w-0 items-center gap-2.5 text-base font-semibold leading-none text-[var(--ink-1)]">
                    <SiteLogo logoUrl={site.logoUrl} className="size-8" />
                    <span className="truncate">{siteTitle}</span>
                </Link>
            }
            placement="left"
            size={288}
            open={open}
            onClose={onClose}
            className="lg:hidden"
            /* 抽屉被 portal 到 body 之外，不在 .workspace-shell 里，
             * 所以吃不到侧栏那条无层级覆盖规则。挂一个稳定的根类，
             * 让 global-surfaces.css 能按同样的方式压住 antd 的 reset。 */
            rootClassName="workspace-mobile-nav"
            styles={{ header: { borderBottomColor: "var(--border)", minHeight: 60, padding: "12px 16px" }, body: { padding: "12px 14px 18px" } }}
        >
            <WorkspaceNavList variant="drawer" activeToolSlug={activeToolSlug} onNavigate={onClose} />
            <div className="mt-5 space-y-1 border-t border-border pt-4">
                <Link
                    href="/profile"
                    prefetch
                    onMouseEnter={() => router.prefetch("/profile")}
                    onFocus={() => router.prefetch("/profile")}
                    onClick={onClose}
                    className={itemClass(accountActive)}
                    aria-current={accountActive ? "page" : undefined}
                >
                    <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#f6b181_0%,#e2671f_100%)] text-[10px] font-semibold text-white ring-1 ring-black/5 dark:ring-white/15">
                        {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : avatarInitial}
                    </span>
                    <span className="min-w-0 flex-1 truncate">个人中心</span>
                    <span className={cn("size-1.5 rounded-full", accountActive ? "bg-current" : "bg-transparent")} />
                </Link>
                <Link
                    href="/"
                    prefetch
                    onMouseEnter={() => router.prefetch("/")}
                    onFocus={() => router.prefetch("/")}
                    onClick={onClose}
                    className={itemClass(false)}
                >
                    <Globe className="size-5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">官网首页</span>
                    <span className="size-1.5 rounded-full bg-transparent" />
                </Link>
            </div>
        </Drawer>
    );
}
