import { markAudioTaskFailed } from "@/lib/server/audio-task-runtime";
import { getAudioTask, updateAudioTask } from "@/lib/server/audio-task-store";
import { markImageTaskFailed } from "@/lib/server/image-task-runtime";
import { getImageTask, updateImageTask } from "@/lib/server/image-task-store";
import { refundImageTask } from "@/lib/server/image-task-refund";
import { getStoredGenerationTaskRecord, type GenerationTaskType } from "@/lib/server/generation-task-store";
import { claimGenerationTaskReview, releaseGenerationTaskReviewClaim, scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { withGenerationTaskFence } from "@/lib/server/generation-task-fence";
import { generationTaskChargeEvidence, generationTaskHasResult, generationTaskHasUpstreamId } from "@/lib/server/generation-task-evidence";
import { markTextTaskFailed } from "@/lib/server/text-task-runtime";
import { getTextTask, transitionTextTask, updateTextTask } from "@/lib/server/text-task-store";
import { failVideoTaskFromWorker } from "@/lib/server/video-task-runtime";
import { getVideoTask, updateVideoTask } from "@/lib/server/video-task-store";

export type ReviewableGenerationTaskType = Extract<GenerationTaskType, "text" | "image" | "video" | "audio">;
export type GenerationTaskReviewInput = { action: "resume_upstream"; upstreamTaskId: string; origin: string } | { action: "provide_result"; result: string } | { action: "confirm_failed"; reason?: string };

export type GenerationTaskReviewOptions = {
    /** Pin the decision to the version the caller inspected; a newer version is a 409 conflict. */
    expected?: { updatedAt: number; attemptNo: number };
    /**
     * Batch close of uncharged tasks (#101). The task is re-read after the review claim is held, and
     * any charge, result or upstream ID found then refuses the decision with 409 before failure
     * settlement can run, so a debit written between the caller's check and the claim is never
     * refunded or settled by this path.
     */
    requireUnbilled?: boolean;
};

export async function reviewGenerationTask(type: ReviewableGenerationTaskType, id: string, input: GenerationTaskReviewInput, options: GenerationTaskReviewOptions = {}) {
    const { expected, requireUnbilled = false } = options;
    if (requireUnbilled && input.action !== "confirm_failed") throw new GenerationTaskReviewError(400, "未扣款约束只适用于确认失败");
    const record = await getStoredGenerationTaskRecord(type, id);
    if (!record) throw new GenerationTaskReviewError(404, "生成任务不存在或已过期");
    if (expected && (record.updatedAt !== expected.updatedAt || Math.floor(Number(record.attemptNo) || 0) !== Math.floor(Number(expected.attemptNo) || 0))) {
        throw new GenerationTaskReviewError(409, "任务状态已被其他操作更新，请刷新后重试");
    }
    if (record.executionPhase !== "needs_review") throw new GenerationTaskReviewError(409, "当前任务不需要人工确认");
    validateReviewInput(type, input);

    // BUG-091: the phase check above and the writes below used to be separate, so two concurrent
    // decisions could both pass. Claim the task against what was read; only one reviewer wins.
    const claim = await claimGenerationTaskReview(type, id, { executionPhase: record.executionPhase, updatedAt: record.updatedAt, attemptNo: record.attemptNo });
    if (!claim) throw new GenerationTaskReviewError(409, "任务状态已被其他操作更新，请刷新后重试");
    try {
        const current = requireUnbilled ? await requireUnbilledAfterClaim(type, id) : record;
        return await withGenerationTaskFence({ type, taskId: id, userId: record.userId, workerId: claim.workerId, leaseUntil: claim.leaseUntil }, () => applyReviewDecision(type, id, input, current));
    } finally {
        await releaseGenerationTaskReviewClaim(type, id, claim.workerId).catch((error) => console.error("Generation review claim release failed", { type, id, error: error instanceof Error ? error.message : "unknown" }));
    }
}

async function requireUnbilledAfterClaim(type: ReviewableGenerationTaskType, id: string) {
    const current = await getStoredGenerationTaskRecord(type, id);
    if (!current) throw new GenerationTaskReviewError(404, "生成任务不存在或已过期");
    if (generationTaskChargeEvidence(current).charged) throw new GenerationTaskReviewError(409, "任务已产生扣费记录，不能按未扣款关闭");
    if (generationTaskHasResult(current)) throw new GenerationTaskReviewError(409, "任务已有结果，不能按未扣款关闭");
    if (generationTaskHasUpstreamId(current)) throw new GenerationTaskReviewError(409, "任务已有上游任务 ID，不能按未扣款关闭");
    return current;
}

function validateReviewInput(type: ReviewableGenerationTaskType, input: GenerationTaskReviewInput) {
    if (input.action === "resume_upstream" && !clean(input.upstreamTaskId, 500)) throw new GenerationTaskReviewError(400, "请输入上游任务 ID");
    if (input.action === "provide_result") {
        const result = clean(input.result, 20_000);
        if (!result) throw new GenerationTaskReviewError(400, type === "text" ? "请输入文本结果" : "请输入结果地址");
        if (type !== "text" && !isResultUrl(result)) throw new GenerationTaskReviewError(400, "结果地址必须是 http(s)、data: 或站内媒体路径");
    }
}

async function applyReviewDecision(type: ReviewableGenerationTaskType, id: string, input: GenerationTaskReviewInput, record: NonNullable<Awaited<ReturnType<typeof getStoredGenerationTaskRecord>>>) {
    if (input.action === "resume_upstream") {
        const upstreamTaskId = clean(input.upstreamTaskId, 500);
        await attachUpstreamTask(type, id, upstreamTaskId, input.origin);
        const now = Date.now();
        await scheduleGenerationTask(type, id, { executionPhase: "submitted", upstreamTaskId, submittedAt: record.submittedAt || now, nextPollAt: now, lastUpstreamStatus: "manually_confirmed" });
        return { action: input.action, executionPhase: "submitted" as const };
    }

    if (input.action === "provide_result") {
        const result = clean(input.result, 20_000);
        if (type === "text") {
            const task = await requireTextTask(id);
            const completed = await transitionTextTask(task, ["pending", "running"], { status: "success", result: { content: result }, messages: [], config: { ...task.config, apiKey: "" } });
            if (!completed) throw new GenerationTaskReviewError(409, "文本任务状态已变化");
            await updateTextTask(id, { config: { ...task.config, apiKey: "" }, candidateConfigs: [] });
            await scheduleGenerationTask(type, id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "manual_result" });
            return { action: input.action, executionPhase: "completed" as const };
        }
        await scheduleGenerationTask(type, id, { executionPhase: "result_ready", resultPayload: { url: result }, nextPollAt: Date.now(), lastUpstreamStatus: "manual_result" });
        return { action: input.action, executionPhase: "result_ready" as const };
    }

    const reason = clean(input.reason, 500) || "管理员已确认上游未创建任务";
    if (type === "image") {
        const task = await getImageTask(id);
        if (!task) throw new GenerationTaskReviewError(404, "图片任务不存在或已过期");
        if (task.status === "success") throw new GenerationTaskReviewError(409, "图片任务已有成功结果，不能确认失败或退款");
        if (task.status === "error") {
            const hasResult = Boolean(task.result || task.providerResults?.length);
            const settled = !hasResult && task.billing?.pointsRecordId && !task.billing.refunded ? await refundImageTask(task) : task;
            await scheduleGenerationTask(type, id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "manually_failed" });
            return {
                action: input.action,
                executionPhase: "completed" as const,
                settlement: settled.billing?.refunded ? ("refunded" as const) : ("no_refundable_charge" as const),
            };
        }
        if (task.status === "cancelled") {
            if (hasResultPayloadEvidence(record.resultPayload)) {
                throw new GenerationTaskReviewError(409, "任务已有结果证据，不能按未提交退款");
            }
            if (task.result || task.providerResults?.length || task.upstream?.id || record.upstreamTaskId) {
                throw new GenerationTaskReviewError(409, "任务已有上游身份或生成结果，不能按未提交退款");
            }
            if (!/^cancel_(unconfirmed|requested|requested_without_upstream_id)$/.test(record.lastUpstreamStatus || "")) {
                throw new GenerationTaskReviewError(409, "当前任务没有可确认的取消记录");
            }

            const resultPayload = {
                ...record.resultPayload,
                refundEvidence: { source: "admin_confirmed_unsubmitted", reason },
            };
            await scheduleGenerationTask(type, id, { lastUpstreamStatus: "cancelled_before_submission", resultPayload });
            const billing = task.billing;
            if (!billing?.pointsRecordId) {
                await scheduleGenerationTask(type, id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "cancelled_before_submission", resultPayload });
                return { action: input.action, executionPhase: "completed" as const, settlement: "no_refundable_charge" as const };
            }

            const settled = billing.refunded ? task : await refundImageTask(task);
            await scheduleGenerationTask(type, id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "manually_failed", resultPayload });
            return {
                action: input.action,
                executionPhase: "completed" as const,
                settlement: settled.billing?.refunded ? (billing.refunded ? "already_refunded" as const : "refunded" as const) : "no_refundable_charge" as const,
            };
        }
    }
    await failTask(type, id, reason);
    await scheduleGenerationTask(type, id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "manually_failed" });
    return { action: input.action, executionPhase: "completed" as const };
}

