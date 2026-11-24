import { describe, expect, it } from "vitest";

import { buildVideoProviderRequest } from "./provider-task-config";

// Public DeepKey video contract: JSON /v1/videos, images plus metadata media URLs.
const fixedTemplate = '{"model":"{{model}}","prompt":"{{prompt}}","aspect_ratio":"{{aspect_ratio}}","images":"{{images}}","metadata":{"video_urls":"{{videos}}","audio_urls":"{{audios}}"}}';
const variableTemplate = '{"model":"{{model}}","prompt":"{{prompt}}","aspect_ratio":"{{aspect_ratio}}","seconds":"{{seconds}}","images":"{{images}}","metadata":{"video_urls":"{{videos}}","audio_urls":"{{audios}}"}}';
const values = {
    model: "sd2.0-mini933-720p-x10s",
    prompt: "Reference image one and video one",
    aspect_ratio: "9:16",
    seconds: 12,
    images: ["https://objects.example/character.png"],
    videos: ["https://objects.example/motion.mp4"],
    audios: ["https://objects.example/music.mp3"],
};

describe("documented JSON video channel templates", () => {
    it("preserves CLMM fixed string fields while rendering the requested duration", () => {
        expect(buildVideoProviderRequest('{"seconds":"1","mySeconds":"{{duration_string}}","resolution":"fixed"}', {}, { seconds: 12, duration_string: "12", resolution: "720p" })).toEqual({ seconds: "1", mySeconds: "12", resolution: "fixed" });
    });
    it("preserves all media arrays and omits timing and resolution on fixed-duration models", () => {
        const body = buildVideoProviderRequest(fixedTemplate, {}, values);

        expect(body).toEqual({ model: values.model, prompt: values.prompt, aspect_ratio: "9:16", images: values.images, metadata: { video_urls: values.videos, audio_urls: values.audios } });
    });

    it("sends an integer duration on variable-duration models", () => {
        const body = buildVideoProviderRequest(variableTemplate, {}, { ...values, model: "sd2.0-mini933-720p-x5-15s" });

        expect(body.seconds).toBe(12);
        expect(body.metadata).toEqual({ video_urls: values.videos, audio_urls: values.audios });
        expect(body).not.toHaveProperty("size");
        expect(body).not.toHaveProperty("resolution");
    });

    it("omits empty images and preserves empty metadata media arrays for text-to-video requests", () => {
        const body = buildVideoProviderRequest(fixedTemplate, {}, { ...values, images: [], videos: [], audios: [] });

        expect(body).not.toHaveProperty("images");
        expect(body.metadata).toEqual({ video_urls: [], audio_urls: [] });
    });
});
