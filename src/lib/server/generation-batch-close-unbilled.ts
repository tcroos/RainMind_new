import { createHash } from "node:crypto";

import { safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { generationTaskChargeEvidence, generationTaskHasResult, generationTaskHasUpstreamId } from "@/lib/server/generation-task-evidence";
import { GenerationTaskReviewError, reviewGenerationTask, type ReviewableGenerationTaskType } from "@/lib/server/generation-task-review-service";
import { getStoredGenerationTaskRecord } from "@/lib/server/generation-task-store";

type AuditLogActor = NonNullable<Parameters<typeof safeRecordAuditLog>[0]["actor"]>;

export const BATCH_CLOSE_UNBILLED_MAX_ITEMS = 50;
export const BATCH_CLOSE_UNBILLED_REASON = "未扣费批量关闭";
const BATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_BATCHES = 500;
const BATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set<ReviewableGenerationTaskType>(["image", "video", "audio", "text"]);
const AUDIT_ACTION = "admin.generation_task.batch_close_unbilled";

export type BatchCloseIneligibleReason = "charged" | "has_result" | "has_upstream_id";
export type BatchCloseItemOutcome = {
    type: ReviewableGenerationTaskType;
    id: string;
    outcome: "applied" | "conflict" | "not_found" | "rejected" | "failed";
    reasons?: BatchCloseIneligibleReason[];
    message?: string;
};
export type BatchCloseResult = {
    batchRequestId: string;
    /** True when at least one item was ineligible and therefore nothing in the batch was written. */
    rejected: boolean;
    items: BatchCloseItemOutcome[];
    summary: { applied: number; conflict: number; notFound: number; rejected: number; failed: number };
};

type BatchItem = { type: ReviewableGenerationTaskType; id: string; expectedUpdatedAt: number; expectedAttempt: number };

export class BatchCloseUnbilledError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

const batches = new Map<string, { fingerprint: string; result: Promise<BatchCloseResult>; expiresAt: number }>();

/**
 * Batch close for review tasks that never charged the user (#101). The only decision it can make is
 * confirm_failed through the existing review service, which on an uncharged task has nothing to
 * refund.
 *
 * Eligibility is checked for the whole batch before anything is written: one charged task, one task
 * with a result or one task with an upstream ID rejects the batch, with a reason per item. The same
 * checks run again inside the review once its claim is held (`requireUnbilled`), so a debit written
 * between this inspection and the claim turns that item into a conflict, never a refund. After that
 * each item is its own CAS write and its own audit entry; a conflict on one item does not undo the
 * others. Replays of (administrator, batchRequestId) return the first result.
 */
export async function closeUnbilledReviewTasks(body: unknown, actor: AuditLogActor): Promise<BatchCloseResult> {
    const request = parseBatch(body);
    const key = `${actor.id}:${request.batchRequestId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(request.items)).digest("hex");
    const now = Date.now();
    pruneBatches(now);
    const cached = batches.get(key);
    if (cached && cached.expiresAt > now) {
        if (cached.fingerprint !== fingerprint) throw new BatchCloseUnbilledError(400, "该批次编号已用于其他任务，请生成新的批次编号");
        return cached.result;
    }
    const result = runBatch(request.batchRequestId, request.items, actor);
    batches.set(key, { fingerprint, result, expiresAt: now + BATCH_CACHE_TTL_MS });
    result.catch(() => {
        if (batches.get(key)?.result === result) batches.delete(key);
    });
    return result;
}

async function runBatch(batchRequestId: string, items: BatchItem[], actor: AuditLogActor): Promise<BatchCloseResult> {
    const checks = await Promise.all(items.map(inspect));
    const rejected = checks.some((check) => check.outcome === "rejected");
    const outcomes: BatchCloseItemOutcome[] = [];

    for (const [index, item] of items.entries()) {
        const check = checks[index];
        let outcome: BatchCloseItemOutcome;
        if (rejected || check.outcome !== "eligible") {
            // Ineligible batch: nothing is written. Eligible items in it are reported as not run.
            outcome = check.outcome === "eligible" ? { type: item.type, id: item.id, outcome: "rejected", message: "同批次中有不可关闭的任务，整批未执行" } : check;
        } else {
            outcome = await closeItem(item);
        }
        outcomes.push(outcome);
        await safeRecordAuditLog({
            action: AUDIT_ACTION,
            status: outcome.outcome === "applied" ? "success" : "failure",
            actor,
            target: { type: "generation_task", id: item.id },
            metadata: { taskType: item.type, batchRequestId, index, outcome: outcome.outcome, ...(outcome.reasons ? { reasons: outcome.reasons } : {}), batchRejected: rejected },
        });
    }

    const count = (value: BatchCloseItemOutcome["outcome"]) => outcomes.filter((entry) => entry.outcome === value).length;
    return {
        batchRequestId,
        rejected,
        items: outcomes,
        summary: { applied: count("applied"), conflict: count("conflict"), notFound: count("not_found"), rejected: count("rejected"), failed: count("failed") },
    };
}

async function inspect(item: BatchItem): Promise<BatchCloseItemOutcome | { outcome: "eligible" }> {
    const record = await getStoredGenerationTaskRecord(item.type, item.id);
    if (!record) return { type: item.type, id: item.id, outcome: "not_found", message: "任务不存在或已过期" };
    const reasons: BatchCloseIneligibleReason[] = [];
    if (generationTaskChargeEvidence(record).charged) reasons.push("charged");
    if (generationTaskHasResult(record)) reasons.push("has_result");
    if (generationTaskHasUpstreamId(record)) reasons.push("has_upstream_id");
    if (reasons.length) return { type: item.type, id: item.id, outcome: "rejected", reasons, message: reasons.map(reasonLabel).join("、") };
    if (record.executionPhase !== "needs_review" || record.updatedAt !== item.expectedUpdatedAt || Math.floor(Number(record.attemptNo) || 0) !== item.expectedAttempt) {
        return { type: item.type, id: item.id, outcome: "conflict", message: "任务状态已变化，请刷新后重试" };
    }
    return { outcome: "eligible" };
}

async function closeItem(item: BatchItem): Promise<BatchCloseItemOutcome> {
    try {
        await reviewGenerationTask(item.type, item.id, { action: "confirm_failed", reason: BATCH_CLOSE_UNBILLED_REASON }, { expected: { updatedAt: item.expectedUpdatedAt, attemptNo: item.expectedAttempt }, requireUnbilled: true });
        return { type: item.type, id: item.id, outcome: "applied" };
    } catch (error) {
        if (error instanceof GenerationTaskReviewError && error.status === 404) return { type: item.type, id: item.id, outcome: "not_found", message: error.message };
        if (error instanceof GenerationTaskReviewError && error.status === 409) return { type: item.type, id: item.id, outcome: "conflict", message: error.message };
        console.error("Batch close unbilled item failed", { type: item.type, id: item.id, error: error instanceof Error ? error.message : "unknown" });
        return { type: item.type, id: item.id, outcome: "failed", message: "关闭失败" };
    }
}

function parseBatch(body: unknown) {
    const value = (body && typeof body === "object" ? body : {}) as { batchRequestId?: unknown; action?: unknown; items?: unknown };
    if (value.action !== undefined && value.action !== "confirm_failed_unbilled") throw new BatchCloseUnbilledError(400, "批量操作只支持关闭未扣款任务");
    const batchRequestId = typeof value.batchRequestId === "string" ? value.batchRequestId.trim() : "";
    if (!BATCH_ID_PATTERN.test(batchRequestId)) throw new BatchCloseUnbilledError(400, "请提供有效的批次编号（UUID）");
    const rawItems = Array.isArray(value.items) ? value.items : null;
    if (!rawItems || !rawItems.length) throw new BatchCloseUnbilledError(400, "请至少选择一条任务");
    if (rawItems.length > BATCH_CLOSE_UNBILLED_MAX_ITEMS) throw new BatchCloseUnbilledError(400, `单次最多处理 ${BATCH_CLOSE_UNBILLED_MAX_ITEMS} 条任务`);

    const items: BatchItem[] = [];
    const seen = new Set<string>();
    for (const entry of rawItems) {
        const raw = (entry && typeof entry === "object" ? entry : {}) as { type?: unknown; id?: unknown; expectedUpdatedAt?: unknown; expectedAttempt?: unknown };
        const type = raw.type as ReviewableGenerationTaskType;
        const id = typeof raw.id === "string" ? raw.id.trim().slice(0, 160) : "";
        const expectedUpdatedAt = Number(raw.expectedUpdatedAt);
        const expectedAttempt = Number(raw.expectedAttempt);
        if (!TYPES.has(type) || !id) throw new BatchCloseUnbilledError(400, "任务类型或编号无效");
        if (!Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt <= 0) throw new BatchCloseUnbilledError(400, "缺少任务版本，请刷新后重试");
        if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 0) throw new BatchCloseUnbilledError(400, "缺少任务尝试次数，请刷新后重试");
        const identity = `${type}:${id}`;
        if (seen.has(identity)) throw new BatchCloseUnbilledError(400, "同一批次中任务不能重复");
        seen.add(identity);
        items.push({ type, id, expectedUpdatedAt, expectedAttempt });
    }
    return { batchRequestId, items };
}

function reasonLabel(reason: BatchCloseIneligibleReason) {
    return { charged: "已扣款", has_result: "已有结果", has_upstream_id: "已有上游任务 ID" }[reason];
}

function pruneBatches(now: number) {
    for (const [key, entry] of batches) if (entry.expiresAt <= now) batches.delete(key);
    while (batches.size >= MAX_CACHED_BATCHES) batches.delete(batches.keys().next().value!);
}

export function resetBatchCloseUnbilledCacheForTests() {
    batches.clear();
}
