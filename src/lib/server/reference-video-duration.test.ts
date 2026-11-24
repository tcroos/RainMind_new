import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ registration: vi.fn(), probe: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: mocks.registration, isLocalMediaRegistrationExpired: () => false }));
vi.mock("@/lib/server/local-media-storage", () => ({ REFERENCE_MEDIA_ROOT: "D:/media/reference", GENERATION_MEDIA_ROOT: "D:/media/generation" }));
vi.mock("@/lib/server/ffmpeg", () => ({ runFfprobe: mocks.probe }));
vi.mock("@/lib/server/data-adapter", () => ({ readJsonDataFile: mocks.read, writeJsonDataFile: mocks.write }));
import { trustedReferenceVideoDurations } from "./reference-video-duration";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.registration.mockResolvedValue({ type: "video", scope: "reference", ownerUserId: "user", createdAt: "today", bytes: 100 });
    mocks.read.mockResolvedValue(null);
    mocks.write.mockResolvedValue(undefined);
    mocks.probe.mockResolvedValue({ stdout: JSON.stringify({ format: { duration: "2.3" }, streams: [{ codec_type: "video" }] }) });
});
describe("trusted reference video duration", () => {
    const user = { id: "user", role: "user" as const };
    const reference = { type: "video" as const, url: "/api/reference-assets/permanent/clip.mp4" };
    it("probes once but returns every repeated reference for billing", async () => {
        const result = await trustedReferenceVideoDurations([reference, reference], user, "https://site.example");
        expect(result).toHaveLength(2);
        expect(result[0].durationMs).toBe(2300);
        expect(mocks.probe).toHaveBeenCalledOnce();
        expect(mocks.probe.mock.calls[0][0]).toContain("file");
        expect(mocks.write).toHaveBeenCalledOnce();
    });
    it("rejects external, spoofed scope and other users before probing", async () => {
        await expect(trustedReferenceVideoDurations([{ ...reference, url: "https://other.example/api/reference-assets/a" }], user, "https://site.example")).rejects.toThrow("站内");
        mocks.registration.mockResolvedValue({ type: "video", scope: "generation", ownerUserId: "user" });
        await expect(trustedReferenceVideoDurations([reference], user, "https://site.example")).rejects.toThrow("无权");
        mocks.registration.mockResolvedValue({ type: "video", scope: "reference", ownerUserId: "other" });
        await expect(trustedReferenceVideoDurations([reference], user, "https://site.example")).rejects.toThrow("无权");
        expect(mocks.probe).not.toHaveBeenCalled();
    });
    it("uses only trusted cache and rejects invalid probe metadata", async () => {
        mocks.read.mockResolvedValueOnce({ version: 1, durationMs: 15001 });
        expect((await trustedReferenceVideoDurations([reference], user, "https://site.example"))[0].durationMs).toBe(15001);
        expect(mocks.probe).not.toHaveBeenCalled();
        mocks.probe.mockResolvedValueOnce({ stdout: JSON.stringify({ format: { duration: "NaN" }, streams: [] }) });
        await expect(trustedReferenceVideoDurations([reference], user, "https://site.example")).rejects.toThrow("无法识别");
    });
});
