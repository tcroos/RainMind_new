import { defaultConfig, modelOptionName, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { creativeModelProfileForLogicalModel } from "@/lib/creative-model-capabilities";
import { parseImageDimensions } from "@/lib/image-size";
import type { CanvasAudioSettingKey } from "../components/canvas-audio-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata } from "../types";

export function connectedCanvasNodeMetadata(globalConfig: AiConfig, source: CanvasNodeData | undefined, targetType: CanvasNodeType): CanvasNodeMetadata | undefined {
    if (![CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Config].includes(targetType)) return undefined;
    const sourceMode = source?.type === CanvasNodeType.Video ? "video" : source?.type === CanvasNodeType.Config ? source.metadata?.generationMode || "image" : "image";
    const targetMode = targetType === CanvasNodeType.Config ? sourceMode : targetType === CanvasNodeType.Video ? "video" : "image";
    const compatible = Boolean(source && (source.type === CanvasNodeType.Image || source.type === CanvasNodeType.Video || source.type === CanvasNodeType.Config) && sourceMode === targetMode);
    const model = resolveCanvasGenerationModel(globalConfig, targetMode, compatible ? source?.metadata?.model : "");
    const config = source && compatible ? buildCanvasNodeConfig(globalConfig, source, targetMode, model) : globalConfig;
    const sourceSize = source?.metadata?.size;
    const dimensions = targetMode === "image" && source?.metadata?.imageSizeMode === "custom" ? null : parseImageDimensions(sourceSize || "");
    const width = dimensions?.width || source?.metadata?.naturalWidth;
    const height = dimensions?.height || source?.metadata?.naturalHeight;
    const size = sourceSize && !dimensions ? sourceSize : width && height ? reducedCanvasRatio(width, height) : undefined;
    const metadata: CanvasNodeMetadata = { size: size || (targetType === CanvasNodeType.Config ? globalConfig.size : "16:9"), sizeLocked: Boolean(size && size !== "auto") };
    if (targetType === CanvasNodeType.Config) metadata.generationMode = targetMode;
    if (!compatible && targetType !== CanvasNodeType.Config) return metadata;
    metadata.model = model;
    metadata.count = Math.max(1, Number(config.canvasImageCount || config.count) || 1);
    if (targetMode === "image") {
        metadata.count = compatible ? (source?.metadata?.count ?? Math.max(1, Number(globalConfig.canvasImageCount || globalConfig.count) || 1)) : metadata.count;
        metadata.quality = config.quality;
        metadata.imageSizeMode = size?.includes(":") ? "ratio" : source?.metadata?.imageSizeMode || config.imageSizeMode;
        metadata.imageResolution = config.imageResolution;
    } else if (targetMode === "video") {
        metadata.seconds = config.videoSeconds;
        metadata.vquality = config.vquality;
    }
    return metadata;
}

function reducedCanvasRatio(width: number, height: number): string {
    let a = width;
    let b = height;
    while (b) [a, b] = [b, a % b];
    return `${width / a}:${height / a}`;
}

export function canvasVideoSizeRatio(size: string): string {
    const dimensions = parseImageDimensions(size);
    return dimensions ? reducedCanvasRatio(dimensions.width, dimensions.height) : size;
}

export function buildCanvasNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode, model: string): AiConfig {
    const config: AiConfig = {
        ...globalConfig,
        model,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        imageSizeMode: node.metadata?.imageSizeMode || globalConfig.imageSizeMode,
        imageResolution: node.metadata?.imageResolution || globalConfig.imageResolution,
        imageStyle: node.metadata?.imageStyle || globalConfig.imageStyle,
        imageOutputFormat: node.metadata?.imageOutputFormat || globalConfig.imageOutputFormat,
        imageBackground: node.metadata?.imageBackground || globalConfig.imageBackground,
        imageModeration: node.metadata?.imageModeration || globalConfig.imageModeration,
        imageResponseFormat: node.metadata?.imageResponseFormat || globalConfig.imageResponseFormat,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
    // 模型声明了清晰度/时长档位时，把画布节点里残留的 720/1080/auto 等旧值收敛到合法档位，
    // 否则估价会按错倍率计算、请求也会被后端能力校验拒绝。
    if (mode === "video") {
        const profile = creativeModelProfileForLogicalModel((config.logicalModels || []).find((item) => item.id === modelOptionName(model)));
        const resolutions = (profile?.resolutions || []).map((value) => value.trim()).filter((value) => value && value.toLowerCase() !== "auto");
        if (resolutions.length) {
            const current = String(config.vquality || "")
                .trim()
                .toLowerCase()
                .replace(/p$/, "");
            const matched = resolutions.find((value) => value.toLowerCase().replace(/p$/, "") === current);
            config.vquality = matched || resolutions[0];
        }
        const durations = profile?.durationSeconds || [];
        if (durations.length) {
            const current = Number(config.videoSeconds);
            const matched = durations.includes(current) ? current : (durations.find((value) => value >= (Number.isFinite(current) ? current : 0)) ?? durations[durations.length - 1]);
            config.videoSeconds = String(matched);
        }
    }
    return config;
}

export function resolveCanvasGenerationModel(config: AiConfig, mode: CanvasGenerationMode, currentModel = "") {
    const models = selectableModelsByCapability(config, mode);
    const current = findModelOption(models, currentModel);
    if (current) return current;
    const preferred = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    return findModelOption(models, preferred) || models[0] || "";
}

function findModelOption(options: string[], value: string) {
    const normalized = modelOptionName(value).trim().toLowerCase();
    return normalized ? options.find((option) => modelOptionName(option).trim().toLowerCase() === normalized) || "" : "";
}

export function canvasVideoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

export function canvasAudioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
