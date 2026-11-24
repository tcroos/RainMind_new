import { creativeModelProfileForLogicalModel, reconcileCreativeGenerationPreferences, type CreativeModelCapabilityProfile, type CreativeModelCapabilityOption } from "@/lib/creative-model-capabilities";
import type { CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";
import type { AiConfig } from "@/stores/use-config-store";

import type { CanvasGenerationMode, CanvasNodeMetadata } from "../types";

type MediaMode = Extract<CanvasGenerationMode, "image" | "video">;

export function canvasModelCapabilityProfile(config: AiConfig, model = config.model): CreativeModelCapabilityProfile | undefined {
    return creativeModelProfileForLogicalModel(config.logicalModels.find((item) => item.id.toLowerCase() === model.toLowerCase()));
}

export function canvasModelConfigPatch(config: AiConfig, model: string, mode: MediaMode): Partial<CanvasNodeMetadata> {
    const capabilityProfile = canvasModelCapabilityProfile(config, model);
    const option: CreativeModelCapabilityOption = { id: model, name: model, capability: mode, ...(capabilityProfile ? { capabilityProfile } : {}) };
    const preferences: CreativeGenerationPreferences =
        mode === "image" ? { image: { size: config.size, sizeMode: config.imageSizeMode, resolution: config.imageResolution, quality: config.quality, style: config.imageStyle, outputFormat: config.imageOutputFormat, background: config.imageBackground, moderation: config.imageModeration, responseFormat: config.imageResponseFormat, count: positiveInteger(config.count, 1) } } : { video: { size: config.size, quality: config.vquality, seconds: positiveInteger(config.videoSeconds, 5) } };
    const reconciled = reconcileCreativeGenerationPreferences(preferences, [option]);
    // Selecting a model must not replace the user's or inherited canvas dimensions.
    if (reconciled.image) Object.assign(reconciled.image, { size: config.size, sizeMode: config.imageSizeMode });
    if (reconciled.video) reconciled.video.size = config.size;
    return mode === "image"
        ? { model, size: reconciled.image?.size, quality: reconciled.image?.quality, count: reconciled.image?.count, imageSizeMode: capabilityProfile?.imageOptions ? reconciled.image?.sizeMode : undefined, imageResolution: capabilityProfile?.imageOptions ? reconciled.image?.resolution : undefined, imageStyle: capabilityProfile?.imageOptions ? reconciled.image?.style : undefined, imageOutputFormat: capabilityProfile?.imageOptions ? reconciled.image?.outputFormat : undefined, imageBackground: capabilityProfile?.imageOptions ? reconciled.image?.background : undefined, imageModeration: capabilityProfile?.imageOptions ? reconciled.image?.moderation : undefined, imageResponseFormat: capabilityProfile?.imageOptions ? reconciled.image?.responseFormat : undefined }
        : { model, size: reconciled.video?.size, vquality: reconciled.video?.quality, seconds: reconciled.video?.seconds === undefined ? undefined : String(reconciled.video.seconds) };
}

function positiveInteger(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
