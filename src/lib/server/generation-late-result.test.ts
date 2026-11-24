import { describe, expect, it, vi } from "vitest";
vi.mock("./generation-task-store", () => ({ appendGenerationTaskLateEvidence: vi.fn(), getStoredGenerationTaskRecord: vi.fn(async () => ({ resultPayload: { url: "original" } })) }));
vi.mock("./generation-task-scheduler", () => ({ scheduleGenerationTask: vi.fn() }));
import { scheduleGenerationTask } from "./generation-task-scheduler";
import { retainLateGenerationResult } from "./generation-late-result";
import { appendGenerationTaskLateEvidence } from "./generation-task-store";
import { withGenerationTaskFence } from "./generation-task-fence";

describe("late refunded generation results", () => {
    it.each(["takeover", "webhook"])("keeps evidence after %s without using the lost claim mutation", async () => {
        const result = { url: "late-result" };
        await withGenerationTaskFence({ type: "image", taskId: "original", userId: "user", workerId: "old", leaseUntil: 1 }, () => retainLateGenerationResult("image", "original", result, { evidenceOnly: true }));
        expect(appendGenerationTaskLateEvidence).toHaveBeenCalledWith("image", "original", result);
    });
    it.each(["image", "video", "audio", "text"] as const)("keeps %s evidence in private schedule payload without delivery or debit", async kind => {
        const result = { url: "/api/reference-assets/existing" };
        await retainLateGenerationResult(kind, "original", result);
        expect(scheduleGenerationTask).toHaveBeenLastCalledWith(kind, "original", expect.objectContaining({
            executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "result_settlement_conflict",
            resultPayload: expect.objectContaining({ url: "original", lateResult: result }),
        }), { cancellation: true });
    });
});
