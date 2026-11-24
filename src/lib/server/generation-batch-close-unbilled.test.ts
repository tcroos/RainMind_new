import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getRecord: vi.fn(), review: vi.fn(), audit: vi.fn(), forbidden: vi.fn() }));

vi.mock("@/lib/server/generation-task-store", () => ({ getStoredGenerationTaskRecord: mocks.getRecord }));
vi.mock("@/lib/server/audit-log-store", () => ({ safeRecordAuditLog: mocks.audit }));
vi.mock("@/lib/server/generation-task-review-service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/server/generation-task-review-service")>()),
    reviewGenerationTask: mocks.review,
}));
// Batch close must never reach a refund module.
vi.mock("@/lib/server/image-task-refund", () => ({ refundImageTask: mocks.forbidden }));
vi.mock("@/lib/server/audio-task-refund", () => ({ refundAudioTask: mocks.forbidden }));
vi.mock("@/lib/server/video-task-refund", () => ({ refundVideoTask: mocks.forbidden }));
vi.mock("@/lib/server/points-wallet-service", () => ({ refundGenerationTaskPoints: mocks.forbidden }));

import { GenerationTaskReviewError } from "@/lib/server/generation-task-review-service";

import { BATCH_CLOSE_UNBILLED_REASON, BatchCloseUnbilledError, closeUnbilledReviewTasks, resetBatchCloseUnbilledCacheForTests } from "./generation-batch-close-unbilled";

const actor = { id: "admin-one", role: "admin" as const };
const BATCH = "11111111-2222-4333-8444-555555555555";

type Record = { id: string; type: string; status: string; executionPhase: string; updatedAt: number; attemptNo: number; upstreamTaskId?: string; payload: { [key: string]: unknown }; resultPayload?: { [key: string]: unknown } };

function record(id: string, patch: Partial<Record> = {}): Record {
    return { id, type: "image", status: "running", executionPhase: "needs_review", updatedAt: 500, attemptNo: 1, payload: {}, resultPayload: {}, ...patch };
}

function item(id: string, patch: { [key: string]: unknown } = {}) {
    return { type: "image", id, expectedUpdatedAt: 500, expectedAttempt: 1, ...patch };
}

function useRecords(...records: Record[]) {
    const byId = new Map(records.map((entry) => [entry.id, entry]));
    mocks.getRecord.mockImplementation(async (_type: string, id: string) => byId.get(id) || null);
}

