import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    fetchInternal: vi.fn(),
    fetchExternal: vi.fn(),
    writeReference: vi.fn(),
    sign: vi.fn(),
    providerSign: vi.fn(),
    getRegistration: vi.fn(),
    createExternalReadUrl: vi.fn(),
}));

vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi: mocks.fetchInternal }));
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: mocks.fetchExternal }));
vi.mock("@/lib/server/reference-asset-store", () => ({ writeReferenceMediaDataUrl: mocks.writeReference }));
vi.mock("@/lib/server/reference-asset-access", () => ({
    createSignedReferenceAssetUrl: mocks.sign,
    createProviderSignedReferenceAssetUrl: mocks.providerSign,
    createProviderSignedGenerationAssetUrl: mocks.providerSign,
}));
vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: mocks.getRegistration }));
vi.mock("@/lib/server/object-storage-service", () => ({ createExternalMediaReadUrl: mocks.createExternalReadUrl }));

import { normalizeVideoProviderImageReferences } from "./video-reference-image";
import type { VideoGenerationReference } from "@/lib/video-reference-contract";

describe("video provider image references", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.writeReference.mockResolvedValue({ token: "temporary/2026/08/20/images/reference.png" });
        mocks.sign.mockReturnValue("https://site.example/api/reference-assets/temporary/reference.png?purpose=provider-read&expires=9999999999&signature=normalized");
        mocks.providerSign.mockReturnValue("https://site.example/api/reference-assets/temporary/reference.png?purpose=provider-read&expires=9999999999&signature=provider");
        mocks.getRegistration.mockResolvedValue(null);
    });

    it("keeps PNG and JPEG references on the zero-copy path", async () => {
        const references = [image("https://cdn.example.com/reference.png"), image("https://cdn.example.com/reference.jpg")];

        await expect(normalize(references)).resolves.toEqual(references);
        expect(mocks.fetchInternal).not.toHaveBeenCalled();
        expect(mocks.fetchExternal).not.toHaveBeenCalled();
        expect(mocks.writeReference).not.toHaveBeenCalled();
    });

    it("converts an internal WebP original to a lossless PNG reference without resizing", async () => {
        const webp = await sharp({ create: { width: 37, height: 23, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 0.5 } } })
            .webp()
            .toBuffer();
        mocks.fetchInternal.mockResolvedValue(new Response(webp, { headers: { "content-type": "image/webp", "content-length": String(webp.length) } }));

        const [result] = await normalize([image("https://site.example/api/reference-assets/temporary/source.webp?purpose=provider-read&signature=test")]);

        expect(result?.url).toContain("signature=provider");
        expect(mocks.fetchInternal).toHaveBeenCalledWith("http://internal/api/reference-assets/temporary/source.webp?purpose=provider-read&signature=test", { cache: "no-store" });
        const dataUrl = mocks.writeReference.mock.calls[0]?.[0] as string;
        const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
        await expect(sharp(bytes).metadata()).resolves.toMatchObject({ format: "png", width: 37, height: 23 });
        expect(mocks.writeReference).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/), "image", expect.objectContaining({ ownerUserId: "user-one", source: "video-reference-normalization", maxBytes: 20 * 1024 * 1024 }));
    });

    it("removes local WebP preview parameters and submits the original PNG source", async () => {
        const [result] = await normalize([image("https://site.example/api/reference-assets/permanent/source.png?purpose=provider-read&expires=9999999999&signature=source&format=webp&width=320")]);

        expect(result?.url).toBe("https://site.example/api/reference-assets/permanent/source.png?expires=9999999999&purpose=provider-read&signature=source");
        expect(mocks.fetchInternal).not.toHaveBeenCalled();
        expect(mocks.fetchExternal).not.toHaveBeenCalled();
        expect(mocks.writeReference).not.toHaveBeenCalled();
    });

    it("normalizes public WebP references through the guarded outbound fetcher", async () => {
        const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } })
            .webp()
            .toBuffer();
        mocks.fetchExternal.mockResolvedValue(new Response(webp));

        await normalize([image("https://cdn.example.com/reference.webp")]);

        expect(mocks.fetchExternal).toHaveBeenCalledWith("https://cdn.example.com/reference.webp", { cache: "no-store" });
        expect(mocks.writeReference).toHaveBeenCalledOnce();
    });

    it("hands upstreams the R2 presigned URL instead of the signed site route", async () => {
        mocks.getRegistration.mockResolvedValue({
            storageKey: "permanent/2026/10/18/images/source.png",
            storageProvider: "object",
            externalObjectKey: "vozeb-pro/permanent/2026/10/18/images/source.png",
            ownerUserId: "user-one",
            type: "image",
            mimeType: "image/png",
        });
        mocks.createExternalReadUrl.mockResolvedValue("https://r2.example/source.png?X-Amz-Signature=abc");

        const [result] = await normalize([image("https://site.example/api/reference-assets/permanent/2026/10/18/images/source.png")]);

        expect(result?.url).toBe("https://r2.example/source.png?X-Amz-Signature=abc");
        expect(mocks.createExternalReadUrl).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ storageProvider: "object" }), { expiresIn: 3600 });
        expect(mocks.fetchInternal).not.toHaveBeenCalled();
    });

    it.each(["video", "audio"] as const)("hands upstreams a direct object URL for owned %s references", async (type) => {
        const reference: VideoGenerationReference = { type, role: "reference", url: `https://site.example/api/reference-assets/permanent/source.${type === "video" ? "mp4" : "mp3"}?purpose=provider-read&signature=test` };
        mocks.getRegistration.mockResolvedValue({ storageProvider: "object", ownerUserId: "user-one", type });
        mocks.createExternalReadUrl.mockResolvedValue("https://r2.example/source?X-Amz-Signature=test");

        await expect(normalize([reference])).resolves.toEqual([{ ...reference, url: "https://r2.example/source?X-Amz-Signature=test" }]);
        expect(mocks.createExternalReadUrl).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ type }), { expiresIn: 3600 });
        expect(mocks.fetchInternal).not.toHaveBeenCalled();
        expect(mocks.fetchExternal).not.toHaveBeenCalled();
        expect(mocks.writeReference).not.toHaveBeenCalled();
    });

    it("preserves external video URLs without querying the media registry", async () => {
        const reference: VideoGenerationReference = { type: "video", role: "reference", url: "https://cdn.example/reference.mp4" };

        await expect(normalize([reference])).resolves.toEqual([reference]);
        expect(mocks.getRegistration).not.toHaveBeenCalled();
        expect(mocks.createExternalReadUrl).not.toHaveBeenCalled();
    });

    it.each([
        { storageProvider: "local", ownerUserId: "user-one" },
        { storageProvider: "object", ownerUserId: "user-two" },
        { storageProvider: "object", ownerUserId: "user-one", expiresAt: "2000-01-01T00:00:00.000Z" },
    ])("does not presign inaccessible or local video assets: %j", async (registration) => {
        const reference: VideoGenerationReference = { type: "video", role: "reference", url: "https://site.example/api/generation-log-assets/permanent/reference.mp4?purpose=provider-read&signature=test" };
        mocks.getRegistration.mockResolvedValue(registration);

        await expect(normalize([reference])).resolves.toEqual([reference]);
        expect(mocks.createExternalReadUrl).not.toHaveBeenCalled();
    });

    it("uses the signed audio route when object presigning fails", async () => {
        const reference: VideoGenerationReference = { type: "audio", role: "reference", url: "https://site.example/api/reference-assets/permanent/reference.mp3?purpose=provider-read&signature=test" };
        mocks.getRegistration.mockResolvedValue({ storageProvider: "object", ownerUserId: "user-one" });
        mocks.createExternalReadUrl.mockRejectedValue(new Error("Object storage unavailable"));

        await expect(normalize([reference])).resolves.toEqual([reference]);
    });

    it("keeps the signed site route when the reference is not in object storage", async () => {
        mocks.getRegistration.mockResolvedValue({ storageKey: "permanent/2026/10/18/images/source.png", storageProvider: "local", ownerUserId: "user-one", type: "image", mimeType: "image/png" });

        const [result] = await normalize([image("https://site.example/api/reference-assets/permanent/2026/10/18/images/source.png")]);

        expect(result?.url).toBe("https://site.example/api/reference-assets/permanent/2026/10/18/images/source.png");
        expect(mocks.createExternalReadUrl).not.toHaveBeenCalled();
    });

    it("ignores object presigning for references owned by another user", async () => {
        mocks.getRegistration.mockResolvedValue({ storageKey: "permanent/2026/10/18/images/source.png", storageProvider: "object", externalObjectKey: "vozeb-pro/x.png", ownerUserId: "user-two", type: "image", mimeType: "image/png" });

        const [result] = await normalize([image("https://site.example/api/reference-assets/permanent/2026/10/18/images/source.png")]);

        expect(result?.url).toBe("https://site.example/api/reference-assets/permanent/2026/10/18/images/source.png");
        expect(mocks.createExternalReadUrl).not.toHaveBeenCalled();
    });
});

function normalize(references: VideoGenerationReference[]) {
    return normalizeVideoProviderImageReferences({ references, userId: "user-one", internalOrigin: "http://internal", publicOrigin: "https://site.example" });
}

function image(url: string) {
    return { type: "image" as const, role: "reference" as const, url };
}
