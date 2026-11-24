import { describe, expect, it, vi } from "vitest";

import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";
import type { ImageTask } from "@/lib/server/image-task-store";

const mocks = vi.hoisted(() => ({ imageSubmissionFetch: vi.fn(), imageReferenceToDataUrl: vi.fn() }));

vi.mock("./image-task-support", async () => ({
    ...(await vi.importActual<typeof import("./image-task-support")>("./image-task-support")),
    imageSubmissionFetch: mocks.imageSubmissionFetch,
    imageReferenceToDataUrl: mocks.imageReferenceToDataUrl,
}));

import { resolveDeclarativeImageSize, runCustomImageTask } from "./image-task-custom";

describe("declarative image request size", () => {
    it("renders chat image templates with multimodal reference messages", async () => {
        mocks.imageSubmissionFetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "![image](https://media.example/result.png)" } }] }), { headers: { "content-type": "application/json" } }));
        const task = {
            id: "chat-image",
            userId: "user",
            username: "user",
            displayName: "User",
            source: "canvas",
            status: "running",
            createdAt: 1,
            updatedAt: 1,
            kind: "generation",
            prompt: "keep the subject",
            references: [],
            config: {
                model: "nano-banana-2",
                baseUrl: "https://provider.example",
                apiKey: "fixture-key",
                apiFormat: "openai",
                advancedConfig: { ...emptyAdvancedConfig(), protocol: "custom", createPath: "/chat/completions", requestTemplate: '{"model":"{{model}}","messages":"{{messages}}"}', resultField: "choices[0].message.content" },
            },
        } as ImageTask;
        await runCustomImageTask(task, "http://internal", "https://site.example", "", true);
        expect(JSON.parse(mocks.imageSubmissionFetch.mock.lastCall![2].body).messages).toEqual([{ role: "user", content: [{ type: "text", text: "keep the subject" }] }]);
        task.references = [{ dataUrl: "https://media.example/reference.png", type: "image/png" }];
        mocks.imageSubmissionFetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "![image](https://media.example/result.png)" } }] }), { headers: { "content-type": "application/json" } }));
        await runCustomImageTask(task, "http://internal", "https://site.example", "", true);
        expect(JSON.parse(mocks.imageSubmissionFetch.mock.lastCall![2].body).messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: "https://media.example/reference.png" } });
    });
    it("sends Gemini custom reference images as inlineData without losing template parameters", async () => {
        mocks.imageReferenceToDataUrl.mockResolvedValueOnce("data:image/png;base64,aGVsbG8=");
        mocks.imageSubmissionFetch.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] }), { headers: { "content-type": "application/json" } }));
        const task = {
            id: "custom-gemini",
            userId: "user",
            kind: "edit",
            prompt: "keep the subject",
            references: [{ url: "https://objects.example/reference.png", type: "image/png" }],
            config: {
                model: "custom-image",
                baseUrl: "https://provider.example",
                apiKey: "fixture-key",
                apiFormat: "gemini",
                size: "9:16",
                quality: "4K",
                advancedConfig: {
                    ...emptyAdvancedConfig(),
                    protocol: "custom",
                    createPath: "/models/custom-image:generateContent",
                    requestTemplate: '{"contents":[{"role":"user","parts":[{"text":"{{prompt}}"}]}],"generationConfig":{"responseModalities":["TEXT","IMAGE"],"temperature":0.4}}',
                    resultField: "candidates[0].content.parts[0].inlineData.data",
                },
            },
        } as ImageTask;
        await runCustomImageTask(task, "http://internal", "https://site.example", "", true);
        const body = JSON.parse(mocks.imageSubmissionFetch.mock.lastCall![2].body);
        expect(body.contents[0].parts).toContainEqual({ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } });
        expect(body.generationConfig.temperature).toBe(0.4);
        expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "9:16", imageSize: "4K" });
        expect(body.contents[0].parts[0].text).toContain("keep the subject");
    });
    it("does not turn Stable Diffusion intelligent requests into a square size", () => {
        expect(resolveDeclarativeImageSize({ quality: "auto", size: "auto", advancedConfig: { ...emptyAdvancedConfig(), protocol: "stable-diffusion" } })).toBe("");
    });

    it("preserves explicit dimensions and does not invent custom protocol defaults", () => {
        expect(resolveDeclarativeImageSize({ quality: "high", size: "1536x1024", advancedConfig: { ...emptyAdvancedConfig(), protocol: "stable-diffusion" } })).toBe("1536x1024");
        expect(resolveDeclarativeImageSize({ quality: "auto", size: "auto", advancedConfig: { ...emptyAdvancedConfig(), protocol: "custom" } })).toBe("");
    });

    it("keeps the system proxy as the polling base when the proxy exposes the upstream URL", async () => {
        mocks.imageSubmissionFetch.mockResolvedValueOnce(
            new Response(JSON.stringify({ id: "upstream-one", status: "queued" }), {
                headers: { "content-type": "application/json", "x-vozeb-pro-upstream-url": "https://provider.example/v1/jobs" },
            }),
        );
        const task = {
            id: "image-one",
            userId: "user-one",
            username: "user",
            displayName: "User",
            kind: "generation",
            source: "image-workbench",
            status: "running",
            createdAt: 1,
            updatedAt: 1,
            prompt: "create an image",
            references: [],
            config: {
                baseUrl: "/api/ai/system/channel-one",
                apiKey: "",
                apiFormat: "openai",
                model: "custom-image",
                channelId: "channel-one",
                advancedConfig: {
                    ...emptyAdvancedConfig(),
                    protocol: "custom",
                    createPath: "/jobs",
                    queryPath: "/jobs/:task_id",
                    requestTemplate: '{"prompt":"{{prompt}}"}',
                    resultField: "data.image_url",
                },
            },
        } as ImageTask;

        await expect(runCustomImageTask(task, "http://internal", "http://public", "", true)).resolves.toMatchObject({
            pending: {
                id: "upstream-one",
                mediaBaseUrl: "https://provider.example/v1/jobs",
                pollBaseUrl: "http://internal/api/ai/system/channel-one/jobs",
            },
        });
    });
});
