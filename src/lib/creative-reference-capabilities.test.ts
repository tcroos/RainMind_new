import { describe, expect, it } from "vitest";

import { creativeReferenceCounts, creativeReferenceOptions, creativeReferenceSetError, creativeReferenceUploadError } from "./creative-reference-capabilities";

describe("creative video reference capabilities", () => {
    it("counts each media type and exposes separate per-type upload availability", () => {
        const counts = creativeReferenceCounts([{ type: "image" }, { type: "video" }, { type: "audio" }, { type: "text" }]);
        expect(counts).toEqual({ image: 1, video: 1, audio: 1 });
        expect(creativeReferenceOptions({ supportsReferenceImage: true, supportsReferenceVideo: true, supportsReferenceAudio: true, maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxReferenceTotal: 12 }, counts)).toMatchObject([
            { type: "image", count: 1, max: 9, disabled: false },
            { type: "video", count: 1, max: 3, disabled: false },
            { type: "audio", count: 1, max: 3, disabled: false },
        ]);
    });

    it("blocks type and mixed-total overflow and Seedance audio-only uploads", () => {
        const profile = { supportsReferenceImage: true, supportsReferenceVideo: true, supportsReferenceAudio: true, maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxReferenceTotal: 15, requiresReferenceImageOrVideo: true };
        expect(creativeReferenceUploadError(profile, { image: 9, video: 0, audio: 0 }, "image", 1)).toContain("最多 9 张");
        expect(creativeReferenceUploadError({ ...profile, maxReferenceTotal: 12 }, { image: 9, video: 2, audio: 1 }, "audio", 1)).toContain("最多支持 12 份");
        expect(creativeReferenceUploadError(profile, { image: 0, video: 0, audio: 0 }, "audio", 1)).toContain("不能单独使用");
        expect(creativeReferenceSetError(profile, { image: 0, video: 0, audio: 1 })).toContain("不能单独使用");
        expect(creativeReferenceSetError(profile, { image: 1, video: 0, audio: 1 })).toBeUndefined();
    });
});
