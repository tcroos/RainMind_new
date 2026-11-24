import { describe, expect, it } from "vitest";
import { clmmVideoTimingTemplate, deepKeyVideoContract } from "./provider-video-contracts";
import { buildVideoProviderRequest } from "./server/provider-task-config";

describe("documented provider video contracts", () => {
    it.each([
        "sd2.0-933-720p-fast-x10s",
        "sd2.0-933-720p-fast-x15s",
        "sd2.0-933-720p-fast-x5-15s",
        "sd2.0-mini933-720p-x10s",
        "sd2.0-mini933-720p-x15s",
        "sd2.0-mini933-720p-x5-15s",
        "Minimax-H3-768p-933-10s",
        "Minimax-H3-768p-933-15s",
        "Minimax-H3-768p-933-10s-15s",
        "MiniMax-H3-933-1440p-10s",
        "MiniMax-H3-933-1440p-15s",
        "MiniMax-H3-933-1440p-10-15s",
    ])("builds the JSON contract for %s", (model) => {
        const contract = deepKeyVideoContract(model)!;
        expect(contract).not.toBeNull();
        const body = buildVideoProviderRequest(contract.config.requestTemplate, {}, { model, prompt: "test", aspect_ratio: "16:9", seconds: 12, images: ["https://fixture.example/source.png"], videos: ["https://fixture.example/video.mp4"], audios: [] });
        expect(body.model).toBe(model);
        expect(body.metadata).toEqual({ video_urls: ["https://fixture.example/video.mp4"], audio_urls: [] });
        if (contract.profile.durationSeconds) expect(body).not.toHaveProperty("seconds");
        else expect(body.seconds).toBe(12);
        expect(body).not.toHaveProperty("resolution");
        expect(contract.profile).toMatchObject({ supportsReferenceImage: true, supportsReferenceVideo: true, supportsReferenceAudio: true, maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3 });
        if (model.startsWith("sd2.0-")) expect(contract.profile).toMatchObject({ maxReferenceTotal: 15, requiresReferenceImageOrVideo: true });
        if (model.startsWith("Minimax-H3-768p")) expect(contract.profile.maxReferenceTotal).toBe(12);
        if (model.startsWith("MiniMax-H3-933-1440p")) expect(contract.profile.maxReferenceTotal).toBe(15);
    });
    it("matches CLMM independent Ns/gz tokens without guessing model capabilities", () => {
        expect(clmmVideoTimingTemplate("LTX-2.3 Pro-1080p-10s-gz")).toEqual({ seconds: "1", mySeconds: "10" });
        expect(clmmVideoTimingTemplate("veo-3.1-fast-720p-8s")).toEqual({ seconds: "1", mySeconds: "{{duration_string}}" });
        expect(clmmVideoTimingTemplate("mg-seedance-2.5-720p")).toEqual({ seconds: "{{seconds_string}}" });
        expect(clmmVideoTimingTemplate("something15selse")).toEqual({ seconds: "{{seconds_string}}" });
        expect(deepKeyVideoContract("unknown-model")).toBeNull();
    });
});
