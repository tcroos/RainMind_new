import sharp from "sharp";

import { parseBase64DataUrl } from "@/lib/media-file";

export async function imageProviderEvidence(dataUrl: string) {
    const parsed = parseBase64DataUrl(dataUrl);
    if (!parsed) return undefined;
    const bytes = Buffer.from(parsed.data, "base64");
    const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    return { width: metadata.width, height: metadata.height, bytes: bytes.length, format: metadata.format };
}
