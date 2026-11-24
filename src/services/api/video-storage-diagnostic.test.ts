import { describe, expect, it } from "vitest";

import { createVideoStorageDiagnostic, formatVideoStorageDiagnostic } from "./video-storage-diagnostic";

describe("video storage diagnostics", () => {
    it("classifies stage and source without retaining signed URLs or credentials", () => {
        const diagnostic = createVideoStorageDiagnostic("server_storage_response", new Error("upload failed https://bucket.example/video.mp4?X-Amz-Signature=secret"), {
            sourceUrl: "https://cdn.example/video.mp4?token=secret",
            bytes: 4096,
            mimeType: "video/mp4",
            httpStatus: 502,
            errorCode: "R2_WRITE_FAILED",
        });

        expect(diagnostic).toMatchObject({ stage: "server_storage_response", sourceUrlType: "remote", bytes: 4096, mimeType: "video/mp4", httpStatus: 502, errorCode: "R2_WRITE_FAILED" });
        expect(JSON.stringify(diagnostic)).not.toContain("secret");
        expect(formatVideoStorageDiagnostic(diagnostic)).toContain("服务端存储响应");
        expect(formatVideoStorageDiagnostic(diagnostic)).not.toContain("cdn.example");
    });

    it.each(["download", "read", "upload", "server_storage_response"] as const)("preserves the %s stage", stage => {
        expect(createVideoStorageDiagnostic(stage, new Error("failed"), { sourceUrl: "/api/reference-assets/permanent/video.mp4" }).stage).toBe(stage);
    });
});
