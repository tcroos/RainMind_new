import { describe, expect, it } from "vitest";

import { imageModelFamily } from "./image-model-family";

describe("GPT image families", () => {
    it.each(["gpt-image-2", "gpt-image-2-4K", "gpt-image-2-adobe", "gpt-image-2-count", "gpt-image-2-Gpt02"])("groups %s without changing its upstream identity", (model) => {
        expect(imageModelFamily(model)).toEqual({ id: "gpt-image-2", name: "GPT Image 2" });
    });
    it.each(["gpt-image-2.5", "gpt-image-2.5-Gpt02"])("groups %s into the GPT Image 2.5 family", (model) => {
        expect(imageModelFamily(model)).toEqual({ id: "gpt-image-2.5", name: "GPT Image 2.5" });
    });
    it.each(["flare", "sunburst"])("keeps the %s variant separate", (variant) => {
        for (const suffix of ["", "-count", "-adobe", "-Gpt02"]) expect(imageModelFamily(`gpt-image-2.5-${variant}${suffix}`)?.id).toBe(`gpt-image-2.5-${variant}`);
        expect(imageModelFamily(`gpt-image-2.5-${variant}-sync`)).toBeUndefined();
    });
});
