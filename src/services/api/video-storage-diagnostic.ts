export type VideoStorageStage = "download" | "read" | "upload" | "server_storage_response";
export type VideoStorageSourceUrlType = "site" | "remote" | "inline" | "unknown";

export type VideoStorageDiagnostic = {
    stage: VideoStorageStage;
    bytes?: number;
    mimeType?: string;
    sourceUrlType: VideoStorageSourceUrlType;
    httpStatus?: number;
    errorCode?: string;
    messageSummary: string;
};

export class VideoMediaStorageError extends Error {
    readonly diagnostic: VideoStorageDiagnostic;

    constructor(diagnostic: VideoStorageDiagnostic) {
        super(diagnostic.messageSummary);
        this.name = "VideoMediaStorageError";
        this.diagnostic = diagnostic;
    }
}

export function createVideoStorageDiagnostic(
    stage: VideoStorageStage,
    error: unknown,
    input: { sourceUrl?: string; bytes?: number; mimeType?: string; httpStatus?: number; errorCode?: string } = {},
): VideoStorageDiagnostic {
    const sourceUrlType = classifyVideoStorageSource(input.sourceUrl);
    const details = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; message?: unknown; response?: { status?: unknown } } : undefined;
    const httpStatus = positiveInteger(input.httpStatus) || positiveInteger(details?.response?.status) || positiveInteger(details?.status);
    const errorCode = safeToken(input.errorCode || details?.code);
    return {
        stage,
        ...(positiveInteger(input.bytes) !== undefined ? { bytes: positiveInteger(input.bytes) } : {}),
        ...(safeMimeType(input.mimeType) ? { mimeType: safeMimeType(input.mimeType) } : {}),
        sourceUrlType,
        ...(httpStatus ? { httpStatus } : {}),
        ...(errorCode ? { errorCode } : {}),
        messageSummary: summarizeVideoStorageError(error),
    };
}

export function classifyVideoStorageSource(sourceUrl?: string): VideoStorageSourceUrlType {
    const value = sourceUrl?.trim() || "";
    if (!value) return "unknown";
    if (/^(data|blob):/i.test(value)) return "inline";
    if (/^\/api\/(reference-assets|generation-log-assets)\//i.test(value)) return "site";
    try {
        const url = new URL(value, "http://vozeb.local");
        if (url.origin === "http://vozeb.local" && /^\/api\/(reference-assets|generation-log-assets)\//i.test(url.pathname)) return "site";
        if (url.protocol === "http:" || url.protocol === "https:") return "remote";
    } catch {
        return "unknown";
    }
    return "unknown";
}

export function summarizeVideoStorageError(error: unknown) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "视频结果保存失败";
    return message
        .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
        .replace(/(token|signature|credential|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
        .replace(/[\r\n\t]+/g, " ")
        .slice(0, 240) || "视频结果保存失败";
}

export function formatVideoStorageDiagnostic(diagnostic: VideoStorageDiagnostic) {
    const stage = diagnostic.stage === "download" ? "下载" : diagnostic.stage === "read" ? "读取" : diagnostic.stage === "upload" ? "上传" : "服务端存储响应";
    const facts = [
        diagnostic.httpStatus ? `HTTP ${diagnostic.httpStatus}` : undefined,
        diagnostic.errorCode,
        diagnostic.bytes !== undefined ? `${diagnostic.bytes} bytes` : undefined,
        diagnostic.mimeType,
        diagnostic.sourceUrlType === "unknown" ? undefined : `来源 ${diagnostic.sourceUrlType}`,
        diagnostic.messageSummary,
    ].filter(Boolean);
    return `${stage}阶段：${facts.join("；")}`;
}

function positiveInteger(value: unknown) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function safeToken(value: unknown) {
    return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : undefined;
}

function safeMimeType(value?: string) {
    const mimeType = value?.split(";", 1)[0]?.trim().toLowerCase();
    return mimeType && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType) ? mimeType : undefined;
}
