import type { ViewportTransform } from "../types";
import type { CanvasBounds } from "./canvas-spatial-index";

/** 悬浮工具栏的估算屏幕尺寸，用于把它收敛在画布可视区域内 */
export const SELECTION_TOOLBAR_WIDTH = 620;
export const SELECTION_TOOLBAR_HEIGHT = 40;
const SCREEN_MARGIN = 12;
const ANCHOR_GAP = 12;

/** 组框左上角 Group N 纯文字标签的屏幕锚点，和组框共用同一个 viewport 换算，缩放时严格跟手 */
export function groupLabelScreenAnchor(bounds: CanvasBounds, viewport: ViewportTransform, size: { width: number; height: number }) {
    return {
        left: Math.min(Math.max(8, viewport.x + bounds.left * viewport.k + 8), Math.max(8, size.width - 120)),
        top: Math.min(Math.max(8, viewport.y + bounds.top * viewport.k - 20), Math.max(8, size.height - 28)),
    };
}

/**
 * 把世界坐标的选区边界换算成工具栏的屏幕锚点。
 * 工具栏挂在屏幕层（不随画布缩放），left 是水平中心、top 是底边（贴在选区上沿）。
 * 选区贴到画布顶部或左右边缘时，把工具栏收进可视区域，避免被裁掉。
 */
export function toolbarScreenAnchor(bounds: CanvasBounds, viewport: ViewportTransform, size: { width: number; height: number }, gap = ANCHOR_GAP) {
    const centerX = viewport.x + ((bounds.left + bounds.right) / 2) * viewport.k;
    const topY = viewport.y + bounds.top * viewport.k - gap;
    const halfWidth = Math.min(SELECTION_TOOLBAR_WIDTH / 2, Math.max(0, size.width / 2 - SCREEN_MARGIN));
    const minX = halfWidth + SCREEN_MARGIN;
    const maxX = size.width - halfWidth - SCREEN_MARGIN;
    const maxTop = Math.max(SELECTION_TOOLBAR_HEIGHT + SCREEN_MARGIN, size.height - SCREEN_MARGIN);
    return {
        left: maxX >= minX ? Math.min(maxX, Math.max(minX, centerX)) : size.width / 2,
        top: Math.min(maxTop, Math.max(SELECTION_TOOLBAR_HEIGHT + SCREEN_MARGIN, topY)),
    };
}
