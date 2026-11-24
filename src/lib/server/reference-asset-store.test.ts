import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalMediaRegistration } from "@/lib/server/local-media-registry";

const mocks = vi.hoisted(() => ({
    cleanupExpired: vi.fn(),
    getRegistration: vi.fn(),
    register: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn(),
    persistExternal: vi.fn<() => Promise<LocalMediaRegistration | null>>(async () => null),
    createExternalReadUrl: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("node:fs/promises", () => ({
    copyFile: vi.fn(),
    mkdir: vi.fn(),
    stat: mocks.stat,
    unlink: mocks.unlink,
    writeFile: mocks.writeFile,
}));
vi.mock("@/lib/server/local-media-registry", () => ({
    getLocalMediaRegistration: mocks.getRegistration,
    registerLocalMediaAsset: mocks.register,
}));
vi.mock("@/lib/server/object-storage-service", () => ({
    persistExternalMediaIfEnabled: mocks.persistExternal,
    createExternalMediaReadUrl: mocks.createExternalReadUrl,
}));
vi.mock("@/lib/server/local-media-storage", () => ({
    cleanupExpiredLocalMediaAssets: mocks.cleanupExpired,
    createDatedMediaPath: vi.fn(() => "temporary/2026/01/01/images/file.png"),
    REFERENCE_MEDIA_ROOT: "C:\\tmp\\reference-assets",
}));

import { readReferenceAsset, writeReferenceMediaDataUrl } from "./reference-asset-store";

describe("reference asset lifecycle boundaries", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("does not run media cleanup from the online write path", async () => {
        await expect(writeReferenceMediaDataUrl("invalid", "image", { ownerUserId: "user-one", source: "test" })).rejects.toThrow("参考素材格式不正确");
        expect(mocks.cleanupExpired).not.toHaveBeenCalled();
    });

    it("accepts a generated frame whose base64 exceeds the V8 regexp stack boundary", async () => {
        const bytes = Buffer.alloc(3_300_000, 1);

        await expect(writeReferenceMediaDataUrl(`data:image/png;base64,${bytes.toString("base64")}`, "image", { ownerUserId: "user-one", source: "test" })).resolves.toMatchObject({ bytes: bytes.length, mimeType: "image/png" });
        const written = mocks.writeFile.mock.calls[0]?.[1] as Buffer;
        expect(Buffer.isBuffer(written)).toBe(true);
        expect(written.length).toBe(bytes.length);
        expect(written[0]).toBe(1);
    });

    it("leaves expired temporary files for reference-aware maintenance", async () => {
        const registration = { storageKey: "temporary/2026/01/01/images/20260101-000000-00000000-0000-4000-8000-000000000000.png" };
        mocks.stat.mockResolvedValue({ size: 12, mtimeMs: 0 });
        mocks.getRegistration.mockResolvedValue(registration);

        await expect(readReferenceAsset(registration.storageKey)).resolves.toMatchObject({ size: 12, registration });
        expect(mocks.unlink).not.toHaveBeenCalled();
    });

    // Upstreams cannot follow the signed route (needs a session, 307s to R2), so an
    // object-stored asset must come back with a direct presigned URL.
    it("returns an R2 presigned URL when the asset is stored in object storage", async () => {
        mocks.persistExternal.mockResolvedValueOnce({
            storageKey: "temporary/2026/01/01/images/file.png",
            storageProvider: "object",
            externalObjectKey: "vozeb-pro/media/reference/temporary/file.png",
            externalStorageId: "r2",
            ownerUserId: "user-one",
            scope: "reference",
            storageClass: "temporary",
            type: "image",
            source: "test",
            mimeType: "image/png",
            bytes: 4,
            createdAt: "2026-01-01T00:00:00.000Z",
        });
        mocks.createExternalReadUrl.mockResolvedValueOnce("https://r2.example/file.png?X-Amz-Signature=abc");

        await expect(writeReferenceMediaDataUrl("data:image/png;base64,AAAA", "image", { ownerUserId: "user-one", source: "test" })).resolves.toMatchObject({
            storage: "object",
            url: "https://r2.example/file.png?X-Amz-Signature=abc",
        });
        expect(mocks.createExternalReadUrl).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ storageProvider: "object" }), { expiresIn: 3600 });
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it("omits the URL when presigning is unavailable so callers fall back to the signed route", async () => {
        mocks.persistExternal.mockResolvedValueOnce({
            storageKey: "temporary/2026/01/01/images/file.png",
            storageProvider: "object",
            externalObjectKey: "vozeb-pro/media/reference/temporary/file.png",
            ownerUserId: "user-one",
            scope: "reference",
            storageClass: "temporary",
            type: "image",
            source: "test",
            mimeType: "image/png",
            bytes: 4,
            createdAt: "2026-01-01T00:00:00.000Z",
        });
        mocks.createExternalReadUrl.mockRejectedValueOnce(new Error("object storage not configured"));

        const result = await writeReferenceMediaDataUrl("data:image/png;base64,AAAA", "image", { ownerUserId: "user-one", source: "test" });
        expect(result.storage).toBe("object");
        expect(result.url).toBeUndefined();
    });
});
