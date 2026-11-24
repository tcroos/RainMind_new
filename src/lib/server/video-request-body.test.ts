import { describe, expect, it } from "vitest";

import { buildVideoProviderRequest } from "./provider-task-config";

/**
 * Snapshot the exact JSON body our video worker emits for each upstream family.
 *
 * The reference field names come from the upstream contracts:
 *   - clmm-mall: POST /v1/videos with reference_image_urls (array)
 *   - xinbiapi (volc): content multimodal array
 *   - deepkey/minimax: reference fields per channel template
 */
const values = {
    model: "mg-seedance-2.5-720p",
    prompt: "a red cube slowly rotates",
    aspect_ratio: "9:16",
    duration: 5,
    seconds: 5,
    seconds_string: "5",
    images: ["https://r2.example/a.jpg"],
    videos: [],
    audios: [],
    content: [
        { type: "text", text: "a red cube slowly rotates" },
        { type: "image_url", role: "reference_image", image_url: { url: "https://r2.example/a.jpg" } },
    ],
};

function render(template: string) {
    return buildVideoProviderRequest(template, {}, values) as Record<string, unknown>;
}

describe("video request bodies per upstream", () => {
    it("clmm: reference_image_urls is an array (official contract)", () => {
        const out = render('{"model":"{{model}}","prompt":"{{prompt}}","aspect_ratio":"{{aspect_ratio}}","seconds":"{{seconds_string}}","reference_image_urls":"{{images}}"}');
        expect(out.model).toBe("mg-seedance-2.5-720p");
        expect(out.reference_image_urls).toEqual(["https://r2.example/a.jpg"]);
        expect(Array.isArray(out.reference_image_urls)).toBe(true);
        expect(out.seconds).toBe("5");
    });

    it("clmm: reference_videos/reference_audios stay arrays", () => {
        const withMedia = { ...values, videos: ["https://r2.example/v.mp4"], audios: ["https://r2.example/a.mp3"] };
        const out = buildVideoProviderRequest('{"model":"{{model}}","prompt":"{{prompt}}","reference_image_urls":"{{images}}","reference_videos":"{{videos}}","reference_audios":"{{audios}}"}', {}, withMedia) as Record<string, unknown>;
        expect(out.reference_image_urls).toEqual(["https://r2.example/a.jpg"]);
        expect(out.reference_videos).toEqual(["https://r2.example/v.mp4"]);
        expect(out.reference_audios).toEqual(["https://r2.example/a.mp3"]);
    });

    it("xinbiapi/volc: content becomes a multimodal array", () => {
        const out = render('{"model":"{{model}}","content":"{{content}}","ratio":"{{aspect_ratio}}","duration":"{{duration}}"}');
        expect(Array.isArray(out.content)).toBe(true);
    });

    it("empty reference list stays an array for the CLMM reference_image_urls field", () => {
        const out = buildVideoProviderRequest('{"model":"{{model}}","reference_image_urls":"{{images}}"}', {}, { ...values, images: [] }) as Record<string, unknown>;
        expect(out.reference_image_urls).toEqual([]);
    });
});
