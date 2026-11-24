import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    getAuthSettings: vi.fn(),
    getStoredGenerationTaskByRequest: vi.fn(),
    generationCapacityRetryAfterSeconds: vi.fn(),
    rate: vi.fn(),
    withGenerationConcurrencyLimit: vi.fn(),
    createImageTask: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: mocks.after };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user-one", role: "user" })) }));
vi.mock("@/lib/auth/store", () => ({
    getAuthSettings: mocks.getAuthSettings,
    isAuthInputError: vi.fn(() => false),
    refundUserPoints: vi.fn(),
}));
vi.mock("@/lib/server/generation-task-store", () => ({
    generationCapacityRetryAfterSeconds: mocks.generationCapacityRetryAfterSeconds,
    getStoredGenerationTaskByRequest: mocks.getStoredGenerationTaskByRequest,
    linkStoredGenerationTask: vi.fn(),
    withGenerationConcurrencyLimit: mocks.withGenerationConcurrencyLimit,
}));
vi.mock("@/lib/server/security", () => ({
    checkGenerationRateLimit: mocks.rate,
    rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: vi.fn() }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: vi.fn() }));
vi.mock("@/lib/server/image-task-store", () => ({
    createImageTask: mocks.createImageTask,
    getImageTask: vi.fn(),
    touchImageTask: vi.fn(),
    transitionImageTask: vi.fn(),
    updateImageTask: vi.fn(),
}));

import { maxDuration, POST } from "./route";
import { createCanvasImageLayerGrant } from "@/lib/server/canvas-image-layer-grant";

