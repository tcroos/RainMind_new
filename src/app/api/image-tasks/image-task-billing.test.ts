import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: (url: string, init?: RequestInit) => fetch(url, init) }));
vi.mock("@/lib/server/generation-task-store", () => ({ appendGenerationTaskBillingEvidence: vi.fn() }));

const mocks = vi.hoisted(() => ({
    getSettings: vi.fn(),
    refund: vi.fn(),
    updateTask: vi.fn(),
}));

vi.mock("@/lib/auth/store", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/auth/store")>()),
    getAuthSettings: mocks.getSettings,
    refundUserPoints: mocks.refund,
}));
vi.mock("@/lib/server/image-task-store", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/server/image-task-store")>()),
    updateImageTask: mocks.updateTask,
}));

import { GenerationSubmissionSafeFailure, GenerationSubmissionUncertainError } from "@/lib/server/generation-submission-error";
import { imageSubmissionFetch, parseChargedImageResponse, parseImageSubmissionJson } from "./image-task-support";
import { appendGenerationTaskBillingEvidence } from "@/lib/server/generation-task-store";

describe("image submission billing state", () => {
    const task = { id: "image-billing", userId: "user-one", attemptNo: 1, config: { model: "image-model", quality: "high" } } as never;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSettings.mockResolvedValue({ generationPointMultipliers: { imageQuality: { high: 2 } } });
        mocks.updateTask.mockResolvedValue(task);
        mocks.refund.mockResolvedValue(undefined);
    });

    it("persists a charge when a 2xx submission body is invalid", async () => {
        const response = new Response("not-json", { status: 200, headers: { "x-vozeb-pro-points-cost": "1.5", "x-vozeb-pro-points-record-id": "points-invalid" } });

        await expect(parseImageSubmissionJson(task, response)).rejects.toBeInstanceOf(GenerationSubmissionUncertainError);
        expect(mocks.updateTask).toHaveBeenCalledWith("image-billing", { billing: { pointsCost: 1.5, pointsRecordId: "points-invalid", refunded: false } });
        expect(mocks.refund).not.toHaveBeenCalled();
    });

    it("persists unknown HTTP charge before callers can switch protocol or candidate", async () => {
        mocks.updateTask.mockResolvedValue(null);
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("failure", { status: 502, headers: { "x-vozeb-pro-settlement-status": "unknown", "x-vozeb-pro-points-cost": "3", "x-vozeb-pro-points-record-id": "unknown-image" } }));
        try {
            await expect(imageSubmissionFetch({ baseUrl: "https://one.example" } as never, "https://one.example/images/generations", { method: "POST" }, task)).rejects.toBeInstanceOf(GenerationSubmissionUncertainError);
            expect(mocks.updateTask).toHaveBeenCalledWith("image-billing", { billing: { pointsCost: 3, pointsRecordId: "unknown-image", refunded: false } });
            expect(appendGenerationTaskBillingEvidence).toHaveBeenCalledWith("image", "image-billing", "user-one", expect.objectContaining({ pointsCost: 3, pointsRecordId: "unknown-image" }));
            expect(mocks.refund).not.toHaveBeenCalled();
        } finally { fetchMock.mockRestore(); }
    });

    it("keeps an uncertain structured result charged, but refunds a definitive parse failure", async () => {
        const uncertainResponse = Response.json({}, { headers: { "x-vozeb-pro-points-cost": "2", "x-vozeb-pro-points-record-id": "points-uncertain" } });
        await expect(
            parseChargedImageResponse(task, uncertainResponse, async () => {
                throw new GenerationSubmissionUncertainError("missing task id");
            }),
        ).rejects.toBeInstanceOf(GenerationSubmissionUncertainError);
        expect(mocks.updateTask).toHaveBeenCalledWith("image-billing", { billing: { pointsCost: 2, pointsRecordId: "points-uncertain", refunded: false } });
        expect(mocks.refund).not.toHaveBeenCalled();

        mocks.updateTask.mockClear();
        const failedResponse = Response.json({}, { headers: { "x-vozeb-pro-points-cost": "3", "x-vozeb-pro-points-record-id": "points-failed" } });
        await expect(
            parseChargedImageResponse(task, failedResponse, async () => {
                throw new GenerationSubmissionSafeFailure("provider rejected");
            }),
        ).rejects.toBeInstanceOf(GenerationSubmissionSafeFailure);
        expect(mocks.refund).toHaveBeenCalledWith("user-one", "image-model", 3, "image", 2, undefined, "points-failed");
    });
});
