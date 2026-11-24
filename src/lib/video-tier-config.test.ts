import { describe, expect, it } from "vitest";

import {
    cloneVideoTiers,
    DEFAULT_VIDEO_TIERS,
    MAX_VIDEO_TIERS,
    normalizeVideoTiers,
    resolveVideoTierId,
    videoTierBillingMode,
    videoTierMatchesModel,
} from "./video-tier-config";

describe("normalizeVideoTiers", () => {
    it("配置缺失或非法时回落到内置默认", () => {
        expect(normalizeVideoTiers(undefined).map((tier) => tier.id)).toEqual(DEFAULT_VIDEO_TIERS.map((tier) => tier.id));
        expect(normalizeVideoTiers("broken").length).toBe(DEFAULT_VIDEO_TIERS.length);
        expect(normalizeVideoTiers([]).length).toBe(DEFAULT_VIDEO_TIERS.length);
    });

    it("丢弃非法项、去重 id 并按 order 排序", () => {
        const tiers = normalizeVideoTiers([
            { id: "value-second", label: "低价福利（按秒）", modelTier: "value", display: "grouped", billingMode: "duration", order: 40, enabled: true },
            { id: "Bad Id", label: "非法", modelTier: "value" },
            { id: "value-second", label: "重复", modelTier: "value" },
            { id: "official", label: "官方原生", modelTier: "official", display: "flat", order: 10 },
        ]);
        expect(tiers.map((tier) => tier.id)).toEqual(["official", "value-second"]);
        expect(tiers[1].billingMode).toBe("duration");
    });

    it("label 清空时保留条目并回落默认名称（不整条丢弃）", () => {
        const tiers = normalizeVideoTiers([
            { id: "official", label: "官方原生", modelTier: "official", display: "flat", order: 10, enabled: true },
            { id: "value-new", label: "", modelTier: "value", display: "grouped", order: 20, enabled: true },
        ]);
        expect(tiers.map((tier) => tier.id)).toEqual(["official", "value-new"]);
        expect(tiers[1].label).toBe("低价福利");
    });

    it("老的单条 value 自动迁移成按次/按秒两条，且不重复", () => {
        const migrated = normalizeVideoTiers([
            { id: "official", label: "官方原生", modelTier: "official", display: "flat", order: 10, enabled: true },
            { id: "stable", label: "特价稳定", modelTier: "stable", display: "flat", order: 20, enabled: true },
            { id: "value", label: "低价福利", modelTier: "value", display: "grouped", order: 30, enabled: true },
        ]);
        expect(migrated.map((tier) => tier.id)).toEqual(["official", "stable", "value-fixed", "value-duration"]);
    });

    it("已存在拆分条目时不再重复添加", () => {
        const migrated = normalizeVideoTiers([
            { id: "value", label: "低价福利", modelTier: "value", display: "grouped", order: 10, enabled: true },
            { id: "value-fixed", label: "低价福利（按次）", modelTier: "value", display: "grouped", billingMode: "fixed", order: 20, enabled: true },
        ]);
        expect(migrated.filter((tier) => tier.modelTier === "value" && tier.billingMode === "fixed")).toHaveLength(1);
        expect(migrated.map((tier) => tier.id)).toEqual(["value-fixed", "value-duration"]);
    });

    it("限制最大条目数", () => {        const many = Array.from({ length: MAX_VIDEO_TIERS + 4 }, (_, index) => ({
            id: `tier-${index}`,
            label: `档位 ${index}`,
            modelTier: "value",
            display: "grouped",
            order: index,
            enabled: true,
        }));
        expect(normalizeVideoTiers(many).length).toBe(MAX_VIDEO_TIERS);
    });
});

describe("videoTierBillingMode", () => {
    it("按首个启用绑定的 videoBilling.mode 判定，缺省按按次", () => {
        expect(videoTierBillingMode({ bindings: [{ enabled: true, priority: 1, capabilityProfile: { videoBilling: { mode: "duration" } } }] })).toBe("duration");
        expect(videoTierBillingMode({ bindings: [{ enabled: true, priority: 1, capabilityProfile: { videoBilling: { mode: "fixed" } } }] })).toBe("fixed");
        expect(videoTierBillingMode({ bindings: [{ enabled: true, priority: 1 }] })).toBe("fixed");
        expect(videoTierBillingMode({})).toBe("fixed");
    });

    it("忽略停用绑定，取优先级最小的启用绑定", () => {
        const mode = videoTierBillingMode({
            bindings: [
                { enabled: false, priority: 0, capabilityProfile: { videoBilling: { mode: "duration" } } },
                { enabled: true, priority: 2, capabilityProfile: { videoBilling: { mode: "fixed" } } },
            ],
        });
        expect(mode).toBe("fixed");
    });
});

describe("videoTierMatchesModel", () => {
    const base = { bindings: [{ enabled: true, priority: 1, capabilityProfile: { videoBilling: { mode: "duration" } } }] };

    it("未指定计费口径时只按档位匹配", () => {
        const entry = { id: "value", label: "低价福利", modelTier: "value" as const, display: "grouped" as const, order: 10, enabled: true };
        expect(videoTierMatchesModel(entry, { ...base, tier: "value" })).toBe(true);
        expect(videoTierMatchesModel(entry, { ...base, tier: "stable" })).toBe(false);
    });

    it("指定计费口径时再按计费模式过滤", () => {
        const perSecond = { id: "value-second", label: "低价福利（按秒）", modelTier: "value" as const, display: "grouped" as const, billingMode: "duration" as const, order: 10, enabled: true };
        expect(videoTierMatchesModel(perSecond, { ...base, tier: "value" })).toBe(true);
        expect(videoTierMatchesModel(perSecond, { bindings: [], tier: "value" })).toBe(false);
    });

    it("模型 tier 直接指向自定义档位 id 时命中，不受计费口径影响", () => {
        const custom = { id: "promo-x", label: "限时特惠", modelTier: "value" as const, display: "grouped" as const, billingMode: "duration" as const, order: 10, enabled: true };
        expect(videoTierMatchesModel(custom, { bindings: [], tier: "promo-x" })).toBe(true);
        expect(videoTierMatchesModel(custom, { ...base, tier: "value" })).toBe(true);
        expect(videoTierMatchesModel(custom, { ...base, tier: "stable" })).toBe(false);
    });
});

describe("resolveVideoTierId", () => {
    const tiers = cloneVideoTiers(DEFAULT_VIDEO_TIERS);

    it("命中已有 id", () => {
        expect(resolveVideoTierId(tiers, "stable")).toBe("stable");
    });

    it("把旧的 value 映射到按次条目", () => {
        expect(resolveVideoTierId(tiers, "value")).toBe("value-fixed");
    });

    it("未知或缺失时回落到首个条目", () => {
        expect(resolveVideoTierId(tiers, "unknown")).toBe("official");
        expect(resolveVideoTierId(tiers, undefined)).toBe("official");
    });
});
