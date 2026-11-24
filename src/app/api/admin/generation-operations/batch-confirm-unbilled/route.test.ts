import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), close: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn((_request: Request, user: { id: string; role: string }) => ({ id: user.id, role: user.role })) }));
vi.mock("@/lib/server/generation-batch-close-unbilled", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/server/generation-batch-close-unbilled")>()),
    closeUnbilledReviewTasks: mocks.close,
}));

import { BatchCloseUnbilledError } from "@/lib/server/generation-batch-close-unbilled";

import { POST } from "./route";

const manager = { id: "admin-one", accountId: "0001", role: "admin", status: "active", adminPermissions: ["generation.manage"] };
const body = { batchRequestId: "11111111-2222-4333-8444-555555555555", items: [{ type: "image", id: "a", expectedUpdatedAt: 500, expectedAttempt: 1 }] };

function request(payload: unknown) {
    return new Request("https://app.example/api/admin/generation-operations/batch-confirm-unbilled", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}

function result(summary: Partial<{ applied: number; conflict: number; notFound: number; rejected: number; failed: number }>, rejected = false) {
    return { batchRequestId: body.batchRequestId, rejected, items: [], summary: { applied: 0, conflict: 0, notFound: 0, rejected: 0, failed: 0, ...summary } };
}

describe("POST batch-confirm-unbilled", () => {
    beforeEach(() => vi.clearAllMocks());

    it("requires a session and generation.manage", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        expect((await POST(request(body))).status).toBe(401);
        mocks.getCurrentUser.mockResolvedValue({ ...manager, adminPermissions: ["generation.read"] });
        expect((await POST(request(body))).status).toBe(403);
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one", role: "user" });
        expect((await POST(request(body))).status).toBe(403);
        expect(mocks.close).not.toHaveBeenCalled();
    });

    it("maps outcomes to status codes", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        const cases: Array<[ReturnType<typeof result>, number]> = [
            [result({ applied: 2, conflict: 1 }), 200],
            [result({ rejected: 2 }, true), 409],
            [result({ conflict: 1 }), 409],
            [result({ notFound: 1 }), 404],
            [result({ failed: 1 }), 500],
        ];
        for (const [data, status] of cases) {
            mocks.close.mockResolvedValueOnce(data);
            const response = await POST(request(body));
            expect(response.status).toBe(status);
            await expect(response.json()).resolves.toMatchObject({ data: { summary: data.summary } });
        }
        expect(mocks.close).toHaveBeenCalledWith(body, { id: "admin-one", role: "admin" });
    });

    it("returns validation errors as 400", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        mocks.close.mockRejectedValueOnce(new BatchCloseUnbilledError(400, "请提供有效的批次编号（UUID）"));
        const response = await POST(request({ ...body, batchRequestId: "x" }));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ code: 400, msg: "请提供有效的批次编号（UUID）" });
    });
});
