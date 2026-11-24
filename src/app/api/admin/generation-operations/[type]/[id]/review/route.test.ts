import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    review: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://internal") }));
vi.mock("@/lib/server/audit-log-store", () => ({ safeRecordAuditLog: mocks.audit, auditActorFromRequest: vi.fn((_request: Request, user: { id: string; role: string }) => ({ id: user.id, role: user.role })) }));
vi.mock("@/lib/server/generation-task-review-service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/server/generation-task-review-service")>()),
    reviewGenerationTask: mocks.review,
}));

import { POST } from "./route";
import { GenerationTaskReviewError } from "@/lib/server/generation-task-review-service";

const admin = { id: "admin-one", role: "admin", status: "active", adminPermissions: ["generation.manage"] };

describe("admin generation task review route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("rejects non-admin users", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one", role: "user" });

        const response = await POST(request({ action: "confirm_failed" }), context("image", "task-one"));

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({ code: 403, data: null, msg: "需要管理员权限" });
        expect(mocks.review).not.toHaveBeenCalled();
    });

    it("passes a trusted internal origin when resuming an upstream task", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["generation.manage"] });
        mocks.review.mockResolvedValue({ action: "resume_upstream", executionPhase: "submitted" });

        const response = await POST(request({ action: "resume_upstream", upstreamTaskId: "upstream-one" }), context("video", "task-one"));

        expect(response.status).toBe(200);
        expect(mocks.review).toHaveBeenCalledWith("video", "task-one", {
            action: "resume_upstream",
            upstreamTaskId: "upstream-one",
            origin: "http://internal",
        });
        await expect(response.json()).resolves.toMatchObject({ code: 0, data: { executionPhase: "submitted" } });
    });

    it("audits a successful decision without the submitted reason or result", async () => {
        mocks.getCurrentUser.mockResolvedValue(admin);
        mocks.review.mockResolvedValue({ action: "confirm_failed", executionPhase: "completed", settlement: "refunded" });

        const response = await POST(request({ action: "confirm_failed", reason: "see https://cdn.example/x?token=secret" }), context("image", "task-one"));

        expect(response.status).toBe(200);
        expect(mocks.audit).toHaveBeenCalledOnce();
        const entry = mocks.audit.mock.calls[0][0];
        expect(entry).toMatchObject({
            action: "admin.generation_task.review",
            status: "success",
            actor: { id: "admin-one", role: "admin" },
            target: { type: "generation_task", id: "task-one" },
            metadata: { taskType: "image", decision: "confirm_failed", priorPhase: "needs_review", executionPhase: "completed", settlement: "refunded" },
        });
        expect(JSON.stringify(entry)).not.toContain("token=secret");
    });

    it("audits a conflicting decision as a failure and returns 409", async () => {
        mocks.getCurrentUser.mockResolvedValue(admin);
        mocks.review.mockRejectedValue(new GenerationTaskReviewError(409, "任务状态已被其他操作更新，请刷新后重试"));

        const response = await POST(request({ action: "confirm_failed" }), context("image", "task-one"));

        expect(response.status).toBe(409);
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.generation_task.review", status: "failure", target: { type: "generation_task", id: "task-one" }, metadata: expect.objectContaining({ decision: "confirm_failed", httpStatus: 409 }) }));
    });

    it("does not audit requests rejected before any decision is attempted", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one", role: "user" });
        await POST(request({ action: "confirm_failed" }), context("image", "task-one"));
        mocks.getCurrentUser.mockResolvedValue(admin);
        await POST(request({ action: "delete_everything" }), context("image", "task-one"));

        expect(mocks.audit).not.toHaveBeenCalled();
    });
});

function request(body: unknown) {
    return new Request("https://app.example/api/admin/generation-operations/image/task-one/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

function context(type: string, id: string) {
    return { params: Promise.resolve({ type, id }) };
}
