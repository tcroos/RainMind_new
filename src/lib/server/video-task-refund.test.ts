import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoTask } from "./video-task-store";
import { videoBillingSnapshot } from "@/lib/video-billing";

const mocks = vi.hoisted(() => ({ refund: vi.fn(), get: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth/store", () => ({ refundUserPoints: mocks.refund }));
vi.mock("@/lib/server/video-task-store", () => ({ getVideoTask: mocks.get, updateVideoTask: mocks.update }));
import { refundVideoTask } from "./video-task-refund";

describe("reference video refunds", () => {
    let task: VideoTask;
    beforeEach(() => {
        vi.resetAllMocks();
        task = { id: "video", userId: "user", status: "error", createdAt: 1, updatedAt: 1, config: { apiSource: "system", apiFormat: "openai", model: "upstream", logicalModel: "video", baseUrl: "/api/ai/system/fixture", apiKey: "system" }, upstream: { id: "accepted", provider: "generation", model: "upstream", pointsCost: 8000, pointsUnits: 20, pointsRecordId: "debit" }, billingSnapshot: videoBillingSnapshot({ mode: "duration", baseSeconds: 1, referenceVideoSeconds: true }, 5, [{ storageKey: "clip", durationMs: 15000 }]) };
        mocks.update.mockImplementation(async (_id, patch) => { task = { ...task, ...patch }; });
        mocks.get.mockImplementation(async () => task);
    });
    it("refunds original cost and units once, preserving the snapshot", async () => {
        const refunded = await refundVideoTask(task);
        await refundVideoTask(refunded);
        expect(mocks.refund).toHaveBeenCalledExactlyOnceWith("user", "video", 8000, "video", 20, "video-task:video:refund", "debit");
        expect(refunded.billingSnapshot?.totalSeconds).toBe(20);
        expect(refunded.upstream.refunded).toBe(true);
    });
    it("does not mark a failed refund complete", async () => {
        mocks.refund.mockRejectedValue(new Error("database unavailable"));
        await expect(refundVideoTask(task)).rejects.toThrow("database unavailable");
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("keeps zero cost and zero units when releasing a free generation", async () => {
        task.upstream.pointsCost = 0;
        task.upstream.pointsUnits = 0;
        await refundVideoTask(task);
        expect(mocks.refund).toHaveBeenCalledWith("user", "video", 0, "video", 0, "video-task:video:refund", "debit");
    });
});
