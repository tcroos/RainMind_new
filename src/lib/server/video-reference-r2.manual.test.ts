import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";

const registration = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: async () => registration.value }));

it.skipIf(process.env.VOZEB_VERIFY_REAL_R2 !== "1")(
    "uploads real media to configured R2 and reads normalized provider URLs without redirects",
    async () => {
        const { getObjectStorageRuntimeConfig } = await import("./object-storage-config");
        const { putObjectBytes, deleteObjects } = await import("./object-storage-client");
        const { normalizeVideoProviderImageReferences } = await import("./video-reference-image");
        const config = await getObjectStorageRuntimeConfig();
        expect(config.bucket).toBe("rainmind");
        const keys: string[] = [];
        try {
            for (const [type, extension, mimeType] of [
                ["video", "mp4", "video/mp4"],
                ["audio", "wav", "audio/wav"],
            ] as const) {
                const bytes = readFileSync(`C:/Users/taofb/AppData/Local/Temp/opencode/r2-reference.${extension}`);
                const storageKey = `diagnostics/local-video-reference-20261019/reference.${extension}`;
                const key = `${config.prefix}/${storageKey}`;
                keys.push(key);
                await putObjectBytes(config, { key, bytes, contentType: mimeType });
                registration.value = { storageProvider: "object", externalStorageId: config.id, externalObjectKey: key, storageKey, ownerUserId: "local-r2-verification", type, mimeType, originalName: `reference.${extension}` };
                const [reference] = await normalizeVideoProviderImageReferences({
                    references: [{ type, role: "reference", url: `https://local-verification.example/api/reference-assets/${storageKey}` }],
                    userId: "local-r2-verification",
                    internalOrigin: "http://127.0.0.1",
                    publicOrigin: "https://local-verification.example",
                });
                const response = await fetch(reference.url, { redirect: "manual" });
                expect(response.status).toBe(200);
                expect(response.headers.get("location")).toBeNull();
                expect(response.headers.get("content-type")).toContain(mimeType);
                const downloaded = Buffer.from(await response.arrayBuffer());
                expect(createHash("sha256").update(downloaded).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
                console.log(JSON.stringify({ type, bucket: config.bucket, key, status: response.status, bytes: downloaded.length, redirect: false, sha256Match: true }));
            }
        } finally {
            if (keys.length) await deleteObjects(config, keys);
        }
    },
    60000,
);
