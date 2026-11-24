import { describe, expect, it, vi } from "vitest";
vi.mock("@/services/api/generation-tasks", () => ({ readGenerationTask: vi.fn() }));
import { readGenerationTask } from "@/services/api/generation-tasks";
import { reconcileCanvasTaskRetry } from "./canvas-task-retry";

describe("canvas retry reconciliation", () => {
    it.each(["image", "video", "audio", "text"] as const)("resumes successful %s without permission to recreate", async kind => {
        vi.mocked(readGenerationTask).mockResolvedValue({ status: "success", needsReview: false } as Awaited<ReturnType<typeof readGenerationTask>>);
        expect((await reconcileCanvasTaskRetry(kind, "original")).action).toBe("resume");
        expect(readGenerationTask).toHaveBeenLastCalledWith(kind, "original");
    });
    it.each(["running", "pending", "error", "cancelled"])("handles %s explicitly", async status => {
        vi.mocked(readGenerationTask).mockResolvedValue({ status, needsReview: false, refundStatus: "not_required", result: null } as Awaited<ReturnType<typeof readGenerationTask>>);
        expect((await reconcileCanvasTaskRetry("image", "original")).action).toBe(status === "error" ? "recreate" : status === "cancelled" ? "review" : "resume");
    });
    it.each(["pending", "unknown", "failed", undefined])("does not recreate an error with unsettled refund %s", async refundStatus => {
        vi.mocked(readGenerationTask).mockResolvedValue({ status: "error", needsReview: false, refundStatus, result: null } as Awaited<ReturnType<typeof readGenerationTask>>);
        expect((await reconcileCanvasTaskRetry("image", "original")).action).toBe("review");
    });
    it.each(["refunded", "not_required"])("only recreates settled %s errors without a result", async refundStatus => {
        vi.mocked(readGenerationTask).mockResolvedValue({ status: "error", needsReview: false, refundStatus, result: null } as Awaited<ReturnType<typeof readGenerationTask>>);
        expect((await reconcileCanvasTaskRetry("video", "original")).action).toBe("recreate");
        vi.mocked(readGenerationTask).mockResolvedValue({ status: "error", needsReview: false, refundStatus, result: { url: "/saved.mp4" } } as Awaited<ReturnType<typeof readGenerationTask>>);
        expect((await reconcileCanvasTaskRetry("video", "original")).action).toBe("review");
    });
    it("blocks unknown and failed reads", async () => {
        vi.mocked(readGenerationTask).mockResolvedValue({ status: "running", needsReview: true } as Awaited<ReturnType<typeof readGenerationTask>>);
        expect((await reconcileCanvasTaskRetry("video", "original")).action).toBe("review");
        vi.mocked(readGenerationTask).mockRejectedValue(new Error("offline"));
        await expect(reconcileCanvasTaskRetry("video", "original")).rejects.toThrow("offline");
    });
});
