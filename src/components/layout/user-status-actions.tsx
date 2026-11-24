"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, CircleHelp, CreditCard, Crown, Gift, Globe, Keyboard, LogOut, Moon, ShieldCheck, Sun, UserCircle, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Input, Popover } from "antd";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { AnnouncementNotificationCenter } from "@/components/layout/announcement-notification-center";
import { CreditSymbol, formatCreditAmount } from "@/constant/credits";
import { cn } from "@/lib/utils";
import { userAvatarInitial } from "@/lib/user-avatar";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";
import { resetClientSessionState } from "@/lib/client-session-reset";

type UserStatusActionsProps = {
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    initialUser?: LocalUser;
    /** 插在深浅切换左侧的额外控件（画布用：色盘入口） */
    themeTogglePrefix?: ReactNode;
    /** 工作台把「积分 / 主题 / 头像」搬到了侧栏底部（AccountRailBar），
     * 顶栏就只留通知铃；后台页面没有侧栏，仍走默认值 true。 */
    showAccountCluster?: boolean;
};

export function UserStatusActions({ variant = "default", onOpenShortcuts, initialUser, themeTogglePrefix, showAccountCluster = true }: UserStatusActionsProps) {
    const router = useRouter();
    const { message } = App.useApp();
    const [pointsOpen, setPointsOpen] = useState(false);
    const [accountOpen, setAccountOpen] = useState(false);
    const [isCompactViewport, setIsCompactViewport] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const storeUser = useUserStore((state) => state.user);
    const user = storeUser || initialUser || null;
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const canvasTheme = canvasThemes[theme];
    const defaultControlClass =
        "inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-[#e6e9ed] bg-white text-sm font-medium text-[#59616c] transition hover:border-[#d9dde3] hover:bg-[#f3f5f7] hover:text-[#20242a] dark:border-[#2c3138] dark:bg-[#181b20] dark:text-[#b7bec8] dark:hover:border-[#3b424c] dark:hover:bg-[#22262c] dark:hover:text-white";
    const canvasControlClass =
        "inline-flex h-9 shrink-0 items-center justify-center rounded-xl border px-2.5 text-sm font-medium shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/35 [&_svg]:size-4";
    const canvasIconClass = cn(canvasControlClass, "w-9 px-0");
    const canvasControlStyle: CSSProperties | undefined =
        variant === "canvas"
            ? {
                  background: canvasTheme.toolbar.panel,
                  borderColor: canvasTheme.toolbar.border,
                  boxShadow: theme === "dark" ? "0 10px 30px rgba(0,0,0,.28)" : "0 10px 24px rgba(28,25,23,.08)",
                  color: canvasTheme.toolbar.item,
              }
            : undefined;
    const naturalIconClass = variant === "canvas" ? canvasIconClass : cn(defaultControlClass, "w-8 px-0 [&_svg]:size-4");
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? canvasControlStyle : undefined;
    const avatarUrl = user?.avatarUrl?.trim();
    /* 默认头像：一个字 + 品牌橙渐变。原来的「两个汉字 + 灰底」在 32px 里
     * 既挤又像本地开发的占位图，尤其是深色态那块白圆。 */
    const avatarInitial = userAvatarInitial(user?.displayName || user?.username || "用户");
    const accountName = user?.displayName || user?.username || "用户";
    const accountSecondary = user ? `ID：${user.accountId}` : "";
    const planActionLabel = user?.hasActivePlan ? "续费套餐" : "升级套餐";
    useEffect(() => {
        if (user?.role === "admin") router.prefetch("/admin");
        if (user) {
            router.prefetch("/canvas");
            router.prefetch("/profile");
        }
    }, [router, user]);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(max-width: 520px)");
        const syncViewport = () => setIsCompactViewport(mediaQuery.matches);
        syncViewport();
        mediaQuery.addEventListener("change", syncViewport);
        return () => mediaQuery.removeEventListener("change", syncViewport);
    }, []);

    const logout = async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
            await resetClientSessionState();
            router.replace("/login");
            router.refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "退出登录失败");
        }
    };

    useEffect(() => {
        if (variant !== "canvas" || (!pointsOpen && !accountOpen)) return;
        const closeCanvasPopups = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (rootRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest(".user-points-popover, .account-menu-popover, .ant-popover, .ant-dropdown, .ant-dropdown-menu, .ant-dropdown-menu-submenu, .ant-dropdown-menu-submenu-popup")) {
                return;
            }
            setPointsOpen(false);
            setAccountOpen(false);
        };
        document.addEventListener("pointerdown", closeCanvasPopups, true);
        return () => document.removeEventListener("pointerdown", closeCanvasPopups, true);
    }, [variant, pointsOpen, accountOpen]);

    const handleAccountOpenChange = (open: boolean) => {
        setAccountOpen(open);
        if (open) setPointsOpen(false);
    };

    const pointsButton = user ? (
        <button
            type="button"
            className={cn(variant === "canvas" ? canvasControlClass : defaultControlClass, "gap-1 px-2 text-xs font-semibold sm:gap-1.5 sm:px-2.5", variant === "canvas" ? "canvas-points-action" : "app-points-action shrink-0")}
            style={iconStyle}
            title="积分余额"
        >
            <CreditSymbol className="text-sm" />
            {formatCreditAmount(user.pointsBalance)}
        </button>
    ) : null;

    return (
        <div ref={rootRef} className={cn("user-status-actions inline-flex max-w-full items-center gap-1.5 sm:gap-2", variant === "canvas" ? "canvas-user-status-actions shrink-0" : "app-user-status-actions min-w-0")}>
            {showAccountCluster && user ? (
                <Popover
                    rootClassName="user-points-popover"
                    open={pointsOpen}
                    onOpenChange={(open) => {
                        setPointsOpen(open);
                        if (open) setAccountOpen(false);
                    }}
                    trigger="click"
                    placement="bottomRight"
                    content={<PointsSummaryPanel user={user} onClose={() => setPointsOpen(false)} />}
                >
                    {pointsButton}
                </Popover>
            ) : null}
            <AnnouncementNotificationCenter
                compact={isCompactViewport}
                buttonClassName={cn(naturalIconClass, variant === "canvas" ? "canvas-notification-action" : "app-notification-action")}
                buttonStyle={iconStyle}
                onOpen={() => {
                    setPointsOpen(false);
                    setAccountOpen(false);
                }}
            />
            {showAccountCluster ? (
                <>
                    {themeTogglePrefix}
                    <AnimatedThemeToggler
                        theme={theme}
                        onThemeChange={setTheme}
                        className={cn(naturalIconClass, variant === "canvas" && "canvas-theme-action")}
                        style={iconStyle}
                        aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                        title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                    />
                </>
            ) : null}
            {showAccountCluster ? (
                user ? (
                    <Popover
                        rootClassName="account-menu-popover"
                        open={accountOpen}
                        onOpenChange={handleAccountOpenChange}
                        trigger="click"
                        placement="bottomRight"
                        arrow={false}
                        content={
                            <AccountMenuPanel
                                user={user}
                                avatarUrl={avatarUrl}
                                avatarInitial={avatarInitial}
                                onNavigate={(href) => {
                                    setAccountOpen(false);
                                    router.push(href);
                                }}
                                onLogout={() => {
                                    setAccountOpen(false);
                                    void logout();
                                }}
                                onDismiss={() => setAccountOpen(false)}
                            />
                        }
                    >
                        <button
                            type="button"
                            className={cn(
                                variant === "canvas" ? canvasControlClass : defaultControlClass,
                                variant === "canvas"
                                    ? "canvas-account-action size-9 rounded-full border-0 bg-transparent p-0 hover:bg-transparent"
                                    : "app-account-action size-8 rounded-full border-0 bg-transparent p-0 hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent",
                            )}
                            style={iconStyle}
                            aria-label="账户菜单"
                            title={user.displayName || user.username}
                        >
                            {avatarUrl ? (
                                <img src={avatarUrl} alt="" className="size-full rounded-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                                <span
                                    aria-hidden="true"
                                    className="user-avatar-fallback grid size-full place-items-center rounded-full bg-[linear-gradient(135deg,#f6b181_0%,#e2671f_100%)] text-[12px] font-semibold leading-none text-white ring-1 ring-black/5 transition hover:brightness-105 dark:ring-white/15"
                                >
                                    {avatarInitial}
                                </span>
                            )}
                        </button>
                    </Popover>
                ) : (
                    <Link href="/login" className={cn(variant === "canvas" ? canvasControlClass : defaultControlClass, "gap-2 px-2.5", variant === "canvas" && "canvas-account-action")} style={iconStyle}>
                        <UserCircle className="size-4" />
                        <span className="hidden sm:inline">登录</span>
                    </Link>
                )
            ) : null}
            {onOpenShortcuts ? (
                <button type="button" className={cn(naturalIconClass, variant === "canvas" && "canvas-shortcuts-action")} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}

function PointsSummaryPanel({ user, onClose }: { user: LocalUser; onClose: () => void }) {
    const { message } = App.useApp();
    const setUser = useUserStore((state) => state.setUser);
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const [recordTotal, setRecordTotal] = useState<number>();
    useEffect(() => {
        let active = true;
        void fetch("/api/points?page=1&pageSize=1", { cache: "no-store" })
            .then((response) => response.json())
            .then((payload: { total?: number }) => {
                if (active && Number.isFinite(payload.total)) setRecordTotal(Number(payload.total));
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [user.id]);
    const redeemCode = async () => {
        const value = code.trim();
        if (!value || redeeming) return;
        setRedeeming(true);
        try {
            const response = await fetch("/api/cdk/redeem", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: value }),
            });
            const payload = (await response.json()) as { user?: LocalUser; points?: number; error?: string };
            if (!response.ok || !payload.user) throw new Error(payload.error || "兑换失败");
            setUser(payload.user);
            setCode("");
            message.success(`兑换成功，获得 ${formatCreditAmount(payload.points || 0)} 积分`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "兑换失败");
        } finally {
            setRedeeming(false);
        }
    };

    const permanentPoints = user.permanentPointsBalance ?? Math.max(0, user.pointsBalance - (user.dailyPointsBalance || 0));
    return (
        <div className="user-points-panel w-[min(19rem,calc(100vw-2rem))] text-[var(--ink-1)]">
            <div className="flex items-end justify-between gap-3 px-0.5">
                <div className="min-w-0">
                    <div className="text-[11.5px] leading-4 text-[var(--ink-3)]">当前积分</div>
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                        <CreditSymbol className="size-4 self-center text-[var(--brand-600)]" />
                        <span className="text-[26px] font-semibold leading-7 tabular-nums">{formatCreditAmount(user.pointsBalance)}</span>
                    </div>
                </div>
                <div className="shrink-0 pb-1 text-right text-[11px] leading-[18px] text-[var(--ink-3)]">
                    <div>
                        今日可用 <strong className="font-medium tabular-nums text-[var(--ink-2)]">{formatCreditAmount(user.dailyPointsBalance || 0)}</strong>
                    </div>
                    <div>
                        永久 <strong className="font-medium tabular-nums text-[var(--ink-2)]">{formatCreditAmount(permanentPoints)}</strong>
                    </div>
                </div>
            </div>

            <div className="mt-3 border-t border-[var(--hairline)] pt-3">
                <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium">
                        <Gift className="size-3.5 text-[var(--brand-600)]" /> CDK 兑换
                    </span>
                    <span className="truncate text-[10.5px] text-[var(--ink-3)]">{recordTotal === undefined ? "兑换后自动到账" : `共 ${recordTotal} 条积分记录`}</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                    <Input value={code} size="middle" className="min-w-0 flex-1" placeholder="输入兑换密钥" aria-label="CDK 兑换密钥" onChange={(event) => setCode(event.target.value)} onPressEnter={() => void redeemCode()} />
                    <Button type="primary" className="!h-9 !shrink-0 !px-3 !text-[12.5px]" loading={redeeming} onClick={() => void redeemCode()}>
                        兑换
                    </Button>
                </div>
            </div>

            <div className="mt-3.5 flex flex-col gap-1">
                <Link
                    href="/wallet"
                    onClick={onClose}
                    className="points-summary-purchase flex h-9 items-center justify-center gap-2 rounded-lg bg-[#18181b] px-3 text-[12.5px] font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-[#18181b]"
                >
                    <CreditCard className="size-4" />
                    去钱包充值
                </Link>
                <Link href="/wallet?section=consume" onClick={onClose} className="flex h-9 items-center justify-between rounded-lg px-2 text-[12.5px] font-medium text-[var(--ink-2)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--ink-1)]">
                    使用详情
                    <ChevronRight className="size-4 text-[var(--ink-3)]" />
                </Link>
            </div>
        </div>
    );
}

/**
 * 账户菜单：整块自定义面板，不再走 antd 的 Dropdown menu。
 * 菜单项之间去掉一条条分割线，靠留白分组；套餐信息收成一块浅底卡片，
 * 续费按钮从黄底改成跟随主题的黑/白小胶囊。
 */
function AccountMenuPanel({ user, avatarUrl, avatarInitial, onNavigate, onLogout, onDismiss }: { user: LocalUser; avatarUrl?: string; avatarInitial: string; onNavigate: (href: string) => void; onLogout: () => void; onDismiss?: () => void }) {
    const accountName = user.displayName || user.username || "用户";
    const planLabel = user.planName || user.planId || "免费版";
    const planActionLabel = user.hasActivePlan ? "续费套餐" : "升级套餐";
    /* 外观切换收进菜单：顶栏那枚太阳/月亮已经移到侧栏底部，
     * 而底部那行按参考稿只放「头像 + 名字 + 积分」，第四个按钮会把名字挤没，
     * 所以主题放在展开后的菜单里（和参考站把「深色」放进账户菜单一致）。 */
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const rows = [
        { key: "profile", label: "账户管理", icon: UserCircle, href: "/profile" },
        { key: "wallet", label: "钱包", icon: Wallet, href: "/wallet" },
        { key: "help", label: "帮助中心", icon: CircleHelp, href: "/help" },
        ...(user.role === "admin" ? [{ key: "admin", label: "管理员后台", icon: ShieldCheck, href: "/admin" }] : []),
        { key: "site", label: "官网首页", icon: Globe, href: "/" },
    ];
    return (
        /* 参考 Lovart 账户弹层：头像 + 邮箱、一行套餐/积分、整宽升级按钮、纯文字菜单、退出登录。
         * 原来的「当前套餐」灰卡 + 重复积分行已被压成一行，菜单行距也更紧，整块宽度与侧栏一致。 */
        <div className="w-[232px] text-[var(--ink-1)]">
            <div className="flex items-center gap-2.5 px-0.5">
                <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-black/5 dark:ring-white/15">
                    {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                        <span className="grid size-full place-items-center bg-[linear-gradient(135deg,#f6b181_0%,#e2671f_100%)] text-[12px] font-semibold text-white">{avatarInitial}</span>
                    )}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold leading-5">{accountName}</div>
                    <div className="mt-0.5 truncate text-[11px] leading-4 text-[var(--ink-3)]">{user.email || `ID：${user.accountId}`}</div>
                </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--hairline)] px-0.5 pt-3">
                <span className="min-w-0 truncate text-[12px] text-[var(--ink-3)]">{planLabel}</span>
                <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[12.5px] font-semibold text-[var(--ink-1)] transition hover:bg-[var(--surface-soft)]"
                    onClick={() => onNavigate("/wallet")}
                    aria-label="查看积分与账单"
                >
                    <CreditSymbol className="text-[13px] text-[var(--brand-600)]" />
                    <span className="tabular-nums">{formatCreditAmount(user.pointsBalance)}</span>
                    <ChevronRight className="size-3.5 text-[var(--ink-3)]" />
                </button>
            </div>

            <button
                type="button"
                /* 按钮文字色走内联样式：全局有未分层级的 `button { color: inherit }`，
                   Tailwind 的文字颜色类在 @layer 里会被它压掉，黑底黑字就这么来的。 */
                style={{ color: "var(--surface-panel)" }}
                className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[#18181b] text-[12.5px] font-semibold transition hover:opacity-90 dark:bg-white"
                onClick={() => onNavigate("/wallet?section=billing")}
                aria-label={planActionLabel}
                title={planActionLabel}
            >
                <Crown className="size-3.5" /> {planActionLabel}
            </button>

            <div className="mt-2 flex flex-col">
                {/* 消息中心并进菜单：顶栏已取消，桌面的通知入口只有这里 */}
                <AnnouncementNotificationCenter
                    variant="row"
                    compact={false}
                    buttonClassName="text-[var(--ink-1)]"
                    onOpen={() => {
                        onDismiss?.();
                    }}
                />
                {rows.map((row) => {
                    const Icon = row.icon;
                    return (
                        <button
                            key={row.key}
                            type="button"
                            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12.5px] font-medium text-[var(--ink-1)] transition hover:bg-[var(--surface-soft)]"
                            onClick={() => onNavigate(row.href)}
                        >
                            <Icon className="size-4 shrink-0 text-[var(--ink-3)]" />
                            {row.label}
                        </button>
                    );
                })}
                {/* 外观作为普通一行，右侧显示当前模式与箭头，和参考站的「浅色 >」一致 */}
                <button
                    type="button"
                    className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12.5px] font-medium text-[var(--ink-1)] transition hover:bg-[var(--surface-soft)]"
                    onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                >
                    {theme === "dark" ? <Moon className="size-4 shrink-0 text-[var(--ink-3)]" /> : <Sun className="size-4 shrink-0 text-[var(--ink-3)]" />}
                    外观
                    <span className="ml-auto text-[11.5px] font-normal text-[var(--ink-3)]">{theme === "dark" ? "深色" : "浅色"}</span>
                    <ChevronRight className="size-3.5 text-[var(--ink-3)]" />
                </button>
            </div>

            <div className="mt-2 border-t border-[var(--hairline)] pt-2">
                <button type="button" className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12.5px] font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30" onClick={onLogout}>
                    <LogOut className="size-4 shrink-0" />
                    退出登录
                </button>
            </div>
        </div>
    );
}

