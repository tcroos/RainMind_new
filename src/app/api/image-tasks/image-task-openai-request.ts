import { parseImageDimensions } from "@/lib/image-size";
import type { ImageTaskConfig } from "@/lib/server/image-task-store";
import { GenerationSubmissionSafeFailure } from "@/lib/server/generation-submission-error";

import { resolveSize, validateImageSize } from "./image-task-size";

/** 分辨率档位映射到全站统一的质量基准：1K=1024、2K=2048、4K=2880 底数。 */
const RESOLUTION_QUALITY: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
    low: "low",
    medium: "medium",
    high: "high",
    standard: "standard",
    hd: "hd",
};

export function buildOpenAiImageGenerationRequest(config: ImageTaskConfig, prompt: string) {
    const options = config.capabilityProfile?.imageOptions;
    if (!options) {
        return {
            model: config.model,
            prompt,
            ...(config.outputMode === "layers" ? {} : { n: 1 }),
            ...(config.quality && config.quality !== "auto" ? { quality: config.quality } : {}),
            ...(config.size && config.size !== "auto" ? { size: config.size } : {}),
        };
    }

    const size = resolveImageApiRequestSize(config);
    const quality = resolveImageApiQuality(config);
    const style = selectedOption(config.style, options.styles);
    const outputFormat = selectedOption(config.outputFormat, options.outputFormats);
    const background = config.background || config.outputBackground || selectedOption(undefined, options.backgrounds);
    const moderation = selectedOption(config.moderation, options.moderations);
    const responseFormat = selectedOption(config.responseFormat, options.responseFormats);

    return {
        model: config.model,
        prompt,
        ...(config.outputMode === "layers" ? {} : { n: 1 }),
        ...(quality ? { quality } : {}),
        ...(size ? { size } : {}),
        ...(style ? { style } : {}),
        ...(outputFormat ? { output_format: outputFormat } : {}),
        ...(background ? { background } : {}),
        ...(moderation ? { moderation } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
    };
}

/** 推导比例模式；前端未显式给出 sizeMode 时按尺寸字符串判断。 */
export function resolveImageApiSizeMode(config: Pick<ImageTaskConfig, "size" | "sizeMode">): "auto" | "ratio" | "custom" {
    if (config.sizeMode === "auto" || config.sizeMode === "ratio" || config.sizeMode === "custom") return config.sizeMode;
    if (!config.size || config.size === "auto") return "auto";
    return parseImageDimensions(config.size) ? "custom" : "ratio";
}

/** 文生图与参考图编辑都必须走同一个尺寸推导，否则编辑请求会漏掉 size。 */
export function resolveImageApiRequestSize(config: ImageTaskConfig) {
    const options = config.capabilityProfile?.imageOptions;
    const sizeMode = resolveImageApiSizeMode(config);
    if (sizeMode === "auto") return undefined;
    // 部分上游（如 nano-banana 系列）只认比例字符串，传像素会卡死或回落到默认方块
    if (config.capabilityProfile?.sizeFormat === "ratio" && sizeMode === "ratio") {
        return config.size === "auto" ? "1:1" : config.size;
    }
    return imageApiSize(sizeMode, config.size, config.resolution || options?.resolutions?.[0]);
}

export function resolveImageApiQuality(config: ImageTaskConfig) {
    return selectedOption(config.quality, config.capabilityProfile?.imageOptions?.qualities, true);
}

export function imageApiSize(sizeMode: "auto" | "ratio" | "custom", size = "auto", resolution?: string) {
    if (sizeMode === "auto") return undefined;
    if (sizeMode === "custom") {
        const dimensions = parseImageDimensions(size);
        if (!dimensions) throw new GenerationSubmissionSafeFailure("自定义宽高必须是正整数，例如 1536x2048");
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }

    try {
        // 比例模式必须复用全站 resolveSize：按面积基准放大长边，
        // 否则长边被锁在 1024 会得到 576x1024 这类过小且上游不认的尺寸。
        const quality = RESOLUTION_QUALITY[(resolution || "").trim().toLowerCase()];
        return resolveSize(quality, size === "auto" ? "1:1" : size);
    } catch (error) {
        if (error instanceof GenerationSubmissionSafeFailure) throw error;
        throw new GenerationSubmissionSafeFailure(error instanceof Error ? error.message : "图片比例或分辨率无效");
    }
}

function selectedOption(value: string | undefined, supported: string[] | undefined, omitAuto = false) {
    const selected = value?.trim() || supported?.[0];
    if (!selected || (omitAuto && selected.toLowerCase() === "auto")) return undefined;
    if (!supported?.length || !supported.some((option) => option.toLowerCase() === selected.toLowerCase())) throw new GenerationSubmissionSafeFailure(`当前渠道未声明支持 ${selected} 参数`);
    return selected;
}
