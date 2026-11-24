import { describe, expect, it, vi } from "vitest";

const outbound = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: outbound }));
import { createObjectMediaDownloadResponse } from "./object-media-download-response";

describe("same-origin object media downloads", () => {
    it("streams original bytes without a redirect or dependency on R2 CORS headers", async () => {
        outbound.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4", "content-length": "3" } }));
        const request = new Request("http://localhost/media?download=original");
        const response = await createObjectMediaDownloadResponse(request, "https://storage.example/signed");
        expect(response.status).toBe(200);
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("content-type")).toBe("video/mp4");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
        expect(outbound).toHaveBeenCalledWith("https://storage.example/signed", { signal: request.signal, redirect: "error" });
    });

    it("does not pass upstream error bytes off as a successful download", async () => {
        outbound.mockResolvedValue(new Response("missing", { status: 404 }));
        const response = await createObjectMediaDownloadResponse(new Request("http://localhost/media"), "https://storage.example/signed");
        expect(response.status).toBe(502);
    });
});
