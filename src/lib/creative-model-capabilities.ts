import type { LogicalModelCapabilityProfile } from "@/lib/auth/store-types";
import { isCreativeAutoValue, type CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";

export type CreativeMediaCapability = "image" | "video" | "audio";
export type CreativeModelCapabilityProfile = Pick<
    LogicalModelCapabilityProfile,
    | "videoBilling"
    | "aspectRatios"
    | "resolutions"
    | "durationSeconds"
    | "minDurationSeconds"
    | "maxDurationSeconds"
    | "maxBatchSize"
    | "supportsReferenceImage"
    | "supportsReferenceVideo"
    | "supportsReferenceAudio"
    | "maxReferenceImages"
    | "maxReferenceVideos"
    | "maxReferenceAudios"
    | "maxReferenceTotal"
    | "requiresReferenceImageOrVideo"
    | "imageOptions"
>;
export type CreativeModelCapabilityOption = {
    id: string;
    name: string;
    capability: CreativeMediaCapability;
    tier?: string;
    capabilityProfile?: CreativeModelCapabilityProfile;
};

export function distributeCreativeModelCounts<T extends Pick<CreativeModelCapabilityOption, "id" | "capabilityProfile">>(models: readonly T[], requestedCount?: number) {
    const counts = new Map(models.map((model) => [model.id, 1]));
    let remaining = Math.max(requestedCount || models.length, models.length) - models.length;
    while (remaining > 0) {
        const available = models.filter((model) => !model.capabilityProfile?.maxBatchSize || (counts.get(model.id) || 0) < model.capabilityProfile.maxBatchSize);
        if (!available.length) throw new Error("所选模型无法承载当前生成总数，请减少数量或调整模型");
        const share = Math.max(1, Math.floor(remaining / available.length));
        for (const model of available) {
            if (!remaining) break;
            const current = counts.get(model.id) || 0;
            const capacity = model.capabilityProfile?.maxBatchSize ? model.capabilityProfile.maxBatchSize - current : remaining;
            const added = Math.min(share, capacity, remaining);
            counts.set(model.id, current + added);
            remaining -= added;
        }
    }
    return models.map((model) => ({ model, count: counts.get(model.id) || 1 }));
}

type LogicalModelLike = {
    id: string;
    bindings: Array<{ enabled: boolean; capabilityProfile?: LogicalModelCapabilityProfile }>;
};

export function creativeModelProfileForLogicalModel(model: LogicalModelLike | undefined): CreativeModelCapabilityProfile | undefined {
    const profiles = (model?.bindings || []).filter((binding) => binding.enabled && binding.capabilityProfile).map((binding) => binding.capabilityProfile!);
    if (!profiles.length) return undefined;
    const minDurationSeconds = minimum(profiles.map((profile) => profile.minDurationSeconds));
    const maxDurationSeconds = maximum(profiles.map((profile) => profile.maxDurationSeconds));
    const configuredDurations = unionNumberLists(profiles.map((profile) => profile.durationSeconds));
    const filteredDurations =
        minDurationSeconds === undefined && maxDurationSeconds === undefined
            ? configuredDurations
            : configuredDurations?.filter((value) => (minDurationSeconds !== undefined && value < minDurationSeconds) || (maxDurationSeconds !== undefined && value > maxDurationSeconds));
    const durationSeconds = filteredDurations?.length ? filteredDurations : undefined;
    return compactProfile({
        videoBilling: profiles.find((profile) => profile.videoBilling)?.videoBilling,
        aspectRatios: unionTextLists(profiles.map((profile) => profile.aspectRatios)),
        resolutions: unionTextLists(profiles.map((profile) => profile.resolutions)),
        imageOptions: mergeImageOptions(profiles.map((profile) => profile.imageOptions), "union"),
        durationSeconds,
        minDurationSeconds,
        maxDurationSeconds,
        maxBatchSize: maximum(profiles.map((profile) => profile.maxBatchSize)),
        supportsReferenceImage: profileBoolean(profiles.map((profile) => profile.supportsReferenceImage)),
        supportsReferenceVideo: profileBoolean(profiles.map((profile) => profile.supportsReferenceVideo)),
        supportsReferenceAudio: profileBoolean(profiles.map((profile) => profile.supportsReferenceAudio)),
        maxReferenceImages: minimum(profiles.map((profile) => profile.maxReferenceImages)),
        maxReferenceVideos: minimum(profiles.map((profile) => profile.maxReferenceVideos)),
        maxReferenceAudios: minimum(profiles.map((profile) => profile.maxReferenceAudios)),
        maxReferenceTotal: minimum(profiles.map((profile) => profile.maxReferenceTotal)),
        requiresReferenceImageOrVideo: profiles.length > 0 && profiles.every((profile) => profile.requiresReferenceImageOrVideo === true) ? true : undefined,
    });
}

export function creativeSelectedModelProfile(models: readonly CreativeModelCapabilityOption[], capability: CreativeMediaCapability): CreativeModelCapabilityProfile | undefined {
    const selected = models.filter((model) => model.capability === capability);
    const profiles = selected.filter((model) => model.capabilityProfile).map((model) => model.capabilityProfile!);
    if (!profiles.length) return undefined;
    const duration = intersectDurationProfiles(profiles);
    return compactProfile({
        videoBilling: profiles.find((profile) => profile.videoBilling)?.videoBilling,
        aspectRatios: intersectTextLists(profiles.map((profile) => profile.aspectRatios)),
        resolutions: intersectTextLists(profiles.map((profile) => profile.resolutions)),
        imageOptions: selected.every((model) => model.capabilityProfile?.imageOptions) ? mergeImageOptions(profiles.map((profile) => profile.imageOptions), "intersection") : undefined,
        ...duration,
        maxBatchSize: selected.every((model) => model.capabilityProfile?.maxBatchSize) ? selected.reduce((total, model) => total + model.capabilityProfile!.maxBatchSize!, 0) : undefined,
        supportsReferenceImage: selected.every((model) => model.capabilityProfile?.supportsReferenceImage === true) ? true : selected.some((model) => model.capabilityProfile?.supportsReferenceImage === false) ? false : undefined,
        supportsReferenceVideo: selected.every((model) => model.capabilityProfile?.supportsReferenceVideo === true) ? true : selected.some((model) => model.capabilityProfile?.supportsReferenceVideo === false) ? false : undefined,
        supportsReferenceAudio: selected.every((model) => model.capabilityProfile?.supportsReferenceAudio === true) ? true : selected.some((model) => model.capabilityProfile?.supportsReferenceAudio === false) ? false : undefined,
        maxReferenceImages: minimum(profiles.map((profile) => profile.maxReferenceImages)),
        maxReferenceVideos: minimum(profiles.map((profile) => profile.maxReferenceVideos)),
        maxReferenceAudios: minimum(profiles.map((profile) => profile.maxReferenceAudios)),
        maxReferenceTotal: minimum(profiles.map((profile) => profile.maxReferenceTotal)),
        requiresReferenceImageOrVideo: profiles.length > 0 && profiles.every((profile) => profile.requiresReferenceImageOrVideo === true) ? true : undefined,
    });
}

export function reconcileCreativeGenerationPreferences(preferences: CreativeGenerationPreferences, models: readonly CreativeModelCapabilityOption[]): CreativeGenerationPreferences {
    let next = preferences;
    const imageModels = models.filter((model) => model.capability === "image");
    const imageProfile = creativeSelectedModelProfile(models, "image");
    if (imageModels.length) {
        const image = imageProfile?.imageOptions
            ? reconcileImagePreferences(preferences.image || {}, imageProfile, imageModels.length)
            : reconcileMediaPreferences(preferences.image || {}, imageProfile || {}, imageModels.length);
        if (image !== preferences.image) next = { ...next, image };
    }
    const videoModels = models.filter((model) => model.capability === "video");
    const videoProfile = creativeSelectedModelProfile(models, "video");
    if (videoModels.length) {
        const video = reconcileVideoPreferences(preferences.video || {}, videoProfile || {}, videoModels.length);
        if (video !== preferences.video) next = { ...next, video };
    }
    return next;
}

function reconcileMediaPreferences<T extends { size?: string; quality?: string; count?: number }>(value: T, profile: CreativeModelCapabilityProfile, minimumCount: number): T {
    let next = value;
    const size = reconcileSizeValue(value.size, profile.aspectRatios);
    const quality = reconcileTextValue(value.quality, profile.resolutions);
    const count = Math.max(minimumCount, Math.min(value.count || 1, profile.maxBatchSize || Number.POSITIVE_INFINITY));
    if (size !== value.size || quality !== value.quality || count !== value.count) next = { ...value, size, quality, count };
    return next;
}

function reconcileImagePreferences<T extends NonNullable<CreativeGenerationPreferences["image"]>>(value: T, profile: CreativeModelCapabilityProfile, minimumCount: number): T {
    const options = profile.imageOptions!;
    let next = value;
    const sizeMode = options.sizeModes?.includes(value.sizeMode || "auto") ? value.sizeMode || "auto" : options.sizeModes?.[0];
    const size = sizeMode === "auto" ? "auto" : sizeMode === "custom" ? value.size || "1024x1024" : reconcileSizeValue(value.size, profile.aspectRatios);
    const resolution = reconcileTextValue(value.resolution, options.resolutions);
    const quality = reconcileTextValue(value.quality, options.qualities);
    const style = reconcileTextValue(value.style, options.styles);
    const outputFormat = reconcileTextValue(value.outputFormat, options.outputFormats);
    const background = reconcileTextValue(value.background, options.backgrounds) as T["background"];
    const moderation = reconcileTextValue(value.moderation, options.moderations);
    const responseFormat = reconcileTextValue(value.responseFormat, options.responseFormats) as T["responseFormat"];
    const count = Math.max(minimumCount, Math.min(value.count || 1, profile.maxBatchSize || Number.POSITIVE_INFINITY));
    if (size !== value.size || sizeMode !== value.sizeMode || resolution !== value.resolution || quality !== value.quality || style !== value.style || outputFormat !== value.outputFormat || background !== value.background || moderation !== value.moderation || responseFormat !== value.responseFormat || count !== value.count) {
        next = { ...value, size, sizeMode, resolution, quality, style, outputFormat, background, moderation, responseFormat, count };
    }
    return next;
}

function reconcileSizeValue(value: string | undefined, supported: string[] | undefined) {
    if (!supported) return value;
    const dimensions = value?.match(/^(\d+)x(\d+)$/i);
    if (dimensions) {
        const divisor = greatestCommonDivisor(Number(dimensions[1]), Number(dimensions[2]));
        const ratio = `${Number(dimensions[1]) / divisor}:${Number(dimensions[2]) / divisor}`;
        if (supported.some((item) => normalizedText(item) === normalizedText(ratio))) return value;
    }
    return reconcileTextValue(value, supported);
}

function reconcileVideoPreferences<T extends { size?: string; quality?: string; count?: number; seconds?: number }>(value: T, profile: CreativeModelCapabilityProfile, minimumCount: number): T {
    let next = reconcileMediaPreferences(value, profile, minimumCount);
    const seconds = reconcileSeconds(value.seconds, profile);
    if (seconds !== value.seconds) next = { ...next, seconds };
    return next;
}

function reconcileTextValue(value: string | undefined, supported: string[] | undefined) {
    if (!supported) return value;
    if (!value || isCreativeAutoValue(value)) return value;
    const matched = value ? supported.find((item) => normalizedText(item) === normalizedText(value)) : undefined;
    if (matched) return matched;
    return supported[0];
}

function reconcileSeconds(value: number | undefined, profile: CreativeModelCapabilityProfile) {
    const hasRange = profile.minDurationSeconds !== undefined || profile.maxDurationSeconds !== undefined;
    const inRange = (profile.minDurationSeconds === undefined || (value !== undefined && value >= profile.minDurationSeconds)) && (profile.maxDurationSeconds === undefined || (value !== undefined && value <= profile.maxDurationSeconds));
    if (profile.durationSeconds?.length && !hasRange) {
        if (value && profile.durationSeconds.includes(value)) return value;
        return profile.durationSeconds[0] || value;
    }
    if (value === undefined) return profile.minDurationSeconds;
    if (profile.durationSeconds?.includes(value) && !inRange) return value;
    if (profile.minDurationSeconds && value < profile.minDurationSeconds) return profile.minDurationSeconds;
    if (profile.maxDurationSeconds && value > profile.maxDurationSeconds) return profile.maxDurationSeconds;
    return value;
}

function intersectTextLists(lists: Array<string[] | undefined>) {
    const configured = lists.filter((list): list is string[] => Array.isArray(list) && list.length > 0);
    if (!configured.length) return undefined;
    return configured[0].filter((item) => configured.slice(1).every((list) => list.some((candidate) => normalizedText(candidate) === normalizedText(item))));
}

function mergeImageOptions(options: Array<LogicalModelCapabilityProfile["imageOptions"]>, mode: "union" | "intersection") {
    const configured = options.filter((value): value is NonNullable<LogicalModelCapabilityProfile["imageOptions"]> => Boolean(value));
    if (!configured.length) return undefined;
    const keys = ["sizeModes", "resolutions", "qualities", "styles", "outputFormats", "backgrounds", "moderations", "responseFormats"] as const;
    const merged = Object.fromEntries(keys.map((key) => [key, mode === "union" ? unionTextLists(configured.map((value) => value[key])) : intersectTextLists(configured.map((value) => value[key]))]));
    return Object.values(merged).some((value) => value?.length) ? merged as NonNullable<LogicalModelCapabilityProfile["imageOptions"]> : undefined;
}

function intersectNumberLists(lists: Array<number[] | undefined>) {
    const configured = lists.filter((list): list is number[] => Array.isArray(list) && list.length > 0);
    if (!configured.length) return undefined;
    return configured[0].filter((item) => configured.slice(1).every((list) => list.includes(item)));
}

function intersectDurationProfiles(profiles: CreativeModelCapabilityProfile[]) {
    const constrained = profiles.filter((profile) => profile.durationSeconds?.length || profile.minDurationSeconds !== undefined || profile.maxDurationSeconds !== undefined);
    const discrete = constrained.filter((profile) => profile.durationSeconds?.length && profile.minDurationSeconds === undefined && profile.maxDurationSeconds === undefined);
    if (discrete.length) {
        const candidates = intersectNumberLists(discrete.map((profile) => profile.durationSeconds)) || [];
        return {
            durationSeconds: candidates.filter((seconds) => constrained.every((profile) => supportsDuration(profile, seconds))),
        };
    }
    return {
        durationSeconds: unionNumberLists(constrained.map((profile) => profile.durationSeconds)),
        minDurationSeconds: maximum(constrained.map((profile) => profile.minDurationSeconds)),
        maxDurationSeconds: minimum(constrained.map((profile) => profile.maxDurationSeconds)),
    };
}

function supportsDuration(profile: CreativeModelCapabilityProfile, seconds: number) {
    const inRange = (profile.minDurationSeconds === undefined || seconds >= profile.minDurationSeconds) && (profile.maxDurationSeconds === undefined || seconds <= profile.maxDurationSeconds);
    return (profile.durationSeconds?.includes(seconds) ?? false) || ((profile.minDurationSeconds !== undefined || profile.maxDurationSeconds !== undefined) && inRange);
}

function unionTextLists(lists: Array<string[] | undefined>) {
    const values = new Map<string, string>();
    for (const item of lists.flatMap((list) => list || [])) values.set(normalizedText(item), item);
    return values.size ? Array.from(values.values()) : undefined;
}

function unionNumberLists(lists: Array<number[] | undefined>) {
    const values = Array.from(new Set(lists.flatMap((list) => list || []))).sort((left, right) => left - right);
    return values.length ? values : undefined;
}

function minimum(values: Array<number | undefined>) {
    const configured = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return configured.length ? Math.min(...configured) : undefined;
}

function maximum(values: Array<number | undefined>) {
    const configured = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return configured.length ? Math.max(...configured) : undefined;
}

function profileBoolean(values: Array<boolean | undefined>) {
    if (values.length && values.every((value) => value === true)) return true;
    if (values.length && values.every((value) => value === false)) return false;
    return undefined;
}

function compactProfile(profile: CreativeModelCapabilityProfile) {
    return Object.values(profile).some((value) => value !== undefined) ? profile : undefined;
}

function normalizedText(value: string) {
    return value.trim().replace(/p$/i, "").toLowerCase();
}

function greatestCommonDivisor(left: number, right: number): number {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a || 1;
}
