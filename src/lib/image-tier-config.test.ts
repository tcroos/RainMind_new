import { describe, expect, it } from "vitest";

import { cloneImageTiers, DEFAULT_IMAGE_TIERS, imageTierMatchesModel, isFreeImageModel, normalizeImageTiers, resolveImageTierId } from "./image-tier-config";

describe("image tiers", () => {
    it("缺失或空数组回落默认两条，免费档默认生效", () => {
        expect(normalizeImageTiers(undefined).map((tier) => tier.id)).toEqual(["free", "standard"]);
        expect(normalizeImageTiers([]).find((tier) => tier.id === "free")?.free).toBe(true);
        expect(isFreeImageModel(DEFAULT_IMAGE_TIERS, { tier: "free" })).toBe(true);
        expect(isFreeImageModel(DEFAULT_IMAGE_TIERS, { tier: "standard" })).toBe(false);
    });

    it("只有启用且标记 free 的档位才免单", () => {
        const tiers = normalizeImageTiers([
            { id: "promo", label: "活动", order: 10, enabled: true, free: true },
            { id: "off", label: "停用", order: 20, enabled: false, free: true },
        ]);
        expect(isFreeImageModel(tiers, { tier: "promo" })).toBe(true);
        expect(isFreeImageModel(tiers, { tier: "off" })).toBe(false);
        expect(isFreeImageModel(tiers, undefined)).toBe(false);
        expect(isFreeImageModel(undefined, { tier: "promo" })).toBe(false);
    });

    it("丢弃非法项并按 order 排序，label 为空时保留条目", () => {
        const tiers = normalizeImageTiers([
            { id: "vip", label: "站长生图", order: 30, enabled: true },
            { id: "Bad Id", label: "非法", order: 10 },
            { id: "vip", label: "重复", order: 40 },
            { id: "free", label: "", order: 5, enabled: true },
        ]);
        expect(tiers.map((tier) => tier.id)).toEqual(["free", "vip"]);
        expect(tiers[0].label).toBe("未命名档位");
    });

    it("模型 tier 等于档位 id 时命中", () => {
        const entry = { id: "free", label: "免费生图", order: 10, enabled: true, free: true };
        expect(imageTierMatchesModel(entry, { tier: "free" })).toBe(true);
        expect(imageTierMatchesModel(entry, { tier: "standard" })).toBe(false);
        expect(imageTierMatchesModel(entry, {})).toBe(false);
    });

    it("记忆值失效时回落到第一个启用档位", () => {
        const tiers = cloneImageTiers(DEFAULT_IMAGE_TIERS);
        expect(resolveImageTierId(tiers, "standard")).toBe("standard");
        expect(resolveImageTierId(tiers, "missing")).toBe("free");
        expect(resolveImageTierId(tiers, undefined)).toBe("free");
    });
});
