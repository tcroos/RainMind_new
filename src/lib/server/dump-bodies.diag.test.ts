import { describe, it } from "vitest";

import { buildVideoProviderRequest } from "./provider-task-config";

describe("dump bodies", () => {
    it("prints rendered payloads", () => {
        const values = {
            model: "mg-seedance-2.5-720p",
            prompt: "a red cube slowly rotates",
            aspect_ratio: "9:16",
            duration: 5,
            seconds: 5,
            images: ["https://r2.example/a.jpg"],
            videos: [],
            audios: [],
            content: [{ type: "text", text: "hi" }],
        };

        const clmm = buildVideoProviderRequest('{"model":"{{model}}","prompt":"{{prompt}}","aspect_ratio":"{{aspect_ratio}}","seconds":"1","reference_image_urls":"{{images}}"}', {}, values);
        console.log("CLMM:", JSON.stringify(clmm));

        const volc = buildVideoProviderRequest('{"model":"{{model}}","content":"{{content}}","ratio":"{{aspect_ratio}}","duration":"{{duration}}"}', {}, values);
        console.log("VOLC:", JSON.stringify(volc));

        const empty = buildVideoProviderRequest('{"model":"{{model}}","reference_image_urls":"{{images}}"}', {}, { ...values, images: [] });
        console.log("EMPTY:", JSON.stringify(empty));
    });
});
