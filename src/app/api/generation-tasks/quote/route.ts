import { readJsonBodyResult } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { POST as quoteVideo } from "@/app/api/video-generation-tasks/video-generation-route";
import { contractError, contractResponse, forwardGenerationRequest, generationKinds } from "../contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 2400;

export async function POST(request: Request) {
    const traceId = crypto.randomUUID();
    try {
        if (!await getCurrentUser(request)) return contractError(traceId, "quote", 401, "UNAUTHORIZED", "请先登录");
        const parsed = await readJsonBodyResult<{ kind?: string; input?: Record<string, unknown> }>(request);
        if (!parsed.ok) return contractError(traceId, "quote", parsed.status, "INVALID_REQUEST", parsed.message);
        const body = parsed.data;
        if (!body || !generationKinds.has(body.kind || "")) return contractError(traceId, "quote", 400, "INVALID_TASK_KIND", "不支持的任务类型");
        if (body.kind !== "video") return contractError(traceId, "quote", 422, "QUOTE_NOT_SUPPORTED", "该任务类型暂不支持生成前报价");
        if (!body.input || typeof body.input !== "object" || Array.isArray(body.input)) return contractError(traceId, "quote", 400, "INVALID_REQUEST", "缺少报价 input");
        const input = { ...body.input, quoteOnly: true };
        delete (input as Record<string, unknown>).quoteItems;
        delete (input as Record<string, unknown>).expectedQuote;
        const response = await quoteVideo(forwardGenerationRequest(request, "/api/video-generation-tasks", input));
        const payload = await response.json();
        if (!response.ok || !payload?.quote?.confirmation) return contractError(traceId, "quote", response.ok ? 502 : response.status, "GENERATION_QUOTE_FAILED", typeof payload?.error === "string" ? payload.error : "任务报价失败", response.headers);
        const quote = payload.quote;
        return contractResponse(traceId, "quote", { ok: true, data: { quote: { kind: "video", power: quote.points, breakdown: quote, expiresAt: quote.expiresAt, quoteToken: Buffer.from(JSON.stringify(quote)).toString("base64url") } } }, 200, response.headers);
    } catch (error) {
        console.error("Unified generation quote failed", { traceId, error });
        return contractError(traceId, "quote", 500, "GENERATION_QUOTE_FAILED", "任务报价失败");
    }
}
