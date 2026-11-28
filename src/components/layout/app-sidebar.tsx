"use client";

import { PanelLeft } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { AccountRailBar } from "@/components/layout/user-status-actions";
import { SidebarNewProject, SidebarRecentProjects } from "@/components/layout/sidebar-projects";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampSidebarWidth, sidebarModeForWidth, type SidebarMode } from "@/components/layout/sidebar-width";
import { SiteLogo } from "@/components/layout/site-logo";
import { WorkspaceNavList } from "@/components/layout/workspace-nav-list";
import { type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { DEFAULT_SITE_TITLE, resolveSiteTitle } from "@/lib/site-brand";
import { usePublicSessionStore } from "@/stores/use-public-session-store";

/* 折叠开关放在品牌行右侧（照参考稿），不再放在顶栏。
 * 图标用最简的 PanelLeft，状态靠 aria-pressed 和 title 表达。 */
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

/**
 * 桌面侧栏：默认收起（72px），右边缘可自由拖拽到 232px。
 * 显示档位由拖过的比例决定（见 sidebar-width.ts）：收起 → 图标 + 悬停提示；
 * 紧凑 → 图标在上、名称在下；完全展开 → 横排 + 最近项目。
 */
export function AppSidebar({
    activeToolSlug,
    width,
    onWidthChange,
    onToggleExpanded,
}: {
    activeToolSlug?: NavigationToolSlug;
    width: number;
    onWidthChange: (width: number, done: boolean) => void;
    onToggleExpanded?: () => void;
}) {
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: DEFAULT_SITE_TITLE, logoUrl: "/logo.svg" };
    const siteTitle = resolveSiteTitle(site.title);
    const mode: SidebarMode = sidebarModeForWidth(width);
    const expanded = mode === "full";
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { startX: event.clientX, startWidth: width };
        setDragging(true);
    };
    const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        onWidthChange(clampSidebarWidth(drag.startWidth + event.clientX - drag.startX), false);
    };
    const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        setDragging(false);
        onWidthChange(clampSidebarWidth(drag.startWidth + event.clientX - drag.startX), true);
    };

    return (
        <aside
            data-sidebar-mode={mode}
            style={{ width }}
            className={cn("relative hidden h-full shrink-0 flex-col overflow-x-clip bg-[var(--surface-rail)] text-[var(--ink-1)] lg:flex", dragging ? "select-none" : "transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)]")}
        >
            {expanded ? (
                <div className="flex h-14 shrink-0 items-center justify-between gap-2 pl-5 pr-3">
                    <Link href="/create" className="flex min-w-0 items-center" aria-label={siteTitle}>
                        <SiteLogo logoUrl={site.logoUrl} className="size-8 shrink-0" />
                        <span className="ml-2.5 min-w-0 truncate text-[15px] font-semibold">{siteTitle}</span>
                    </Link>
                    <SidebarToggle expanded onToggle={onToggleExpanded} className="size-8" />
                </div>
            ) : (
                /* 收起 / 紧凑态不额外占一行：折叠图标平时透明，指针落到品牌图标上才换出来。 */
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

            {/* 收起 / 完全展开：左边缘钉在 16px，动画中「+」不动；紧凑档导航是居中的纵排，按钮跟着实时宽度居中 */}
            <div className={cn("shrink-0 pb-3 pt-1", mode === "compact" ? "flex justify-center px-2" : "px-4")}>
                <SidebarNewProject expanded={expanded} />
            </div>

            <WorkspaceNavList variant="rail" activeToolSlug={activeToolSlug} expanded={expanded} railMode={mode} footer={<SidebarRecentProjects expanded={expanded} />} />

            <div className={cn("shrink-0 px-2", expanded ? "pb-3 pt-2" : "pb-2", mode === "compact" && "flex justify-center")}>
                <AccountRailBar expanded={expanded} />
            </div>

            {/* 右边缘拖拽手柄：8px 热区，悬停/拖动时显示一条细线；双击在收起与完全展开之间切换 */}
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整侧边栏宽度"
                aria-valuemin={SIDEBAR_MIN_WIDTH}
                aria-valuemax={SIDEBAR_MAX_WIDTH}
                aria-valuenow={width}
                tabIndex={0}
                data-testid="sidebar-resize-handle"
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={onToggleExpanded}
                onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") onWidthChange(clampSidebarWidth(width - 16), true);
                    if (event.key === "ArrowRight") onWidthChange(clampSidebarWidth(width + 16), true);
                }}
                className="group/handle absolute inset-y-0 right-0 z-40 w-2 cursor-col-resize touch-none outline-none"
            >
                <span className={cn("absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--brand-500)] transition-opacity", dragging ? "opacity-100" : "opacity-0 group-hover/handle:opacity-60 group-focus-visible/handle:opacity-100")} />
            </div>
        </aside>
    );
}
