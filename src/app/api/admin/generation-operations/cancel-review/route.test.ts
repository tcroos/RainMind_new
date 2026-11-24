import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), list: vi.fn(), audit: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/generation-cancel-review-queue", () => ({ listCancelReviewQueue: mocks.list }));
vi.mock("@/lib/server/audit-log-store", () => ({ safeRecordAuditLog: mocks.audit, auditActorFromRequest: vi.fn((_request: Request, user: { id: string; role: string }) => ({ id: user.id, role: user.role })) }));

import { GET } from "./route";

const manager = { id: "admin-one", role: "admin", status: "active", adminPermissions: ["generation.manage"] };

function request(query = "") {
    return new Request(`https://app.example/api/admin/generation-operations/cancel-review${query}`);
}

describe("GET cancel review queue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.list.mockResolvedValue({ items: [{ taskId: "task-one" }], nextCursor: null });
    });

    it("requires a session", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        expect((await GET(request())).status).toBe(401);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it("rejects ordinary users with 403", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one", role: "user" });
        const response = await GET(request());
        expect(response.status).toBe(403);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it("rejects an administrator who can only read generation operations", async () => {
        mocks.getCurrentUser.mockResolvedValue({ ...manager, adminPermissions: ["generation.read"] });
        expect((await GET(request())).status).toBe(403);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it("lets a generation manager view the queue", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        const response = await GET(request());
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ code: 0, data: { items: [{ taskId: "task-one" }], nextCursor: null } });
    });

    it("parses filters and the cursor", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        await GET(request("?type=video&executionPhase=needs_review&lastUpstreamStatus=cancel_unconfirmed&requestedFrom=1000&requestedTo=2000&cursor=abc&limit=50"));
        expect(mocks.list).toHaveBeenCalledWith({ type: "video", executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed", requestedFrom: 1000, requestedTo: 2000, cursor: "abc", limit: 50 });
    });

    it("returns 400 for an invalid cursor", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        mocks.list.mockRejectedValue(new Error("队列游标无效"));
        const response = await GET(request("?cursor=bad"));
        expect(response.status).toBe(400);
    });

    it("audits queue access with the filters but no task data", async () => {
        mocks.getCurrentUser.mockResolvedValue(manager);
        await GET(request("?type=image"));
        expect(mocks.audit).toHaveBeenCalledWith({
            action: "admin.generation_task.cancel_review.list",
            status: "success",
            actor: { id: "admin-one", role: "admin" },
            target: { type: "generation_cancel_review_queue", id: "cancel_review" },
            metadata: { filters: { type: "image" }, resultCount: 1, hasNextPage: false },
        });
    });
});