async function attachUpstreamTask(type: ReviewableGenerationTaskType, id: string, upstreamTaskId: string, origin: string) {
    if (type === "text") {
        const task = await requireTextTask(id);
        await updateTextTask(id, { upstream: { id: upstreamTaskId, createPath: task.config.advancedConfig?.createPath || "" } });
        return;
    }
    if (type === "image") {
        const task = await getImageTask(id);
        if (!task) throw new GenerationTaskReviewError(404, "图片任务不存在或已过期");
        const baseUrl = absoluteProviderBase(task.config.baseUrl, origin);
        await updateImageTask(id, { upstream: { id: upstreamTaskId, mediaBaseUrl: baseUrl, pollBaseUrl: baseUrl } });
        return;
    }
    if (type === "audio") {
        const task = await getAudioTask(id);
        if (!task) throw new GenerationTaskReviewError(404, "音频任务不存在或已过期");
        await updateAudioTask(id, { upstream: { id: upstreamTaskId, createPath: task.config.advancedConfig?.createPath || "/audio/speech" } });
        return;
    }
    const task = await getVideoTask(id);
    if (!task) throw new GenerationTaskReviewError(404, "视频任务不存在或已过期");
    await updateVideoTask(id, { upstream: { ...task.upstream, id: upstreamTaskId } });
}

