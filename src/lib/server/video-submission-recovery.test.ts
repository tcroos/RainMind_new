import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), fetch: vi.fn(), update: vi.fn(), charge: vi.fn() }));
vi.mock("@/lib/server/points-wallet-service", () => ({ findConsumedPointsByIdempotencyKey: mocks.charge }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.settings }));
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: mocks.fetch }));
vi.mock("@/lib/server/video-task-store", () => ({ updateVideoTask: mocks.update }));
import { recoverVideoSubmission, videoSubmissionChannelFingerprint } from "./video-submission-recovery";
import type { VideoTask } from "./video-task-store";
import { createServer } from "node:http";
import { videoBillingSnapshot } from "@/lib/video-billing";

describe("unknown video submission lookup", () => {
    it("recovers an accepted task over TCP without another POST", async () => {
        const requests: string[] = [];
        const server = createServer((request, response) => {
            requests.push(`${request.method} ${request.url}`);
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ data: { id: "accepted-task", task_type: "video" } }));
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Fixture did not bind");
        try {
            const localChannel = { ...channel, baseUrl: `http://127.0.0.1:${address.port}/v1` };
            const original = task();
            original.submissionIdentity = { clientRequestId: "original-request", channelFingerprint: videoSubmissionChannelFingerprint(localChannel), pointsIdempotencyKey: "original-debit", pointsUnits: 1 };
            mocks.settings.mockResolvedValue({ systemChannels: [localChannel] });
            mocks.fetch.mockImplementation((url, init) => fetch(url, init));
            mocks.charge.mockResolvedValue({ id: "original-record", amount: -100 });
            await expect(recoverVideoSubmission(original)).resolves.toMatchObject({ upstream: { id: "accepted-task", pointsCost: 100, pointsRecordId: "original-record" } });
            expect(requests).toEqual(["GET /v1/tasks/by-client-request-id?client_request_id=original-request"]);
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });
    const channel = {
        id: "fixture",
        baseUrl: "https://fixture.example/v1",
        apiKey: "fixture-key",
        enabled: true,
        apiFormat: "openai",
        models: ["fixture-video"],
        advancedConfig: { protocol: "custom", requestLookupPath: "/tasks/by-client-request-id?client_request_id={{client_request_id}}" },
    };
    const task = () =>
        ({
            id: "local",
            userId: "user",
            submissionIdentity: { clientRequestId: "stable-request", channelFingerprint: videoSubmissionChannelFingerprint(channel) },
            config: { channelId: channel.id, model: "fixture-video", advancedConfig: { protocol: "custom", requestLookupPath: "/tasks/by-client-request-id?client_request_id={{client_request_id}}" } },
            upstream: { id: "", model: "fixture-video" },
        }) as unknown as VideoTask;
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings.mockResolvedValue({ systemChannels: [channel] });
    });
    it("finds the original id using one GET and persists it without creating a task", async () => {
        mocks.fetch.mockResolvedValue(Response.json({ task_id: "secondary", id: "original", task_type: "video" }));
        await expect(recoverVideoSubmission(task())).resolves.toMatchObject({ upstream: { id: "original" } });
        expect(String(mocks.fetch.mock.calls[0][0])).toBe("https://fixture.example/v1/tasks/by-client-request-id?client_request_id=stable-request");
        expect(mocks.fetch.mock.calls[0][1].method).toBeUndefined();
        expect(mocks.update).toHaveBeenCalledOnce();
    });
    it("keeps 404 unknown and never persists an invented id", async () => {
        mocks.fetch.mockResolvedValue(new Response(null, { status: 404 }));
        await expect(recoverVideoSubmission(task())).resolves.toBeNull();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("does not query with a rotated key", async () => {
        mocks.settings.mockResolvedValue({ systemChannels: [{ ...channel, apiKey: "rotated" }] });
        await expect(recoverVideoSubmission(task())).resolves.toBeNull();
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("rejects an image task rather than routing it through video persistence", async () => {
        mocks.fetch.mockResolvedValue(Response.json({ data: { id: "image-task", task_type: "image" } }));
        await expect(recoverVideoSubmission(task())).resolves.toBeNull();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("restores the original debit record for settlement and refunds", async () => {
        const original = task();
        original.submissionIdentity!.pointsIdempotencyKey = "original-charge";
        original.submissionIdentity!.pointsUnits = 1.5;
        mocks.fetch.mockResolvedValue(Response.json({ id: "original", task_type: "video" }));
        mocks.charge.mockResolvedValue({ id: "debit", amount: -150 });
        await expect(recoverVideoSubmission(original)).resolves.toMatchObject({ upstream: { id: "original", pointsRecordId: "debit", pointsCost: 150, pointsUnits: 1.5 } });
        expect(mocks.charge).toHaveBeenCalledWith("user", "original-charge");
    });
    it("keeps the task under review when its original billing record cannot be recovered", async () => {
        const original = task();
        original.submissionIdentity!.pointsIdempotencyKey = "missing-charge";
        mocks.fetch.mockResolvedValue(Response.json({ id: "original", task_type: "video" }));
        mocks.charge.mockResolvedValue(null);
        await expect(recoverVideoSubmission(original)).resolves.toBeNull();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("preserves reference billing snapshot and original units despite current price changes", async () => {
        const original = task();
        original.billingSnapshot = videoBillingSnapshot({ mode: "duration", baseSeconds: 1, referenceVideoSeconds: true }, 5, [{ storageKey: "clip", durationMs: 15000 }]);
        original.submissionIdentity!.pointsIdempotencyKey = "original-charge";
        original.submissionIdentity!.pointsUnits = 20;
        mocks.settings.mockResolvedValue({ systemChannels: [channel], modelPointCosts: { video: 999 } });
        mocks.fetch.mockResolvedValue(Response.json({ id: "original", task_type: "video" }));
        mocks.charge.mockResolvedValue({ id: "debit", amount: -8000 });
        const recovered = await recoverVideoSubmission(original);
        expect(recovered).toMatchObject({ billingSnapshot: original.billingSnapshot, upstream: { pointsRecordId: "debit", pointsCost: 8000, pointsUnits: 20 } });
        expect(mocks.update).toHaveBeenCalledWith("local", { upstream: expect.objectContaining({ pointsCost: 8000, pointsUnits: 20 }) });
    });
});
