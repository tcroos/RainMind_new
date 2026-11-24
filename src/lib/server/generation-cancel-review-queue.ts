import { getPublicUsersByIds } from "@/lib/auth/store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { generationTaskChargeEvidence } from "@/lib/server/generation-task-evidence";
import { listCancelReviewQueueRecords, type CancelReviewQueueOptions, type CancelReviewQueueRecord } from "@/lib/server/generation-task-store";

type QueueBilling = { pointsCost?: number; pointsRecordId?: string; refunded?: boolean };

export type CancelReviewQueueItem = {
    taskId: string;
    type: string;
    user: { accountId: string; displayName: string } | null;
    attemptNo: number;
    hasUpstreamTaskId: boolean;
    channelId: string | null;
    provider: string | null;
    model: string | null;
    surface: string | null;
    submissionPhase: string | null;
    executionPhase: string | null;
    lastUpstreamStatus: string | null;
    errorSummary: string | null;
    cancellationRequestedAt: number;
    pointsRecordId: string | null;
    refundStatus: "refunded" | "not_refunded" | "no_charge";
    charged: boolean;
    chargedAmount?: number;
    hasResult: boolean;
    lastOperator: { accountId: string } | null;
    lastOperatedAt: string | null;
    updatedAt: number;
};

/**
 * Read-only view of the cancel review queue (BUG-091 stage 1).
 *
 * Deliberately narrow: only the fields an administrator needs to decide whether a task may be
 * rechecked later. Provider config, cookies, upstream task IDs, signed media URLs and prompt or
 * result text never leave the server, and error text is routed through the shared redactor.
 */
export async function listCancelReviewQueue(options: CancelReviewQueueOptions): Promise<{ items: CancelReviewQueueItem[]; nextCursor: string | null }> {
    const page = await listCancelReviewQueueRecords(options);
    const userIds = Array.from(new Set(page.items.map((record) => record.userId)));
    const users = userIds.length ? await getPublicUsersByIds(userIds) : [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    return {
        items: page.items.map((record) => queueItem(record, usersById.get(record.userId))),
        nextCursor: page.nextCursor,
    };
}

function queueItem(record: CancelReviewQueueRecord, user?: { accountId: string; displayName: string }): CancelReviewQueueItem {
    const billing = billingOf(record);
    const error = textOf(record.payload?.error) || textOf(record.resultPayload?.reviewReason);
    const prior = auditFields(record.resultPayload);
    const charge = generationTaskChargeEvidence(record);
    return {
        taskId: record.id,
        type: record.type,
        user: user ? { accountId: user.accountId, displayName: user.displayName } : null,
        attemptNo: Math.floor(Number(record.attemptNo) || 0),
        hasUpstreamTaskId: Boolean(record.upstreamTaskId || textOf(record.payload?.upstream && (record.payload.upstream as { id?: unknown }).id)),
        channelId: record.channelId || null,
        provider: record.provider || null,
        model: modelOf(record),
        surface: record.surface || null,
        submissionPhase: textOf(record.resultPayload?.submissionPhase) || null,
        executionPhase: record.executionPhase || null,
        lastUpstreamStatus: record.lastUpstreamStatus || null,
        errorSummary: error ? toSafeGenerationErrorMessage(error, "任务处理失败").slice(0, 240) || null : null,
        cancellationRequestedAt: record.requestedAt,
        pointsRecordId: billing.pointsRecordId || null,
        refundStatus: billing.refunded ? "refunded" : billing.pointsRecordId ? "not_refunded" : "no_charge",
        charged: charge.charged,
        ...(charge.amount !== undefined ? { chargedAmount: charge.amount } : {}),
        hasResult: hasResult(record),
        lastOperator: prior.accountId ? { accountId: prior.accountId } : null,
        lastOperatedAt: prior.at,
        updatedAt: record.updatedAt,
    };
}

function billingOf(record: CancelReviewQueueRecord): QueueBilling {
    const payload = record.payload || {};
    const billing = (record.type === "video" ? payload.upstream : payload.billing) as QueueBilling | undefined;
    return billing && typeof billing === "object" ? billing : {};
}

/** Only model identifiers; never baseUrl, apiKey or other config. */
function modelOf(record: CancelReviewQueueRecord) {
    const payload = record.payload || {};
    const config = (payload.config && typeof payload.config === "object" ? payload.config : {}) as Record<string, unknown>;
    return [payload.logicalModelId, config.logicalModelId, payload.model, config.model, config.imageModel, config.videoModel, config.audioModel].map(textOf).find(Boolean) || null;
}

function hasResult(record: CancelReviewQueueRecord) {
    const payload = record.payload || {};
    return [payload.result, payload.providerResults, record.resultPayload?.url, record.resultPayload?.lateResult, record.resultPayload?.lateWorkerEvidence].some(hasEvidence);
}

function hasEvidence(value: unknown): boolean {
    if (typeof value === "string") return Boolean(value.trim());
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return false;
}

function auditFields(resultPayload?: Record<string, unknown>) {
    const review = resultPayload?.lastReview;
    if (!review || typeof review !== "object") return { accountId: "", at: null as string | null };
    const value = review as { accountId?: unknown; at?: unknown };
    return { accountId: textOf(value.accountId), at: typeof value.at === "string" ? value.at : null };
}

function textOf(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}