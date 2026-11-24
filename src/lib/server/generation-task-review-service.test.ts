import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getRecord: vi.fn(),
    schedule: vi.fn(),
    getText: vi.fn(),
    updateText: vi.fn(),
    transitionText: vi.fn(),
    markTextFailed: vi.fn(),
    getImage: vi.fn(),
    updateImage: vi.fn(),
    markImageFailed: vi.fn(),
    refundImage: vi.fn(),
    getAudio: vi.fn(),
    updateAudio: vi.fn(),
    markAudioFailed: vi.fn(),
    getVideo: vi.fn(),
    updateVideo: vi.fn(),
    markVideoFailed: vi.fn(),
    claimReview: vi.fn(),
    releaseReview: vi.fn(),
    fenceAtSchedule: [] as Array<string | undefined>,
}));

vi.mock("@/lib/server/generation-task-store", () => ({ getStoredGenerationTaskRecord: mocks.getRecord }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.schedule, claimGenerationTaskReview: mocks.claimReview, releaseGenerationTaskReviewClaim: mocks.releaseReview }));
vi.mock("@/lib/server/text-task-store", () => ({ getTextTask: mocks.getText, updateTextTask: mocks.updateText, transitionTextTask: mocks.transitionText }));
vi.mock("@/lib/server/text-task-runtime", () => ({ markTextTaskFailed: mocks.markTextFailed }));
vi.mock("@/lib/server/image-task-store", () => ({ getImageTask: mocks.getImage, updateImageTask: mocks.updateImage }));
vi.mock("@/lib/server/image-task-runtime", () => ({ markImageTaskFailed: mocks.markImageFailed }));
vi.mock("@/lib/server/image-task-refund", () => ({ refundImageTask: mocks.refundImage }));
vi.mock("@/lib/server/audio-task-store", () => ({ getAudioTask: mocks.getAudio, updateAudioTask: mocks.updateAudio }));
vi.mock("@/lib/server/audio-task-runtime", () => ({ markAudioTaskFailed: mocks.markAudioFailed }));
vi.mock("@/lib/server/video-task-store", () => ({ getVideoTask: mocks.getVideo, updateVideoTask: mocks.updateVideo }));
vi.mock("@/lib/server/video-task-runtime", () => ({ failVideoTaskFromWorker: mocks.markVideoFailed }));

import { reviewGenerationTask } from "./generation-task-review-service";
import { currentGenerationTaskFence } from "./generation-task-fence";