async function failTask(type: ReviewableGenerationTaskType, id: string, reason: string) {
    if (type === "text") return markTextTaskFailed(await requireTextTask(id), reason);
    if (type === "image") {
        const task = await getImageTask(id);
        if (!task) throw new GenerationTaskReviewError(404, "图片任务不存在或已过期");
        return markImageTaskFailed(task, reason);
    }
    if (type === "audio") {
        const task = await getAudioTask(id);
        if (!task) throw new GenerationTaskReviewError(404, "音频任务不存在或已过期");
        return markAudioTaskFailed(task, reason);
    }
    const task = await getVideoTask(id);
    if (!task) throw new GenerationTaskReviewError(404, "视频任务不存在或已过期");
    return failVideoTaskFromWorker(task, reason);
}

async function requireTextTask(id: string) {
    const task = await getTextTask(id);
    if (!task) throw new GenerationTaskReviewError(404, "文本任务不存在或已过期");
    return task;
}

function absoluteProviderBase(baseUrl: string, origin: string) {
    return baseUrl.startsWith("/") ? `${origin}${baseUrl}` : baseUrl;
}

function isResultUrl(value: string) {
    return /^(?:https?:\/\/|data:(?:image|video|audio)\/|\/api\/(?:reference-assets|generation-log-assets)\/)/i.test(value);
}

function hasResultPayloadEvidence(payload?: Record<string, unknown>) {
    if (!payload) return false;
    if (typeof payload.url === "string" && payload.url.trim()) return true;
    if (hasEvidenceValue(payload.lateResult)) return true;
    return hasEvidenceValue(payload.lateWorkerEvidence);
}

function hasEvidenceValue(value: unknown) {
    if (typeof value === "string") return Boolean(value.trim());
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return Boolean(value);
}

function clean(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export class GenerationTaskReviewError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
    }
}
