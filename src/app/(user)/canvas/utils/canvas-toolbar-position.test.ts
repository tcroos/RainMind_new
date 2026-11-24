import { describe, expect, it } from "vitest";

import { SELECTION_TOOLBAR_HEIGHT, SELECTION_TOOLBAR_WIDTH, toolbarScreenAnchor } from "./canvas-toolbar-position";

const bounds = { left: 400, top: 100, right: 800, bottom: 300 };
const viewport = { x: 0, y: 0, k: 1 };
const size = { width: 1280, height: 760 };

describe("toolbarScreenAnchor", () => {
    it("常规位置：工具栏底边贴在选区上沿，水平居中", () => {
        expect(toolbarScreenAnchor(bounds, viewport, size)).toEqual({ left: 600, top: 88 });
    });

    it("随画布缩放与平移换算屏幕坐标", () => {
        expect(toolbarScreenAnchor(bounds, { x: 40, y: 20, k: 0.5 }, size)).toEqual({ left: 340, top: 58 });
    });

    it("选区贴左边缘时把工具栏推进可视区域", () => {
        const left = toolbarScreenAnchor({ left: -400, top: 200, right: -100, bottom: 300 }, viewport, size);
        expect(left.left).toBeGreaterThanOrEqual(SELECTION_TOOLBAR_WIDTH / 2 + 12);
    });

    it("选区贴右边缘时把工具栏拉回可视区域", () => {
        const right = toolbarScreenAnchor({ left: 1400, top: 200, right: 1700, bottom: 300 }, viewport, size);
        expect(right.left).toBeLessThanOrEqual(size.width - SELECTION_TOOLBAR_WIDTH / 2 - 12);
    });

    it("选区贴顶边缘时不会让工具栏被裁掉", () => {
        expect(toolbarScreenAnchor({ left: 0, top: -200, right: 200, bottom: 0 }, viewport, size).top).toBe(SELECTION_TOOLBAR_HEIGHT + 12);
    });

    it("选区贴底边缘时仍留在可视区域内", () => {
        expect(toolbarScreenAnchor({ left: 0, top: 900, right: 200, bottom: 1000 }, viewport, size).top).toBeLessThanOrEqual(size.height - 12);
    });

    it("组激活时可自定义更大的间距，给组菜单让位", () => {
        expect(toolbarScreenAnchor(bounds, viewport, size, 36).top).toBe(64);
    });

    it("画布比工具栏还窄时退化为居中，不产出越界坐标", () => {
        const narrow = toolbarScreenAnchor(bounds, viewport, { width: 400, height: 300 });
        expect(narrow.left).toBe(200);
        expect(narrow.top).toBeGreaterThanOrEqual(SELECTION_TOOLBAR_HEIGHT + 12);
    });
});
