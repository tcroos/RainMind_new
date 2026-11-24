import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getImageTask: vi.fn(),
    getVideoTask: vi.fn(),
    getAudioTask: vi.fn(),
    getTextTask: vi.fn(),
    getStoredGenerationTaskRecord: vi.fn(),
    getDatabaseProvider: vi.fn(() => "file"),
    readAuthDb: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/image-task-store", () => ({ getImageTask: mocks.getImageTask }));
vi.mock("@/lib/server/video-task-store", () => ({ getVideoTask: mocks.getVideoTask }));
vi.mock("@/lib/server/audio-task-store", () => ({ getAudioTask: mocks.getAudioTask }));
vi.mock("@/lib/server/text-task-store", () => ({ getTextTask: mocks.getTextTask }));
vi.mock("@/lib/server/generation-task-store", () => ({ getStoredGenerationTaskRecord: mocks.getStoredGenerationTaskRecord }));
vi.mock("@/lib/server/database", () => ({ getDatabaseProvider: mocks.getDatabaseProvider }));
vi.mock("@/lib/auth/store-repository", () => ({ readAuthDb: mocks.readAuthDb }));

import { GET } from "./route";

function context(kind: string, id: string) {
    return { params: Promise.resolve({ kind, id }) };
}

function request() {
    return new Request("http://localhost/api/generation-tasks/image/task-a", { headers: { cookie: "session" } });
}

