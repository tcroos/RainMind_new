import type { LogicalModelCapabilityProfile } from "@/lib/auth/store";
import { parseImageDimensions } from "@/lib/image-size";

export type CapabilityConstraintInput = {
    capability: "image" | "video" | "audio" | "text";
    referenceCount?: number;
    referenceImageCount?: number;
    referenceVideoCount?: number;
    referenceAudioCount?: number;
    referenceTotalCount?: number;
    hasReferenceImageOrVideo?: boolean;
    durationSeconds?: number;
    batchSize?: number;
    aspectRatio?: string;
    resolution?: string;
    sizeMode?: string;
    imageQuality?: string;
    imageStyle?: string;
    imageOutputFormat?: string;
    imageBackground?: string;
    imageModeration?: string;
    imageResponseFormat?: string;
};

export function assertCapabilityConstraints(profile: LogicalModelCapabilityProfile | undefined, input: CapabilityConstraintInput) {
    if (!profile) return;
    if (input.capability === "image" && parseImageDimensions(input.aspectRatio || "") && profile.resolutions?.length && profile.resolutions.every((item) => normalizedResolution(item, "image") === "auto")) throw new Error("当前模型仅支持自动尺寸");
    if (input.capability === "image" && profile.imageOptions) {
        const options = profile.imageOptions;
        if (input.sizeMode && options.sizeModes?.length && !options.sizeModes.includes(input.sizeMode as "auto" | "ratio" | "custom")) throw new Error(`当前模型不支持${input.sizeMode}尺寸模式`);
        if (input.resolution && options.resolutions?.length && !supportsOption(options.resolutions, input.resolution, normalizedResolution)) throw new Error(`当前模型不支持 ${input.resolution} 分辨率`);
        if (input.imageQuality && options.qualities?.length && !supportsOption(options.qualities, input.imageQuality)) throw new Error(`当前模型不支持 ${input.imageQuality} 画质`);
        if (input.imageStyle && options.styles?.length && !supportsOption(options.styles, input.imageStyle)) throw new Error(`当前模型不支持 ${input.imageStyle} 风格`);
        if (input.imageOutputFormat && options.outputFormats?.length && !supportsOption(options.outputFormats, input.imageOutputFormat)) throw new Error(`当前模型不支持 ${input.imageOutputFormat} 输出格式`);
        if (input.imageBackground && options.backgrounds?.length && !supportsOption(options.backgrounds, input.imageBackground)) throw new Error(`当前模型不支持 ${input.imageBackground} 背景`);
        if (input.imageModeration && options.moderations?.length && !supportsOption(options.moderations, input.imageModeration)) throw new Error(`当前模型不支持 ${input.imageModeration} 审核模式`);
        if (input.imageResponseFormat && options.responseFormats?.length && !supportsOption(options.responseFormats, input.imageResponseFormat)) throw new Error(`当前模型不支持 ${input.imageResponseFormat} 响应格式`);
    }
    const imageCount = input.referenceImageCount ?? input.referenceCount ?? 0;
    const videoCount = input.referenceVideoCount ?? 0;
    const audioCount = input.referenceAudioCount ?? 0;
    if (imageCount && profile.supportsReferenceImage === false) throw new Error("当前模型不支持参考图片");
    if (videoCount && profile.supportsReferenceVideo === false) throw new Error("当前模型不支持参考视频");
    if (audioCount && profile.supportsReferenceAudio === false) throw new Error("当前模型不支持参考音频");
    if (imageCount && profile.maxReferenceImages && imageCount > profile.maxReferenceImages) throw new Error(`当前模型最多支持 ${profile.maxReferenceImages} 张参考图`);
    if (videoCount && profile.maxReferenceVideos && videoCount > profile.maxReferenceVideos) throw new Error(`当前模型最多支持 ${profile.maxReferenceVideos} 段参考视频`);
    if (audioCount && profile.maxReferenceAudios && audioCount > profile.maxReferenceAudios) throw new Error(`当前模型最多支持 ${profile.maxReferenceAudios} 段参考音频`);
    if (input.referenceTotalCount && profile.maxReferenceTotal && input.referenceTotalCount > profile.maxReferenceTotal) throw new Error(`当前模型最多支持 ${profile.maxReferenceTotal} 份参考素材`);
    if (profile.requiresReferenceImageOrVideo && audioCount > 0 && input.hasReferenceImageOrVideo === false) throw new Error("参考音频不能单独使用，请同时添加参考图或参考视频");
    if (input.batchSize && profile.maxBatchSize && input.batchSize > profile.maxBatchSize) throw new Error(`当前模型最多支持批量生成 ${profile.maxBatchSize} 个结果`);
    if (input.durationSeconds && profile.minDurationSeconds && input.durationSeconds < profile.minDurationSeconds) throw new Error(`当前清晰度最短视频时长为 ${profile.minDurationSeconds} 秒`);
    if (input.durationSeconds && profile.maxDurationSeconds && input.durationSeconds > profile.maxDurationSeconds) throw new Error(`当前清晰度最长视频时长为 ${profile.maxDurationSeconds} 秒`);
    if (input.durationSeconds && profile.durationSeconds?.length && !profile.durationSeconds.includes(input.durationSeconds)) {
        const clarity = String(input.resolution || "").trim();
        throw new Error(`当前清晰度${clarity ? `（${clarity}）` : ""}不支持 ${input.durationSeconds} 秒时长，仅支持 ${profile.durationSeconds.join(" / ")} 秒`);
    }
    const allowsCustomRatio = input.capability === "image" && input.sizeMode === "custom" && profile.imageOptions?.sizeModes?.includes("custom");
    const aspectRatio = allowsCustomRatio ? undefined : normalizedAspectRatio(input.aspectRatio);
    if (aspectRatio && aspectRatio !== "auto" && profile.aspectRatios?.length && !profile.aspectRatios.some((item) => normalizedAspectRatio(item) === aspectRatio)) throw new Error(`当前模型不支持 ${input.aspectRatio} 比例`);
    const resolution = normalizedResolution(input.resolution, input.capability);
    if (resolution && resolution !== "auto" && profile.resolutions?.length && !profile.resolutions.some((item) => normalizedResolution(item, input.capability) === resolution)) {
        throw new Error(`当前模型不支持 ${input.resolution} 分辨率，可选：${profile.resolutions.join(" / ")}`);
    }
}

function supportsOption(options: string[], requested: string, normalize: (value: string, capability: "image") => string = (value) => value.trim().toLowerCase()) {
    return options.some((value) => normalize(value, "image") === normalize(requested, "image"));
}

function normalizedResolution(value: string | undefined, capability: CapabilityConstraintInput["capability"]) {
    const text = value?.trim().replace(/p$/i, "").toLowerCase() || "";
    return capability === "image" ? ({ low: "1k", standard: "1k", medium: "2k", hd: "2k", high: "4k" } as Record<string, string>)[text] || text : text;
}

function normalizedAspectRatio(value: string | undefined) {
    const text = value?.trim().toLowerCase() || "";
    const dimensions = text.match(/^(\d+)x(\d+)$/);
    if (!dimensions) return text;
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(left: number, right: number): number {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a || 1;
}
