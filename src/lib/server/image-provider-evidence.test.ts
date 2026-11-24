import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { imageProviderEvidence } from "./image-provider-evidence";

describe("upstream image evidence", () => {
    it("reads original pixels before any requested-size normalization", async () => {
        const bytes = await sharp({ create: { width: 37, height: 19, channels: 3, background: "red" } }).png().toBuffer();
        await expect(imageProviderEvidence(`data:image/png;base64,${bytes.toString("base64")}`)).resolves.toEqual({ width: 37, height: 19, bytes: bytes.length, format: "png" });
    });

    it("does not mistake a remote URL for decoded pixel evidence", async () => {
        await expect(imageProviderEvidence("https://example.com/result.png")).resolves.toBeUndefined();
    });
});
