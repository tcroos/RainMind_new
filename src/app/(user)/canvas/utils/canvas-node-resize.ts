/**
 * 节点缩放的触发阈值。
 * 原来四角各有一块 44px 的常驻命中区，鼠标擦过节点角就会进入缩放；
 * 现在命中区按屏幕像素恒定、只在节点激活时接管指针，并且按下后要真正拖动才开始改尺寸。
 */

/** 按下后累计位移超过该屏幕像素距离才算开始缩放，避免单击/手抖误触发 */
export const CANVAS_RESIZE_START_THRESHOLD_PX = 4;

/** 缩放角命中区在屏幕上的边长（像素） */
export const CANVAS_RESIZE_HIT_SCREEN_PX = 24;

/** 世界坐标命中区的上限，避免画布缩得很小时在节点内部铺开一大片 */
export const CANVAS_RESIZE_HIT_WORLD_MAX = 48;

export function shouldStartCanvasNodeResize(dx: number, dy: number, threshold = CANVAS_RESIZE_START_THRESHOLD_PX) {
    return Math.hypot(dx, dy) >= threshold;
}

/** 把屏幕像素换算成世界坐标命中区；低于 0.4 倍时封顶，保证远景下不会盖住节点内容 */
export function canvasResizeHitSize(scale: number, screenPixels = CANVAS_RESIZE_HIT_SCREEN_PX) {
    return Math.min(CANVAS_RESIZE_HIT_WORLD_MAX, screenPixels / Math.max(scale, 0.4));
}
