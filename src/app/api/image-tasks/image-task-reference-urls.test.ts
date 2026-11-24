import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    requireManagedMediaInputOwner: vi.fn(async () => "user-one"),
    writeReferenceImageDataUrl: vi.fn(),
    getRegistration: vi.fn(),
    createExternalReadUrl: vi.fn(),
}));

vi.mock("@/lib/server/managed-media-input-access", () => ({ requireManagedMediaInputOwner: mocks.requireManagedMediaInputOwner }));
vi.mock("@/lib/server/reference-asset-store", () => ({ writeReferenceImageDataUrl: mocks.writeReferenceImageDataUrl }));
vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: mocks.getRegistration }));
vi.mock("@/lib/server/object-storage-service", () => ({ createExternalMediaReadUrl: mocks.createExternalReadUrl }));

import { publicImageReferenceRequestUrl } from "./image-task-reference-urls";

describe("image task provider reference URLs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("VOZEB_PRO_REFERENCE_ASSET_SIGNING_KEY", "test-signing-key");
    });

    afterEach(() => vi.unstubAllEnvs());

    it("prefers the registered source over a remote fallback", async () => {
        const result = await publicImageReferenceRequestUrl(
            {
                dataUrl: "",
                serverUrl: "/api/reference-assets/permanent/2026/08/20/images/source.png?format=webp&width=320",
                remoteUrl: "https://cdn.example.com/temporary-source.png",
            },
            "http://internal",
            "https://vozeb.example",
            { ownerUserId: "user-one", taskId: "task-one" },
        );

        expect(result).toMatch(/^https:\/\/vozeb\.example\/api\/reference-assets\/permanent\/2026\/08\/20\/images\/source\.png\?purpose=provider-read/);
        expect(result).not.toContain("format=webp");
        expect(result).not.toContain("width=320");
        expect(result).not.toContain("cdn.example.com");
    });

    it("reuses an owned generation asset through a scoped provider signature", async () => {
        const source = "/api/generation-log-assets/permanent/2026/08/20/images/generated.png";
        const result = await publicImageReferenceRequestUrl({ dataUrl: "", serverUrl: source }, "http://internal", "https://vozeb.example", { ownerUserId: "user-one", taskId: "task-one" });

        expect(mocks.requireManagedMediaInputOwner).toHaveBeenCalledWith(source, { id: "user-one", role: "user" }, "generation");
        expect(result).toMatch(/^https:\/\/vozeb\.example\/api\/generation-log-assets\/.+purpose=provider-read/);
        expect(mocks.writeReferenceImageDataUrl).not.toHaveBeenCalled();
    });

    it("does not sign another user's generation asset", async () => {
        mocks.requireManagedMediaInputOwner.mockRejectedValueOnce(new Error("参考素材不存在或无权访问"));

        await expect(
            publicImageReferenceRequestUrl({ dataUrl: "", serverUrl: "/api/generation-log-assets/permanent/2026/08/20/images/other.png" }, "http://internal", "https://vozeb.example", { ownerUserId: "user-one", taskId: "task-one" }),
        ).rejects.toThrow("参考素材不存在或无权访问");
    });

    it("hands upstreams the R2 presigned URL for object-stored references", async () => {
        mocks.getRegistration.mockResolvedValue({ storageKey: "permanent/2026/10/18/images/source.png", storageProvider: "object", externalObjectKey: "vozeb-pro/permanent/2026/10/18/images/source.png", ownerUserId: "user-one", type: "image", mimeType: "image/png" });
        mocks.createExternalReadUrl.mockResolvedValue("https://r2.example/source.png?X-Amz-Signature=abc");

        const result = await publicImageReferenceRequestUrl(
            { dataUrl: "", serverUrl: "/api/reference-assets/permanent/2026/10/18/images/source.png" },
            "http://internal",
            "https://vozeb.example",
            { ownerUserId: "user-one", taskId: "task-one" },
        );

        expect(result).toBe("https://r2.example/source.png?X-Amz-Signature=abc");
        expect(mocks.createExternalReadUrl).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ storageProvider: "object" }), { expiresIn: 3600 });
    });

    it("falls back to the signed site route when the reference is local", async () => {
        mocks.getRegistration.mockResolvedValue({ storageKey: "permanent/2026/10/18/images/source.png", storageProvider: "local", ownerUserId: "user-one", type: "image", mimeType: "image/png" });

        const result = await publicImageReferenceRequestUrl(
            { dataUrl: "", serverUrl: "/api/reference-assets/permanent/2026/10/18/images/source.png" },
            "http://internal",
            "https://vozeb.example",
            { ownerUserId: "user-one", taskId: "task-one" },
        );

        expect(result).toMatch(/^https:\/\/vozeb\.example\/api\/reference-assets\/.+purpose=provider-read/);
        expect(mocks.createExternalReadUrl).not.toHaveBeenCalled();
    });
});