describe("generation task manual review", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.fenceAtSchedule = [];
        mocks.getRecord.mockResolvedValue({ executionPhase: "needs_review", submittedAt: 100, updatedAt: 500, attemptNo: 1, userId: "user-one" });
        mocks.refundImage.mockImplementation(async (task) => task);
        mocks.claimReview.mockResolvedValue({ workerId: "admin-review:one", leaseUntil: Date.now() + 120_000 });
        mocks.releaseReview.mockResolvedValue(true);
        mocks.schedule.mockImplementation(async (type: string, id: string) => {
            mocks.fenceAtSchedule.push(currentGenerationTaskFence(type as "image", id)?.workerId);
            return {};
        });
    });

    it("refuses a decision pinned to an older version of the task", async () => {
        await expect(reviewGenerationTask("image", "image-one", { action: "confirm_failed" }, { expected: { updatedAt: 499, attemptNo: 1 } })).rejects.toMatchObject({ status: 409 });
        await expect(reviewGenerationTask("image", "image-one", { action: "confirm_failed" }, { expected: { updatedAt: 500, attemptNo: 2 } })).rejects.toMatchObject({ status: 409 });
        expect(mocks.claimReview).not.toHaveBeenCalled();
    });

    describe("requireUnbilled", () => {
        const unbilled = { executionPhase: "needs_review", submittedAt: 100, updatedAt: 500, attemptNo: 1, userId: "user-one", status: "running", payload: {}, resultPayload: {} };
        const charges: Array<[string, Record<string, unknown>]> = [
            ["a points record", { billing: { pointsCost: 12, pointsRecordId: "points-1", refunded: false } }],
            ["a positive billing cost", { billing: { pointsCost: 3 } }],
            ["a positive video upstream cost", { upstream: { pointsCost: 6 } }],
        ];

        for (const type of ["image", "audio", "video", "text"] as const) {
            for (const [label, payload] of charges) {
                it(`refuses ${type} with 409 and settles nothing when ${label} appears after the claim`, async () => {
                    // inspect saw an uncharged task; a debit lands between inspect and the claim.
                    mocks.getRecord.mockResolvedValueOnce(unbilled).mockResolvedValueOnce({ ...unbilled, updatedAt: 501, payload });

                    await expect(reviewGenerationTask(type, "task-one", { action: "confirm_failed", reason: "未扣费批量关闭" }, { expected: { updatedAt: 500, attemptNo: 1 }, requireUnbilled: true })).rejects.toMatchObject({
                        status: 409,
                        message: "任务已产生扣费记录，不能按未扣款关闭",
                    });

                    expect(mocks.claimReview).toHaveBeenCalledTimes(1);
                    expect(mocks.releaseReview).toHaveBeenCalledWith(type, "task-one", "admin-review:one");
                    expect(mocks.refundImage).not.toHaveBeenCalled();
                    expect(mocks.markImageFailed).not.toHaveBeenCalled();
                    expect(mocks.markAudioFailed).not.toHaveBeenCalled();
                    expect(mocks.markVideoFailed).not.toHaveBeenCalled();
                    expect(mocks.markTextFailed).not.toHaveBeenCalled();
                    expect(mocks.schedule).not.toHaveBeenCalled();
                });
            }
        }

        it("refuses when a result or an upstream ID appears after the claim", async () => {
            mocks.getRecord.mockResolvedValueOnce(unbilled).mockResolvedValueOnce({ ...unbilled, resultPayload: { url: "https://cdn.example/a.png" } });
            await expect(reviewGenerationTask("image", "task-one", { action: "confirm_failed" }, { requireUnbilled: true })).rejects.toMatchObject({ status: 409, message: "任务已有结果，不能按未扣款关闭" });

            mocks.getRecord.mockResolvedValueOnce(unbilled).mockResolvedValueOnce({ ...unbilled, upstreamTaskId: "up-1" });
            await expect(reviewGenerationTask("image", "task-one", { action: "confirm_failed" }, { requireUnbilled: true })).rejects.toMatchObject({ status: 409, message: "任务已有上游任务 ID，不能按未扣款关闭" });

            expect(mocks.markImageFailed).not.toHaveBeenCalled();
            expect(mocks.refundImage).not.toHaveBeenCalled();
            expect(mocks.releaseReview).toHaveBeenCalledTimes(2);
        });

        it("still closes a task that stays uncharged after the claim", async () => {
            mocks.getRecord.mockResolvedValueOnce(unbilled).mockResolvedValueOnce(unbilled);
            mocks.getImage.mockResolvedValue({ id: "task-one", status: "running" });

            await expect(reviewGenerationTask("image", "task-one", { action: "confirm_failed", reason: "未扣费批量关闭" }, { expected: { updatedAt: 500, attemptNo: 1 }, requireUnbilled: true })).resolves.toMatchObject({ executionPhase: "completed" });

            expect(mocks.markImageFailed).toHaveBeenCalledTimes(1);
            expect(mocks.refundImage).not.toHaveBeenCalled();
            expect(mocks.releaseReview).toHaveBeenCalledTimes(1);
        });

        it("only applies to confirm_failed", async () => {
            await expect(reviewGenerationTask("image", "task-one", { action: "provide_result", result: "https://cdn.example/a.png" }, { requireUnbilled: true })).rejects.toMatchObject({ status: 400 });
            expect(mocks.claimReview).not.toHaveBeenCalled();
        });
    });

    it("rejects tasks that are no longer waiting for review", async () => {
        mocks.getRecord.mockResolvedValueOnce({ executionPhase: "polling" });

        await expect(reviewGenerationTask("image", "image-one", { action: "provide_result", result: "https://cdn.example/image.png" })).rejects.toMatchObject({
            status: 409,
            message: "当前任务不需要人工确认",
        });
        expect(mocks.schedule).not.toHaveBeenCalled();
    });

    it("attaches an existing upstream task ID without creating another task", async () => {
        mocks.getImage.mockResolvedValue({ id: "image-one", config: { baseUrl: "/api/ai/system/channel-one" } });

        await expect(reviewGenerationTask("image", "image-one", { action: "resume_upstream", upstreamTaskId: "upstream-existing", origin: "http://internal" })).resolves.toEqual({
            action: "resume_upstream",
            executionPhase: "submitted",
        });
        expect(mocks.updateImage).toHaveBeenCalledWith("image-one", {
            upstream: {
                id: "upstream-existing",
                mediaBaseUrl: "http://internal/api/ai/system/channel-one",
                pollBaseUrl: "http://internal/api/ai/system/channel-one",
            },
        });
        expect(mocks.schedule).toHaveBeenCalledWith("image", "image-one", expect.objectContaining({ executionPhase: "submitted", upstreamTaskId: "upstream-existing", nextPollAt: expect.any(Number) }));
    });

    it("queues a supplied media URL for persistence and rejects unsafe schemes", async () => {
        await expect(reviewGenerationTask("video", "video-one", { action: "provide_result", result: "javascript:alert(1)" })).rejects.toMatchObject({ status: 400 });
        await expect(reviewGenerationTask("video", "video-one", { action: "provide_result", result: "https://cdn.example/video.mp4" })).resolves.toEqual({
            action: "provide_result",
            executionPhase: "result_ready",
        });
        expect(mocks.schedule).toHaveBeenLastCalledWith("video", "video-one", expect.objectContaining({ executionPhase: "result_ready", resultPayload: { url: "https://cdn.example/video.mp4" } }));
    });

    it("completes a text task directly with the supplied final text", async () => {
        const task = { id: "text-one", status: "running", config: { apiKey: "secret" } };
        mocks.getText.mockResolvedValue(task);
        mocks.transitionText.mockResolvedValue({ ...task, status: "success" });

        await expect(reviewGenerationTask("text", "text-one", { action: "provide_result", result: "人工核对后的结果" })).resolves.toEqual({
            action: "provide_result",
            executionPhase: "completed",
        });
        expect(mocks.transitionText).toHaveBeenCalledWith(task, ["pending", "running"], expect.objectContaining({ status: "success", result: { content: "人工核对后的结果" }, messages: [], config: { apiKey: "" } }));
        expect(mocks.schedule).toHaveBeenCalledWith("text", "text-one", expect.objectContaining({ executionPhase: "completed", nextPollAt: undefined }));
    });

    it.each([
        ["text", "text-one", mocks.getText, mocks.markTextFailed],
        ["image", "image-one", mocks.getImage, mocks.markImageFailed],
        ["video", "video-one", mocks.getVideo, mocks.markVideoFailed],
        ["audio", "audio-one", mocks.getAudio, mocks.markAudioFailed],
    ] as const)("uses the normal %s failure path so its runtime refunds billing exactly once", async (type, id, getTask, markFailed) => {
        const task = { id };
        getTask.mockResolvedValue(task);

        await reviewGenerationTask(type, id, { action: "confirm_failed", reason: "上游确认未创建" });

        expect(markFailed).toHaveBeenCalledWith(task, "上游确认未创建");
        expect(mocks.schedule).toHaveBeenCalledWith(type, id, expect.objectContaining({ executionPhase: "completed", lastUpstreamStatus: "manually_failed" }));
    });

    it("refunds a cancelled image after an administrator confirms it was never submitted", async () => {
        const task = { id: "image-one", status: "cancelled", billing: { pointsCost: 20, pointsRecordId: "debit-one", refunded: false } };
        mocks.getRecord.mockResolvedValue({ executionPhase: "needs_review", upstreamTaskId: undefined, lastUpstreamStatus: "cancel_unconfirmed", resultPayload: { billingEvidence: { pointsRecordId: "debit-one", pointsCost: 20 } } });
        mocks.getImage.mockResolvedValue(task);
        mocks.refundImage.mockResolvedValue({ ...task, billing: { ...task.billing, refunded: true } });

        await expect(reviewGenerationTask("image", "image-one", { action: "confirm_failed", reason: "上游确认未创建" })).resolves.toMatchObject({
            settlement: "refunded",
        });

        expect(mocks.schedule).toHaveBeenNthCalledWith(1, "image", "image-one", expect.objectContaining({ lastUpstreamStatus: "cancelled_before_submission" }));
        expect(mocks.refundImage).toHaveBeenCalledWith(task);
        expect(mocks.schedule).toHaveBeenLastCalledWith("image", "image-one", expect.objectContaining({ executionPhase: "completed", lastUpstreamStatus: "manually_failed" }));
    });

    it.each([
        ["lateResult", { lateResult: { url: "https://cdn.example/late.png" } }],
        ["url", { url: "https://cdn.example/result.png" }],
        ["lateWorkerEvidence", { lateWorkerEvidence: { resultUrl: "https://cdn.example/worker-result.png" } }],
    ])("refuses to refund a cancelled image when resultPayload contains %s evidence", async (_evidence, resultPayload) => {
        const task = { id: "image-one", status: "cancelled", billing: { pointsCost: 20, pointsRecordId: "debit-one", refunded: false } };
        mocks.getRecord.mockResolvedValue({ executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed", resultPayload });
        mocks.getImage.mockResolvedValue(task);

        await expect(reviewGenerationTask("image", "image-one", { action: "confirm_failed" })).rejects.toMatchObject({
            status: 409,
            message: "任务已有结果证据，不能按未提交退款",
        });

        expect(mocks.refundImage).not.toHaveBeenCalled();
        expect(mocks.schedule).not.toHaveBeenCalled();
    });

    it("does not repeat a refund when the same cancellation confirmation is retried", async () => {
        const task = { id: "image-one", status: "cancelled", billing: { pointsCost: 20, pointsRecordId: "debit-one", refunded: false } };
        mocks.getRecord.mockResolvedValueOnce({ executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed" }).mockResolvedValueOnce({ executionPhase: "completed", lastUpstreamStatus: "manually_failed" });
        mocks.getImage.mockResolvedValue(task);

        await reviewGenerationTask("image", "image-one", { action: "confirm_failed" });
        await expect(reviewGenerationTask("image", "image-one", { action: "confirm_failed" })).rejects.toMatchObject({ status: 409 });

        expect(mocks.refundImage).toHaveBeenCalledTimes(1);
    });

    it("reports no refundable charge for a cancelled image without a debit record", async () => {
        const task = { id: "image-one", status: "cancelled", billing: { pointsCost: 20, refunded: false } };
        mocks.getRecord.mockResolvedValue({ executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed" });
        mocks.getImage.mockResolvedValue(task);

        await expect(reviewGenerationTask("image", "image-one", { action: "confirm_failed" })).resolves.toMatchObject({
            settlement: "no_refundable_charge",
        });

        expect(mocks.refundImage).not.toHaveBeenCalled();
    });

    it("does not refund a cancelled image that already has a successful result", async () => {
        const task = { id: "image-one", status: "cancelled", result: { dataUrl: "/api/generation-log-assets/result.png" }, billing: { pointsRecordId: "debit-one", refunded: false } };
        mocks.getRecord.mockResolvedValue({ executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed" });
        mocks.getImage.mockResolvedValue(task);

        await expect(reviewGenerationTask("image", "image-one", { action: "confirm_failed" })).rejects.toMatchObject({ status: 409 });

        expect(mocks.refundImage).not.toHaveBeenCalled();
        expect(mocks.schedule).not.toHaveBeenCalled();
    });

    it("does not refund a cancelled image while an upstream task identity exists", async () => {
        const task = { id: "image-one", status: "cancelled", upstream: { id: "upstream-one" }, billing: { pointsRecordId: "debit-one", refunded: false } };
        mocks.getRecord.mockResolvedValue({ executionPhase: "needs_review", upstreamTaskId: "upstream-one", lastUpstreamStatus: "cancel_unconfirmed" });
        mocks.getImage.mockResolvedValue(task);

        await expect(reviewGenerationTask("image", "image-one", { action: "confirm_failed" })).rejects.toMatchObject({ status: 409 });

        expect(mocks.refundImage).not.toHaveBeenCalled();
    });

    describe("concurrent decisions (BUG-091)", () => {
        const cancelled = { id: "image-one", status: "cancelled", billing: { pointsCost: 20, pointsRecordId: "debit-one", refunded: false } };

        it("lets only one of two concurrent confirmations act, so the refund runs once", async () => {
            // Both requests read the same needs_review record before either writes.
            mocks.getRecord.mockResolvedValue({ executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed", updatedAt: 500, attemptNo: 1, userId: "user-one" });
            mocks.getImage.mockResolvedValue(cancelled);
            mocks.claimReview.mockResolvedValueOnce({ workerId: "admin-review:one", leaseUntil: Date.now() + 120_000 }).mockResolvedValueOnce(null);

            const results = await Promise.allSettled([
                reviewGenerationTask("image", "image-one", { action: "confirm_failed" }),
                reviewGenerationTask("image", "image-one", { action: "confirm_failed" }),
            ]);

            expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
            const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
            expect(rejected.reason).toMatchObject({ status: 409, message: "任务状态已被其他操作更新，请刷新后重试" });
            expect(mocks.refundImage).toHaveBeenCalledTimes(1);
        });

        it("returns a conflict without scheduling, failing, or refunding when the claim is lost", async () => {
            mocks.getRecord.mockResolvedValue({ executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed", updatedAt: 500, attemptNo: 1, userId: "user-one" });
            mocks.getImage.mockResolvedValue(cancelled);
            mocks.claimReview.mockResolvedValue(null);

            await expect(reviewGenerationTask("image", "image-one", { action: "confirm_failed" })).rejects.toMatchObject({ status: 409 });

            expect(mocks.schedule).not.toHaveBeenCalled();
            expect(mocks.refundImage).not.toHaveBeenCalled();
            expect(mocks.markImageFailed).not.toHaveBeenCalled();
            expect(mocks.releaseReview).not.toHaveBeenCalled();
        });

        it("claims against the phase, updated_at and attempt it read", async () => {
            mocks.getImage.mockResolvedValue({ id: "image-one", config: { baseUrl: "/api/ai/system/channel-one" } });

            await reviewGenerationTask("image", "image-one", { action: "resume_upstream", upstreamTaskId: "upstream-existing", origin: "http://internal" });

            expect(mocks.claimReview).toHaveBeenCalledWith("image", "image-one", { executionPhase: "needs_review", updatedAt: 500, attemptNo: 1 });
        });

        it("runs the decision inside the claim fence so a lost lease blocks later writes", async () => {
            mocks.getImage.mockResolvedValue({ id: "image-one", config: { baseUrl: "/api/ai/system/channel-one" } });

            await reviewGenerationTask("image", "image-one", { action: "resume_upstream", upstreamTaskId: "upstream-existing", origin: "http://internal" });

            expect(mocks.fenceAtSchedule.length).toBeGreaterThan(0);
            expect(mocks.fenceAtSchedule.every((workerId) => workerId === "admin-review:one")).toBe(true);
        });

        it("releases the claim after success and after a failed decision", async () => {
            mocks.getImage.mockResolvedValue({ id: "image-one", config: { baseUrl: "/api/ai/system/channel-one" } });
            await reviewGenerationTask("image", "image-one", { action: "resume_upstream", upstreamTaskId: "upstream-existing", origin: "http://internal" });
            expect(mocks.releaseReview).toHaveBeenLastCalledWith("image", "image-one", "admin-review:one");

            mocks.releaseReview.mockClear();
            mocks.getImage.mockResolvedValue(null);
            await expect(reviewGenerationTask("image", "image-one", { action: "resume_upstream", upstreamTaskId: "upstream-existing", origin: "http://internal" })).rejects.toMatchObject({ status: 404 });
            expect(mocks.releaseReview).toHaveBeenCalledWith("image", "image-one", "admin-review:one");
        });

        it("validates input before taking a claim", async () => {
            await expect(reviewGenerationTask("image", "image-one", { action: "resume_upstream", upstreamTaskId: "  ", origin: "http://internal" })).rejects.toMatchObject({ status: 400 });
            expect(mocks.claimReview).not.toHaveBeenCalled();
        });
    });
});
