export type GenerationFailureClass =
    | "retryable_upstream"
    | "retryable_rate_limit"
    | "retryable_not_sent"
    | "terminal_request"
    | "uncertain_submitted"
    | "cancelled";

export type GenerationFailureStage = "submit" | "poll" | "persist";

export type GenerationFailureInput = {
    stage: GenerationFailureStage;
    status?: number;
    message?: string;
    error?: unknown;
};

const TERMINAL_STATUSES = new Set([400, 401, 402, 403, 404, 405, 409, 413, 415, 422]);
const RETRYABLE_UPSTREAM_STATUSES = new Set([408, 425, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 529]);
const NOT_SENT_ERROR = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|ERR_TLS|CERT_|SELF_SIGNED|DNS|connect refused/i;
const UNCERTAIN_ERROR = /fetch failed|ECONNRESET|UND_ERR_SOCKET|socket|network|无效 JSON|invalid json|没有返回.*(?:ID|ID)|结果未知/i;
const TERMINAL_MESSAGE = /内容政策|内容审核|政策|违规|敏感|审核未通过|余额不足|额度不足|配额不足|积分不足|insufficient|quota|content policy|moderation|unauthorized|forbidden|invalid|参数不正确|参数不完整|不支持|未授权|鉴权失败|认证失败/i;

export function generationFailureMessage(error: unknown): string {
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message || error.name || "";
    if (error && typeof error === "object") {
        const record = error as { message?: unknown; error?: unknown; code?: unknown };
        return [record.message, record.error, record.code].filter((value): value is string => typeof value === "string").join(" ").trim();
    }
    return "";
}

export function classifyGenerationFailure(input: GenerationFailureInput): GenerationFailureClass {
    const message = input.message || generationFailureMessage(input.error);
    const status = input.status;
    const errorName = input.error instanceof Error ? input.error.name : "";
    if (/取消|cancelled|canceled/i.test(message)) return "cancelled";
    if (status === 429) return "retryable_rate_limit";
    if (status !== undefined && RETRYABLE_UPSTREAM_STATUSES.has(status)) return "retryable_upstream";
    if (status !== undefined && TERMINAL_STATUSES.has(status)) return "terminal_request";
    if (NOT_SENT_ERROR.test(message)) return "retryable_not_sent";
    if (TERMINAL_MESSAGE.test(message)) return "terminal_request";
    if (errorName === "TimeoutError" || /超时|timeout/i.test(message)) return "retryable_upstream";
    if (UNCERTAIN_ERROR.test(message)) return "uncertain_submitted";
    if (input.stage === "submit") return "uncertain_submitted";
    return "retryable_upstream";
}

export function isRetryableCandidateFailure(failureClass: GenerationFailureClass) {
    return failureClass === "retryable_upstream" || failureClass === "retryable_rate_limit" || failureClass === "retryable_not_sent";
}

export function isTerminalRequestMessage(message: string) {
    return TERMINAL_MESSAGE.test(message);
}

export function isChannelRetryableFailure(
    config: { retryableStatuses?: number[]; retryableErrorPatterns?: string[] } | undefined,
    status?: number,
    message = "",
) {
    if (!config) return false;
    if (status !== undefined && config.retryableStatuses?.includes(status)) return true;
    const normalized = message.toLowerCase();
    return Boolean(config.retryableErrorPatterns?.some((pattern) => pattern.trim() && normalized.includes(pattern.trim().toLowerCase())));
}