describe("closeUnbilledReviewTasks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetBatchCloseUnbilledCacheForTests();
        mocks.review.mockResolvedValue({ action: "confirm_failed", executionPhase: "completed" });
    });

    it("closes uncharged tasks through confirm_failed with the CAS tokens", async () => {
        useRecords(record("a"), record("b", { type: "video", attemptNo: 0, updatedAt: 42 }));

        const result = await closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("a"), item("b", { type: "video", expectedAttempt: 0, expectedUpdatedAt: 42 })] }, actor);

        expect(result.rejected).toBe(false);
        expect(result.summary).toMatchObject({ applied: 2, conflict: 0, notFound: 0, rejected: 0 });
        expect(mocks.review).toHaveBeenCalledWith("image", "a", { action: "confirm_failed", reason: BATCH_CLOSE_UNBILLED_REASON }, { expected: { updatedAt: 500, attemptNo: 1 }, requireUnbilled: true });
        expect(mocks.review).toHaveBeenCalledWith("video", "b", { action: "confirm_failed", reason: BATCH_CLOSE_UNBILLED_REASON }, { expected: { updatedAt: 42, attemptNo: 0 }, requireUnbilled: true });
        expect(mocks.forbidden).not.toHaveBeenCalled();
    });

    it("rejects the whole batch when one task is charged, and never refunds", async () => {
        useRecords(record("a"), record("charged", { payload: { billing: { pointsCost: 12, pointsRecordId: "points-1", refunded: false } } }));

        const result = await closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("a"), item("charged")] }, actor);

        expect(result.rejected).toBe(true);
        expect(result.items).toEqual([
            { type: "image", id: "a", outcome: "rejected", message: "同批次中有不可关闭的任务，整批未执行" },
            { type: "image", id: "charged", outcome: "rejected", reasons: ["charged"], message: "已扣款" },
        ]);
        expect(mocks.review).not.toHaveBeenCalled();
        expect(mocks.forbidden).not.toHaveBeenCalled();
    });

    it("treats a points record or a positive video upstream cost as charged", async () => {
        useRecords(record("rec", { payload: { billing: { pointsRecordId: "p" } } }), record("vid", { type: "video", payload: { upstream: { pointsCost: 3 } } }));

        const result = await closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("rec"), item("vid", { type: "video" })] }, actor);

        expect(result.items.map((entry) => entry.reasons)).toEqual([["charged"], ["charged"]]);
        expect(mocks.review).not.toHaveBeenCalled();
    });

    it("rejects tasks with a result or an upstream ID with per-item reasons", async () => {
        useRecords(
            record("result", { resultPayload: { url: "https://cdn.example/a.png" } }),
            record("upstream", { upstreamTaskId: "up-1" }),
            record("payload-upstream", { payload: { upstream: { id: "up-2" } } }),
            record("success", { status: "success" }),
        );

        const result = await closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("result"), item("upstream"), item("payload-upstream"), item("success")] }, actor);

        expect(result.rejected).toBe(true);
        expect(result.items.map((entry) => entry.reasons)).toEqual([["has_result"], ["has_upstream_id"], ["has_upstream_id"], ["has_result"]]);
        expect(mocks.review).not.toHaveBeenCalled();
    });

    it("reports a mixed batch item by item without writing anything", async () => {
        useRecords(record("ok"), record("charged", { payload: { billing: { pointsCost: 5 } } }), record("upstream", { upstreamTaskId: "u" }));

        const result = await closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("ok"), item("charged"), item("upstream"), item("missing")] }, actor);

        expect(result.rejected).toBe(true);
        expect(result.items.map((entry) => [entry.id, entry.outcome, entry.reasons])).toEqual([
            ["ok", "rejected", undefined],
            ["charged", "rejected", ["charged"]],
            ["upstream", "rejected", ["has_upstream_id"]],
            ["missing", "not_found", undefined],
        ]);
        expect(mocks.review).not.toHaveBeenCalled();
    });

    it("reports CAS conflicts and missing tasks without blocking the rest", async () => {
        useRecords(record("ok"), record("moved", { updatedAt: 999 }), record("attempt", { attemptNo: 2 }), record("phase", { executionPhase: "completed" }), record("race"));
        mocks.review.mockImplementation(async (_type: string, id: string) => {
            if (id === "race") throw new GenerationTaskReviewError(409, "任务状态已被其他操作更新，请刷新后重试");
            return { action: "confirm_failed", executionPhase: "completed" };
        });

        const result = await closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("ok"), item("moved"), item("attempt"), item("phase"), item("race"), item("gone")] }, actor);

        expect(result.rejected).toBe(false);
        expect(result.items.map((entry) => [entry.id, entry.outcome])).toEqual([
            ["ok", "applied"],
            ["moved", "conflict"],
            ["attempt", "conflict"],
            ["phase", "conflict"],
            ["race", "conflict"],
            ["gone", "not_found"],
        ]);
        expect(result.summary).toMatchObject({ applied: 1, conflict: 4, notFound: 1 });
        expect(mocks.review).toHaveBeenCalledTimes(2);
    });

    it("writes one audit entry per item, including rejected batches", async () => {
        useRecords(record("a"), record("b"));
        await closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("a"), item("b")] }, actor);
        expect(mocks.audit).toHaveBeenCalledTimes(2);
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.generation_task.batch_close_unbilled", status: "success", target: { type: "generation_task", id: "a" }, metadata: expect.objectContaining({ batchRequestId: BATCH, index: 0, outcome: "applied" }) }));

        vi.clearAllMocks();
        resetBatchCloseUnbilledCacheForTests();
        useRecords(record("a"), record("c", { payload: { billing: { pointsRecordId: "p" } } }));
        await closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("a"), item("c")] }, actor);
        expect(mocks.audit).toHaveBeenCalledTimes(2);
        expect(mocks.audit.mock.calls.every(([entry]) => entry.status === "failure" && entry.metadata.batchRejected === true)).toBe(true);
    });

    it("replays the same batch id without running again and refuses reuse for other items", async () => {
        useRecords(record("a"), record("b"));
        const first = await closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("a")] }, actor);
        const second = await closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("a")] }, actor);
        expect(second).toBe(first);
        expect(mocks.review).toHaveBeenCalledTimes(1);
        await expect(closeUnbilledReviewTasks({ batchRequestId: BATCH, items: [item("b")] }, actor)).rejects.toMatchObject({ status: 400 });
    });

    it("validates the request before reading any task", async () => {
        const cases: unknown[] = [
            { batchRequestId: "not-a-uuid", items: [item("a")] },
            { batchRequestId: BATCH, items: [] },
            { batchRequestId: BATCH, items: Array.from({ length: 51 }, (_, index) => item(`t${index}`)) },
            { batchRequestId: BATCH, items: [item("a", { type: "agent" })] },
            { batchRequestId: BATCH, items: [item("a", { expectedUpdatedAt: undefined })] },
            { batchRequestId: BATCH, items: [item("a", { expectedAttempt: undefined })] },
            { batchRequestId: BATCH, items: [item("a"), item("a")] },
            { batchRequestId: BATCH, action: "refund", items: [item("a")] },
        ];
        for (const body of cases) await expect(closeUnbilledReviewTasks(body, actor)).rejects.toBeInstanceOf(BatchCloseUnbilledError);
        expect(mocks.getRecord).not.toHaveBeenCalled();
        expect(mocks.review).not.toHaveBeenCalled();
    });
});
