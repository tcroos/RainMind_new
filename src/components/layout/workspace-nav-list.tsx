"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { isExternalTool, navigationGroups, navigationToolHref, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";

/*
 * 桌面侧栏（rail）与移动抽屉（drawer）的导航，数据源、分组顺序、外链判定完全一致，
 * 差别只在「怎么排」：侧栏能收起到只剩图标，抽屉永远带文字、触控目标更宽松，
 * 并且用一个圆点标出当前页（触屏没有 hover 可借力）。
 *
 * 以前这段在两个文件里各写一遍，加一个导航项要改两处，而且已经各长各的：
 * 分组间距 mt-4 / mt-5、字号 font-normal / font-medium、条目间距 space-y-0.5 / space-y-1、
 * 选中指示「只有底色」/「底色 + 圆点」。现在两种外观的差异集中写在 VARIANTS 里，
 * 渲染逻辑只有一份 —— 差异是有意的就留在表里，是笔误就改一处。
 */

type NavVariant = "rail" | "drawer";

const NAV_ITEM_STATE = {
    active: "bg-[var(--surface-inset)] text-[var(--ink-1)]",
    idle: "text-[var(--ink-2)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]",
} as const;

const DRAWER_ITEM_BASE = "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-base transition";

const VARIANTS = {
    rail: {
        nav: (expanded: boolean) => cn("hide-scrollbar min-h-0 flex-1 overflow-y-auto py-3", expanded ? "px-4" : "px-2"),
        group: "mt-4",
        groupLabel: "mb-1 px-2 text-[13px] font-normal text-[var(--ink-3)]",
        items: "space-y-0.5",
        item: (expanded: boolean) => cn("group relative flex h-11 items-center rounded-lg px-2 text-base font-medium transition-colors duration-150", expanded ? "justify-start gap-3 px-3" : "justify-center"),
        activeItem: NAV_ITEM_STATE.active,
        idleItem: NAV_ITEM_STATE.idle,
        activeDot: false,
    },
    drawer: {
        nav: () => undefined,
        group: "mt-5",
        groupLabel: "mb-1 px-3 text-[13px] font-medium text-[var(--ink-3)]",
        items: "space-y-1",
        item: () => DRAWER_ITEM_BASE,
        activeItem: cn(NAV_ITEM_STATE.active, "font-medium"),
        idleItem: NAV_ITEM_STATE.idle,
        activeDot: true,
    },
} as const;

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
};

export function WorkspaceNavList({ variant, activeToolSlug, expanded = true, onNavigate }: WorkspaceNavListProps) {
    const router = useRouter();
    const styles = VARIANTS[variant];
    const isRail = variant === "rail";
    /* 侧栏收起时只留图标，靠 title 和 aria-label 兜住可读性；抽屉永远带文字 */
    const showLabel = isRail ? expanded : true;

    return (
        <nav className={styles.nav(expanded)} aria-label="工作空间导航">
            {navigationGroups.map((group, groupIndex) => {
                const tools = navigationTools.filter((tool) => tool.group === group.id);
                return (
                    <div key={group.id} className={cn(groupIndex > 0 && styles.group)}>
                        {showLabel ? <div className={styles.groupLabel}>{group.label}</div> : null}
                        <div className={styles.items}>
                            {tools.map((tool) => {
                                const Icon = tool.icon;
                                const active = tool.slug === activeToolSlug;
                                const external = isExternalTool(tool);
                                const href = navigationToolHref(tool);
                                const className = cn(styles.item(expanded), active ? styles.activeItem : styles.idleItem);
                                /* 侧栏收起后只剩图标，必须给 title；抽屉一直有文字，不需要 */
                                const hint = isRail ? tool.label : undefined;
                                const content = (
                                    <>
                                        <Icon className={cn("size-5 shrink-0", isRail && active && "text-[var(--ink-1)]")} />
                                        {showLabel ? <span className="min-w-0 flex-1 truncate">{tool.label}</span> : null}
                                        {styles.activeDot ? <span className={cn("size-1.5 rounded-full", active ? "bg-current" : "bg-transparent")} aria-hidden /> : null}
                                    </>
                                );
                                return external ? (
                                    <a key={tool.slug} href={href} target="_blank" rel="noreferrer noopener" title={hint} className={className}>
                                        {content}
                                    </a>
                                ) : (
                                    <Link
                                        key={tool.slug}
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
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </nav>
    );
}
