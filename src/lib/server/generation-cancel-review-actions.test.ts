import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ keepPending: vi.fn(), getRecord: vi.fn(), audit: vi.fn(), forbidden: vi.fn() }));

vi.mock("@/lib/server/generation-task-scheduler", () => ({ recordCancelReviewKeepPending: mocks.keepPending }));
vi.mock("@/lib/server/generation-task-store", () => ({ getStoredGenerationTaskRecord: mocks.getRecord }));
vi.mock("@/lib/server/audit-log-store", () => ({ safeRecordAuditLog: mocks.audit }));
// keep_pending must never reach a refund, a task creation or a worker handoff.
vi.mock("@/lib/server/image-task-refund", () => ({ refundImageTask: mocks.forbidden }));
vi.mock("@/lib/server/video-task-refund", () => ({ refundVideoTask: mocks.forbidden }));
vi.mock("@/lib/server/points-wallet-service", () => ({ refundGenerationTaskPoints: mocks.forbidden }));

import { CancelReviewActionError, keepCancelReviewPending, resetCancelReviewBatchCacheForTests } from "./generation-cancel-review-actions";

const actor = { id: "admin-one", role: "admin" as const };
const reviewer = { accountId: "0001" };
const BATCH = "11111111-2222-4333-8444-555555555555";

function item(id: string, patch: Record<string, unknown> = {}) {
    return { type: "image", id, expectedUpdatedAt: 500, expectedAttempt: 1, ...patch };
}

