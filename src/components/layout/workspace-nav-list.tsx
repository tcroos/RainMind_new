"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tooltip } from "antd";
import type { ReactNode } from "react";

import type { SidebarMode } from "@/components/layout/sidebar-width";

import { isExternalTool, navigationGroups, navigationToolHref, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";

/*
 * 桌面侧栏（rail）与移动抽屉（drawer）的导航，数据源、顺序、外链判定完全一致，
 * 差别只在「怎么排」：侧栏能收起到只剩图标，抽屉永远带文字、触控目标更宽松。
 *
 * 参考 Lovart 侧栏：分组标题（创作 / 项目 / 资产 / 个人）已取消，所有入口平铺成一列，
 * 靠统一的 40px 行高与浅底选中态分层。navigationGroups 仍作为「顺序定义」保留在常量里，
 * 只是不再渲染成小字标题 —— 数据结构不动，旧链接与分组相关的调用方都不受影响。
 *
 * 素材库曾在这里挂过 hover 浮层（「素材 / 我的提示词 / 公共词库」），已移除：
 * 浮层是给人看的「菜单」，但这三项其实是同一页的内容切换，应该在页面内用 tab 完成。
 */

type NavVariant = "rail" | "drawer";

const RAIL_ITEM_BASE = "group relative flex h-10 items-center rounded-lg px-2 text-[14px] font-medium transition-colors duration-150";
const DRAWER_ITEM_BASE = "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] transition";

const VARIANTS = {
    rail: {
        /* 导航和「最近项目」共用这一个滚动容器：整条侧栏只有一条滚动条 */
        /* 收起与展开共用同一套水平几何（nav 左右 8px、条目左内边距 19px）：
         * 图标中心恒在 x=36，宽度动画时图标原地不动、只有右侧文字被裁切/淡入淡出（照 Lovart）。 */
        nav: (_expanded: boolean) => "hide-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1",
        items: "space-y-0.5",
        item: (_expanded: boolean) => cn(RAIL_ITEM_BASE, "justify-start gap-3 overflow-hidden whitespace-nowrap pl-[19px] pr-3"),
        /* 侧栏选中态只用一层极浅底 + 字重，不再加圆点或色条 */
        activeItem: "bg-[var(--surface-inset)] text-[var(--ink-1)]",
        idleItem: "text-[var(--ink-2)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]",
    },
    drawer: {
        nav: () => undefined,
        items: "space-y-0.5",
        item: () => DRAWER_ITEM_BASE,
        /* 抽屉选中态更轻：只把图标和文字染成品牌色并加粗，去掉整块灰底与右侧圆点 */
        activeItem: "font-semibold text-[var(--brand-600)]",
        idleItem: "text-[var(--ink-2)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]",
    },
} as const;

/* 分组只用来定顺序，标题本身不再显示 */
const FLAT_TOOLS = navigationGroups.flatMap((group) => navigationTools.filter((tool) => tool.group === group.id));

/** 抽屉里非导航条目（个人中心 / 官网首页）复用同一套条目样式，避免再手抄一遍。 */
export function drawerNavItemClass(active: boolean) {
    return cn(DRAWER_ITEM_BASE, active ? VARIANTS.drawer.activeItem : VARIANTS.drawer.idleItem);
}

type WorkspaceNavListProps = {
    variant: NavVariant;
    activeToolSlug?: NavigationToolSlug;
    /** 仅 rail 使用：侧栏是否展开；收起时只留图标与 title 提示 */
    expanded?: boolean;
    /** 抽屉里点条目后要关掉抽屉 */
    onNavigate?: () => void;
    /** 仅 rail 使用：显示档位。collapsed 只有图标（悬停浮出名称），compact 图标在上名称在下，full 横排 */
    railMode?: SidebarMode;
    /** 侧栏导航下方的附加区块（最近项目），与导航共用同一滚动容器 */
    footer?: ReactNode;
};

export function WorkspaceNavList({ variant, activeToolSlug, expanded = true, railMode, onNavigate, footer }: WorkspaceNavListProps) {
    const router = useRouter();
    const styles = VARIANTS[variant];
    const isRail = variant === "rail";
    /* 侧栏收起时只留图标，靠 title 和 aria-label 兜住可读性；抽屉永远带文字 */
    const mode: SidebarMode = isRail ? (railMode ?? (expanded ? "full" : "collapsed")) : "full";
    /* rail 的文字始终在 DOM 里，收起时只淡出，保证宽度动画中图标不跳 */
    const showLabel = isRail || mode !== "collapsed";
    const labelHidden = isRail && mode === "collapsed";

    return (
        <nav className={styles.nav(expanded)} aria-label="工作空间导航">
            <div className={styles.items}>
                {FLAT_TOOLS.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    const external = isExternalTool(tool);
                    const href = navigationToolHref(tool);
                    const compact = isRail && mode === "compact";
                    const className = cn(
                        compact ? "group relative flex h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[12px] font-medium transition-colors duration-150" : styles.item(expanded),
                        active ? styles.activeItem : styles.idleItem,
                    );
                    /* 收起态的名称交给右侧 Tooltip 浮出；其它档位名称已经显示，不再给 title */
                    const hint = undefined;
                    const content = (
                        <>
                            <Icon className={cn("size-[18px] shrink-0", isRail && active && "text-[var(--ink-1)]")} />
                            {showLabel ? (
                                <span
                                    aria-hidden={labelHidden || undefined}
                                    className={cn("min-w-0 truncate transition-opacity duration-200", compact ? "max-w-full text-center leading-4" : "flex-1", labelHidden && "opacity-0")}
                                >
                                    {tool.label}
                                </span>
                            ) : null}
                        </>
                    );
                    const withTip = (node: ReactNode) =>
                        isRail && mode === "collapsed" ? (
                            <Tooltip key={tool.slug} title={tool.label} placement="right" mouseEnterDelay={0.05} arrow={false}>
                                {node}
                            </Tooltip>
                        ) : (
                            node
                        );
                    if (external) {
                        return withTip(
                            <a key={tool.slug} href={href} target="_blank" rel="noreferrer noopener" title={hint} aria-label={tool.label} className={className}>
                                {content}
                            </a>,
                        );
                    }
                    return withTip(
                        <Link
                            key={tool.slug}
                            aria-label={tool.label}
                            href={href}
                            prefetch
                            title={hint}
                            onMouseEnter={() => router.prefetch(href)}
                            onFocus={() => router.prefetch(href)}
                            onClick={onNavigate}
                            className={className}
                            aria-current={active ? "page" : undefined}
                        >
                            {content}
                        </Link>,
                    );
                })}
            </div>
            {footer ? <div className="mt-5">{footer}</div> : null}
        </nav>
    );
}
