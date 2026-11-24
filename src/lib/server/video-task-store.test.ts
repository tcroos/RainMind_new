import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getStoredGenerationTask: vi.fn(), stableVideoResultUrl: vi.fn() }));

vi.mock("@/lib/server/generation-task-store", () => ({
    createStoredGenerationTask: vi.fn(),
    getStoredGenerationTask: mocks.getStoredGenerationTask,
    mutateStoredGenerationTask: vi.fn(),
    touchStoredGenerationTask: vi.fn(),
    transitionStoredGenerationTask: vi.fn(),
}));
vi.mock("@/lib/server/video-result-url", () => ({ stableVideoResultUrl: mocks.stableVideoResultUrl }));

import { getVideoTask } from "./video-task-store";

const SIGNED = "https://rainmind.account.r2.cloudflarestorage.com/vozeb-pro/media/reference/permanent/2026/11/04/videos/a.mp4?X-Amz-Signature=abc";
const SITE = "/api/reference-assets/permanent/2026/11/04/videos/a.mp4";

describe("getVideoTask legacy result mapping", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.stableVideoResultUrl.mockImplementation(async (url?: string) => (url === SIGNED ? SITE : url));
    });

    it("serves a historical signed result URL as the stable site route", async () => {
        mocks.getStoredGenerationTask.mockResolvedValue({ id: "t", status: "success", result: { url: SIGNED, mimeType: "video/mp4" } });
        const task = await getVideoTask("t");
        expect(task?.result).toEqual({ url: SITE, mimeType: "video/mp4" });
    });

    it("returns tasks without a result unchanged", async () => {
        const running = { id: "t", status: "running" };
        mocks.getStoredGenerationTask.mockResolvedValue(running);
        await expect(getVideoTask("t")).resolves.toBe(running);
        expect(mocks.stableVideoResultUrl).not.toHaveBeenCalled();
    });

    it("keeps the same object when the URL is already stable", async () => {
        const stored = { id: "t", status: "success", result: { url: SITE } };
        mocks.getStoredGenerationTask.mockResolvedValue(stored);
        await expect(getVideoTask("t")).resolves.toBe(stored);
    });

    it("returns null for a missing task", async () => {
        mocks.getStoredGenerationTask.mockResolvedValue(null);
        await expect(getVideoTask("missing")).resolves.toBeNull();
    });
});