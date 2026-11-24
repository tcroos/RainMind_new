import { requestCreditCost } from "@/constant/credits";
import { distributeCreativeModelCounts, type CreativeModelCapabilityOption } from "@/lib/creative-model-capabilities";
import type { CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";
import type { AiConfig } from "@/stores/use-config-store";

export function estimateCreativeVideoCost(
    config: Pick<AiConfig, "apiSource" | "modelPointCosts" | "generationPointMultipliers" | "logicalModels" | "vquality">,
    models: readonly CreativeModelCapabilityOption[],
    preferences: CreativeGenerationPreferences,
) {
    const videoModels = models.filter((model) => model.capability === "video");
    if (!videoModels.length) return undefined;
    return distributeCreativeModelCounts(videoModels, preferences.video?.count).reduce((total, { model, count }) => {
        const profile = model.capabilityProfile;
        const quality = resolveQuality(preferences.video?.quality, profile?.resolutions, config.vquality);
        const defaultSeconds = profile?.durationSeconds?.[0] ?? profile?.minDurationSeconds ?? 5;
        const seconds = supportedDuration(preferences.video?.seconds || defaultSeconds, profile?.durationSeconds, profile?.minDurationSeconds, profile?.maxDurationSeconds) || 5;
        return (
            total +
            requestCreditCost({
                apiSource: config.apiSource,
                modelPointCosts: config.modelPointCosts,
                generationPointMultipliers: config.generationPointMultipliers,
                logicalModels: config.logicalModels,
                model: model.id,
                kind: "video",
                videoBilling: profile?.videoBilling,
                videoQuality: quality,
                videoSeconds: seconds,
                count,
            })
        );
    }, 0);
}

function supportedDuration(requested: number | undefined, options: number[] | undefined, min: number | undefined, max: number | undefined) {
    let seconds = requested || options?.[0] || min;
    if (seconds === undefined) return undefined;
    if (min !== undefined) seconds = Math.max(seconds, min);
    if (max !== undefined) seconds = Math.min(seconds, max);
    if (options?.length && !options.includes(seconds)) seconds = options.find((option) => option >= seconds!) || options[options.length - 1];
    return seconds;
}

function resolveQuality(requested: string | undefined, options: string[] | undefined, fallback: string) {
    const value = (requested || "").trim();
    if (options?.length) {
        const matched = options.find((option) => option.toLowerCase() === value.toLowerCase());
        if (matched) return matched;
        // 旧偏好里的 720/1080/auto 不在模型声明中时，回退到模型默认清晰度，避免按错倍率估价。
        return options[0];
    }
    return value || fallback;
}
