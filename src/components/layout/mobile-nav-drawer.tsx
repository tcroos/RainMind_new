"use client";

import { Drawer } from "antd";
import { Globe } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { SiteLogo } from "@/components/layout/site-logo";
import { isExternalTool, navigationGroups, navigationToolHref, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
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
    /* 配色与桌面侧栏 AppSidebar 共用同一套令牌，不要在这里写死 hex：
     * 原先是一整套手抄的灰阶（底色 / 主文字 / 次文字 / 深色态各一份），凑巧和令牌
     * 数值接近所以看不出，但 global-surfaces.css 里的底色整体提亮过一档，
     * 手抄值不会跟着变，窄屏就会和桌面脱队。
     * 注意：这些 text-/bg- 工具类本身压不过 antd 的无层级 a 规则，
     * 真正生效的覆盖在 global-surfaces.css 的 .workspace-mobile-nav 段。 */
    const itemClass = (active: boolean) =>
        cn(
            "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-base transition",
            active
                ? "bg-[var(--surface-inset)] font-medium text-[var(--ink-1)]"
                : "text-[var(--ink-2)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]",
        );

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
            {navigationGroups.map((group, groupIndex) => (
                <div key={group.id} className={cn(groupIndex > 0 && "mt-5")}>
                    <div className="mb-1 px-3 text-[13px] font-medium text-[var(--ink-3)]">{group.label}</div>
                    <div className="space-y-1">
                        {navigationTools
                            .filter((tool) => tool.group === group.id)
                            .map((tool) => {
                                const Icon = tool.icon;
                                const active = tool.slug === activeToolSlug;
                                const external = isExternalTool(tool);
                                const href = navigationToolHref(tool);
                                const inner = (
                                    <>
                                        <Icon className="size-5 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate">{tool.label}</span>
                                        <span className={cn("size-1.5 rounded-full", active ? "bg-current" : "bg-transparent")} />
                                    </>
                                );
                                return external ? (
                                    <a key={tool.slug} href={href} target="_blank" rel="noreferrer noopener" className={itemClass(false)}>
                                        {inner}
                                    </a>
                                ) : (
                                    <Link
                                        key={tool.slug}
                                        href={href}
                                        prefetch
                                        onMouseEnter={() => router.prefetch(href)}
                                        onFocus={() => router.prefetch(href)}
                                        onClick={onClose}
                                        className={itemClass(active)}
                                        aria-current={active ? "page" : undefined}
                                    >
                                        {inner}
                                    </Link>
                                );
                            })}
                    </div>
                </div>
            ))}
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
