import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), keepPending: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn((_request: Request, user: { id: string; role: string }) => ({ id: user.id, role: user.role })) }));
vi.mock("@/lib/server/generation-cancel-review-actions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/server/generation-cancel-review-actions")>()),
    keepCancelReviewPending: mocks.keepPending,
}));

import { POST } from "./route";
import { CancelReviewActionError } from "@/lib/server/generation-cancel-review-actions";

const manager = { id: "admin-one", accountId: "0001", role: "admin", status: "active", adminPermissions: ["generation.manage"] };
const body = { batchRequestId: "11111111-2222-4333-8444-555555555555", action: "keep_pending", items: [{ type: "image", id: "a", expectedUpdatedAt: 500, expectedAttempt: 1 }] };

function request(payload: unknown) {
    return new Request("https://app.example/api/admin/generation-operations/cancel-review/keep-pending", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}

function summary(applied: number, conflict: number, notFound: number) {
    return { batchRequestId: body.batchRequestId, items: [], summary: { applied, conflict, notFound } };
}

describe("POST cancel review keep_pending", () => {
    beforeEach(() => vi.clearAllMocks());

    it("requires a session", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        expect((await POST(request(body))).status).toBe(401);
        expect(mocks.keepPending).not.toHaveBeenCalled();
    });

    it("rejects ordinary users and read-only administrators with 403", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one", role: "user" });
        expect((await POST(request(body))).status).toBe(403);
        mocks.getCurrentUser.mockResolvedValue({ ...manager, adminPermissions: ["generation.read"] });
        expect((await POST(request(body))).status).toBe(403);
        expect(mocks.keepPending).not.toHaveBeenCalled();
    });

    it("passes the actor and the reviewer account to the service", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        mocks.keepPending.mockResolvedValue(summary(1, 0, 0));

        const response = await POST(request(body));

        expect(response.status).toBe(200);
        expect(mocks.keepPending).toHaveBeenCalledWith(body, { id: "admin-one", role: "admin" }, { accountId: "0001" });
    });

    it("returns 200 when at least one item applied, even with conflicts", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        mocks.keepPending.mockResolvedValue(summary(2, 1, 0));
        const response = await POST(request(body));
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ code: 0, data: { summary: { applied: 2, conflict: 1 } } });
    });

    it("returns 409 instead of a silent success when nothing applied because of conflicts", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        mocks.keepPending.mockResolvedValue(summary(0, 2, 0));
        const response = await POST(request(body));
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ code: 409, data: { summary: { applied: 0, conflict: 2 } } });
    });

    it("returns 404 when no item exists", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        mocks.keepPending.mockResolvedValue(summary(0, 0, 1));
        expect((await POST(request(body))).status).toBe(404);
    });

    it("maps a rejected batch (including a refund attempt) to its status", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        mocks.keepPending.mockRejectedValue(new CancelReviewActionError(400, "批量操作只支持保持待处理（keep_pending）"));
        const response = await POST(request({ ...body, action: "refund" }));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ code: 400, msg: "批量操作只支持保持待处理（keep_pending）" });
    });

    it("rejects a malformed body with 400", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        const response = await POST(new Request("https://app.example/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
        expect(response.status).toBe(400);
        expect(mocks.keepPending).not.toHaveBeenCalled();
    });
});