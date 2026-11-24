/**
 * Client-safe contract and request helpers for the cancel review queue page (BUG-091 stage 3a).
 *
 * Mirrors the shape returned by `src/lib/server/generation-cancel-review-queue.ts` without importing
 * server code into the browser bundle. The test file pins the two types together.
 */

export const CANCEL_REVIEW_TASK_TYPES = ["image", "video", "audio", "text"] as const;
export type CancelReviewTaskType = (typeof CANCEL_REVIEW_TASK_TYPES)[number];

export const KEEP_PENDING_MAX_ITEMS = 50;
export const CANCEL_REVIEW_DEFAULT_PAGE_SIZE = 20;

export const CANCEL_REVIEW_QUEUE_URL = "/api/admin/generation-operations/cancel-review";
export const CANCEL_REVIEW_KEEP_PENDING_URL = "/api/admin/generation-operations/cancel-review/keep-pending";

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

export type CancelReviewFilters = {
    type?: string;
    executionPhase?: string;
    lastUpstreamStatus?: string;
    requestedFrom?: number;
    requestedTo?: number;
};

export function cancelReviewRowKey(item: Pick<CancelReviewQueueItem, "type" | "taskId">) {
    return `${item.type}:${item.taskId}`;
}

export function cancelReviewQueueQuery(filters: CancelReviewFilters, cursor: string | null, limit: number) {
    const query = new URLSearchParams();
    if (filters.type) query.set("type", filters.type);
    if (filters.executionPhase) query.set("executionPhase", filters.executionPhase);
    if (filters.lastUpstreamStatus) query.set("lastUpstreamStatus", filters.lastUpstreamStatus);
    if (filters.requestedFrom) query.set("requestedFrom", String(filters.requestedFrom));
    if (filters.requestedTo) query.set("requestedTo", String(filters.requestedTo));
    if (cursor) query.set("cursor", cursor);
    query.set("limit", String(limit));
    return query;
}

/** Keyset pagination: the last entry is the cursor of the current page, `null` is the first page. */
export type CursorStack = readonly (string | null)[];
export const INITIAL_CURSOR_STACK: CursorStack = [null];
export const currentCursor = (stack: CursorStack) => stack[stack.length - 1] ?? null;
export const pushCursor = (stack: CursorStack, next: string): CursorStack => [...stack, next];
export const popCursor = (stack: CursorStack): CursorStack => (stack.length > 1 ? stack.slice(0, -1) : stack);

export type QueuePaging = { filters: CancelReviewFilters; stack: CursorStack };
export type QueuePagingAction = { type: "filters"; filters: CancelReviewFilters } | { type: "next"; cursor: string } | { type: "previous" } | { type: "reset" };

