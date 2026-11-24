import { describe, expect, it } from "vitest";

import { formatCanvasUpdatedDate } from "./canvas-project-format";

describe("formatCanvasUpdatedDate", () => {
    it("输出中文年月日，月日不补零", () => {
        expect(formatCanvasUpdatedDate(new Date(2026, 10, 14, 9, 5).toISOString())).toBe("更新于 2026年11月14日");
        expect(formatCanvasUpdatedDate(new Date(2026, 0, 3, 23, 59).toISOString())).toBe("更新于 2026年1月3日");
    });

    it("非法值返回空串，由卡片决定这一行不渲染", () => {
        expect(formatCanvasUpdatedDate("not-a-date")).toBe("");
        expect(formatCanvasUpdatedDate("")).toBe("");
    });
});
