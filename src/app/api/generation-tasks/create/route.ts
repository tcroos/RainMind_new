import { readJsonBodyResult } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { POST as createImage } from "@/app/api/image-tasks/route";
import { POST as createVideo } from "@/app/api/video-generation-tasks/video-generation-route";
import { POST as createAudio } from "@/app/api/audio-tasks/route";
import { POST as createText } from "@/app/api/text-tasks/route";
import { getImageTask } from "@/lib/server/image-task-store";
import { getVideoTask } from "@/lib/server/video-task-store";
import { getAudioTask } from "@/lib/server/audio-task-store";
import { getTextTask } from "@/lib/server/text-task-store";
import type { VideoGenerationQuote } from "@/lib/video-generation-quote";
import { contractError, contractResponse, forwardGenerationRequest, generationKinds, type GenerationKind } from "../contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 2400;

export async function POST(request: Request) {
    const traceId = crypto.randomUUID();
    try {
        if (!await getCurrentUser(request)) return contractError(traceId, "create", 401, "UNAUTHORIZED", "请先登录");
        // Image's established boundary permits inline references up to 32 MiB.
        const parsed = await readJsonBodyResult<{ kind?: string; input?: Record<string, unknown>; quoteToken?: unknown }>(request, 32 * 1024 * 1024);
        if (!parsed.ok) return contractError(traceId, "create", parsed.status, "INVALID_REQUEST", parsed.message);
        const body = parsed.data;
        if (!body || !generationKinds.has(body.kind || "")) return contractError(traceId, "create", 400, "INVALID_TASK_KIND", "不支持的任务类型");
        if (!body.input || typeof body.input !== "object" || Array.isArray(body.input)) return contractError(traceId, "create", 400, "INVALID_REQUEST", "缺少任务 input");
        const kind = body.kind as GenerationKind;
        const input = { ...body.input };
        // Neither creation nor quote callers may smuggle legacy control flags through input.
        delete input.quoteOnly;
        delete input.quoteItems;
        delete input.expectedQuote;
        delete input.quoteTargetId;
        if (kind === "video") {
            let quote: VideoGenerationQuote;
            try {
                if (typeof body.quoteToken !== "string" || !body.quoteToken) throw new Error();
                quote = JSON.parse(Buffer.from(body.quoteToken, "base64url").toString("utf8"));
                if (!quote || typeof quote.confirmation !== "string" || !Number.isSafeInteger(quote.expiresAt) || Number(quote.expiresAt) <= Date.now()) throw new Error();
            } catch {
                return contractError(traceId, "create", 409, "INVALID_QUOTE", "报价无效或已过期，请重新报价");
            }
            // Existing video handler verifies the signature, user, request target, parameters,
            // references and current price before any new task or upstream submission.
            input.expectedQuote = quote;
        } else if (body.quoteToken !== undefined) {
            return contractError(traceId, "create", 400, "QUOTE_NOT_SUPPORTED", "该任务类型暂不支持报价凭证");
        }
        const handlers = { image: createImage, video: createVideo, audio: createAudio, text: createText };
        const paths = { image: "/api/image-tasks", video: "/api/video-generation-tasks", audio: "/api/audio-tasks", text: "/api/text-tasks" };
        const response = await handlers[kind](forwardGenerationRequest(request, paths[kind], input));
        const payload = await response.json();
        if (!response.ok || !payload?.task?.id) return contractError(traceId, "create", response.ok ? 502 : response.status, response.status === 409 ? "QUOTE_OR_REQUEST_CONFLICT" : "GENERATION_TASK_CREATE_FAILED", typeof payload?.error === "string" ? payload.error : "任务创建失败", response.headers);
        const task = payload.task;
        let power: number | null = null;
        try {
            const readers = { image: getImageTask, video: getVideoTask, audio: getAudioTask, text: getTextTask };
            const stored = await readers[kind](task.id) as { billing?: { pointsCost?: number }; upstream?: { pointsCost?: number } } | null;
            power = stored?.billing?.pointsCost ?? stored?.upstream?.pointsCost ?? null;
        } catch {
            // The task already exists: a billing read must never turn a successful submit into a retry.
            console.warn("Generation task billing snapshot unavailable", { traceId, kind, taskId: task.id });
        }
        return contractResponse(traceId, "create", { ok: true, data: { task: { ...task, id: task.id, taskId: task.id, kind, power, needsReview: task.needsReview === true }, ...(payload.warning ? { warning: payload.warning } : {}) } }, response.status, response.headers);
    } catch (error) {
        console.error("Unified generation task create failed", { traceId, error });
        return contractError(traceId, "create", 500, "GENERATION_TASK_CREATE_FAILED", "任务创建结果暂未确认，请检查原任务后再试");
    }
}
