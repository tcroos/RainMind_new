import { describe, expect, it } from "vitest";

import { CANVAS_RESIZE_HIT_SCREEN_PX, CANVAS_RESIZE_HIT_WORLD_MAX, CANVAS_RESIZE_START_THRESHOLD_PX, canvasResizeHitSize, shouldStartCanvasNodeResize } from "./canvas-node-resize";

describe("shouldStartCanvasNodeResize", () => {
    it("轻微抖动不触发缩放", () => {
        expect(shouldStartCanvasNodeResize(1, 1)).toBe(false);
        expect(shouldStartCanvasNodeResize(2, 2)).toBe(false);
    });

    it("位移达到阈值才触发", () => {
        expect(shouldStartCanvasNodeResize(CANVAS_RESIZE_START_THRESHOLD_PX, 0)).toBe(true);
        expect(shouldStartCanvasNodeResize(0, -CANVAS_RESIZE_START_THRESHOLD_PX)).toBe(true);
        expect(shouldStartCanvasNodeResize(8, 6)).toBe(true);
    });

    it("按屏幕像素斜向距离判断，不受单轴小位移影响", () => {
        expect(shouldStartCanvasNodeResize(3, 0)).toBe(false);
        expect(shouldStartCanvasNodeResize(3, 3)).toBe(true);
    });

    it("阈值可覆盖", () => {
        expect(shouldStartCanvasNodeResize(5, 0, 8)).toBe(false);
        expect(shouldStartCanvasNodeResize(8, 0, 8)).toBe(true);
    });
});

describe("canvasResizeHitSize", () => {
    it("1 倍缩放下命中区就是 24px，明显小于原来的 44px", () => {
        expect(canvasResizeHitSize(1)).toBe(CANVAS_RESIZE_HIT_SCREEN_PX);
    });

    it("缩小画布时按屏幕像素补偿，保持差不多的可点面积", () => {
        expect(canvasResizeHitSize(0.5)).toBe(48);
        expect(canvasResizeHitSize(0.2)).toBe(CANVAS_RESIZE_HIT_WORLD_MAX);
        expect(canvasResizeHitSize(2)).toBe(12);
    });

    it("自定义屏幕尺寸同样受世界坐标上限约束", () => {
        expect(canvasResizeHitSize(0.1, 100)).toBe(CANVAS_RESIZE_HIT_WORLD_MAX);
        expect(canvasResizeHitSize(1, 16)).toBe(16);
    });
});