/** Every filter change and every invalid cursor goes back to the first page. */
export function queuePagingReducer(state: QueuePaging, action: QueuePagingAction): QueuePaging {
    if (action.type === "filters") return { filters: action.filters, stack: INITIAL_CURSOR_STACK };
    if (action.type === "next") return { ...state, stack: pushCursor(state.stack, action.cursor) };
    if (action.type === "previous") return { ...state, stack: popCursor(state.stack) };
    return { ...state, stack: INITIAL_CURSOR_STACK };
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Envelope<T> = { code?: number; data?: T | null; msg?: string };

export type QueueLoadResult =
    | { kind: "ok"; items: CancelReviewQueueItem[]; nextCursor: string | null }
    | { kind: "forbidden"; message: string }
    | { kind: "cursor_invalid"; message: string }
    | { kind: "error"; message: string };

export async function loadCancelReviewQueue(fetcher: Fetcher, filters: CancelReviewFilters, cursor: string | null, limit: number): Promise<QueueLoadResult> {
    let response: Response;
    try {
        response = await fetcher(`${CANCEL_REVIEW_QUEUE_URL}?${cancelReviewQueueQuery(filters, cursor, limit)}`, { cache: "no-store" });
    } catch {
        return { kind: "error", message: "待核查队列读取失败，请检查网络后重试" };
    }
    const payload = await readEnvelope<{ items?: CancelReviewQueueItem[]; nextCursor?: string | null }>(response);
    if (response.status === 403) return { kind: "forbidden", message: payload.msg || "没有生成运维权限" };
    if (response.status === 400 && cursor) return { kind: "cursor_invalid", message: "队列已变化，请刷新" };
    if (!response.ok || !payload.data || !Array.isArray(payload.data.items)) return { kind: "error", message: payload.msg || "待核查队列读取失败" };
    return { kind: "ok", items: payload.data.items, nextCursor: payload.data.nextCursor || null };
}

export type KeepPendingOutcome = { type: string; id: string; outcome: "applied" | "conflict" | "not_found"; updatedAt?: number };
export type KeepPendingBatch = { batchRequestId: string; items: KeepPendingOutcome[]; summary: { applied: number; conflict: number; notFound: number } };

export type KeepPendingResult =
    | { kind: "empty" }
    | { kind: "too_many"; max: number }
    | { kind: "applied"; batch: KeepPendingBatch; conflicts: KeepPendingOutcome[] }
    | { kind: "conflict"; batch: KeepPendingBatch | null; conflicts: KeepPendingOutcome[] }
    | { kind: "not_found"; message: string }
    | { kind: "forbidden"; message: string }
    | { kind: "error"; message: string };

export function keepPendingBody(items: readonly CancelReviewQueueItem[], batchRequestId: string) {
    return {
        batchRequestId,
        action: "keep_pending" as const,
        items: items.map((item) => ({ type: item.type, id: item.taskId, expectedUpdatedAt: item.updatedAt, expectedAttempt: item.attemptNo })),
    };
}

export async function submitKeepPending(fetcher: Fetcher, items: readonly CancelReviewQueueItem[], createBatchId: () => string = () => crypto.randomUUID()): Promise<KeepPendingResult> {
    if (!items.length) return { kind: "empty" };
    if (items.length > KEEP_PENDING_MAX_ITEMS) return { kind: "too_many", max: KEEP_PENDING_MAX_ITEMS };
    let response: Response;
    try {
        response = await fetcher(CANCEL_REVIEW_KEEP_PENDING_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(keepPendingBody(items, createBatchId())),
        });
    } catch {
        return { kind: "error", message: "操作失败，请检查网络后重试" };
    }
    const payload = await readEnvelope<KeepPendingBatch>(response);
    const batch = payload.data && Array.isArray(payload.data.items) ? payload.data : null;
    const conflicts = batch ? batch.items.filter((entry) => entry.outcome === "conflict") : [];
    if (response.status === 200 && batch) return { kind: "applied", batch, conflicts };
    if (response.status === 409) return { kind: "conflict", batch, conflicts };
    if (response.status === 404) return { kind: "not_found", message: payload.msg || "任务不存在或已过期" };
    if (response.status === 403) return { kind: "forbidden", message: payload.msg || "没有生成运维权限" };
    return { kind: "error", message: payload.msg || "操作失败" };
}

async function readEnvelope<T>(response: Response): Promise<Envelope<T>> {
    try {
        const value = (await response.json()) as unknown;
        return value && typeof value === "object" ? (value as Envelope<T>) : {};
    } catch {
        return {};
    }
}

export function cancelReviewTypeLabel(value: string) {
    return ({ image: "图片", video: "视频", audio: "音频", text: "文本" } as Record<string, string>)[value] || value;
}

export function cancelReviewRefundLabel(value: CancelReviewQueueItem["refundStatus"]) {
    return { refunded: "已退款", not_refunded: "未退款", no_charge: "未扣费" }[value] || value;
}

export function cancelReviewUpstreamStatusLabel(value: string | null) {
    if (!value) return "未记录";
    return ({ cancel_unconfirmed: "取消未确认" } as Record<string, string>)[value] || value;
}

export function formatCancelReviewTime(value: number | string | null | undefined) {
    if (value === null || value === undefined || value === "") return "未记录";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未记录";
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
