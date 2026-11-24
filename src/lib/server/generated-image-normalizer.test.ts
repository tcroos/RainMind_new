import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { normalizeGeneratedImageBytes } from "./generated-image-normalizer";

describe("generated image normalization", () => {
    it("resizes an upstream image to the exact requested dimensions", async () => {
        const source = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#7c8da5" } })
            .png()
            .toBuffer();
        const result = await normalizeGeneratedImageBytes(source, "image/png", "1824x1024");

        expect(result).toMatchObject({ mimeType: "image/png", width: 1824, height: 1024 });
        await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({ format: "png", width: 1824, height: 1024 });
    });

    it("restores a provider-safe image to a small exact requested size", async () => {
        const source = await sharp({ create: { width: 672, height: 1008, channels: 3, background: "#9a6b4f" } })
            .png()
            .toBuffer();
        const result = await normalizeGeneratedImageBytes(source, "image/png", "400x600");

        expect(result).toMatchObject({ mimeType: "image/png", width: 400, height: 600 });
        await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({ format: "png", width: 400, height: 600 });
    });

    it("keeps the upstream file unchanged when no exact target is configured", async () => {
        const source = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#506070" } })
            .jpeg({ quality: 92 })
            .toBuffer();
        const result = await normalizeGeneratedImageBytes(source, "image/jpeg", "16:9");

        expect(result).toMatchObject({ mimeType: "image/jpeg", width: 1280, height: 720 });
        expect(result.bytes).toEqual(source);
    });

    it("keeps a large exact upstream image instead of applying a platform edge ceiling", async () => {
        const source = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#203040" } })
            .webp()
            .toBuffer();
        const result = await normalizeGeneratedImageBytes(source, "image/webp", "4096x2304");

        expect(result).toMatchObject({ mimeType: "image/png", width: 4096, height: 2304 });
        await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({ format: "png", width: 4096, height: 2304 });
    });

    it("keeps original high-quality bytes for a ratio preference even when the upstream grid differs", async () => {
        // 9:16 requests 768x1360 but providers snap to 768x1376; re-encoding here
        // would drop a quality-99 JPEG to sharp's default quality 80.
        const source = await sharp({ create: { width: 768, height: 1376, channels: 3, background: "#3d5a80" } })
            .jpeg({ quality: 99, chromaSubsampling: "4:4:4" })
            .toBuffer();
        const result = await normalizeGeneratedImageBytes(source, "image/jpeg", "9:16");

        expect(result).toMatchObject({ mimeType: "image/jpeg", width: 768, height: 1376 });
        expect(result.bytes).toEqual(source);
    });

    it("resizes exact pixel requests losslessly even within the old tolerance", async () => {
        const source = await sharp({ create: { width: 768, height: 1376, channels: 3, background: "red" } })
            .jpeg({ quality: 99 })
            .toBuffer();
        const result = await normalizeGeneratedImageBytes(source, "image/jpeg", "768x1360");
        expect(result).toMatchObject({ mimeType: "image/png", width: 768, height: 1360 });
        await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({ format: "png", width: 768, height: 1360 });
    });

    it("resizes larger differences without default JPEG quality loss", async () => {
        const source = await sharp({ create: { width: 800, height: 1400, channels: 3, background: "#3d5a80" } })
            .jpeg({ quality: 99 })
            .toBuffer();
        const result = await normalizeGeneratedImageBytes(source, "image/jpeg", "768x1360");

        expect(result).toMatchObject({ width: 768, height: 1360 });
        expect(result.bytes).not.toEqual(source);
        expect(result.mimeType).toBe("image/png");
    });

    it("preserves edge content instead of cropping a mismatched aspect ratio", async () => {
        const source = await sharp({ create: { width: 200, height: 100, channels: 3, background: "red" } })
            .png()
            .toBuffer();
        const result = await normalizeGeneratedImageBytes(source, "image/png", "100x100");
        const { data, info } = await sharp(result.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
        expect(pixel(0, 50)).toEqual([255, 0, 0]);
        expect(pixel(99, 50)).toEqual([255, 0, 0]);
        expect(pixel(50, 0)).toEqual([0, 0, 0]);
    });
});
