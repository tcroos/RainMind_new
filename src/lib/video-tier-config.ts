/**
 * 视频一级档位配置（展示层）。
 *
 * 设计约束（见 FEAT-019）：
 * - 逻辑模型身上仍只打 official / stable / value，本文档不改变计费或路由语义；
 * - 一级档位只决定"怎么展示"：扁平直出（flat）或二级展开（grouped）；
 * - value 档位可按视频计费模式（fixed=按次 / duration=按秒）再拆成多个一级条目；
 * - 配置缺失或非法时一律回落到内置默认，保证面板永远有档位可选。
 */

export type VideoTierModelTier = "official" | "stable" | "value";
export type VideoTierDisplay = "flat" | "grouped";
export type VideoTierBillingMode = "fixed" | "duration";

export type VideoTierConfig = {
    id: string;
    label: string;
    modelTier: VideoTierModelTier;
    display: VideoTierDisplay;
    billingMode?: VideoTierBillingMode;
    order: number;
    enabled: boolean;
};

export const MAX_VIDEO_TIERS = 8;
export const VIDEO_TIER_LABEL_MAX_LENGTH = 20;
export const VIDEO_TIER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** 逻辑模型上的 tier 现在可以直接指向某个一级档位 id（也兼容旧的 official/stable/value 语义）。 */
export function isVideoTierId(value: unknown): value is string {
    return typeof value === "string" && VIDEO_TIER_ID_PATTERN.test(value);
}

export const DEFAULT_VIDEO_TIERS: readonly VideoTierConfig[] = [
    { id: "official", label: "官方原生", modelTier: "official", display: "flat", order: 10, enabled: true },
    { id: "stable", label: "特价稳定", modelTier: "stable", display: "flat", order: 20, enabled: true },
    { id: "value-fixed", label: "低价福利（按次）", modelTier: "value", display: "grouped", billingMode: "fixed", order: 30, enabled: true },
    { id: "value-duration", label: "低价福利（按秒）", modelTier: "value", display: "grouped", billingMode: "duration", order: 40, enabled: true },
];

export function cloneVideoTiers(tiers: readonly VideoTierConfig[]): VideoTierConfig[] {
    return tiers.map((tier) => ({ ...tier }));
}

function readModelTier(value: unknown): VideoTierModelTier | undefined {
    return value === "official" || value === "stable" || value === "value" ? value : undefined;
}

function readDisplay(value: unknown): VideoTierDisplay {
    return value === "grouped" ? "grouped" : "flat";
}

function readBillingMode(value: unknown): VideoTierBillingMode | undefined {
    return value === "fixed" || value === "duration" ? value : undefined;
}

const MODEL_TIER_FALLBACK_LABEL: Record<VideoTierModelTier, string> = {
    official: "官方原生",
    stable: "特价稳定",
    value: "低价福利",
};

/** 归一化一级档位：丢弃非法项、去重 id、限制数量、按 order 排序；为空时回落默认。
 * 注意：空 label 不会丢弃条目，而是回落为档位默认名称，避免用户清空输入时整条消失。 */
export function normalizeVideoTiers(input: unknown): VideoTierConfig[] {
    if (!Array.isArray(input)) return cloneVideoTiers(DEFAULT_VIDEO_TIERS);
    const seen = new Set<string>();
    const tiers: VideoTierConfig[] = [];
    for (const item of input) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim().toLowerCase() : "";
        const modelTier = readModelTier(record.modelTier);
        const rawLabel = typeof record.label === "string" ? record.label.trim().slice(0, VIDEO_TIER_LABEL_MAX_LENGTH) : "";
        const label = rawLabel || (modelTier ? MODEL_TIER_FALLBACK_LABEL[modelTier] : "");
        if (!VIDEO_TIER_ID_PATTERN.test(id) || !modelTier || seen.has(id)) continue;
        seen.add(id);
        const order = typeof record.order === "number" && Number.isFinite(record.order) ? Math.trunc(record.order) : (tiers.length + 1) * 10;
        const billingMode = readBillingMode(record.billingMode);
        tiers.push({
            id,
            label,
            modelTier,
            display: readDisplay(record.display),
            ...(billingMode ? { billingMode } : {}),
            order,
            enabled: record.enabled !== false,
        });
        if (tiers.length >= MAX_VIDEO_TIERS) break;
    }
    if (!tiers.length) return cloneVideoTiers(DEFAULT_VIDEO_TIERS);
    const sorted = tiers.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    return migrateLegacyValueTier(sorted);
}

