import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendGenerationTaskBillingEvidence } from "@/lib/server/generation-task-store";

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    fetchInternalApi: vi.fn(),
    createVideoTask: vi.fn(),
    claimVideoTaskPoll: vi.fn(),
    completeReconciledVideoTask: vi.fn(),
    failReconciledVideoTask: vi.fn(),
    getAuthSettings: vi.fn(),
    getVideoTask: vi.fn(),
    linkStoredGenerationTask: vi.fn(),
    getStoredGenerationTaskByRequest: vi.fn(),
    generationCapacityRetryAfterSeconds: vi.fn(),
    touchVideoTask: vi.fn(),
    transitionVideoTask: vi.fn(),
    updateVideoTask: vi.fn(),
    writeVideoGenerationLog: vi.fn(),
    scheduleGenerationTask: vi.fn(),
    normalizeImageReferences: vi.fn(async (input: { references: unknown[] }) => input.references),
    requireManagedMediaInputOwner: vi.fn(async () => "user"),
    refundUserPoints: vi.fn(),
    trustedDurations: vi.fn(),
    rateLimit: vi.fn(async () => ({ allowed: true, remaining: 5, resetAt: Date.now() + 60_000 })),
    withGenerationConcurrencyLimit: vi.fn(async (_userId, _type, _staleMs, _limit, handler) => handler()),
}));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: mocks.after };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user", role: "user", pointsBalance: 100 })) }));
vi.mock("@/lib/auth/store", () => {
    class AuthInputError extends Error {
        status = 400;
    }
    return { AuthInputError, getAuthSettings: mocks.getAuthSettings, isAuthInputError: (error: unknown) => error instanceof AuthInputError, refundUserPoints: mocks.refundUserPoints };
});
vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi: mocks.fetchInternalApi, resolveInternalOrigin: vi.fn(() => "http://localhost") }));
vi.mock("@/lib/server/generation-task-store", () => ({
    appendGenerationTaskBillingEvidence: vi.fn(),
    generationCapacityRetryAfterSeconds: mocks.generationCapacityRetryAfterSeconds,
    withGenerationConcurrencyLimit: mocks.withGenerationConcurrencyLimit,
    linkStoredGenerationTask: mocks.linkStoredGenerationTask,
    getStoredGenerationTaskByRequest: mocks.getStoredGenerationTaskByRequest,
}));
vi.mock("@/lib/server/managed-media-input-access", () => ({ requireManagedMediaInputOwner: mocks.requireManagedMediaInputOwner }));
vi.mock("@/lib/server/security", () => ({
    checkGenerationRateLimit: mocks.rateLimit,
    rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: vi.fn() }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.scheduleGenerationTask }));
vi.mock("@/lib/server/video-task-log", () => ({ writeVideoGenerationLog: mocks.writeVideoGenerationLog }));
vi.mock("@/lib/server/video-reference-image", () => ({ normalizeVideoProviderImageReferences: mocks.normalizeImageReferences }));
vi.mock("@/lib/server/reference-video-duration", () => ({ trustedReferenceVideoDurations: mocks.trustedDurations }));
vi.mock("@/lib/server/video-task-store", () => ({
    createVideoTask: mocks.createVideoTask,
    claimVideoTaskPoll: mocks.claimVideoTaskPoll,
    completeReconciledVideoTask: mocks.completeReconciledVideoTask,
    failReconciledVideoTask: mocks.failReconciledVideoTask,
    getVideoTask: mocks.getVideoTask,
    touchVideoTask: mocks.touchVideoTask,
    transitionVideoTask: mocks.transitionVideoTask,
    updateVideoTask: mocks.updateVideoTask,
}));

import { GET, POST } from "./route";
import { getCurrentUser } from "@/lib/auth/session";
import { resetChannelRuntimeHealth } from "@/lib/server/channel-runtime-health";
import { normalizeSystemChannelAdvancedConfig } from "@/lib/auth/store-normalizers-channel";

const channels = [
    { id: "one", name: "主渠道", baseUrl: "https://one.example.com/v1", apiKey: "one-secret", apiFormat: "openai", models: ["video-one"], enabled: true, advancedConfig: { protocol: "openai" } },
    { id: "two", name: "备用渠道", baseUrl: "https://two.example.com/v1", apiKey: "two-secret", apiFormat: "openai", models: ["video-two"], enabled: true, advancedConfig: { protocol: "openai" } },
] as const;

const settings = {
    systemChannels: channels,
    logicalModels: [
        {
            id: "video",
            name: "Video",
            capability: "video",
            enabled: true,
            bindings: [
                { id: "one", channelId: "one", upstreamModel: "video-one", enabled: true, priority: 1 },
                { id: "two", channelId: "two", upstreamModel: "video-two", enabled: true, priority: 2 },
            ],
        },
    ],
    defaultModels: { videoModel: "video" },
    generationConcurrency: { video: 2 },
    generationDefaults: { imageSize: "16:9", videoQuality: "720", videoSeconds: 5 },
    generationPointMultipliers: { videoQuality: { "720": 1 }, videoSeconds: { "5": 1 } },
};

