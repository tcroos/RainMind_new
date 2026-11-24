export function resolveImageTaskOptions(config: { quality?: unknown; size?: unknown; sizeMode?: unknown; resolution?: unknown; style?: unknown; outputFormat?: unknown; background?: unknown; moderation?: unknown; responseFormat?: unknown; outputBackground?: unknown; outputMode?: unknown }, defaults: { imageQuality: string; imageSize: string }) {
    const size = text(config.size) || text(defaults?.imageSize) || "auto";
    const sizeMode: "auto" | "ratio" | "custom" = config.sizeMode === "auto" || config.sizeMode === "ratio" || config.sizeMode === "custom" ? config.sizeMode : size.toLowerCase() === "auto" ? "auto" : /^\d+\s*[x*×]\s*\d+$/i.test(size) ? "custom" : "ratio";
    const background = (["auto", "opaque", "transparent"] as const).find((value) => value === config.background);
    const responseFormat = (["url", "b64_json"] as const).find((value) => value === config.responseFormat);
    return {
        quality: text(config.quality) || text(defaults?.imageQuality) || "auto",
        size,
        sizeMode,
        ...(text(config.resolution) ? { resolution: text(config.resolution) } : {}),
        ...(text(config.style) ? { style: text(config.style) } : {}),
        ...(text(config.outputFormat) ? { outputFormat: text(config.outputFormat) } : {}),
        ...(background ? { background } : {}),
        ...(text(config.moderation) ? { moderation: text(config.moderation) } : {}),
        ...(responseFormat ? { responseFormat } : {}),
        ...(config.outputBackground === "transparent" || background === "transparent" ? { outputBackground: "transparent" as const } : config.outputBackground === "opaque" || background === "opaque" ? { outputBackground: "opaque" as const } : {}),
        ...(config.outputMode === "layers" ? { outputMode: "layers" as const } : {}),
    };
}

export function resolveImageGenerationCount(value: unknown) {
    const count = Number(value);
    return Math.max(1, Number.isSafeInteger(count) && count > 0 ? Math.floor(count) : 1);
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