/**
 * 老配置里 "value" 是单一低价档。按次/按秒拆分落地后，把这条自动迁移成两个条目，
 * 已有的拆分条目不被覆盖，避免用户看到两条“低价福利”。
 */
function migrateLegacyValueTier(tiers: VideoTierConfig[]): VideoTierConfig[] {
    const legacy = tiers.find((tier) => tier.id === "value" && !tier.billingMode);
    if (!legacy) return tiers;
    const rest = tiers.filter((tier) => tier !== legacy);
    const hasFixed = rest.some((tier) => tier.modelTier === "value" && tier.billingMode === "fixed");
    const hasDuration = rest.some((tier) => tier.modelTier === "value" && tier.billingMode === "duration");
    const additions: VideoTierConfig[] = [];
    const baseOrder = Math.max(legacy.order, ...rest.map((tier) => tier.order));
    if (!hasFixed) {
        additions.push({ id: "value-fixed", label: "低价福利（按次）", modelTier: "value", display: "grouped", billingMode: "fixed", order: baseOrder, enabled: legacy.enabled });
    }
    if (!hasDuration) {
        additions.push({ id: "value-duration", label: "低价福利（按秒）", modelTier: "value", display: "grouped", billingMode: "duration", order: baseOrder + 5, enabled: legacy.enabled });
    }
    return [...rest, ...additions].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

type BillingCarrier = {
    bindings?: ReadonlyArray<{ enabled?: boolean; priority?: number; capabilityProfile?: { videoBilling?: { mode?: string } } }>;
};

/** 取逻辑模型首个启用绑定的视频计费模式；未配置时按按次（fixed）处理，与扣点口径一致。 */
export function videoTierBillingMode(model: BillingCarrier): VideoTierBillingMode {
    const bindings = (model.bindings || [])
        .filter((binding) => binding.enabled !== false)
        .slice()
        .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
    return bindings[0]?.capabilityProfile?.videoBilling?.mode === "duration" ? "duration" : "fixed";
}

type TierCandidate = BillingCarrier & { tier?: string };

/** 判断某个逻辑模型是否属于某个一级档位条目。
 * 优先按档位 id 精确匹配（后台可以给模型直接指定任意一级档位）；
 * 兼容旧值：模型 tier 为 official/stable/value 时按语义档位匹配，value 再按计费模式细分。 */
export function videoTierMatchesModel(entry: VideoTierConfig, model: TierCandidate): boolean {
    if (model.tier === entry.id) return true;
    if (model.tier !== entry.modelTier) return false;
    if (!entry.billingMode) return true;
    return videoTierBillingMode(model) === entry.billingMode;
}

/** 兼容旧值：localStorage / 节点上存的是 tier id，旧的 "value" 需要映射到具体条目。 */
export function resolveVideoTierId(tiers: readonly VideoTierConfig[], storedId: string | undefined): string {
    const enabled = tiers.filter((tier) => tier.enabled);
    const candidates = enabled.length ? enabled : tiers;
    if (storedId && candidates.some((tier) => tier.id === storedId)) return storedId;
    if (storedId === "value" || storedId === "stable" || storedId === "official") {
        const byModelTier = candidates.find((tier) => tier.modelTier === storedId);
        if (byModelTier) return byModelTier.id;
    }
    return candidates[0]?.id || DEFAULT_VIDEO_TIERS[0].id;
}
