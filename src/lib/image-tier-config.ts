/**
 * 图片一级档位配置。
 *
 * 与视频档位的区别（用户 2026-11-24 明确）：
 * - 图片档位下直接列模型，不做二级展开；
 * - 不按计费口径拆分，免费/常规/站长等分类完全由运营在后台手工挂载；
 * - 档位清单可自由增删，代码只提供起步默认值，不写死业务分类。
 *
 * 空数组（或字段缺失）都回落默认两条，后台只允许删到剩 1 条，避免出现"没有任何档位"的状态。
 */

import { MAX_VIDEO_TIERS, VIDEO_TIER_ID_PATTERN, VIDEO_TIER_LABEL_MAX_LENGTH } from "@/lib/video-tier-config";

export type ImageTierConfig = {
    id: string;
    label: string;
    order: number;
    enabled: boolean;
    /** 命中该档位的图片模型按 0 单价计费（仅图片生成，其他能力不受影响）。 */
    free: boolean;
};

export const DEFAULT_IMAGE_TIERS: readonly ImageTierConfig[] = [
    { id: "free", label: "免费生图", order: 10, enabled: true, free: true },
    { id: "standard", label: "常规生图", order: 20, enabled: true, free: false },
];

export function cloneImageTiers(tiers: readonly ImageTierConfig[]): ImageTierConfig[] {
    return tiers.map((tier) => ({ ...tier }));
}

export function normalizeImageTiers(input: unknown): ImageTierConfig[] {
    if (!Array.isArray(input)) return cloneImageTiers(DEFAULT_IMAGE_TIERS);
    const seen = new Set<string>();
    const tiers: ImageTierConfig[] = [];
    for (const item of input) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim().toLowerCase() : "";
        if (!VIDEO_TIER_ID_PATTERN.test(id) || seen.has(id)) continue;
        seen.add(id);
        const rawLabel = typeof record.label === "string" ? record.label.trim().slice(0, VIDEO_TIER_LABEL_MAX_LENGTH) : "";
        const order = typeof record.order === "number" && Number.isFinite(record.order) ? Math.trunc(record.order) : (tiers.length + 1) * 10;
        tiers.push({
            id,
            label: rawLabel || "未命名档位",
            order,
            enabled: record.enabled !== false,
            // 老配置没有 free 字段：按 id/label 推断（免费生图），避免升级后静默变成收费。
            // 显式 boolean（后台开关保存过）则完全尊重运营选择。
            free: typeof record.free === "boolean" ? record.free : id === "free" || rawLabel.includes("免费"),
        });
        if (tiers.length >= MAX_VIDEO_TIERS) break;
    }
    return tiers.length
        ? tiers.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
        : cloneImageTiers(DEFAULT_IMAGE_TIERS);
}

/** 服务端/报价共用：模型挂在启用且标记 free 的图片档位上时，图片生成按 0 单价。 */
export function isFreeImageModel(tiers: readonly ImageTierConfig[] | undefined, model: { tier?: string } | undefined): boolean {
    if (!model?.tier || !tiers?.length) return false;
    return tiers.some((tier) => tier.id === model.tier && tier.enabled && tier.free);
}

/** 图片模型归属：模型 tier 直接存图片档位 id。 */
export function imageTierMatchesModel(entry: ImageTierConfig, model: { tier?: string }): boolean {
    return model.tier === entry.id;
}

/** 兼容旧记忆值：找不到就返回 undefined，表示不按档位过滤。 */
export function resolveImageTierId(tiers: readonly ImageTierConfig[], storedId: string | undefined): string | undefined {
    if (!tiers.length) return undefined;
    const enabled = tiers.filter((tier) => tier.enabled);
    const candidates = enabled.length ? enabled : tiers;
    if (storedId && candidates.some((tier) => tier.id === storedId)) return storedId;
    return candidates[0]?.id;
}
