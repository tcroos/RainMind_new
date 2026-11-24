import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), users: vi.fn() }));

vi.mock("@/lib/server/generation-task-store", () => ({ listCancelReviewQueueRecords: mocks.list }));
vi.mock("@/lib/auth/store", () => ({ getPublicUsersByIds: mocks.users }));

import { listCancelReviewQueue } from "./generation-cancel-review-queue";

const SECRET = "sk-live-SECRET-should-never-leak";
const SIGNED = "https://bucket.r2.cloudflarestorage.com/x.mp4?X-Amz-Signature=leak";

function record(patch: Record<string, unknown> = {}) {
    return {
        id: "task-one",
        userId: "user-internal-id",
        type: "image",
        status: "running",
        createdAt: 100,
        updatedAt: 500,
        expiresAt: 9_999_999_999,
        executionPhase: "needs_review",
        lastUpstreamStatus: "cancel_unconfirmed",
        attemptNo: 2,
        channelId: "deepkey-image",
        provider: "openai",
        upstreamTaskId: "upstream-full-id-12345",
        requestedAt: 1_000,
        resultPayload: { cancellationRequestedAt: 1_000, submissionPhase: "submitting", reviewReason: "取消结果尚未确认" },
        payload: {
            config: { apiKey: SECRET, baseUrl: "https://provider.example/v1", headers: { cookie: "session=leak" } },
            prompt: "x".repeat(5_000),
            error: "upstream exploded at https://provider.example/v1?key=" + SECRET,
            billing: { pointsCost: 20, pointsRecordId: "debit-one", refunded: false },
            result: { url: SIGNED },
        },
        ...patch,
    };
}

describe("listCancelReviewQueue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.list.mockResolvedValue({ items: [record()], nextCursor: "next" });
        mocks.users.mockResolvedValue([{ id: "user-internal-id", accountId: "0042", username: "alice", displayName: "Alice" }]);
    });

    it("returns the approved queue fields", async () => {
        const result = await listCancelReviewQueue({});

        expect(result.nextCursor).toBe("next");
        expect(result.items[0]).toEqual({
            taskId: "task-one",
            type: "image",
            user: { accountId: "0042", displayName: "Alice" },
            attemptNo: 2,
            hasUpstreamTaskId: true,
            channelId: "deepkey-image",
            provider: "openai",
            model: null,
            surface: null,
            submissionPhase: "submitting",
            executionPhase: "needs_review",
            lastUpstreamStatus: "cancel_unconfirmed",
            errorSummary: expect.any(String),
            cancellationRequestedAt: 1_000,
            pointsRecordId: "debit-one",
            refundStatus: "not_refunded",
            charged: true,
            chargedAmount: 20,
            hasResult: true,
            lastOperator: null,
            lastOperatedAt: null,
            updatedAt: 500,
        });
    });

    it("never returns secrets, cookies, full config, upstream IDs, signed URLs or long result text", async () => {
        const result = await listCancelReviewQueue({});
        const json = JSON.stringify(result);

        expect(json).not.toContain(SECRET);
        expect(json).not.toContain("session=leak");
        expect(json).not.toContain("provider.example");
        expect(json).not.toContain("upstream-full-id-12345");
        expect(json).not.toContain("X-Amz-Signature");
        expect(json).not.toContain("user-internal-id");
        expect(json).not.toContain("x".repeat(300));
        expect(result.items[0].errorSummary!.length).toBeLessThanOrEqual(240);
    });

    it("reads the video debit from the upstream snapshot", async () => {
        mocks.list.mockResolvedValue({ items: [record({ type: "video", payload: { upstream: { id: "u", pointsRecordId: "video-debit", refunded: true } } })], nextCursor: null });

        const [item] = (await listCancelReviewQueue({})).items;

        expect(item).toMatchObject({ pointsRecordId: "video-debit", refundStatus: "refunded", hasResult: false });
    });

    it("returns model and surface from safe fields only, and charge evidence", async () => {
        mocks.list.mockResolvedValue({ items: [record({ surface: "canvas", payload: { config: { model: "gpt-image-1", apiKey: SECRET, baseUrl: "https://provider.example/v1" } } })], nextCursor: null });

        const [item] = (await listCancelReviewQueue({})).items;

        expect(item).toMatchObject({ model: "gpt-image-1", surface: "canvas", charged: false });
        expect(item).not.toHaveProperty("chargedAmount");
        expect(JSON.stringify(item)).not.toContain(SECRET);
        expect(JSON.stringify(item)).not.toContain("provider.example");
    });

    it("reports no_charge when the task never recorded a debit", async () => {
        mocks.list.mockResolvedValue({ items: [record({ payload: {}, resultPayload: { cancellationRequestedAt: 1_000 } })], nextCursor: null });

        expect((await listCancelReviewQueue({})).items[0]).toMatchObject({ pointsRecordId: null, refundStatus: "no_charge", hasResult: false, errorSummary: null });
    });

    it("falls back to the server-written review reason when the task has no error", async () => {
        mocks.list.mockResolvedValue({ items: [record({ payload: {} })], nextCursor: null });

        expect((await listCancelReviewQueue({})).items[0].errorSummary).toBe("取消结果尚未确认");
    });

    it("treats an object result or provider results as an existing result", async () => {
        mocks.list.mockResolvedValue({ items: [record({ payload: { providerResults: [{ url: "x" }] } }), record({ id: "b", payload: { result: {} } })], nextCursor: null });

        const items = (await listCancelReviewQueue({})).items;
        expect(items.map((item) => item.hasResult)).toEqual([true, false]);
    });

    it("reports a missing upstream ID and an unknown user without exposing internal IDs", async () => {
        mocks.list.mockResolvedValue({ items: [record({ upstreamTaskId: undefined, userId: "ghost" })], nextCursor: null });
        mocks.users.mockResolvedValue([]);

        expect((await listCancelReviewQueue({})).items[0]).toMatchObject({ hasUpstreamTaskId: false, user: null });
    });

    it("shows the last keep_pending reviewer once one is recorded", async () => {
        mocks.list.mockResolvedValue({ items: [record({ resultPayload: { cancellationRequestedAt: 1_000, lastReview: { action: "keep_pending", accountId: "0007", at: "2026-11-05T01:00:00.000Z" } } })], nextCursor: null });

        expect((await listCancelReviewQueue({})).items[0]).toMatchObject({ lastOperator: { accountId: "0007" }, lastOperatedAt: "2026-11-05T01:00:00.000Z" });
    });

    it("passes filters through and looks users up once per page", async () => {
        mocks.list.mockResolvedValue({ items: [record({ id: "a" }), record({ id: "b" })], nextCursor: null });

        await listCancelReviewQueue({ type: "video", executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed", requestedFrom: 1, requestedTo: 2, cursor: "c", limit: 10 });

        expect(mocks.list).toHaveBeenCalledWith({ type: "video", executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed", requestedFrom: 1, requestedTo: 2, cursor: "c", limit: 10 });
        expect(mocks.users).toHaveBeenCalledOnce();
        expect(mocks.users).toHaveBeenCalledWith(["user-internal-id"]);
    });
});