describe("image task route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue(null);
        mocks.rate.mockResolvedValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60_000 });
        mocks.getAuthSettings.mockResolvedValue({ generationConcurrency: { image: 1 } });
    });

    it("keeps background image submission alive past the five minute route default", () => {
        expect(maxDuration).toBeGreaterThanOrEqual(40 * 60);
    });

    it("returns the existing task before settings, rate, and concurrency checks", async () => {
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue({
            id: "existing-image-task",
            kind: "generation",
            status: "running",
            config: { model: "image-upstream", logicalModel: "image-logical" },
        });

        const response = await POST(
            new Request("http://localhost/api/image-tasks", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-VOZEB-PRO-Client-Request-Id": "image-workbench:conversation:slot",
                    "X-VOZEB-PRO-Attempt-No": "3",
                },
                body: JSON.stringify({ prompt: "same request", context: { clientRequestId: "image-workbench:conversation:slot", attemptNo: 3 } }),
            }),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ task: { id: "existing-image-task", status: "running", model: "image-logical" } });
        expect(mocks.getStoredGenerationTaskByRequest).toHaveBeenCalledWith("image", "user-one", "image-workbench:conversation:slot", 3);
        expect(mocks.getAuthSettings).not.toHaveBeenCalled();
        expect(mocks.rate).not.toHaveBeenCalled();
        expect(mocks.withGenerationConcurrencyLimit).not.toHaveBeenCalled();
    });

    it("returns the active task scheduler retry time when image capacity is full", async () => {
        mocks.withGenerationConcurrencyLimit.mockResolvedValue(null);
        mocks.generationCapacityRetryAfterSeconds.mockResolvedValue(8);

        const response = await POST(
            new Request("http://localhost/api/image-tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: "new image" }),
            }),
        );

        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("8");
        expect(mocks.generationCapacityRetryAfterSeconds).toHaveBeenCalledWith("user-one", "image", 10 * 60 * 1000);
    });

    it("keeps ordinary image creation behind the configured concurrency limit", async () => {
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getAuthSettings.mockResolvedValue(imageSettings());
        mocks.createImageTask.mockImplementation(async (input) => ({ ...input, id: "ordinary-image", status: "pending" }));

        const response = await POST(imageRequest({ config: { model: "image" }, prompt: "普通图片" }));

        expect(response.status).toBe(200);
        expect(mocks.withGenerationConcurrencyLimit).toHaveBeenCalledOnce();
    });

    it("lets a verified Canvas layer task bypass ordinary image capacity and persists its class", async () => {
        vi.stubEnv("VOZEB_PRO_ENCRYPTION_KEY", "22".repeat(32));
        const source = "/api/reference-assets/source.png";
        const grant = createCanvasImageLayerGrant({
            userId: "user-one",
            requestId: "decomposition-one",
            source,
            decomposition: {
                strategy: "ecommerce",
                width: 1200,
                height: 800,
                backgroundDescription: "白色背景",
                backgroundPreservedVisuals: [],
                layers: [{ id: "product", name: "商品", kind: "product", bbox: { x: 100, y: 80, width: 700, height: 620 }, zIndex: 1 }],
            },
        });
        mocks.getAuthSettings.mockResolvedValue(imageSettings());
        mocks.createImageTask.mockImplementation(async (input) => ({ ...input, id: "layer-image", status: "pending" }));

        const response = await POST(
            imageRequest({
                kind: "edit",
                config: { model: "image", outputBackground: "transparent" },
                prompt: "提取商品",
                references: [{ serverUrl: source }],
                source: "canvas",
                context: { surface: "canvas" },
                layerBatch: { grant, slotId: "layer:product" },
            }),
        );

        expect(response.status).toBe(200);
        expect(mocks.withGenerationConcurrencyLimit).not.toHaveBeenCalled();
        expect(mocks.createImageTask).toHaveBeenCalledWith(
            expect.objectContaining({
                concurrencyClass: "canvas-layer",
                clientRequestId: expect.stringMatching(/^canvas-layer:/),
                references: [expect.objectContaining({ serverUrl: source })],
            }),
        );
    });

    it("does not let a forged Canvas layer batch bypass image capacity", async () => {
        mocks.getAuthSettings.mockResolvedValue(imageSettings());

        const response = await POST(
            imageRequest({
                kind: "edit",
                config: { model: "image", outputBackground: "transparent" },
                prompt: "提取商品",
                references: [{ serverUrl: "/api/reference-assets/source.png" }],
                source: "canvas",
                context: { surface: "canvas" },
                layerBatch: { grant: "invalid.grant", slotId: "layer:product" },
            }),
        );

        expect(response.status).toBe(400);
        expect(mocks.withGenerationConcurrencyLimit).not.toHaveBeenCalled();
        expect(mocks.createImageTask).not.toHaveBeenCalled();
    });

    it("rejects unsupported ratio and resolution before creating an image task", async () => {
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { image: 1 },
            generationDefaults: { imageSize: "1:1", imageQuality: "low" },
            systemChannels: [{ id: "image-channel", name: "图片", enabled: true, baseUrl: "https://image.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["upstream-image"] }],
            logicalModels: [
                {
                    id: "image",
                    name: "图片",
                    capability: "image",
                    enabled: true,
                    bindings: [{ id: "binding", channelId: "image-channel", upstreamModel: "upstream-image", enabled: true, priority: 1, capabilityProfile: { aspectRatios: ["9:16"], resolutions: ["2K"] } }],
                },
            ],
            defaultModels: { imageModel: "image" },
        });

        const response = await POST(
            new Request("http://localhost/api/image-tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ config: { model: "image", size: "1:1", quality: "low" }, prompt: "竖版海报" }),
            }),
        );

        expect(response.status).toBe(400);
        expect(mocks.createImageTask).not.toHaveBeenCalled();
    });

    it("snapshots initially filtered image candidates with their reasons", async () => {
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { image: 1 },
            generationDefaults: { imageSize: "auto", imageQuality: "auto" },
            systemChannels: [
                { id: "automatic", enabled: true, baseUrl: "https://automatic.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["fixture-image"] },
                { id: "standard", enabled: true, baseUrl: "https://standard.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["fixture-image"] },
            ],
            logicalModels: [{
                id: "fixture-image",
                capability: "image",
                enabled: true,
                bindings: [
                    { id: "automatic-binding", upstreamModel: "fixture-image", channelId: "automatic", enabled: true, priority: 1, capabilityProfile: { resolutions: ["auto"] } },
                    { id: "standard-binding", upstreamModel: "fixture-image", channelId: "standard", enabled: true, priority: 2, capabilityProfile: { resolutions: ["1K", "2K"] } },
                ],
            }],
            defaultModels: { imageModel: "fixture-image" },
        });
        mocks.createImageTask.mockImplementation(async (input) => ({ ...input, id: "filtered-image", status: "pending" }));

        const response = await POST(imageRequest({ config: { model: "fixture-image", size: "2048x2048", quality: "auto" }, prompt: "a blue teapot" }));

        expect(response.status).toBe(200);
        expect(mocks.createImageTask).toHaveBeenCalledWith(expect.objectContaining({
            candidateAudit: {
                initial: [
                    { channelId: "automatic", model: "fixture-image" },
                    { channelId: "standard", model: "fixture-image" },
                ],
                filtered: [expect.objectContaining({ channelId: "automatic", model: "fixture-image", reason: expect.any(String) })],
                fallbackCount: 0,
                attempted: [],
                transitions: [],
            },
        }));
    });

    it.each([
        ["1K", "nano-banana-2"],
        ["2K", "nano-banana-2-2k"],
        ["4K", "nano-banana-2-4k"],
        ["high", "nano-banana-2-4k"],
    ])("routes family %s requests only to the matching upstream resolution", async (quality, upstream) => {
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        const models = ["nano-banana-2", "nano-banana-2-2k", "nano-banana-2-4k"];
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { image: 1 },
            generationDefaults: { imageSize: "auto", imageQuality: "auto" },
            systemChannels: [{ id: "image-channel", name: "图片", enabled: true, baseUrl: "https://image.example.com/v1", apiKey: "secret", apiFormat: "openai", models }],
            logicalModels: [
                {
                    id: "nano-banana-2",
                    name: "Nano Banana 2",
                    capability: "image",
                    enabled: true,
                    bindings: models.map((model, i) => ({ id: model, channelId: "image-channel", upstreamModel: model, enabled: true, priority: i + 1, capabilityProfile: { resolutions: [["1K", "2K", "4K"][i]] } })),
                },
            ],
            defaultModels: { imageModel: "nano-banana-2" },
        });
        mocks.createImageTask.mockImplementation(async (input) => ({ ...input, id: "family-task", status: "pending" }));
        const response = await POST(
            new Request("http://localhost/api/image-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { model: "nano-banana-2", size: "16:9", quality }, prompt: "a blue teapot" }) }),
        );
        expect(response.status).toBe(200);
        expect(mocks.createImageTask).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ model: upstream, logicalModel: "nano-banana-2" }), candidateConfigs: [] }));
    });

    it.each([
        ["auto", "auto", "gpt-image-2.5-flare", ["gpt-image-2.5-flare-count"]],
        ["1:1", "medium", "gpt-image-2.5-flare-count", []],
        ["2048x2048", "auto", "gpt-image-2.5-flare-count", []],
    ])("routes GPT size %s quality %s without automatic-pixel fallback", async (size, quality, expected, candidates) => {
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        const models = ["gpt-image-2.5-flare", "gpt-image-2.5-flare-count"];
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { image: 1 },
            generationDefaults: { imageSize: "auto", imageQuality: "auto" },
            systemChannels: [{ id: "image-channel", enabled: true, baseUrl: "https://example.com/v1", apiKey: "secret", apiFormat: "openai", models }],
            logicalModels: [
                {
                    id: models[0],
                    capability: "image",
                    enabled: true,
                    bindings: models.map((upstreamModel, i) => ({ id: upstreamModel, upstreamModel, channelId: "image-channel", enabled: true, priority: i + 1, capabilityProfile: { resolutions: i === 0 ? ["auto"] : ["1K", "2K", "4K"] } })),
                },
            ],
            defaultModels: { imageModel: models[0] },
        });
        mocks.createImageTask.mockImplementation(async (input) => ({ ...input, id: "gpt-task", status: "pending" }));
        const response = await POST(new Request("http://localhost/api/image-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { model: models[0], size, quality }, prompt: "a teapot" }) }));
        expect(response.status).toBe(200);
        const input = mocks.createImageTask.mock.calls.at(-1)?.[0];
        expect(input.config.model).toBe(expected);
        expect(input.candidateConfigs.map((config: { model: string }) => config.model)).toEqual(candidates);
    });

    it.each(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("routes same-name %s bindings by channel capabilities", async (model) => {
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { image: 1 },
            generationDefaults: { imageSize: "auto", imageQuality: "auto" },
            systemChannels: ["automatic", "standard"].map((id) => ({ id, enabled: true, baseUrl: `https://${id}.example.com/v1`, apiKey: "fixture-key", apiFormat: "openai", models: [model] })),
            logicalModels: [
                {
                    id: model,
                    capability: "image",
                    enabled: true,
                    bindings: [
                        { id: "automatic-binding", upstreamModel: model, channelId: "automatic", enabled: true, priority: 1, capabilityProfile: { aspectRatios: ["1:1"], resolutions: ["auto"] } },
                        { id: "standard-binding", upstreamModel: model, channelId: "standard", enabled: true, priority: 2, capabilityProfile: { aspectRatios: ["1:1"], resolutions: ["1K", "2K"] } },
                    ],
                },
            ],
            defaultModels: { imageModel: model },
        });
        mocks.createImageTask.mockImplementation(async (input) => ({ ...input, id: "standard-image", status: "pending" }));

        for (const config of [
            { size: "1024x1024", quality: "auto" },
            { size: "1:1", quality: "medium" },
        ]) {
            const response = await POST(imageRequest({ config: { model, ...config }, prompt: "a blue teapot" }));
            expect(response.status).toBe(200);
            expect(mocks.createImageTask.mock.calls.at(-1)?.[0]).toMatchObject({ config: { model, logicalModel: model, channelId: "standard", ...config }, candidateConfigs: [] });
        }
    });

    it.each([
        { size: "2048x2048", quality: "auto" },
        { size: "1:1", quality: "medium" },
    ])("rejects $size / $quality when the only binding is automatic-size", async (config) => {
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { image: 1 },
            generationDefaults: { imageSize: "auto", imageQuality: "auto" },
            systemChannels: [{ id: "automatic", enabled: true, baseUrl: "https://automatic.example.com/v1", apiKey: "fixture-key", apiFormat: "openai", models: ["fixture-image"] }],
            logicalModels: [
                { id: "fixture-image", capability: "image", enabled: true, bindings: [{ id: "automatic-binding", upstreamModel: "fixture-image", channelId: "automatic", enabled: true, priority: 1, capabilityProfile: { resolutions: ["auto"] } }] },
            ],
            defaultModels: { imageModel: "fixture-image" },
        });

        const response = await POST(imageRequest({ config: { model: "fixture-image", ...config }, prompt: "a blue teapot" }));
        expect(response.status).toBe(400);
        expect(mocks.createImageTask).not.toHaveBeenCalled();
    });

    it("accepts intelligent ratio and quality without replacing them with fixed model options", async () => {
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { image: 1 },
            generationDefaults: { imageSize: "1:1", imageQuality: "low" },
            systemChannels: [{ id: "image-channel", name: "图片", enabled: true, baseUrl: "https://image.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["upstream-image"] }],
            logicalModels: [
                {
                    id: "image",
                    name: "图片",
                    capability: "image",
                    enabled: true,
                    bindings: [{ id: "binding", channelId: "image-channel", upstreamModel: "upstream-image", enabled: true, priority: 1, capabilityProfile: { aspectRatios: ["9:16"], resolutions: ["2K"] } }],
                },
            ],
            defaultModels: { imageModel: "image" },
        });
        mocks.createImageTask.mockImplementation(async (input) => ({ ...input, id: "image-task", status: "pending" }));

        const response = await POST(
            new Request("http://localhost/api/image-tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ config: { model: "image", size: "auto", quality: "auto" }, prompt: "智能构图" }),
            }),
        );

        expect(response.status).toBe(200);
        expect(mocks.createImageTask).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ size: "auto", quality: "auto" }) }));
    });

    it("routes advanced OpenAI image parameters only through bindings that declare them", async () => {
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        const options = {
            sizeModes: ["auto", "ratio", "custom"] as Array<"auto" | "ratio" | "custom">,
            resolutions: ["1K", "2K", "4K"],
            qualities: ["auto", "low", "medium", "high", "xhigh", "max"],
            styles: ["vivid", "natural"],
            outputFormats: ["png", "jpeg", "webp"],
            backgrounds: ["auto", "opaque", "transparent"] as Array<"auto" | "opaque" | "transparent">,
            moderations: ["auto", "low"],
            responseFormats: ["url", "b64_json"] as Array<"url" | "b64_json">,
        };
        const models = ["gpt-image-2", "gpt-image-2"];
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { image: 1 },
            generationDefaults: { imageSize: "auto", imageQuality: "auto" },
            systemChannels: ["legacy", "standard"].map((id) => ({ id, enabled: true, baseUrl: `https://${id}.example.com/v1`, apiKey: "fixture-key", apiFormat: "openai", models: ["gpt-image-2"] })),
            logicalModels: [
                {
                    id: "gpt-image-2",
                    capability: "image",
                    enabled: true,
                    bindings: [
                        { id: "legacy", upstreamModel: models[0], channelId: "legacy", enabled: true, priority: 1, capabilityProfile: { aspectRatios: ["1:1", "3:4"], resolutions: ["1K", "2K"] } },
                        {
                            id: "standard",
                            upstreamModel: models[1],
                            channelId: "standard",
                            enabled: true,
                            priority: 2,
                            capabilityProfile: { aspectRatios: ["1:1", "3:4"], resolutions: ["1K", "2K", "4K"], maxBatchSize: 10, imageOptions: options },
                        },
                    ],
                },
            ],
            defaultModels: { imageModel: "gpt-image-2" },
        });
        mocks.createImageTask.mockImplementation(async (input) => ({ ...input, id: "gpt-image-options", status: "pending" }));

        const response = await POST(
            imageRequest({
                config: {
                    model: "gpt-image-2",
                    size: "3:4",
                    sizeMode: "ratio",
                    resolution: "2K",
                    quality: "xhigh",
                    style: "vivid",
                    outputFormat: "png",
                    background: "transparent",
                    moderation: "low",
                    responseFormat: "url",
                },
                prompt: "a blue teapot",
            }),
        );

        expect(response.status).toBe(200);
        expect(mocks.createImageTask).toHaveBeenCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({
                    channelId: "standard",
                    model: "gpt-image-2",
                    size: "3:4",
                    sizeMode: "ratio",
                    resolution: "2K",
                    quality: "xhigh",
                    style: "vivid",
                    outputFormat: "png",
                    background: "transparent",
                    moderation: "low",
                    responseFormat: "url",
                }),
                candidateConfigs: [],
            }),
        );
    });

    it("rejects a layer task before upstream submission when it has no unique edit source", async () => {
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { image: 1 },
            generationDefaults: { imageSize: "auto", imageQuality: "auto" },
            systemChannels: [{ id: "image-channel", name: "图片", enabled: true, baseUrl: "https://image.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["upstream-image"] }],
            logicalModels: [
                {
                    id: "image",
                    name: "图片",
                    capability: "image",
                    enabled: true,
                    bindings: [{ id: "binding", channelId: "image-channel", upstreamModel: "upstream-image", enabled: true, priority: 1 }],
                },
            ],
            defaultModels: { imageModel: "image" },
        });

        const response = await POST(
            new Request("http://localhost/api/image-tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "generation", config: { model: "image", outputMode: "layers" }, prompt: "电商分层" }),
            }),
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "电商分层需要且只能使用一张源图" });
        expect(mocks.createImageTask).not.toHaveBeenCalled();
    });
});

function imageRequest(body: unknown) {
    return new Request("http://localhost/api/image-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function imageSettings() {
    return {
        generationConcurrency: { image: 1 },
        generationDefaults: { imageSize: "auto", imageQuality: "auto" },
        systemChannels: [{ id: "image-channel", name: "图片", enabled: true, baseUrl: "https://image.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["upstream-image"] }],
        logicalModels: [
            {
                id: "image",
                name: "图片",
                capability: "image",
                enabled: true,
                bindings: [{ id: "binding", channelId: "image-channel", upstreamModel: "upstream-image", enabled: true, priority: 1 }],
            },
        ],
        defaultModels: { imageModel: "image" },
    };
}
