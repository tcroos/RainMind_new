import { imageRequestAspectRatio } from "./image-task-size";

const IMAGE_SIZES: Record<string, string> = { "1k": "1K", low: "1K", standard: "1K", "2k": "2K", medium: "2K", hd: "2K", "4k": "4K", high: "4K" };

export function geminiImageConfig(size = "auto", quality = "auto", configured: Record<string, unknown> = {}) {
    const aspectRatio = imageRequestAspectRatio(size);
    const imageSize = IMAGE_SIZES[quality.trim().toLowerCase()];
    return { ...(imageSize ? { imageSize } : {}), ...configured, ...(aspectRatio ? { aspectRatio } : {}) };
}