describe("video generation candidate failover", () => {
    let storedTask: Record<string, unknown> | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.fetchInternalApi.mockReset();
        resetChannelRuntimeHealth();
        mocks.getAuthSettings.mockResolvedValue(settings);
        mocks.generationCapacityRetryAfterSeconds.mockResolvedValue(undefined);
        storedTask = undefined;
        mocks.createVideoTask.mockImplementation(async (input) => {
            storedTask = { ...input, id: "local-task", status: "running", createdAt: Date.now(), updatedAt: Date.now() };
            return storedTask;
        });
        mocks.getVideoTask.mockImplementation(async () => storedTask);
        mocks.claimVideoTaskPoll.mockImplementation(async () => storedTask);
        mocks.after.mockImplementation(() => undefined);
    });

    afterEach(() => vi.unstubAllEnvs());

    it("tries the next binding after explicit route failures", async () => {
        const startedAt = Date.now();
        mocks.fetchInternalApi.mockImplementation(async (url: string) => (url.includes("/api/ai/system/one/") ? json({ error: "not found" }, 404) : json({ id: "upstream-two", status: "queued" })));

        const response = await POST(request());
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.task).toMatchObject({ id: "local-task", model: "video", upstreamId: "upstream-two" });
        expect(mocks.fetchInternalApi.mock.calls.some(([url]) => String(url).includes("/api/ai/system/one/"))).toBe(true);
        expect(mocks.fetchInternalApi.mock.calls.some(([url]) => String(url).includes("/api/ai/system/two/"))).toBe(true);
        const submittingSchedules = mocks.scheduleGenerationTask.mock.calls.filter(([, , patch]) => patch.executionPhase === "submitting");
        expect(submittingSchedules).toHaveLength(2);
        expect(submittingSchedules.every(([, , patch]) => patch.nextPollAt >= startedAt + 30 * 60_000)).toBe(true);
    });

    it("quotes reference duration without creating a task or calling upstream", async () => {
        const configured = structuredClone(settings) as unknown as import("@/lib/auth/store").AuthSettings;
        configured.modelPointCosts = { video: 400 };
        configured.systemChannels.forEach((channel) => { channel.advancedConfig = normalizeSystemChannelAdvancedConfig({ protocol: "custom", supportsReferenceImage: true, supportsReferenceVideo: true, requestTemplate: '{"model":"{{model}}","seconds":"{{seconds_string}}","reference_videos":"{{videos}}"}' }); });
        configured.logicalModels[0].bindings.forEach((binding) => { binding.capabilityProfile = { videoBilling: { mode: "duration", baseSeconds: 1, referenceVideoSeconds: true } }; });
        mocks.getAuthSettings.mockResolvedValue(configured);
        mocks.trustedDurations.mockResolvedValue([{ storageKey: "clip", durationMs: 2300 }, { storageKey: "clip", durationMs: 2300 }]);
        const response = await POST(new Request("http://localhost/api/video-generation-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteOnly: true, config: { model: "video", videoSeconds: "5", vquality: "720" }, references: [{ type: "video", url: "/api/reference-assets/permanent/clip.mp4" }, { type: "video", url: "/api/reference-assets/permanent/clip.mp4" }, { type: "image", url: "/api/reference-assets/permanent/image.webp" }] }) }));
        const quotePayload = await response.json();
        expect(response.status, JSON.stringify(quotePayload)).toBe(200);
        expect(quotePayload).toMatchObject({ quote: { outputSeconds: 5, referenceSeconds: 6, totalSeconds: 11, points: 4400 } });
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
        expect(mocks.normalizeImageReferences).not.toHaveBeenCalled();
        expect(mocks.withGenerationConcurrencyLimit).not.toHaveBeenCalled();
    });

    it("returns a complete task-bound quote matrix in one quote request", async () => {
        const configured = structuredClone(settings) as unknown as import("@/lib/auth/store").AuthSettings;
        configured.modelPointCosts = { video: 400 };
        configured.systemChannels.forEach((channel) => { channel.advancedConfig = normalizeSystemChannelAdvancedConfig({ protocol: "custom", supportsReferenceVideo: true, requestTemplate: '{"model":"{{model}}","seconds":"{{seconds_string}}","reference_videos":"{{videos}}"}' }); });
        configured.logicalModels[0].bindings.forEach((binding) => { binding.capabilityProfile = { videoBilling: { mode: "duration", baseSeconds: 1, referenceVideoSeconds: true } }; });
        mocks.getAuthSettings.mockResolvedValue(configured);
        mocks.trustedDurations.mockResolvedValue([{ storageKey: "clip", durationMs: 15000 }]);

        const response = await POST(new Request("http://localhost/api/video-generation-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                quoteOnly: true,
                quoteItems: [
                    { targetId: "run:task-one:1", config: { model: "video", videoSeconds: "5", vquality: "720" }, references: [{ type: "video", url: "/api/reference-assets/permanent/clip.mp4" }] },
                    { targetId: "run:task-two:1", config: { model: "video", videoSeconds: "5", vquality: "720" }, references: [{ type: "video", url: "/api/reference-assets/permanent/clip.mp4" }] },
                ],
            }),
        }));
        const payload = await response.json();

        expect(response.status, JSON.stringify(payload)).toBe(200);
        expect(payload.quotes).toHaveLength(2);
        expect(payload.quotes.map((item: { targetId: string }) => item.targetId)).toEqual(["run:task-one:1", "run:task-two:1"]);
        expect(payload.quotes.map((item: { quote: { targetId: string; points: number } }) => item.quote)).toEqual([
            expect.objectContaining({ targetId: "run:task-one:1", points: 8000 }),
            expect.objectContaining({ targetId: "run:task-two:1", points: 8000 }),
        ]);
        expect(payload.quotes.every((item: { quote: { billingFingerprint: string; semanticFingerprint: string } }) => /^[a-f0-9]{64}$/.test(item.quote.billingFingerprint) && /^[a-f0-9]{64}$/.test(item.quote.semanticFingerprint))).toBe(true);
        expect(payload.quotes[0].quote.confirmation).not.toBe(payload.quotes[1].quote.confirmation);
        expect(mocks.rateLimit).toHaveBeenCalledOnce();
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("bounds the number of items in one video quote batch", async () => {
        const quoteItems = Array.from({ length: 65 }, (_, index) => ({ targetId: `run:task-${index}:1`, config: { model: "video", videoSeconds: "5" }, references: [] }));
        const response = await POST(new Request("http://localhost/api/video-generation-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quoteOnly: true, quoteItems }),
        }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: "视频批量报价最多支持 64 个任务" });
        expect(mocks.trustedDurations).not.toHaveBeenCalled();
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
    });

    it("rejects a task-bound quote when it is submitted for another request identity", async () => {
        const configured = structuredClone(settings) as unknown as import("@/lib/auth/store").AuthSettings;
        configured.logicalModels[0].bindings.forEach((binding) => { binding.capabilityProfile = { videoBilling: { mode: "duration", baseSeconds: 1, referenceVideoSeconds: true } }; });
        mocks.getAuthSettings.mockResolvedValue(configured);
        mocks.trustedDurations.mockResolvedValue([]);
        const quoteResponse = await POST(new Request("http://localhost/api/video-generation-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quoteOnly: true, quoteTargetId: "target-one", config: { model: "video", videoSeconds: "5" }, references: [], context: { clientRequestId: "target-one" } }),
        }));
        const { quote } = await quoteResponse.json();
        const response = await POST(new Request("http://localhost/api/video-generation-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-VOZEB-PRO-Client-Request-Id": "target-two" },
            body: JSON.stringify({ config: { model: "video", videoSeconds: "5" }, prompt: "clip", expectedQuote: quote, context: { clientRequestId: "target-two" } }),
        }));

        expect(response.status).toBe(409);
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("keeps output seconds separate from signed billed seconds and saves its snapshot", async () => {
        const configured = structuredClone(settings) as unknown as import("@/lib/auth/store").AuthSettings;
        configured.logicalModels[0].bindings.forEach((binding) => { binding.capabilityProfile = { videoBilling: { mode: "duration", baseSeconds: 1, referenceVideoSeconds: true } }; });
        configured.systemChannels.forEach((channel) => { channel.advancedConfig = normalizeSystemChannelAdvancedConfig({ protocol: "custom", supportsReferenceVideo: true, requestTemplate: '{"model":"{{model}}","seconds":"{{seconds_string}}","reference_videos":"{{videos}}"}' }); });
        mocks.getAuthSettings.mockResolvedValue(configured);
        mocks.trustedDurations.mockResolvedValue([{ storageKey: "clip", durationMs: 15000 }]);
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream", status: "queued" }));
        const response = await confirmedRequest({ model: "video", videoSeconds: "5" }, [{ type: "video", url: "/api/reference-assets/permanent/clip.mp4" }]);
        expect(response.status, JSON.stringify(await response.json())).toBe(200);
        expect(mocks.createVideoTask).toHaveBeenCalledWith(expect.objectContaining({ requestedDurationSeconds: 5, billingSnapshot: expect.objectContaining({ outputSeconds: 5, totalSeconds: 20 }) }));
        const init = mocks.fetchInternalApi.mock.calls[0][1];
        expect(JSON.parse(String(init.body))).toMatchObject({ seconds: "5" });
        expect(new Headers(init.headers).has("x-vozeb-pro-video-billing")).toBe(true);
    });

    it("preserves repeated video occurrences in the actual provider payload and billing", async () => {
        const configured = structuredClone(settings) as unknown as import("@/lib/auth/store").AuthSettings;
        configured.logicalModels[0].bindings.forEach((binding) => { binding.capabilityProfile = { videoBilling: { mode: "duration", baseSeconds: 1, referenceVideoSeconds: true } }; });
        configured.systemChannels.forEach((channel) => { channel.advancedConfig = normalizeSystemChannelAdvancedConfig({ protocol: "custom", supportsReferenceVideo: true, requestTemplate: '{"model":"{{model}}","seconds":"{{seconds_string}}","reference_videos":"{{videos}}"}' }); });
        mocks.getAuthSettings.mockResolvedValue(configured);
        mocks.trustedDurations.mockResolvedValue([{ storageKey: "clip", durationMs: 2300 }, { storageKey: "clip", durationMs: 2300 }]);
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream", status: "queued" }));
        const reference = { type: "video", url: "/api/reference-assets/permanent/clip.mp4" };
        const response = await confirmedRequest({ model: "video", videoSeconds: "5" }, [reference, reference]);
        expect(response.status).toBe(200);
        expect(JSON.parse(String(mocks.fetchInternalApi.mock.calls[0][1].body)).reference_videos).toHaveLength(2);
        expect(mocks.createVideoTask).toHaveBeenCalledWith(expect.objectContaining({ billingSnapshot: expect.objectContaining({ referenceSeconds: 6, totalSeconds: 11 }) }));
    });

    it("finalizes an existing task when a fallback candidate changes its quote", async () => {
        const configured = structuredClone(settings) as unknown as import("@/lib/auth/store").AuthSettings;
        configured.systemChannels[0].advancedConfig = normalizeSystemChannelAdvancedConfig({ protocol: "custom", createPath: "/videos", durationRange: "5-15" });
        configured.systemChannels[1].advancedConfig = normalizeSystemChannelAdvancedConfig({ protocol: "custom", createPath: "/videos", durationRange: "10-15" });
        mocks.getAuthSettings.mockResolvedValue(configured);
        mocks.fetchInternalApi.mockResolvedValue(json({ error: "not found" }, 404));
        const response = await confirmedRequest({ model: "video", videoSeconds: "5" });
        expect(response.status).toBe(409);
        expect(mocks.createVideoTask).toHaveBeenCalledOnce();
        expect(mocks.transitionVideoTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "error", retryable: true }));
        expect(mocks.scheduleGenerationTask.mock.calls.at(-1)?.[2]).toMatchObject({ executionPhase: "completed", lastUpstreamStatus: "quote_changed" });
    });

    it("ignores temporary managed URL signatures in request identity", async () => {
        const configured = structuredClone(settings) as unknown as import("@/lib/auth/store").AuthSettings;
        configured.systemChannels.forEach((channel) => { channel.advancedConfig = normalizeSystemChannelAdvancedConfig({ protocol: "custom", supportsReferenceImage: true }); });
        mocks.getAuthSettings.mockResolvedValue(configured);
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream", status: "queued" }));
        const config = { model: "video", videoSeconds: "5" };
        expect((await POST(request(config, [{ type: "image", url: "/api/reference-assets/permanent/image.png?signature=old" }]))).status).toBe(200);
        mocks.getStoredGenerationTaskByRequest.mockResolvedValueOnce(storedTask);
        mocks.fetchInternalApi.mockClear();
        expect((await POST(request(config, [{ type: "image", url: "/api/reference-assets/permanent/image.png?signature=new" }], { clientRequestId: "same-request" }))).status).toBe(200);
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("returns the original idempotent task before checking concurrency", async () => {
        mocks.getStoredGenerationTaskByRequest.mockResolvedValueOnce({
            id: "existing-task",
            status: "running",
            config: { model: "video-one", logicalModelId: "video" },
            upstream: { id: "existing-upstream" },
        });

        const response = await POST(request({ model: "video" }, [], { clientRequestId: "same-request", attemptNo: 2 }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ task: { id: "existing-task", upstreamId: "existing-upstream" } });
        expect(mocks.getStoredGenerationTaskByRequest).toHaveBeenCalledWith("video", "user", "same-request", 2);
        expect(mocks.getAuthSettings).not.toHaveBeenCalled();
        expect(mocks.withGenerationConcurrencyLimit).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
        expect(mocks.rateLimit).not.toHaveBeenCalled();
    });

    it("rejects missing or forged reference charge confirmation before creating a task", async () => {
        const configured = structuredClone(settings) as unknown as import("@/lib/auth/store").AuthSettings;
        configured.logicalModels[0].bindings.forEach((binding) => { binding.capabilityProfile = { videoBilling: { mode: "duration", baseSeconds: 1, referenceVideoSeconds: true } }; });
        mocks.getAuthSettings.mockResolvedValue(configured);
        mocks.trustedDurations.mockResolvedValue([]);
        expect((await POST(request({ model: "video", videoSeconds: "5" }))).status).toBe(409);
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        const body = { config: { model: "video", videoSeconds: "5" }, quoteOnly: true };
        const quoteResponse = await POST(new Request("http://localhost/api/video-generation-tasks", { method: "POST", body: JSON.stringify(body) }));
        const { quote } = await quoteResponse.json();
        const response = await POST(new Request("http://localhost/api/video-generation-tasks", { method: "POST", body: JSON.stringify({ ...body, quoteOnly: false, prompt: "clip", expectedQuote: { ...quote, confirmation: "forged" } }) }));
        expect(response.status).toBe(409);
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
    });

    it("rejects expired video signatures before task creation even if outer expiresAt is changed", async () => {
        const quoteRequest = new Request("http://localhost/api/video-generation-tasks", { method: "POST", body: JSON.stringify({ config: { model: "video", videoSeconds: "5" }, quoteOnly: true }) });
        const { quote } = await (await POST(quoteRequest)).json();
        const now = vi.spyOn(Date, "now").mockReturnValue(quote.expiresAt + 1);
        try {
            const response = await POST(new Request("http://localhost/api/video-generation-tasks", { method: "POST", body: JSON.stringify({ config: { model: "video", videoSeconds: "5" }, prompt: "clip", expectedQuote: { ...quote, expiresAt: quote.expiresAt + 60_000 } }) }));
            expect(response.status).toBe(409);
            expect(mocks.createVideoTask).not.toHaveBeenCalled();
            expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
        } finally { now.mockRestore(); }
    });

    it("rejects changed input for an existing request without creating another task", async () => {
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream", status: "queued" }));
        await POST(request({ model: "video", videoSeconds: "5" }));
        mocks.getStoredGenerationTaskByRequest.mockResolvedValueOnce(storedTask);
        mocks.createVideoTask.mockClear();
        mocks.fetchInternalApi.mockClear();
        const response = await POST(request({ model: "video", videoSeconds: "10" }, [], { clientRequestId: "same-request" }));
        expect(response.status).toBe(409);
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("reuses the original snapshot on an identical request without repricing", async () => {
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream", status: "queued" }));
        await POST(request({ model: "video", videoSeconds: "5" }));
        mocks.getStoredGenerationTaskByRequest.mockResolvedValueOnce(storedTask);
        mocks.getAuthSettings.mockClear();
        mocks.fetchInternalApi.mockClear();
        const response = await POST(request({ model: "video", videoSeconds: "5" }, [], { clientRequestId: "same-request" }));
        expect(response.status).toBe(200);
        expect(mocks.getAuthSettings).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("rejects a changed quote before task creation or upstream billing", async () => {
        const response = await POST(new Request("http://localhost/api/video-generation-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { model: "video", videoSeconds: "5" }, prompt: "clip", expectedQuote: { points: -1, outputSeconds: 5, referenceSeconds: 0, totalSeconds: 5 } }) }));
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining("报价已变化"), quote: { outputSeconds: 5 } });
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("rejects conflicting candidate reference billing rules", async () => {
        const configured = structuredClone(settings) as unknown as import("@/lib/auth/store").AuthSettings;
        configured.logicalModels[0].bindings[0].capabilityProfile = { videoBilling: { mode: "duration", baseSeconds: 1, referenceVideoSeconds: true } };
        configured.logicalModels[0].bindings[1].capabilityProfile = { videoBilling: { mode: "duration", baseSeconds: 10, referenceVideoSeconds: true } };
        mocks.getAuthSettings.mockResolvedValue(configured);
        mocks.trustedDurations.mockResolvedValue([]);
        mocks.fetchInternalApi.mockResolvedValue(json({ error: "not found" }, 404));
        const response = await POST(request());
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining("规则不一致") });
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("finds a canvas task by its exact request identity without creating or billing", async () => {
        mocks.getStoredGenerationTaskByRequest.mockResolvedValueOnce({ id: "saved-task", userId: "user", surface: "canvas", projectId: "canvas-one", config: { model: "video-one" }, requestedDurationSeconds: 10 });
        const response = await GET(new Request("http://localhost/api/video-generation-tasks?projectId=canvas-one&clientRequestId=canvas-video%3Arequest&attemptNo=1"));
        expect(await response.json()).toEqual({ task: { id: "saved-task", model: "video-one", durationSeconds: 10 } });
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(mocks.getStoredGenerationTaskByRequest).toHaveBeenCalledWith("video", "user", "canvas-video:request", 1);
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it.each([null, { userId: "another-user", surface: "canvas", projectId: "canvas-one" }, { userId: "user", surface: "canvas", projectId: "other-project" }, { userId: "user", surface: "chat", projectId: "canvas-one" }])(
        "does not expose missing or differently scoped tasks: %j",
        async (task) => {
            mocks.getStoredGenerationTaskByRequest.mockResolvedValueOnce(task);
            const response = await GET(new Request("http://localhost/api/video-generation-tasks?projectId=canvas-one&clientRequestId=request&attemptNo=1"));
            expect(await response.json()).toEqual({ task: null });
            expect(mocks.createVideoTask).not.toHaveBeenCalled();
        },
    );

    it("requires authentication and a valid lookup identity", async () => {
        vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
        expect((await GET(new Request("http://localhost/api/video-generation-tasks"))).status).toBe(401);
        expect((await GET(new Request("http://localhost/api/video-generation-tasks?projectId=canvas-one&clientRequestId=request&attemptNo=0"))).status).toBe(400);
        expect(mocks.getStoredGenerationTaskByRequest).not.toHaveBeenCalled();
    });

    it("returns the active task scheduler retry time when video capacity is full", async () => {
        mocks.withGenerationConcurrencyLimit.mockResolvedValueOnce(null);
        mocks.generationCapacityRetryAfterSeconds.mockResolvedValueOnce(9);

        const response = await POST(request());

        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("9");
        expect(mocks.generationCapacityRetryAfterSeconds).toHaveBeenCalledWith("user", "video", 30 * 60_000);
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("rejects unsupported video parameters before task creation or upstream submission", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            logicalModels: [
                {
                    ...settings.logicalModels[0],
                    bindings: settings.logicalModels[0].bindings.map((binding) => ({ ...binding, capabilityProfile: { aspectRatios: ["9:16"], resolutions: ["1080"], durationSeconds: [8] } })),
                },
            ],
        });

        const response = await POST(request({ model: "video", size: "1:1", vquality: "720", videoSeconds: "6" }));

        expect(response.status).toBe(400);
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("accepts intelligent video parameters and omits fixed ratio and resolution upstream", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            logicalModels: [
                {
                    ...settings.logicalModels[0],
                    bindings: settings.logicalModels[0].bindings.map((binding) => ({ ...binding, capabilityProfile: { aspectRatios: ["9:16"], resolutions: ["1080"] } })),
                },
            ],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "smart-video", status: "queued" }));

        const response = await POST(request({ model: "video", size: "auto", vquality: "auto", videoSeconds: "5" }));
        const upstreamBody = JSON.parse(String((mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit])[1].body));

        expect(response.status).toBe(200);
        expect(upstreamBody).not.toHaveProperty("ratio");
        expect(upstreamBody).not.toHaveProperty("aspect_ratio");
        expect(upstreamBody).not.toHaveProperty("resolution");
        expect(upstreamBody).not.toHaveProperty("quality");
    });

    it("passes exact video dimensions, custom clarity, audio, duration, and watermark upstream", async () => {
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "custom-video", status: "queued" }));

        const response = await POST(
            request({
                model: "video",
                size: "1440x1920",
                vquality: "2160",
                videoSeconds: "12",
                videoGenerateAudio: false,
                videoWatermark: true,
            }),
        );
        const upstreamBody = JSON.parse(String((mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit])[1].body));

        expect(response.status).toBe(200);
        expect(upstreamBody).toMatchObject({
            size: "1440x1920",
            width: 1440,
            height: 1920,
            resolution: "2160p",
            quality: "2160p",
            duration: 12,
            seconds: 12,
            generate_audio: false,
            watermark: true,
        });
    });

    it("keeps a named custom video clarity instead of rewriting it", async () => {
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "custom-clarity", status: "queued" }));

        const response = await POST(request({ model: "video", vquality: "4K", videoSeconds: "5" }));
        const upstreamBody = JSON.parse(String((mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit])[1].body));

        expect(response.status).toBe(200);
        expect(upstreamBody).toMatchObject({ resolution: "4K", quality: "4K" });
    });

    it("does not retry another binding after an ambiguous 2xx response", async () => {
        mocks.fetchInternalApi.mockResolvedValue(new Response("not-json", { status: 200, headers: { "x-vozeb-pro-points-cost": "2.5", "x-vozeb-pro-points-record-id": "video-points-unknown" } }));

        const response = await POST(request());

        expect(response.status).toBe(202);
        expect(mocks.fetchInternalApi.mock.calls.some(([url]) => String(url).includes("/api/ai/system/two/"))).toBe(false);
        expect(mocks.createVideoTask).toHaveBeenCalledOnce();
        expect(mocks.scheduleGenerationTask).toHaveBeenLastCalledWith("video", "local-task", expect.objectContaining({ executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "submission_outcome_unknown" }));
        expect(mocks.refundUserPoints).not.toHaveBeenCalled();
        expect(mocks.updateVideoTask).toHaveBeenCalledWith("local-task", expect.objectContaining({ upstream: expect.objectContaining({ pointsCost: 2.5, pointsUnits: expect.any(Number), pointsRecordId: "video-points-unknown", refunded: false }) }));
    });

    it("appends unknown video billing when the fenced snapshot update returns null", async () => {
        mocks.updateVideoTask.mockResolvedValue(null);
        mocks.fetchInternalApi.mockResolvedValue(new Response("unknown", { status: 502, headers: { "x-vozeb-pro-settlement-status": "unknown", "x-vozeb-pro-points-cost": "2.5", "x-vozeb-pro-points-record-id": "late-video" } }));
        expect((await POST(request())).status).toBe(202);
        expect(appendGenerationTaskBillingEvidence).toHaveBeenCalledWith("video", "local-task", "user", expect.objectContaining({ pointsCost: 2.5, pointsRecordId: "late-video" }));
        expect(mocks.refundUserPoints).not.toHaveBeenCalled();
    });

    it("does not retry another path or binding after an ambiguous server failure", async () => {
        mocks.fetchInternalApi.mockResolvedValue(json({ error: "gateway failed" }, 502));

        const response = await POST(request());

        expect(response.status).toBe(202);
        expect(mocks.fetchInternalApi).toHaveBeenCalledTimes(1);
        expect(mocks.fetchInternalApi.mock.calls.some(([url]) => String(url).includes("/api/ai/system/two/"))).toBe(false);
        expect(mocks.createVideoTask).toHaveBeenCalledOnce();
    });

    it("surfaces an explicit HTTP 200 business failure after safe candidate fallback", async () => {
        mocks.fetchInternalApi.mockImplementation(async () => json({ code: "204", msg: "登录验证失败" }));

        const response = await POST(request());

        expect(response.status).toBe(502);
        expect((await response.json()).error).toBe("登录验证失败");
        expect(mocks.createVideoTask).toHaveBeenCalledOnce();
    });

    it("enqueues a GlobalAiOpc task for the recovery worker after creation", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [{ ...channels[0], advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "video-videos" } }],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockResolvedValueOnce(json({ id: "global-video-task", status: "queued" }));

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.scheduleGenerationTask).toHaveBeenLastCalledWith("video", "local-task", expect.objectContaining({ executionPhase: "submitted", upstreamTaskId: "global-video-task" }));
        expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    });

    it("uses the backend default logical model when the client omits a model", async () => {
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-default", status: "queued" }));

        const response = await POST(request({}));

        expect(response.status).toBe(200);
        expect((await response.json()).task.model).toBe("video");
    });

    it("creates a Gemini Veo long-running operation with the native request contract", async () => {
        mocks.getAuthSettings.mockResolvedValue(geminiSettings());
        mocks.fetchInternalApi.mockResolvedValue(json({ name: "models/veo-3.1-generate-preview/operations/gemini-operation-one", done: false }));

        const response = await POST(request({ model: "gemini-video", videoSeconds: 5, size: "16:9", vquality: "720" }));
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];
        const payload = JSON.parse(String(init.body));

        expect(response.status).toBe(200);
        expect(url).toContain("/api/ai/system/gemini/models/veo-3.1-generate-preview:predictLongRunning");
        expect(payload).toEqual({
            instances: [{ prompt: "A test video" }],
            parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "720p", generateAudio: true },
        });
        expect(mocks.scheduleGenerationTask).toHaveBeenLastCalledWith(
            "video",
            "local-task",
            expect.objectContaining({
                executionPhase: "submitted",
                upstreamTaskId: "gemini-operation-one",
                queryPath: "/models/veo-3.1-generate-preview/operations/gemini-operation-one",
            }),
        );
        expect((await response.json()).task.durationSeconds).toBe(6);
    });

    it.each([
        ["invalid JSON", "not-json"],
        ["missing operation ID", JSON.stringify({ done: false })],
    ])("keeps Gemini billing for a 2xx %s response pending manual review", async (_name, body) => {
        mocks.getAuthSettings.mockResolvedValue(geminiSettings());
        mocks.fetchInternalApi.mockResolvedValue(
            new Response(body, {
                status: 200,
                headers: { "content-type": "application/json", "x-vozeb-pro-points-cost": "3.5", "x-vozeb-pro-points-record-id": "gemini-video-points-unknown" },
            }),
        );

        const response = await POST(request({ model: "gemini-video", videoSeconds: 5, size: "16:9", vquality: "720" }));

        expect(response.status).toBe(202);
        expect(mocks.refundUserPoints).not.toHaveBeenCalled();
        expect(mocks.updateVideoTask).toHaveBeenCalledWith("local-task", expect.objectContaining({ upstream: expect.objectContaining({ pointsCost: 3.5, pointsRecordId: "gemini-video-points-unknown", refunded: false }) }));
        expect(mocks.scheduleGenerationTask).toHaveBeenLastCalledWith("video", "local-task", expect.objectContaining({ executionPhase: "needs_review", lastUpstreamStatus: "submission_outcome_unknown" }));
    });

    it("rejects Gemini reference video and audio before creating an operation", async () => {
        mocks.getAuthSettings.mockResolvedValue(geminiSettings());

        const response = await POST(request({ model: "gemini-video" }, [{ type: "video", url: "https://cdn.example.com/reference.mp4" }]));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("参考视频");
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("forwards the authenticated maintenance worker identity to the internal system proxy", async () => {
        const token = "maintenance-token-used-by-generation-worker";
        vi.stubEnv("VOZEB_PRO_MAINTENANCE_TOKEN", `${token}-maintenance`);
        vi.stubEnv("VOZEB_PRO_WORKER_TOKEN", token);
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-worker", status: "queued" }));

        const response = await POST(
            new Request("http://localhost/api/video-generation-tasks", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                    "x-vozeb-pro-worker-user-id": "user",
                },
                body: JSON.stringify({ config: { model: "video" }, prompt: "A test video", references: [] }),
            }),
        );
        const headers = new Headers((mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit).headers);

        expect(response.status).toBe(200);
        expect(headers.get("authorization")).toBe(`Bearer ${token}`);
        expect(headers.get("x-vozeb-pro-worker-user-id")).toBe("user");
        expect(headers.has("cookie")).toBe(false);
    });

    it("uses the SD2.0 model route without affecting OpenAI models on the same channel", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    models: ["openai-text", "sd2.0"],
                    advancedConfig: {
                        protocol: "auto",
                        createPath: "/wrong-channel-path",
                        modelConfigs: { "sd2.0": { capability: "video", protocol: "seedance", createPath: "/sd2/videos", queryPath: "/sd2/videos/:task_id" } },
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [{ ...settings.logicalModels[0].bindings[0], upstreamModel: "sd2.0" }] }],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-sd2", status: "queued" }));

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.fetchInternalApi.mock.calls[0][0]).toContain("/api/ai/system/one/sd2/videos");
    });

    it("uses separate text-to-video and image-to-video paths with trusted billing headers", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "custom",
                        modelConfigs: {
                            "video-one": {
                                capability: "video",
                                protocol: "custom",
                                createPath: "/text-to-video",
                                imageToVideoPath: "/image-to-video",
                                requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","images":"{{images}}"}',
                                resultField: "id",
                                supportsReferenceImage: true,
                            },
                        },
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockImplementation(async () => json({ id: "upstream-custom", status: "queued" }));

        const textResponse = await POST(request({ model: "video" }, [], { clientRequestId: "video-text" }));
        const imageResponse = await POST(request({ model: "video" }, [{ type: "image", url: "https://cdn.example.com/reference.jpg" }], { clientRequestId: "video-image" }));
        const imagePayload = await imageResponse.clone().json();
        const [textUrl, textInit] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];
        const [imageUrl, imageInit] = mocks.fetchInternalApi.mock.calls[1] as [string, RequestInit];
        const textHeaders = new Headers(textInit.headers);
        const imageHeaders = new Headers(imageInit.headers);

        expect(textResponse.status).toBe(200);
        expect(imageResponse.status, JSON.stringify(imagePayload)).toBe(200);
        expect(textUrl).toContain("/api/ai/system/one/text-to-video");
        expect(imageUrl).toContain("/api/ai/system/one/image-to-video");
        expect(textHeaders.get("x-vozeb-pro-logical-model")).toBe("video");
        expect(textHeaders.get("x-vozeb-pro-upstream-model")).toBe("video-one");
        expect(textHeaders.get("x-vozeb-pro-points-idempotency-key")).toBe("video-request:video-text");
        expect(imageHeaders.get("x-vozeb-pro-points-idempotency-key")).toBe("video-request:video-image");
    });

    it("builds an OpenAI video multipart request and uses its image-to-video path", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "openai",
                        modelConfigs: {
                            "video-one": {
                                capability: "video",
                                protocol: "openai",
                                createPath: "/videos",
                                imageToVideoPath: "/videos",
                                queryPath: "/videos/:task_id",
                                requestTemplate: "multipart/form-data: model、prompt、seconds、size、input_reference",
                                resultField: "/videos/:task_id/content",
                                statusField: "status",
                                supportsReferenceImage: true,
                            },
                        },
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-openai", status: "queued" }));
        const reference = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

        const response = await POST(request({ model: "video", videoSeconds: "5", size: "16:9" }, [{ type: "image", url: reference }]));
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];
        const body = init.body as FormData;

        expect(response.status).toBe(200);
        expect(url).toContain("/api/ai/system/one/videos");
        expect(init.body).toBeInstanceOf(FormData);
        expect(new Headers(init.headers).has("content-type")).toBe(false);
        expect(body.get("model")).toBe("video-one");
        expect(body.get("seconds")).toBe("5");
        expect(body.get("size")).toBe("1280x720");
        expect(body.get("input_reference")).toBeInstanceOf(File);

        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-openai-auto", status: "queued" }));
        const intelligentResponse = await POST(request({ model: "video", videoSeconds: "5", size: "auto", vquality: "auto" }));
        const intelligentBody = (mocks.fetchInternalApi.mock.calls[1] as [string, RequestInit])[1].body as FormData;

        expect(intelligentResponse.status).toBe(200);
        expect(intelligentBody.get("size")).toBeNull();
    });

    it("persists the Drama project, episode and shot task context", async () => {
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-drama", status: "queued" }));
        const context = { surface: "drama", projectId: "drama-one", episodeId: "episode-one", shotId: "shot-one", estimatedPoints: 8, attemptNo: 2, clientRequestId: "drama-video:one" };

        const response = await POST(request({ model: "video" }, [], context));

        expect(response.status).toBe(200);
        expect(mocks.createVideoTask).toHaveBeenCalledWith(expect.objectContaining(context));
        expect(mocks.linkStoredGenerationTask).toHaveBeenCalledWith("video", "local-task", context);
    });

    it("rejects a raw upstream model when the logical catalog exists", async () => {
        const response = await POST(request({ model: "video-one" }));

        expect(response.status).toBe(400);
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("rejects an image logical model for a video task", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [...channels, { id: "image", name: "图片渠道", baseUrl: "https://image.example.com/v1", apiKey: "image-secret", apiFormat: "openai", models: ["stable-diffusion-2.0"], enabled: true, advancedConfig: { protocol: "openai" } }],
            logicalModels: [
                ...settings.logicalModels,
                {
                    id: "stable-diffusion-2.0",
                    name: "Stable Diffusion",
                    capability: "image",
                    enabled: true,
                    bindings: [{ id: "image-binding", channelId: "image", upstreamModel: "stable-diffusion-2.0", enabled: true, priority: 1 }],
                },
            ],
        });

        const response = await POST(request({ model: "stable-diffusion-2.0" }));

        expect(response.status).toBe(400);
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("sends a compatible image-to-video request with the real reference and current parameters", async () => {
        mocks.getAuthSettings.mockResolvedValue(publicUrlCompatibleSettings());
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-image-video", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: "10", size: "9:16", vquality: "1080" }, [{ type: "image", url: "https://cdn.example.com/reference.jpg" }]));
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;
        const upstreamBody = JSON.parse(String(init.body));

        expect(response.status).toBe(200);
        expect(upstreamBody).toMatchObject({ model: "video-one", duration: 10, ratio: "9:16", image: "https://cdn.example.com/reference.jpg" });
        expect(upstreamBody.prompt).toContain("A test video");
        expect(upstreamBody.prompt).toContain("将参考图作为首帧、主体身份、外观和场景的主要依据");
        expect(upstreamBody.prompt).toContain("禁止替换主体");
        expect(upstreamBody.images).toEqual(["https://cdn.example.com/reference.jpg"]);
    });

    it("sends a compatible text-to-video request without empty reference fields", async () => {
        mocks.getAuthSettings.mockResolvedValue(publicUrlCompatibleSettings());
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-text-video", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: "5", size: "16:9", vquality: "720" }));
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;
        const upstreamBody = JSON.parse(String(init.body));

        expect(response.status).toBe(200);
        expect(upstreamBody).toMatchObject({ model: "video-one", duration: 5, ratio: "16:9", prompt: "A test video" });
        expect(mocks.createVideoTask).toHaveBeenCalledWith(expect.objectContaining({ requestedDurationSeconds: 5 }));
        expect(upstreamBody).not.toHaveProperty("image");
        expect(upstreamBody).not.toHaveProperty("images");
        expect(upstreamBody.prompt).not.toContain("参考素材一致性要求");
    });

    it("converts workbench pixel sizes into the provider ratio field", async () => {
        mocks.getAuthSettings.mockResolvedValue(publicUrlCompatibleSettings());
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-pixel-ratio", status: "queued" }));

        const response = await POST(request({ model: "video", size: "1280x720" }));
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;

        expect(response.status).toBe(200);
        expect(JSON.parse(String(init.body))).toMatchObject({ ratio: "16:9" });
    });

    it("rounds a requested duration up to the next duration supported by the selected upstream", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "custom",
                        modelConfigs: {
                            "video-one": {
                                capability: "video",
                                protocol: "custom",
                                createPath: "/videos",
                                queryPath: "/videos/:task_id",
                                requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","duration":"{{duration}}"}',
                                resultField: "id",
                                durationRange: "5、8、10 秒",
                            },
                        },
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-duration", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: 7 }));
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;

        expect(response.status).toBe(200);
        expect(JSON.parse(String(init.body))).toMatchObject({ duration: 8 });
        expect(mocks.createVideoTask).toHaveBeenCalledWith(expect.objectContaining({ requestedDurationSeconds: 8 }));
        expect((await response.json()).task.durationSeconds).toBe(8);
    });

    it("uses the selected GlobalAiOpc preset path and Seedance content request body", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "globalaiopc",
                        globalAiOpcPreset: "video-seedance-discount",
                        createPath: "/seedance-discount/videos",
                        queryPath: "/result/:task_id",
                        supportsReferenceImage: true,
                        supportsReferenceVideo: true,
                        supportsReferenceAudio: true,
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "global-seedance-task", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: "5", size: "16:9" }, [{ type: "image", url: "https://cdn.example.com/reference.jpg" }]));
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];

        expect(response.status).toBe(200);
        expect(url).toContain("/api/ai/system/one/seedance-discount/videos");
        expect(JSON.parse(String(init.body))).toMatchObject({
            model: "video-one",
            duration: 5,
            ratio: "16:9",
            content: [expect.objectContaining({ type: "text", text: expect.stringContaining("A test video") }), { type: "image_url", role: "reference_image", image_url: { url: "https://cdn.example.com/reference.jpg" } }],
        });
    });

    it("submits normalized video and audio references in the custom content payload", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "custom",
                        createPath: "/contents/generations/tasks",
                        queryPath: "/contents/generations/tasks/:task_id",
                        requestTemplate: '{"model":"{{model}}","content":"{{content}}"}',
                        supportsReferenceVideo: true,
                        supportsReferenceAudio: true,
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.normalizeImageReferences.mockImplementationOnce(async (input: { references: unknown[] }) =>
            (input.references as Array<{ type: string; url: string }>).map((reference) => ({ ...reference, url: `https://objects.example/${reference.type}?signature=test` })),
        );
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "mixed-reference-task", status: "queued" }));

        const response = await POST(
            request({ model: "video" }, [
                { type: "video", url: "https://cdn.example/reference.mp4" },
                { type: "audio", url: "https://cdn.example/reference.mp3" },
            ]),
        );

        expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
        const [, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(init.body)).content).toEqual([
            expect.objectContaining({ type: "text" }),
            { type: "video_url", role: "reference_video", video_url: { url: "https://objects.example/video?signature=test" } },
            { type: "audio_url", role: "reference_audio", audio_url: { url: "https://objects.example/audio?signature=test" } },
        ]);
    });

    it("sends explicit first and last frames as Seedance content roles", async () => {
        mocks.getAuthSettings.mockResolvedValue(seedanceFrameSettings());
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "seedance-frame-task", status: "queued" }));

        const response = await POST(
            request({ model: "video", videoSeconds: "5", size: "16:9" }, [
                { type: "image", url: "https://cdn.example.com/first.png", role: "first_frame" },
                { type: "image", url: "https://cdn.example.com/last.png", role: "last_frame" },
            ]),
        );
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];

        expect(response.status).toBe(200);
        expect(url).toContain("/api/ai/system/one/seedance-special/videos");
        expect(JSON.parse(String(init.body))).toMatchObject({
            content: [
                expect.objectContaining({ type: "text" }),
                { type: "image_url", role: "first_frame", image_url: { url: "https://cdn.example.com/first.png" } },
                { type: "image_url", role: "last_frame", image_url: { url: "https://cdn.example.com/last.png" } },
            ],
        });
    });

    it("rejects a last frame on OpenAI before creating or billing an upstream task", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [{ ...channels[0], advancedConfig: { protocol: "openai", supportsReferenceImage: true } }],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });

        const response = await POST(
            request({ model: "video" }, [
                { type: "image", url: "https://cdn.example.com/first.png", role: "first_frame" },
                { type: "image", url: "https://cdn.example.com/last.png", role: "last_frame" },
            ]),
        );

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("不支持尾帧输入");
        expect(mocks.createVideoTask).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("skips an unsupported candidate and submits the same frame roles to the next capable binding", async () => {
        const seedanceModel = "sd_2.0_fast_special_720p";
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                { ...channels[0], advancedConfig: { protocol: "openai", supportsReferenceImage: true } },
                {
                    ...channels[1],
                    models: [seedanceModel],
                    advancedConfig: { protocol: "seedance-special", createPath: "/seedance-special/videos", queryPath: "/result/:task_id", supportsReferenceImage: true },
                },
            ],
            logicalModels: [
                {
                    ...settings.logicalModels[0],
                    bindings: [settings.logicalModels[0].bindings[0], { ...settings.logicalModels[0].bindings[1], upstreamModel: seedanceModel }],
                },
            ],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "seedance-fallback-task", status: "queued" }));

        const response = await POST(
            request({ model: "video" }, [
                { type: "image", url: "https://cdn.example.com/first.png", role: "first_frame" },
                { type: "image", url: "https://cdn.example.com/last.png", role: "last_frame" },
            ]),
        );

        expect(response.status).toBe(200);
        expect(mocks.createVideoTask).toHaveBeenCalledTimes(1);
        expect(mocks.fetchInternalApi).toHaveBeenCalledTimes(1);
        expect(String(mocks.fetchInternalApi.mock.calls[0][0])).toContain("/api/ai/system/two/seedance-special/videos");
    });

    it("ignores legacy GlobalAiOpc sample references for text-to-video requests", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "globalaiopc",
                        createPath: "/videos/videos",
                        queryPath: "/result/:task_id",
                        requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","referenceImages":["https://example.com/rabbit.png"],"referenceAudios":["{{image}}"]}',
                        supportsReferenceImage: true,
                        supportsReferenceVideo: true,
                        supportsReferenceAudio: true,
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "global-videos-task", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: "5", size: "16:9", vquality: "720" }));
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];
        const upstreamBody = JSON.parse(String(init.body));

        expect(response.status).toBe(200);
        expect(url).toContain("/api/ai/system/one/videos/videos");
        expect(upstreamBody).toEqual({ model: "video-one", prompt: "A test video", duration: 5, ratio: "16:9", resolution: "720p" });
        expect(upstreamBody).not.toHaveProperty("referenceImages");
        expect(upstreamBody).not.toHaveProperty("referenceVideos");
        expect(upstreamBody).not.toHaveProperty("referenceAudios");
    });

    it("selects the matching endpoint from a multi-preset GlobalAiOpc channel", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    models: ["happyhorse-1.0-i2v", "videos_stable"],
                    advancedConfig: {
                        protocol: "globalaiopc",
                        globalAiOpcPresets: ["video-happyhorse-i2v", "video-videos"],
                        supportsReferenceImage: true,
                        supportsReferenceVideo: true,
                        supportsReferenceAudio: true,
                    },
                },
            ],
            logicalModels: [
                {
                    ...settings.logicalModels[0],
                    bindings: [{ ...settings.logicalModels[0].bindings[0], upstreamModel: "videos_stable" }],
                },
            ],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "global-multi-task", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: "5", size: "16:9", vquality: "720" }));
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];

        expect(response.status).toBe(200);
        expect(url).toContain("/api/ai/system/one/videos/videos");
        expect(JSON.parse(String(init.body))).toEqual({ model: "videos_stable", prompt: "A test video", duration: 5, ratio: "16:9", resolution: "720p" });
    });

    it("submits the documented Yumeng Seedance 2 fields to the v2 model-center path", async () => {
        mocks.getAuthSettings.mockResolvedValue(yumengSettings());
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "yumeng-task", status: "queued" }));
        const references = [
            { type: "image", url: "https://cdn.example.com/reference.png" },
            { type: "video", url: "https://cdn.example.com/reference.mp4" },
            { type: "audio", url: "https://cdn.example.com/reference.mp3" },
        ];

        const response = await POST(request({ model: "sd_2.0_fast_special", videoSeconds: "60", size: "16:9", vquality: "720" }, references));
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(init.body));

        expect(response.status).toBe(200);
        expect(url).toBe("http://localhost/api/ai/system/yumeng/kyyReactApiServer/v2/model-center/tasks");
        expect(body).toMatchObject({
            model: "sd_2.0_fast_special",
            duration: 15,
            aspect_ratio: "16:9",
            resolution: "720p",
            reference_images: ["https://cdn.example.com/reference.png"],
            reference_videos: ["https://cdn.example.com/reference.mp4"],
            reference_audios: ["https://cdn.example.com/reference.mp3"],
            generate_audio: "true",
            tools: [],
            watermark: "false",
        });
        expect(body).not.toHaveProperty("first_image");
        expect(body).not.toHaveProperty("last_image");
    });

    it("submits the normalized PNG reference instead of the source WebP", async () => {
        mocks.getAuthSettings.mockResolvedValue(yumengSettings());
        mocks.normalizeImageReferences.mockImplementationOnce(async (input: { references: unknown[] }) =>
            (input.references as Array<{ type: string; url: string; role?: string }>).map((reference) =>
                reference.type === "image" ? { ...reference, url: "https://site.example/api/reference-assets/temporary/reference.png?purpose=provider-read&expires=9999999999&signature=normalized" } : reference,
            ),
        );
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "yumeng-task", status: "queued" }));

        const response = await POST(request({ model: "sd_2.0_fast_special", videoSeconds: "5", size: "16:9", vquality: "720" }, [{ type: "image", url: "https://cdn.example.com/reference.webp" }]));
        expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
        const [, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(init.body));

        expect(mocks.normalizeImageReferences).toHaveBeenCalledWith({
            references: [{ type: "image", role: "reference", url: "https://cdn.example.com/reference.webp" }],
            userId: "user",
            internalOrigin: "http://localhost",
            publicOrigin: "http://localhost",
        });
        expect(body.reference_images).toEqual(["https://site.example/api/reference-assets/temporary/reference.png?purpose=provider-read&expires=9999999999&signature=normalized"]);
        expect(JSON.stringify(body)).not.toContain("reference.webp");
    });

    it("signs an owned generation asset without creating a reference copy", async () => {
        vi.stubEnv("VOZEB_PRO_REFERENCE_ASSET_SIGNING_KEY", "test-signing-key");
        mocks.getAuthSettings.mockResolvedValue(yumengSettings());
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "yumeng-task", status: "queued" }));
        const source = "/api/generation-log-assets/permanent/2026/08/20/images/storyboard.png";

        const response = await POST(request({ model: "sd_2.0_fast_special", videoSeconds: "5", size: "16:9", vquality: "720" }, [{ type: "image", url: source }], undefined, "https://drama.example/api/video-generation-tasks"));

        expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
        expect(mocks.requireManagedMediaInputOwner).toHaveBeenCalledWith(source, { id: "user", role: "user" }, "generation");
        expect(mocks.normalizeImageReferences).toHaveBeenCalledWith(
            expect.objectContaining({
                references: [expect.objectContaining({ url: expect.stringMatching(/^https:\/\/drama\.example\/api\/generation-log-assets\/.+purpose=provider-read/) })],
            }),
        );
        vi.unstubAllEnvs();
    });

    it("rejects local reference URLs before creating a public-URL provider task", async () => {
        mocks.getAuthSettings.mockResolvedValue(publicUrlCompatibleSettings());

        const response = await POST(request({ model: "video" }, [{ type: "image", url: "http://127.0.0.1:3000/api/reference-assets/reference.jpg" }]));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("站内参考素材");
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("returns 400 for malformed JSON", async () => {
        const response = await POST(new Request("http://localhost/api/video-generation-tasks", { method: "POST", body: "{" }));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe("请求内容不是有效 JSON");
    });

    it("returns 413 before reading an oversized JSON body", async () => {
        const response = await POST(
            new Request("http://localhost/api/video-generation-tasks", {
                method: "POST",
                headers: { "content-length": String(4 * 1024 * 1024 + 1) },
                body: "{}",
            }),
        );

        expect(response.status).toBe(413);
        expect((await response.json()).error).toBe("请求体过大");
    });
});

