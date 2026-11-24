import type { CreativeModelCapabilityProfile } from "@/lib/creative-model-capabilities";

export type CreativeReferenceType = "image" | "video" | "audio";

export type CreativeReferenceCounts = Record<CreativeReferenceType, number>;

export type CreativeReferenceOption = {
    type: CreativeReferenceType;
    label: string;
    count: number;
    max?: number;
    supported: boolean;
    disabled: boolean;
    disabledReason?: string;
};

const REFERENCE_LABELS: Record<CreativeReferenceType, string> = { image: "参考图片", video: "参考视频", audio: "参考音频" };

export function creativeReferenceCounts(assets: readonly { type: string }[]): CreativeReferenceCounts {
    return assets.reduce<CreativeReferenceCounts>(
        (counts, asset) => {
            if (asset.type === "image" || asset.type === "video" || asset.type === "audio") counts[asset.type] += 1;
            return counts;
        },
        { image: 0, video: 0, audio: 0 },
    );
}

export function creativeReferenceOptions(profile: CreativeModelCapabilityProfile | undefined, counts: CreativeReferenceCounts): CreativeReferenceOption[] {
    const total = counts.image + counts.video + counts.audio;
    return (["image", "video", "audio"] as const).map((type) => {
        const supported = profile ? profile[`supportsReference${capitalize(type)}` as "supportsReferenceImage" | "supportsReferenceVideo" | "supportsReferenceAudio"] !== false : true;
        const max = profile?.[`maxReference${capitalize(type)}s` as "maxReferenceImages" | "maxReferenceVideos" | "maxReferenceAudios"];
        const atTypeLimit = max !== undefined && counts[type] >= max;
        const atTotalLimit = profile?.maxReferenceTotal !== undefined && total >= profile.maxReferenceTotal;
        const audioOnly = type === "audio" && profile?.requiresReferenceImageOrVideo === true && counts.image + counts.video === 0;
        const disabledReason = !supported
            ? `当前模型不支持${REFERENCE_LABELS[type]}`
            : atTypeLimit
              ? `最多 ${max} ${type === "image" ? "张" : type === "video" ? "段" : "段"}`
              : atTotalLimit
                ? `最多 ${profile?.maxReferenceTotal} 份参考素材`
                : audioOnly
                  ? "参考音频不能单独使用，请先添加图片或视频"
                  : undefined;
        return { type, label: REFERENCE_LABELS[type], count: counts[type], max, supported, disabled: Boolean(disabledReason), ...(disabledReason ? { disabledReason } : {}) };
    });
}

export function creativeReferenceUploadError(profile: CreativeModelCapabilityProfile | undefined, counts: CreativeReferenceCounts, type: CreativeReferenceType, amount: number) {
    const option = creativeReferenceOptions(profile, counts).find((item) => item.type === type)!;
    if (!option.supported) return option.disabledReason || `当前模型不支持${option.label}`;
    if (option.max !== undefined && counts[type] + amount > option.max) return `${option.label}最多 ${option.max} ${type === "image" ? "张" : "段"}`;
    if (profile?.maxReferenceTotal !== undefined && counts.image + counts.video + counts.audio + amount > profile.maxReferenceTotal) return `当前模型最多支持 ${profile.maxReferenceTotal} 份参考素材`;
    if (amount > 0 && type === "audio" && profile?.requiresReferenceImageOrVideo === true && counts.image + counts.video === 0) return "参考音频不能单独使用，请先添加图片或视频";
    return undefined;
}

export function creativeReferenceSetError(profile: CreativeModelCapabilityProfile | undefined, counts: CreativeReferenceCounts) {
    if (!profile) return undefined;
    if (profile.supportsReferenceImage === false && counts.image > 0) return "当前模型不支持参考图片";
    if (profile.supportsReferenceVideo === false && counts.video > 0) return "当前模型不支持参考视频";
    if (profile.supportsReferenceAudio === false && counts.audio > 0) return "当前模型不支持参考音频";
    if (profile.maxReferenceImages !== undefined && counts.image > profile.maxReferenceImages) return `参考图片最多 ${profile.maxReferenceImages} 张`;
    if (profile.maxReferenceVideos !== undefined && counts.video > profile.maxReferenceVideos) return `参考视频最多 ${profile.maxReferenceVideos} 段`;
    if (profile.maxReferenceAudios !== undefined && counts.audio > profile.maxReferenceAudios) return `参考音频最多 ${profile.maxReferenceAudios} 段`;
    if (profile.maxReferenceTotal !== undefined && counts.image + counts.video + counts.audio > profile.maxReferenceTotal) return `当前模型最多支持 ${profile.maxReferenceTotal} 份参考素材`;
    if (profile.requiresReferenceImageOrVideo && counts.audio > 0 && counts.image + counts.video === 0) return "参考音频不能单独使用，请同时添加参考图片或参考视频";
    return undefined;
}

function capitalize(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
