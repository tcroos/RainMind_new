import { describe, expect, it } from "vitest";

import { HOME_NAVIGATION } from "./home-data";

describe("home header navigation", () => {
    it("keeps the top nav to API 服务 + 联系我们", () => {
        const labels = HOME_NAVIGATION.map((item) => item.label);

        expect(labels).toEqual(["API 服务", "联系我们"]);
    });

    it("does not put 意见反馈 in the top nav (it lives in the footer instead)", () => {
        expect(HOME_NAVIGATION.map((item) => item.label)).not.toContain("意见反馈");
    });
});
