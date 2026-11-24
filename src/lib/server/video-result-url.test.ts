import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getLocalMediaRegistration: vi.fn() }));

vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: mocks.getLocalMediaRegistration }));

import { stableVideoResultUrl } from "./video-result-url";

const STORAGE_KEY = "permanent/2026/11/04/videos/20261104-080101-ee410162-e454-4605-acf1-462134a56641.mp4";
const SIGNED = `https://rainmind.account.r2.cloudflarestorage.com/vozeb-pro/media/reference/${STORAGE_KEY}?X-Amz-Signature=abc&X-Amz-Expires=3600`;

describe("stableVideoResultUrl", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getLocalMediaRegistration.mockResolvedValue({
            storageKey: STORAGE_KEY,
            scope: "reference",
            storageProvider: "object",
            externalObjectKey: `vozeb-pro/media/reference/${STORAGE_KEY}`,
        });
    });

    it("maps a persisted signed object URL back to the stable site route", async () => {
        await expect(stableVideoResultUrl(SIGNED)).resolves.toBe(`/api/reference-assets/${STORAGE_KEY}`);
        expect(mocks.getLocalMediaRegistration).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it("still maps after the signature has expired, because it never reads the signature", async () => {
        const expired = `https://rainmind.account.r2.cloudflarestorage.com/vozeb-pro/media/reference/${STORAGE_KEY}?X-Amz-Date=20200101T000000Z&X-Amz-Expires=1&X-Amz-Signature=old`;
        await expect(stableVideoResultUrl(expired)).resolves.toBe(`/api/reference-assets/${STORAGE_KEY}`);
    });

    it("leaves site routes untouched without a registry lookup", async () => {
        const site = `/api/reference-assets/${STORAGE_KEY}`;
        await expect(stableVideoResultUrl(site)).resolves.toBe(site);
        expect(mocks.getLocalMediaRegistration).not.toHaveBeenCalled();
    });

    it("leaves upstream provider URLs untouched", async () => {
        const upstream = "https://videos.deepkey.top/videos/2026/11/04/task_765781.mp4";
        await expect(stableVideoResultUrl(upstream)).resolves.toBe(upstream);
        expect(mocks.getLocalMediaRegistration).not.toHaveBeenCalled();
    });

    it("does not map when no registration owns that storage key", async () => {
        mocks.getLocalMediaRegistration.mockResolvedValue(null);
        await expect(stableVideoResultUrl(SIGNED)).resolves.toBe(SIGNED);
    });

    it("does not map when the registration points at a different object", async () => {
        mocks.getLocalMediaRegistration.mockResolvedValue({ storageKey: STORAGE_KEY, scope: "reference", storageProvider: "object", externalObjectKey: "vozeb-pro/media/reference/permanent/other.mp4" });
        await expect(stableVideoResultUrl(SIGNED)).resolves.toBe(SIGNED);
    });

    it("does not map generation-scope or local registrations through the reference route", async () => {
        mocks.getLocalMediaRegistration.mockResolvedValue({ storageKey: STORAGE_KEY, scope: "generation", storageProvider: "object", externalObjectKey: `vozeb-pro/media/reference/${STORAGE_KEY}` });
        await expect(stableVideoResultUrl(SIGNED)).resolves.toBe(SIGNED);
    });

    it("returns undefined and empty inputs unchanged", async () => {
        await expect(stableVideoResultUrl(undefined)).resolves.toBeUndefined();
        await expect(stableVideoResultUrl("")).resolves.toBe("");
    });
});