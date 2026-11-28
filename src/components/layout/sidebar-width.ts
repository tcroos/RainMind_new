/**
 * 桌面侧栏宽度 → 显示档位。
 * 边界保持原来的 72px（收起）~ 232px（完全展开）不动，中间可以自由拖拽：
 * - 拖过的比例 < 30%：收起态，只有图标，指针悬停图标时右侧浮出板块名称；
 * - 30% ~ 70%：紧凑态，图标在上、板块名称在下；
 * - ≥ 70%：完全展开，图标 + 名称横排，显示最近项目。
 * 宽度本身不吸附，用户拖到哪就停在哪；只有档位随比例切换。
 */
export const SIDEBAR_MIN_WIDTH = 72;
export const SIDEBAR_MAX_WIDTH = 232;
/** 紧凑态标准宽度：落在 30%~70% 区间内（120~184px），够放两字到四字的板块名 */
export const SIDEBAR_COMPACT_WIDTH = 128;
export const SIDEBAR_COMPACT_RATIO = 0.3;
export const SIDEBAR_FULL_RATIO = 0.7;

export type SidebarMode = "collapsed" | "compact" | "full";

export function clampSidebarWidth(width: number) {
    if (!Number.isFinite(width)) return SIDEBAR_MIN_WIDTH;
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function sidebarRatio(width: number) {
    return (clampSidebarWidth(width) - SIDEBAR_MIN_WIDTH) / (SIDEBAR_MAX_WIDTH - SIDEBAR_MIN_WIDTH);
}

export function sidebarModeForWidth(width: number): SidebarMode {
    const ratio = sidebarRatio(width);
    if (ratio >= SIDEBAR_FULL_RATIO) return "full";
    if (ratio >= SIDEBAR_COMPACT_RATIO) return "compact";
    return "collapsed";
}
