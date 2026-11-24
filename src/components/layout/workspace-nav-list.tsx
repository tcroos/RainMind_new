"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { Popover } from "antd";

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

type NavChild = { slug: string; label: string; description: string; href: string; icon: typeof navigationTools[number]["icon"] };

function toolChildren(tool: (typeof navigationTools)[number]): readonly NavChild[] | undefined {
    return "children" in tool ? (tool.children as readonly NavChild[]) : undefined;
}

/* 二级条目是否命中：先比路径，再比 ?tab。
 * 目的不只是高亮 —— 侧栏和页面内的 tab 共用同一组 URL，两边状态天然一致。 */
function isChildActive(href: string, pathname: string, tab: string | null) {
    const [path, query] = href.split("?");
    if (path !== pathname) return false;
    return new URLSearchParams(query ?? "").get("tab") === tab;
}

/** 二级面板：素材 / 提示词这类「同一件事的不同形态」，在侧栏就地切换。 */
function NavFlyout({ items, pathname, tab, onNavigate }: { items: readonly NavChild[]; pathname: string; tab: string | null; onNavigate?: () => void }) {
    return (
        <div className="w-60">
            {items.map((item) => {
                const Icon = item.icon;
                const active = isChildActive(item.href, pathname, tab);
                return (
                    <Link
                        key={item.slug}
                        href={item.href}
                        prefetch
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                            "flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors",
                            active ? "bg-[var(--surface-inset)]" : "hover:bg-[var(--surface-inset)]",
                        )}
                    >
                        <Icon className="mt-0.5 size-4 shrink-0 text-[var(--ink-3)]" />
                        <span className="min-w-0 flex-1">
                            <span className={cn("block truncate text-[13px] leading-5 text-[var(--ink-1)]", active && "font-semibold")}>{item.label}</span>
                            <span className="block truncate text-[11px] leading-4 text-[var(--ink-3)]">{item.description}</span>
                        </span>
                        {active ? <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--brand-600)]" /> : null}
                    </Link>
                );
            })}
        </div>
    );
}

export function WorkspaceNavList({ variant, activeToolSlug, expanded = true, onNavigate }: WorkspaceNavListProps) {
    const router = useRouter();
    const pathname = usePathname();
    const tab = useSearchParams().get("tab");
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
                                const children = toolChildren(tool);
                                const item = external ? (
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

                                if (!children?.length) return item;

                                /* 抽屉是触屏语境，没有 hover 可借力：直接平铺子项，父项不渲染 ——
                                 * 否则「素材 / 素材 / 提示词」连着三行，父项和第一个子项完全重复。 */
                                if (!isRail) {
                                    return (
                                        <div key={tool.slug} className="space-y-0.5">
                                            {children.map((child) => {
                                                const ChildIcon = child.icon;
                                                const childActive = isChildActive(child.href, pathname, tab);
                                                return (
                                                    <Link
                                                        key={child.slug}
                                                        href={child.href}
                                                        prefetch
                                                        onClick={onNavigate}
                                                        aria-current={childActive ? "page" : undefined}
                                                        className={cn(DRAWER_ITEM_BASE, childActive ? VARIANTS.drawer.activeItem : VARIANTS.drawer.idleItem)}
                                                    >
                                                        <ChildIcon className="size-5 shrink-0" />
                                                        <span className="min-w-0 flex-1 truncate">{child.label}</span>
                                                        <span className={cn("size-1.5 rounded-full", childActive ? "bg-current" : "bg-transparent")} aria-hidden />
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    );
                                }

                                /* 桌面侧栏：悬停展开二级面板，点父项仍直接进默认子项 ——
                                 * 常用路径（看素材）不需要多一次点击，切提示词才走面板。 */
                                return (
                                    <Popover
                                        key={tool.slug}
                                        trigger={["hover", "focus"]}
                                        placement="rightTop"
                                        arrow={false}
                                        /* antd 默认会把面板压在触发元素上，往右让出 10px，
                                         * 侧栏条目本身才不会被盖住（收起态 72px 时尤其明显） */
                                        align={{ offset: [10, 0] }}
                                        mouseEnterDelay={0.1}
                                        mouseLeaveDelay={0.16}
                                        rootClassName="nav-flyout-popover"
                                        content={<NavFlyout items={children} pathname={pathname} tab={tab} onNavigate={onNavigate} />}
                                    >
                                        {item}
                                    </Popover>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </nav>
    );
}
