import { describe, expect, it } from "vitest";

import { assertCapabilityConstraints } from "./capability-constraints";

describe("capability constraints", () => {
    it("uses the binding profile to reject exact pixels on automatic-size image providers", () => {
        const automatic = { resolutions: ["AUTO"] };
        expect(() => assertCapabilityConstraints(automatic, { capability: "image", aspectRatio: "2048x2048", resolution: "auto" })).toThrow("尺寸");
        expect(() => assertCapabilityConstraints(automatic, { capability: "image", aspectRatio: "1:1", resolution: "auto" })).not.toThrow();
        expect(() => assertCapabilityConstraints({ resolutions: ["1K", "2K"] }, { capability: "image", aspectRatio: "2048x2048", resolution: "auto" })).not.toThrow();
        expect(() => assertCapabilityConstraints(undefined, { capability: "image", aspectRatio: "1024x1024", resolution: "auto" })).not.toThrow();
    });

    it("rejects unsupported reference count, duration, batch and ratio", () => {
        const profile = { maxReferenceImages: 2, maxDurationSeconds: 8, durationSeconds: [5, 8], maxBatchSize: 2, aspectRatios: ["16:9"], resolutions: ["1080P", "2K"] };
        expect(() => assertCapabilityConstraints(profile, { capability: "video", referenceCount: 3 })).toThrow("最多支持 2 张参考图");
        expect(() => assertCapabilityConstraints(profile, { capability: "video", durationSeconds: 9 })).toThrow("最长视频时长");
        expect(() => assertCapabilityConstraints(profile, { capability: "image", batchSize: 3 })).toThrow("批量生成");
        expect(() => assertCapabilityConstraints(profile, { capability: "video", aspectRatio: "9:16" })).toThrow("不支持 9:16 比例");
        expect(() => assertCapabilityConstraints(profile, { capability: "video", durationSeconds: 6 })).toThrow("不支持 6 秒时长");
        expect(() => assertCapabilityConstraints(profile, { capability: "video", resolution: "720p" })).toThrow("不支持 720p 分辨率");
        expect(() => assertCapabilityConstraints(profile, { capability: "image", aspectRatio: "1920x1080", resolution: "2k" })).not.toThrow();
        expect(() => assertCapabilityConstraints(profile, { capability: "image", aspectRatio: "auto", resolution: "AUTO" })).not.toThrow();
    });

    it("enforces per-media and mixed reference limits plus the Seedance audio rule", () => {
        const profile = { supportsReferenceImage: true, supportsReferenceVideo: true, supportsReferenceAudio: true, maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxReferenceTotal: 15, requiresReferenceImageOrVideo: true };
        expect(() => assertCapabilityConstraints(profile, { capability: "video", referenceImageCount: 10 })).toThrow("最多支持 9 张参考图");
        expect(() => assertCapabilityConstraints(profile, { capability: "video", referenceVideoCount: 4 })).toThrow("最多支持 3 段参考视频");
        expect(() => assertCapabilityConstraints(profile, { capability: "video", referenceAudioCount: 4 })).toThrow("最多支持 3 段参考音频");
        expect(() => assertCapabilityConstraints(profile, { capability: "video", referenceTotalCount: 16 })).toThrow("最多支持 15 份参考素材");
        expect(() => assertCapabilityConstraints(profile, { capability: "video", referenceAudioCount: 1, hasReferenceImageOrVideo: false })).toThrow("不能单独使用");
        expect(() => assertCapabilityConstraints(profile, { capability: "video", referenceImageCount: 1, referenceAudioCount: 1, hasReferenceImageOrVideo: true })).not.toThrow();
        expect(() => assertCapabilityConstraints({ supportsReferenceVideo: false }, { capability: "video", referenceVideoCount: 1 })).toThrow("不支持参考视频");
    });
});