describe("unified generation task read contract", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-a", role: "user" });
        mocks.getStoredGenerationTaskRecord.mockResolvedValue({ payload: { progressPercent: 42 } });
        mocks.getImageTask.mockResolvedValue({
            id: "task-a",
            userId: "user-a",
            status: "error",
            error: "上游超时",
            result: null,
            billing: { pointsCost: 4, refunded: true },
        });
        mocks.readAuthDb.mockResolvedValue({ pointRecords: [] });
    });

    it("returns the common task shape with structured result, power and refund status", async () => {
        const response = await GET(request(), context("image", "task-a"));
        const body = await response.json() as { ok: boolean; data: { task: Record<string, unknown> }; traceId: string };
        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.traceId).toEqual(expect.any(String));
        expect(body.data.task).toMatchObject({ id: "task-a", kind: "image", status: "error", progressPercent: 42, power: 4, error: "上游超时", refundStatus: "refunded", billed: true });
    });

    it("marks confirmed terminal failures without billing as unbilled and leaves nonterminal billing unknown", async () => {
        mocks.getImageTask.mockResolvedValue({ id: "task-a", userId: "user-a", status: "error", billing: undefined, upstream: undefined });
        const failed = await (await GET(request(), context("image", "task-a"))).json();
        expect(failed.data.task.billed).toBe(false);

        mocks.getImageTask.mockResolvedValue({ id: "task-a", userId: "user-a", status: "running" });
        const running = await (await GET(request(), context("image", "task-a"))).json();
        expect(running.data.task).not.toHaveProperty("billed");

        mocks.getImageTask.mockResolvedValue({ id: "task-a", userId: "user-a", status: "success" });
        const success = await (await GET(request(), context("image", "task-a"))).json();
        expect(success.data.task.billed).toBe(true);
    });

    it("treats a bare upstream object with no charge evidence as unbilled on terminal failure", async () => {
        mocks.getImageTask.mockResolvedValue({ id: "task-a", userId: "user-a", status: "error", billing: undefined, upstream: {} });
        const noEvidence = await (await GET(request(), context("image", "task-a"))).json();
        expect(noEvidence.data.task.billed).toBe(false);

        mocks.getImageTask.mockResolvedValue({ id: "task-a", userId: "user-a", status: "error", billing: undefined, upstream: { pointsCost: 4 } });
        const withCost = await (await GET(request(), context("image", "task-a"))).json();
        expect(withCost.data.task.billed).toBe(true);
    });

    it("does not expose another user's task", async () => {
        mocks.getImageTask.mockResolvedValue({ id: "task-a", userId: "user-b", status: "success" });
        const response = await GET(request(), context("image", "task-a"));
        expect(response.status).toBe(404);
        expect((await response.json()).error).toMatchObject({ code: "TASK_NOT_FOUND" });
    });

    it("rejects unknown kinds", async () => {
        const response = await GET(request(), context("unknown", "task-a"));
        expect(response.status).toBe(400);
    });

    it("returns 401 without a session", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await GET(request(), context("image", "task-a"));
        expect(response.status).toBe(401);
    });

    it("advertises display-only reads and logs the response traceId without settling billing", async () => {
        const log = vi.spyOn(console, "info").mockImplementation(() => {});
        const response = await GET(request(), context("image", "task-a"));
        const body = await response.json();
        expect(body.data).toMatchObject({ readOnly: true, settlementRequired: true });
        expect(log).toHaveBeenCalledWith("Generation task contract", { traceId: body.traceId, operation: "read", status: 200 });
        expect(response.headers.get("x-trace-id")).toBe(body.traceId);
        log.mockRestore();
    });

    it("preserves needsReview and taskId and rejects oversized ids before querying", async () => {
        mocks.getStoredGenerationTaskRecord.mockResolvedValue({ executionPhase: "needs_review" });
        expect((await (await GET(request(), context("image", "task-a"))).json()).data.task).toMatchObject({ taskId: "task-a", needsReview: true });
        mocks.getImageTask.mockClear();
        expect((await GET(request(), context("image", "a".repeat(161)))).status).toBe(400);
        expect(mocks.getImageTask).not.toHaveBeenCalled();
    });

    it("preserves the stored structured text result", async () => {
        mocks.getTextTask.mockResolvedValue({ id: "text", userId: "user-a", status: "success", result: { content: "answer" } });
        expect((await (await GET(request(), context("text", "text"))).json()).data.task.result).toEqual({ content: "answer" });
    });

    it("exposes authoritative ledger fields only to admins", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin" });
        mocks.getImageTask.mockResolvedValue({ id: "task-a", userId: "user-a", status: "error", billing: { pointsCost: 4, pointsRecordId: "consume-a" } });
        mocks.readAuthDb.mockResolvedValue({ pointRecords: [
            { id: "consume-a", userId: "user-a", type: "consume", amount: -4 },
            { id: "refund-a", userId: "user-a", type: "refund", amount: 4, sourceRecordId: "consume-a" },
        ] });
        const body = await (await GET(request(), context("image", "task-a"))).json();
        expect(body.data.task.billing).toMatchObject({ originalPoints: 4, refundedPoints: 4, refundRecordId: "refund-a", refundStatus: "refunded", unrestoredPoints: 0 });
        expect(body.data.task.billing).not.toHaveProperty("idempotencyKey");
    });

    it("reports a snapshot refund with no matching ledger refund as unknown", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin" });
        mocks.getImageTask.mockResolvedValue({ id: "task-a", userId: "user-a", status: "error", billing: { pointsCost: 4, pointsRecordId: "consume-a", refunded: true } });
        mocks.readAuthDb.mockResolvedValue({ pointRecords: [{ id: "consume-a", userId: "user-a", type: "consume", amount: -4 }] });
        const body = await (await GET(request(), context("image", "task-a"))).json();
        expect(body.data.task.billing).toMatchObject({ refundStatus: "unknown", refundedPoints: 0, refundRecordId: null, unrestoredPoints: 0 });
        expect(body.data.task.refundStatus).toBe("unknown");
    });

    it("reads late billing evidence without replacing the current task billing", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin" });
        mocks.getImageTask.mockResolvedValue({ id: "task-a", userId: "user-a", status: "running" });
        mocks.getStoredGenerationTaskRecord.mockResolvedValue({ resultPayload: { billingEvidence: [{ pointsRecordId: "late-consume", pointsCost: 6, settlementStatus: "unknown" }] } });
        mocks.readAuthDb.mockResolvedValue({ pointRecords: [{ id: "late-consume", userId: "user-a", type: "consume", amount: -6 }] });
        const body = await (await GET(request(), context("image", "task-a"))).json();
        expect(body.data.task.billing).toMatchObject({ originalPoints: 6, originalRecordId: "late-consume", refundStatus: "unknown" });
        expect(body.data.task.status).toBe("running");
    });
});
