export type CreativeUploadKind = "image" | "video" | "audio";

export const CREATIVE_IMAGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const CREATIVE_VIDEO_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
export const CREATIVE_AUDIO_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

/** 图片沿用旧上限，保持既有调用方语义不变。 */
export const CREATIVE_UPLOAD_MAX_BYTES = CREATIVE_IMAGE_UPLOAD_MAX_BYTES;

export const CREATIVE_UPLOAD_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/opus",
    "audio/aac",
    "audio/flac",
] as const;

export const CREATIVE_UPLOAD_ACCEPT = CREATIVE_UPLOAD_MIME_TYPES.join(",");

const KIND_LABEL: Record<CreativeUploadKind, string> = { image: "图片", video: "视频", audio: "音频" };

export function creativeUploadMaxBytes(kind: CreativeUploadKind): number {
    if (kind === "video") return CREATIVE_VIDEO_UPLOAD_MAX_BYTES;
    if (kind === "audio") return CREATIVE_AUDIO_UPLOAD_MAX_BYTES;
    return CREATIVE_IMAGE_UPLOAD_MAX_BYTES;
}

export function creativeUploadMaxMegabytes(kind: CreativeUploadKind): number {
    return Math.round(creativeUploadMaxBytes(kind) / (1024 * 1024));
}

/** 参考素材上限文案，例如「单个视频不能超过 200MB」。 */
export function creativeUploadTooLargeMessage(kind: CreativeUploadKind): string {
    return `单个${KIND_LABEL[kind]}不能超过 ${creativeUploadMaxMegabytes(kind)}MB`;
}

export function creativeUploadKindForMime(mime: string | undefined): CreativeUploadKind {
    const value = (mime || "").toLowerCase();
    if (value.startsWith("video/")) return "video";
    if (value.startsWith("audio/")) return "audio";
    return "image";
}

export function isCreativeUploadMimeType(value: string): value is (typeof CREATIVE_UPLOAD_MIME_TYPES)[number] {
    return CREATIVE_UPLOAD_MIME_TYPES.includes(value.toLowerCase() as (typeof CREATIVE_UPLOAD_MIME_TYPES)[number]);
}
