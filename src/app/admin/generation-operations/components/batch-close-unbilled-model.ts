import type { AdminGenerationTask } from "@/lib/admin-generation-operations";

/** Client side of POST /api/admin/generation-operations/batch-confirm-unbilled (#101). */

export const BATCH_CLOSE_UNBILLED_URL = "/api/admin/generation-operations/batch-confirm-unbilled";
export const BATCH_CLOSE_UNBILLED_MAX_ITEMS = 50;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type BatchTask = Pick<AdminGenerationTask, "id" | "type" | "updatedAt" | "attemptNo" | "charged" | "hasResult" | "upstreamTaskId" | "canReview">;

export type BatchCloseItemOutcome = { type: string; id: string; outcome: "applied" | "conflict" | "not_found" | "rejected" | "failed"; reasons?: string[]; message?: string };
export type BatchCloseBatch = { batchRequestId: string; rejected: boolean; items: BatchCloseItemOutcome[]; summary: { applied: number; conflict: number; notFound: number; rejected: number; failed: number } };

export function batchCloseRowKey(task: Pick<AdminGenerationTask, "type" | "id">) {
    return `${task.type}:${task.id}`;
}

/** Why the selection cannot be batch closed; `null` means it can. Mirrors the server rules. */
export function batchCloseBlocker(tasks: readonly BatchTask[]): string | null {
    if (!tasks.length) return "请先勾选任务";
    if (tasks.length > BATCH_CLOSE_UNBILLED_MAX_ITEMS) return `单次最多处理 ${BATCH_CLOSE_UNBILLED_MAX_ITEMS} 条任务`;
    if (tasks.some((task) => !task.canReview)) return "只能关闭待人工确认的任务";
    if (tasks.some((task) => task.charged)) return "选中项包含已扣款任务，请逐条处理";
    if (tasks.some((task) => task.hasResult)) return "选中项包含已有结果的任务";
    if (tasks.some((task) => task.upstreamTaskId)) return "选中项包含已有上游任务 ID 的任务";
    return null;
}

export function batchCloseBody(tasks: readonly BatchTask[], batchRequestId: string) {
    return {
        batchRequestId,
        items: tasks.map((task) => ({ type: task.type, id: task.id, expectedUpdatedAt: task.updatedAt, expectedAttempt: Math.floor(Number(task.attemptNo) || 0) })),
    };
}

export type BatchCloseResult =
    | { kind: "blocked"; message: string }
    | { kind: "applied"; batch: BatchCloseBatch; problems: BatchCloseItemOutcome[] }
    | { kind: "rejected"; message: string; problems: BatchCloseItemOutcome[] }
    | { kind: "conflict"; message: string; problems: BatchCloseItemOutcome[] }
    | { kind: "not_found"; message: string }
    | { kind: "forbidden"; message: string }
    | { kind: "error"; message: string };

export async function submitBatchCloseUnbilled(fetcher: Fetcher, tasks: readonly BatchTask[], createBatchId: () => string = () => crypto.randomUUID()): Promise<BatchCloseResult> {
    const blocker = batchCloseBlocker(tasks);
    if (blocker) return { kind: "blocked", message: blocker };
    let response: Response;
    try {
        response = await fetcher(BATCH_CLOSE_UNBILLED_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batchCloseBody(tasks, createBatchId())) });
    } catch {
        return { kind: "error", message: "操作失败，请检查网络后重试" };
    }
    const payload = (await response.json().catch(() => ({}))) as { data?: BatchCloseBatch | null; msg?: string };
    const batch = payload.data && Array.isArray(payload.data.items) ? payload.data : null;
    const problems = batch ? batch.items.filter((entry) => entry.outcome !== "applied") : [];
    const message = payload.msg || "操作失败";
    if (response.status === 200 && batch) return { kind: "applied", batch, problems };
    if (response.status === 409 && batch?.rejected) return { kind: "rejected", message, problems: problems.filter((entry) => entry.reasons?.length) };
    if (response.status === 409) return { kind: "conflict", message, problems };
    if (response.status === 404) return { kind: "not_found", message };
    if (response.status === 403) return { kind: "forbidden", message };
    return { kind: "error", message };
}

export function batchCloseProblemLabel(entry: BatchCloseItemOutcome) {
    const outcome = { applied: "已关闭", conflict: "状态已变化", not_found: "不存在", rejected: "不可关闭", failed: "失败" }[entry.outcome];
    return entry.message ? `${outcome}：${entry.message}` : outcome;
}
