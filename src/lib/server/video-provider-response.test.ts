import { describe, expect, it } from "vitest";
import { readVideoProviderId, readVideoProviderUrl } from "./video-provider-response";

describe("video response field precedence", () => {
    it("prefers id regardless of JSON insertion order and falls back for empty ids", () => {
        expect(readVideoProviderId({ task_id: "secondary", id: "primary" })).toBe("primary");
        expect(readVideoProviderId({ id: "primary", task_id: "secondary" })).toBe("primary");
        expect(readVideoProviderId({ id: " ", task_id: "secondary" })).toBe("secondary");
    });

    it("uses ordered nonempty result paths rather than object field order", () => {
        const response = { url: "fallback", video_url: "preferred", metadata: { url: "deepkey" } };
        expect(readVideoProviderUrl(response)).toBe("preferred");
        expect(readVideoProviderUrl({ result_url: "secondary", url: "primary" })).toBe("primary");
        expect(readVideoProviderUrl(response, "metadata.url / video_url / url")).toBe("deepkey");
        expect(readVideoProviderUrl({ metadata: { url: " " }, result_url: "result", url: "fallback" }, "metadata.url / result_url / url")).toBe("result");
    });
});