describe("keepCancelReviewPending", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetCancelReviewBatchCacheForTests();
        mocks.keepPending.mockResolvedValue({ updatedAt: 1_000 });
        mocks.getRecord.mockResolvedValue({ id: "exists" });
    });

    it("applies keep_pending per item and returns the new token", async () => {
        const result = await keepCancelReviewPending({ batchRequestId: BATCH, action: "keep_pending", items: [item("a"), item("b")] }, actor, reviewer);

        expect(result.summary).toEqual({ applied: 2, conflict: 0, notFound: 0 });
        expect(result.items).toEqual([
            { type: "image", id: "a", outcome: "applied", updatedAt: 1_000 },
            { type: "image", id: "b", outcome: "applied", updatedAt: 1_000 },
        ]);
        expect(mocks.keepPending).toHaveBeenCalledWith("image", "a", { updatedAt: 500, attemptNo: 1 }, { accountId: "0001", at: expect.any(String) });
    });

    it("never refunds, creates or schedules anything", async () => {
        mocks.keepPending.mockResolvedValueOnce({ updatedAt: 1_000 }).mockResolvedValueOnce(null);

        await keepCancelReviewPending({ batchRequestId: BATCH, action: "keep_pending", items: [item("a"), item("b")] }, actor, reviewer);

        expect(mocks.forbidden).not.toHaveBeenCalled();
    });

    it("reports a partial conflict per item without undoing the others", async () => {
        mocks.keepPending.mockResolvedValueOnce({ updatedAt: 1_000 }).mockResolvedValueOnce(null).mockResolvedValueOnce({ updatedAt: 1_001 });

        const result = await keepCancelReviewPending({ batchRequestId: BATCH, action: "keep_pending", items: [item("a"), item("b"), item("c")] }, actor, reviewer);

        expect(result.summary).toEqual({ applied: 2, conflict: 1, notFound: 0 });
        expect(result.items.map((entry) => entry.outcome)).toEqual(["applied", "conflict", "applied"]);
    });

    it("distinguishes a missing task from a conflicting one", async () => {
        mocks.keepPending.mockResolvedValue(null);
        mocks.getRecord.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "b" });

        const result = await keepCancelReviewPending({ batchRequestId: BATCH, action: "keep_pending", items: [item("a"), item("b")] }, actor, reviewer);

        expect(result.items.map((entry) => entry.outcome)).toEqual(["not_found", "conflict"]);
        expect(result.summary).toEqual({ applied: 0, conflict: 1, notFound: 1 });
    });

    it("audits every item, success and failure, without upstream IDs or free text", async () => {
        mocks.keepPending.mockResolvedValueOnce({ updatedAt: 1_000 }).mockResolvedValueOnce(null);

        await keepCancelReviewPending({ batchRequestId: BATCH, action: "keep_pending", items: [item("a"), item("b", { note: "see https://x?token=leak" })] }, actor, reviewer);

        expect(mocks.audit).toHaveBeenCalledTimes(2);
        expect(mocks.audit).toHaveBeenNthCalledWith(1, {
            action: "admin.generation_task.cancel_review.keep_pending",
            status: "success",
            actor,
            target: { type: "generation_task", id: "a" },
            metadata: { taskType: "image", batchRequestId: BATCH, index: 0, outcome: "applied" },
        });
        expect(mocks.audit).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "failure", target: { type: "generation_task", id: "b" }, metadata: expect.objectContaining({ outcome: "conflict", index: 1 }) }));
        expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("token=leak");
    });

    it("returns the first result for a replayed batchRequestId without re-executing or re-auditing", async () => {
        const request = { batchRequestId: BATCH, action: "keep_pending", items: [item("a")] };

        const first = await keepCancelReviewPending(request, actor, reviewer);
        const replay = await keepCancelReviewPending(request, actor, reviewer);

        expect(replay).toEqual(first);
        expect(mocks.keepPending).toHaveBeenCalledOnce();
        expect(mocks.audit).toHaveBeenCalledOnce();
    });

    it("dedupes a concurrent duplicate batch into a single execution", async () => {
        const request = { batchRequestId: BATCH, action: "keep_pending", items: [item("a")] };

        const [one, two] = await Promise.all([keepCancelReviewPending(request, actor, reviewer), keepCancelReviewPending(request, actor, reviewer)]);

        expect(one).toEqual(two);
        expect(mocks.keepPending).toHaveBeenCalledOnce();
    });

    it("rejects a reused batchRequestId carrying different items", async () => {
        await keepCancelReviewPending({ batchRequestId: BATCH, action: "keep_pending", items: [item("a")] }, actor, reviewer);

        await expect(keepCancelReviewPending({ batchRequestId: BATCH, action: "keep_pending", items: [item("b")] }, actor, reviewer)).rejects.toMatchObject({ status: 409 });
        expect(mocks.keepPending).toHaveBeenCalledOnce();
    });

    it("scopes idempotency per administrator", async () => {
        const request = { batchRequestId: BATCH, action: "keep_pending", items: [item("a")] };
        await keepCancelReviewPending(request, actor, reviewer);
        await keepCancelReviewPending(request, { id: "admin-two", role: "admin" }, { accountId: "0002" });
        expect(mocks.keepPending).toHaveBeenCalledTimes(2);
    });

    it.each([
        ["confirm_failed"],
        ["refund"],
        ["confirm_upstream_terminal"],
        ["recheck"],
    ])("rejects a batch whose action is %s with 400 and executes nothing", async (action) => {
        await expect(keepCancelReviewPending({ batchRequestId: BATCH, action, items: [item("a")] }, actor, reviewer)).rejects.toMatchObject({ status: 400 });
        expect(mocks.keepPending).not.toHaveBeenCalled();
    });

    it("rejects the whole batch with 400 when any item asks for a refund or conclusion", async () => {
        await expect(keepCancelReviewPending({ batchRequestId: BATCH, action: "keep_pending", items: [item("a"), item("b", { action: "refund" })] }, actor, reviewer)).rejects.toMatchObject({ status: 400 });
        expect(mocks.keepPending).not.toHaveBeenCalled();
    });

    it("audits a rejected refund attempt once", async () => {
        await keepCancelReviewPending({ batchRequestId: BATCH, action: "refund", items: [item("a")] }, actor, reviewer).catch(() => undefined);
        expect(mocks.audit).toHaveBeenCalledOnce();
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.generation_task.cancel_review.keep_pending", status: "failure", metadata: expect.objectContaining({ rejectedAction: "refund", itemCount: 1 }) }));
    });

    it.each([
        ["no batchRequestId", { action: "keep_pending", items: [item("a")] }],
        ["a malformed batchRequestId", { batchRequestId: "not-a-uuid", action: "keep_pending", items: [item("a")] }],
        ["an empty batch", { batchRequestId: BATCH, action: "keep_pending", items: [] }],
        ["more than 50 items", { batchRequestId: BATCH, action: "keep_pending", items: Array.from({ length: 51 }, (_, index) => item(`t${index}`)) }],
        ["a duplicate task", { batchRequestId: BATCH, action: "keep_pending", items: [item("a"), item("a")] }],
        ["a missing updatedAt token", { batchRequestId: BATCH, action: "keep_pending", items: [item("a", { expectedUpdatedAt: undefined })] }],
        ["an unsupported task type", { batchRequestId: BATCH, action: "keep_pending", items: [item("a", { type: "agent" })] }],
    ])("rejects %s with 400", async (_label, body) => {
        await expect(keepCancelReviewPending(body, actor, reviewer)).rejects.toBeInstanceOf(CancelReviewActionError);
        await expect(keepCancelReviewPending(body, actor, reviewer)).rejects.toMatchObject({ status: 400 });
        expect(mocks.keepPending).not.toHaveBeenCalled();
    });
});