/**
 * 悬浮积分时的小卡片：套餐 + 升级入口 + 积分 + 使用详情。
 * 和账户菜单里那块「当前套餐 / 积分余额」信息重叠，但用途不同 ——
 * 这里只回答两件事：我还有多少、去哪儿充值或看明细，所以做成紧凑三行，
 * 悬停即可看到，不用先点开账户菜单。
 */
function PointsQuickPanel({ user, onNavigate }: { user: LocalUser; onNavigate: (href: string) => void }) {
    const planLabel = user.planName || user.planId || "免费版";
    const planActionLabel = user.hasActivePlan ? "续费" : "升级";
    const dailyPoints = user.dailyPointsBalance || 0;
    return (
        <div className="w-[232px] text-[var(--ink-1)]">
            <div className="flex items-center justify-between gap-2 px-1">
                <span className="min-w-0 truncate text-[13px] font-semibold">{planLabel}</span>
                <button
                    type="button"
                    /* 同上：全局有未分层的 button{color:inherit}，文字色只能内联 */
                    style={{ color: "var(--surface-panel)" }}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-[#18181b] px-2.5 text-[11px] font-semibold transition hover:opacity-90 dark:bg-[#ffffff]"
                    onClick={() => onNavigate("/wallet?section=billing")}
                >
                    <Crown className="size-3" /> {planActionLabel}
                </button>
            </div>

            <div className="mt-2 border-t border-[var(--hairline)] pt-2">
                <div className="flex items-center justify-between gap-2 px-1 py-1">
                    <span className="inline-flex items-center gap-2 text-[12.5px] font-medium">
                        <CreditSymbol className="text-[13px]" />
                        积分
                    </span>
                    <span className="text-[13px] font-semibold tabular-nums">{formatCreditAmount(user.pointsBalance)}</span>
                </div>
                <div className="px-1 py-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-[12.5px] font-medium">
                            <Gift className="size-4 shrink-0" />
                            每日免费积分
                        </span>
                        <span className="text-[13px] font-semibold tabular-nums">{formatCreditAmount(dailyPoints)}</span>
                    </div>
                    <p className="mt-1 pl-6 text-[11px] leading-4 text-[var(--ink-3)]">每天重置为 {formatCreditAmount(dailyPoints)} 免费积分</p>
                </div>
            </div>

            <div className="mt-1">
                <button
                    type="button"
                    className="flex h-9 w-full items-center gap-2.5 rounded-lg px-1 text-left text-[12.5px] font-medium transition hover:bg-[var(--surface-soft)]"
                    onClick={() => onNavigate("/wallet")}
                >
                    使用详情
                    <ChevronRight className="ml-auto size-4 text-[var(--ink-3)]" />
                </button>
            </div>
        </div>
    );
}

/**
 * 侧栏底部的账号条（工作台专用）。
 *
 * 未点开时就是一行「头像 + 名字 …… ⚡积分」，整行是账户菜单的触发器；
 * 点开后的菜单里才有套餐/余额、账户管理、钱包、帮助、外观切换和退出登录。
 * 不再把积分、主题、头像拆成三个按钮塞进这一行 —— 侧栏展开也才 208px，
 * 塞第四个控件名字就没地方了，而且满排小按钮比一行账号信息更嘈杂。
 */
export function AccountRailBar({ expanded }: { expanded: boolean }) {
    const router = useRouter();
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const user = useUserStore((state) => state.user);
    const avatarUrl = user?.avatarUrl?.trim();
    const accountName = user?.displayName || user?.username || "用户";
    const avatarInitial = userAvatarInitial(accountName);

    const logout = async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
            await resetClientSessionState();
            router.replace("/login");
            router.refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "退出登录失败");
        }
    };

    if (!user) {
        return (
            <Link
                href="/login"
                className={cn("flex h-11 items-center rounded-lg text-[13px] text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]", expanded ? "gap-2 px-2" : "justify-center")}
            >
                <UserCircle className="size-4" />
                {expanded ? "登录" : null}
            </Link>
        );
    }

    return (
        <div className={cn("flex items-center gap-1", expanded ? "w-full" : "flex-col gap-1.5")}>
            <Popover
                rootClassName="account-menu-popover"
                open={open}
                onOpenChange={setOpen}
                trigger="click"
                placement="topLeft"
                arrow={false}
                content={
                    <AccountMenuPanel
                        user={user}
                        avatarUrl={avatarUrl}
                        avatarInitial={avatarInitial}
                        onNavigate={(href) => {
                            setOpen(false);
                            router.push(href);
                        }}
                        onLogout={() => {
                            setOpen(false);
                            void logout();
                        }}
                        onDismiss={() => setOpen(false)}
                    />
                }
            >
                <button
                    type="button"
                    aria-label="账户菜单"
                    title={accountName}
                className={cn(
                    "flex items-center rounded-lg text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]",
                    expanded ? "h-10 min-w-0 flex-1 gap-2 px-2" : "size-9 justify-center",
                )}
            >
                <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#f6b181_0%,#e2671f_100%)] text-[10px] font-semibold text-white ring-1 ring-black/5 dark:ring-white/15">
                    {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : avatarInitial}
                </span>
                {expanded ? <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-[var(--ink-1)]">{accountName}</span> : null}
                </button>
            </Popover>

            {/* 积分单独成键：悬停就展开「套餐 + 积分 + 使用详情」，
             * 想看余额/充值不用先点开账户菜单。 */}
            <Popover
                rootClassName="user-points-popover"
                trigger="hover"
                placement="topRight"
                arrow={false}
                content={
                    <PointsQuickPanel
                        user={user}
                        onNavigate={(href) => {
                            router.push(href);
                        }}
                    />
                }
            >
                <button
                    type="button"
                    aria-label="积分与套餐"
                    title="积分与套餐"
                    /* 不加胶囊底色：和左边的名字同属一行文字信息，
                     * 一有底色就会被读成「按钮压在账号行上」，破坏整行的干净。 */
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-1 text-[13px] font-semibold tabular-nums text-[var(--ink-2)] transition-colors hover:text-[var(--ink-1)]"
                >
                    <CreditSymbol className="text-[14px] text-[var(--brand-600)]" />
                    {formatCreditAmount(user.pointsBalance)}
                </button>
            </Popover>
        </div>
    );
}
