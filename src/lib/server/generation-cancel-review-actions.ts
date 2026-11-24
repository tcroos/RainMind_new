import { createHash } from "node:crypto";

import { safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { recordCancelReviewKeepPending } from "@/lib/server/generation-task-scheduler";
import { getStoredGenerationTaskRecord, type GenerationTaskType } from "@/lib/server/generation-task-store";

type AuditLogActor = NonNullable<Parameters<typeof safeRecordAuditLog>[0]["actor"]>;

const MAX_BATCH_ITEMS = 50;
const BATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_BATCHES = 500;
const BATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE_TYPES = new Set<GenerationTaskType>(["image", "video", "audio", "text"]);
const AUDIT_ACTION = "admin.generation_task.cancel_review.keep_pending";

type KeepPendingItem = { type: GenerationTaskType; id: string; expectedUpdatedAt: number; expectedAttempt: number };
export type CancelReviewItemOutcome = { type: GenerationTaskType; id: string; outcome: "applied" | "conflict" | "not_found"; updatedAt?: number };
export type CancelReviewBatchResult = { batchRequestId: string; items: CancelReviewItemOutcome[]; summary: { applied: number; conflict: number; notFound: number } };

const batches = new Map<string, { fingerprint: string; result: Promise<CancelReviewBatchResult>; expiresAt: number }>();

export class CancelReviewActionError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

/**
 * Stage 2 of the cancel review queue (BUG-091): keep_pending only, single or batched.
 *
 * Each item is its own conditional write and its own audit entry; there is no surrounding
 * transaction, so one conflict never rolls back the others. The batch is idempotent on
 * (administrator, batchRequestId): a replay returns the first result without executing or auditing
 * again. The cache is per process; a replay after a restart re-runs, and every item then reports
 * a conflict because the first run already moved its updatedAt token, so nothing is applied twice.
 */
export async function keepCancelReviewPending(body: unknown, actor: AuditLogActor, reviewer: { accountId: string }): Promise<CancelReviewBatchResult> {
    const request = await parseBatch(body, actor);
    const key = `${actor.id}:${request.batchRequestId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(request.items)).digest("hex");
    const now = Date.now();
    pruneBatches(now);
    const cached = batches.get(key);
    if (cached && cached.expiresAt > now) {
        if (cached.fingerprint !== fingerprint) throw new CancelReviewActionError(409, "该批次编号已用于其他任务，请生成新的批次编号");
        return cached.result;
    }
    const result = runBatch(request.batchRequestId, request.items, actor, reviewer);
    batches.set(key, { fingerprint, result, expiresAt: now + BATCH_CACHE_TTL_MS });
    result.catch(() => {
        if (batches.get(key)?.result === result) batches.delete(key);
    });
    return result;
}

async function runBatch(batchRequestId: string, items: KeepPendingItem[], actor: AuditLogActor, reviewer: { accountId: string }): Promise<CancelReviewBatchResult> {
    const at = new Date().toISOString();
    const outcomes: CancelReviewItemOutcome[] = [];
    for (const [index, item] of items.entries()) {
        const applied = await recordCancelReviewKeepPending(item.type, item.id, { updatedAt: item.expectedUpdatedAt, attemptNo: item.expectedAttempt }, { accountId: reviewer.accountId, at });
        const outcome: CancelReviewItemOutcome = applied
            ? { type: item.type, id: item.id, outcome: "applied", updatedAt: applied.updatedAt }
            : { type: item.type, id: item.id, outcome: (await getStoredGenerationTaskRecord(item.type, item.id)) ? "conflict" : "not_found" };
        outcomes.push(outcome);
        await safeRecordAuditLog({
            action: AUDIT_ACTION,
            status: outcome.outcome === "applied" ? "success" : "failure",
            actor,
            target: { type: "generation_task", id: item.id },
            metadata: { taskType: item.type, batchRequestId, index, outcome: outcome.outcome },
        });
    }
    return {
        batchRequestId,
        items: outcomes,
        summary: {
            applied: outcomes.filter((entry) => entry.outcome === "applied").length,
            conflict: outcomes.filter((entry) => entry.outcome === "conflict").length,
            notFound: outcomes.filter((entry) => entry.outcome === "not_found").length,
        },
    };
}

async function parseBatch(body: unknown, actor: AuditLogActor) {
    const value = (body && typeof body === "object" ? body : {}) as { batchRequestId?: unknown; action?: unknown; items?: unknown };
    const rawItems = Array.isArray(value.items) ? value.items : null;
    const requested = [value.action, ...(rawItems || []).map((entry) => (entry && typeof entry === "object" ? (entry as { action?: unknown }).action : undefined))].filter((action) => action !== undefined && action !== "keep_pending");
    if (requested.length) {
        // Refunds and conclusions are never batched. Record the attempt, then refuse the whole batch.
        await safeRecordAuditLog({ action: AUDIT_ACTION, status: "failure", actor, target: { type: "generation_cancel_review_queue", id: "cancel_review" }, metadata: { rejectedAction: String(requested[0]).slice(0, 60), itemCount: rawItems?.length || 0 } });
        throw new CancelReviewActionError(400, "批量操作只支持保持待处理（keep_pending）");
    }
    const batchRequestId = typeof value.batchRequestId === "string" ? value.batchRequestId.trim() : "";
    if (!BATCH_ID_PATTERN.test(batchRequestId)) throw new CancelReviewActionError(400, "请提供有效的批次编号（UUID）");
    if (!rawItems || !rawItems.length) throw new CancelReviewActionError(400, "请至少选择一条任务");
    if (rawItems.length > MAX_BATCH_ITEMS) throw new CancelReviewActionError(400, `单次最多处理 ${MAX_BATCH_ITEMS} 条任务`);

    const items: KeepPendingItem[] = [];
    const seen = new Set<string>();
    for (const entry of rawItems) {
        const raw = (entry && typeof entry === "object" ? entry : {}) as { type?: unknown; id?: unknown; expectedUpdatedAt?: unknown; expectedAttempt?: unknown };
        const type = raw.type as GenerationTaskType;
        const id = typeof raw.id === "string" ? raw.id.trim().slice(0, 160) : "";
        const expectedUpdatedAt = Number(raw.expectedUpdatedAt);
        const expectedAttempt = Math.floor(Number(raw.expectedAttempt) || 0);
        if (!QUEUE_TYPES.has(type) || !id) throw new CancelReviewActionError(400, "任务类型或编号无效");
        if (!Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt <= 0) throw new CancelReviewActionError(400, "缺少任务版本，请刷新队列后重试");
        const identity = `${type}:${id}`;
        if (seen.has(identity)) throw new CancelReviewActionError(400, "同一批次中任务不能重复");
        seen.add(identity);
        items.push({ type, id, expectedUpdatedAt, expectedAttempt });
    }
    return { batchRequestId, items };
}

function pruneBatches(now: number) {
    for (const [key, entry] of batches) if (entry.expiresAt <= now) batches.delete(key);
    while (batches.size >= MAX_CACHED_BATCHES) batches.delete(batches.keys().next().value!);
}

export function resetCancelReviewBatchCacheForTests() {
    batches.clear();
}