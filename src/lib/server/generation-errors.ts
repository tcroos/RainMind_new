import { hasInsufficientPointsError } from "@/lib/creative-generation-status";
import { readProviderError } from "@/lib/server/provider-task-config";
import { GenerationSubmissionUncertainError } from "@/lib/server/generation-submission-error";
import { relayRequestBodyError } from "@/lib/relay-request-error";

export const DEFAULT_CHANNEL_CONNECT_ERROR = "生成渠道暂时无法连接，请稍后重试或联系管理员。";
export const UNKNOWN_SUBMISSION_REVIEW_ERROR = "上游提交结果不确定，未取得可查询的任务 ID；为避免重复生成和扣费，系统已停止自动重试。";
export const RELAY_REQUEST_BODY_TOO_LARGE_ERROR = "参考素材过大，生成未开始。请减少参考图数量或压缩后重试。";
export const CHANNEL_CONFIG_INVALID_ERROR = "当前模型暂不可用，请联系管理员";
export const UPSTREAM_TEMPORARILY_UNAVAILABLE_ERROR = "上游服务暂时不可用，请稍后重试";

export function toSafeGenerationErrorMessage(error: unknown, fallback: string) {
    const message = generationErrorMessage(error);
    if (hasInsufficientPointsError(error)) return "积分不足";
    const { code, status } = generationErrorDetails(error);
    if (code === "channel_config_invalid") return CHANNEL_CONFIG_INVALID_ERROR;
    if (code === "upstream_unavailable" || code === "provider_http_500" || status === 500) return UPSTREAM_TEMPORARILY_UNAVAILABLE_ERROR;
    const relayError = relayRequestBodyError(error);
    if (relayError) return relayError;
    if (isTimeoutError(error, message)) return "生成接口响应超时，请稍后重试或检查模型服务。";
    if (isFetchNetworkError(error, message)) return DEFAULT_CHANNEL_CONNECT_ERROR;
    if (isHtmlGatewayError(message)) return DEFAULT_CHANNEL_CONNECT_ERROR;
    if (containsInfrastructureDetails(message)) return /参考|素材|公网/i.test(message) ? "参考素材暂时无法提交给当前生成渠道，请重新上传或稍后重试。" : DEFAULT_CHANNEL_CONNECT_ERROR;
    return message || fallback;
}

function generationErrorDetails(error: unknown) {
    let value: unknown = error;
    if (error instanceof Error) {
        try { value = JSON.parse(error.message); } catch { value = error; }
    }
    if (!value || typeof value !== "object") return { code: "", status: undefined };
    const record = value as { code?: unknown; status?: unknown; response?: { status?: unknown; data?: { code?: unknown } }; error?: { code?: unknown } };
    const code = [record.code, record.error?.code, record.response?.data?.code].find((item): item is string => typeof item === "string") || "";
    const statusValue = record.status ?? record.response?.status;
    return { code, status: typeof statusValue === "number" ? statusValue : undefined };
}

export function toSafeGenerationReviewReason(error: unknown, fallback: string) {
    if (error instanceof GenerationSubmissionUncertainError) return UNKNOWN_SUBMISSION_REVIEW_ERROR;
    return toSafeGenerationErrorMessage(error, fallback);
}

function generationErrorMessage(error: unknown) {
    const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (!raw.trim().startsWith("{")) return raw;
    try {
        return readProviderError(JSON.parse(raw)) || raw;
    } catch {
        return raw;
    }
}

function isHtmlGatewayError(message: string) {
    return /<!doctype\s+html|<html\b|<head>\s*<title>\s*\d{3}\b|<center>\s*<h1>\s*\d{3}\b|\bnginx\b/i.test(message);
}

function containsInfrastructureDetails(message: string) {
    return /https?:\/\/|\blocalhost\b|\b127\.0\.0\.1\b|next_public_site_url|base\s*url|api\s*key|\bdns\b|\beconn\w*\b|\benotfound\b|服务器网络|https\s*证书|代理配置|relay\s+request\s+body\s+memory\s+protection/i.test(message);
}

function isTimeoutError(error: unknown, message: string) {
    const lower = message.toLowerCase();
    if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted due to timeout")) return true;
    if (!(error instanceof Error)) return false;
    return error.name === "TimeoutError";
}

function isFetchNetworkError(error: unknown, message: string) {
    if (message.toLowerCase() === "fetch failed") return true;
    if (!(error instanceof TypeError)) return false;
    const cause = "cause" in error ? error.cause : undefined;
    if (!cause || typeof cause !== "object") return false;
    const code = "code" in cause ? String(cause.code) : "";
    return ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code);
}