async function confirmedRequest(config: Record<string, unknown>, references: Array<{ type: string; url: string; role?: string }> = []) {
    const body = { config, references, prompt: "clip" };
    const quoteResponse = await POST(new Request("http://localhost/api/video-generation-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, quoteOnly: true }) }));
    expect(quoteResponse.status).toBe(200);
    const { quote } = await quoteResponse.json();
    return POST(new Request("http://localhost/api/video-generation-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, expectedQuote: quote }) }));
}

function request(config: Record<string, unknown> = { model: "video" }, references: Array<{ type: string; url: string; role?: string }> = [], context?: Record<string, unknown>, requestUrl = "http://localhost/api/video-generation-tasks") {
    const clientRequestId = typeof context?.clientRequestId === "string" ? context.clientRequestId : "";
    return new Request(requestUrl, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(clientRequestId ? { "x-vozeb-pro-client-request-id": clientRequestId } : {}),
            ...(typeof context?.attemptNo === "number" ? { "x-vozeb-pro-attempt-no": String(context.attemptNo) } : {}),
        },
        body: JSON.stringify({ config, prompt: "A test video", references, context }),
    });
}

function seedanceFrameSettings() {
    const model = "sd_2.0_fast_special_720p";
    return {
        ...settings,
        systemChannels: [
            {
                ...channels[0],
                models: [model],
                advancedConfig: { protocol: "seedance-special", createPath: "/seedance-special/videos", queryPath: "/result/:task_id", supportsReferenceImage: true },
            },
        ],
        logicalModels: [
            {
                ...settings.logicalModels[0],
                bindings: [{ ...settings.logicalModels[0].bindings[0], upstreamModel: model }],
            },
        ],
    };
}

function publicUrlCompatibleSettings() {
    return {
        ...settings,
        systemChannels: [
            {
                ...channels[0],
                advancedConfig: {
                    protocol: "compatible",
                    supportsReferenceImage: true,
                    supportsReferenceVideo: false,
                    supportsReferenceAudio: false,
                    referenceRule: "图生视频使用公网图片 URL；单图字段 image，多图字段 images。",
                    requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","duration":"{{duration}}","ratio":"{{ratio}}","image":"https://...","images":["https://..."]}',
                },
            },
        ],
        logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
    };
}

function yumengSettings() {
    const model = "sd_2.0_fast_special";
    const operation = {
        capability: "video" as const,
        source: "official" as const,
        protocol: "yumeng" as const,
        apiFormat: "openai" as const,
        createPath: "/kyyReactApiServer/v2/model-center/tasks",
        imageToVideoPath: "/kyyReactApiServer/v2/model-center/tasks",
        queryPath: "/kyyReactApiServer/v2/model-center/tasks/:task_id",
        requestTemplate:
            '{"model":"{{model}}","prompt":"{{prompt}}","reference_images":"{{images}}","reference_videos":"{{videos}}","reference_audios":"{{audios}}","duration":"{{duration}}","aspect_ratio":"{{aspect_ratio}}","resolution":"{{resolution}}","seed":"-1","first_image":"{{first_frame}}","last_image":"{{last_frame}}","generate_audio":"{{generate_audio_text}}","tools":[],"watermark":"{{watermark_text}}"}',
        resultField: "result_url / video_url",
        statusField: "status",
        durationRange: "4-15 秒",
        referenceRule: "参考素材必须是上游可访问的 URL。",
        supportsReferenceImage: true,
        supportsReferenceVideo: true,
        supportsReferenceAudio: true,
    };
    return {
        ...settings,
        systemChannels: [
            {
                id: "yumeng",
                name: "昱梦",
                baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer",
                apiKey: "yumeng-secret",
                apiFormat: "openai" as const,
                models: [model],
                enabled: true,
                advancedConfig: { protocol: "yumeng" as const, modelCapabilities: { [model]: "video" as const }, modelConfigs: { [model]: operation } },
            },
        ],
        logicalModels: [
            {
                id: model,
                name: model,
                capability: "video" as const,
                enabled: true,
                bindings: [{ id: "yumeng-seedance", channelId: "yumeng", upstreamModel: model, enabled: true, priority: 1 }],
            },
        ],
    };
}

function geminiSettings() {
    const model = "veo-3.1-generate-preview";
    const operation = {
        capability: "video" as const,
        source: "manual" as const,
        protocol: "gemini" as const,
        apiFormat: "gemini" as const,
        createPath: "/models/:model:predictLongRunning",
        imageToVideoPath: "/models/:model:predictLongRunning",
        queryPath: "/models/:model/operations/:task_id",
        requestTemplate: "gemini",
        resultField: "response.generateVideoResponse.generatedSamples[0].video.uri",
        statusField: "done",
        durationRange: "4、6、8 秒",
        supportsReferenceImage: true,
        supportsReferenceVideo: false,
        supportsReferenceAudio: false,
    };
    return {
        ...settings,
        systemChannels: [
            {
                id: "gemini",
                name: "Gemini",
                baseUrl: "https://generativelanguage.googleapis.com",
                apiKey: "gemini-secret",
                apiFormat: "gemini" as const,
                models: [model],
                enabled: true,
                advancedConfig: { protocol: "gemini" as const, modelCapabilities: { [model]: "video" as const }, modelConfigs: { [model]: operation } },
            },
        ],
        logicalModels: [
            {
                id: "gemini-video",
                name: "Gemini 视频",
                capability: "video" as const,
                enabled: true,
                bindings: [{ id: "gemini-binding", channelId: "gemini", upstreamModel: model, enabled: true, priority: 1 }],
            },
        ],
        defaultModels: { ...settings.defaultModels, videoModel: "gemini-video" },
    };
}

function json(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
