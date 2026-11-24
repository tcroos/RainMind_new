import { afterEach, describe, expect, it, vi } from "vitest";

import { createAssetEdgeUrl, createPublicAssetEdgeUrl, getAssetEdgeConfig, verifyAssetEdgeToken } from "./asset-edge";

const secret = "edge-test-secret";

describe("asset edge tokens", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("signs a generation object with a scoped, expiring token", () => {
        vi.stubEnv("VOZEB_PRO_ASSET_EDGE_BASE_URL", "https://assets.example.com/");
        vi.stubEnv("VOZEB_PRO_ASSET_EDGE_SECRET", secret);
        const url = new URL(createAssetEdgeUrl("vozeb-pro/media/generation/permanent/2026/11/05/a.png", { now: 1_000_000_000_000, expiresIn: 120 })!);

        expect(url.origin).toBe("https://assets.example.com");
        expect(url.pathname).toBe("/vozeb-pro/media/generation/permanent/2026/11/05/a.png");
        const token = url.searchParams.get("token")!;
        expect(verifyAssetEdgeToken(token, "vozeb-pro/media/generation/permanent/2026/11/05/a.png", secret, 1_000_000_030_000)).toBe(true);
        expect(verifyAssetEdgeToken(token, "vozeb-pro/media/reference/a.png", secret, 1_000_000_030_000)).toBe(false);
        expect(verifyAssetEdgeToken(token, "vozeb-pro/media/generation/permanent/2026/11/05/a.png", secret, 1_000_000_130_000)).toBe(false);
    });

    it("returns no URL when the edge is not configured or is not HTTPS", () => {
        expect(getAssetEdgeConfig()).toBeNull();
        expect(createAssetEdgeUrl("vozeb-pro/media/generation/a.png")).toBeNull();
        vi.stubEnv("VOZEB_PRO_ASSET_EDGE_BASE_URL", "http://assets.example.com");
        vi.stubEnv("VOZEB_PRO_ASSET_EDGE_SECRET", secret);
        expect(getAssetEdgeConfig()).toBeNull();
    });

    it("builds a public CDN URL without requiring an edge secret", () => {
        vi.stubEnv("VOZEB_PRO_ASSET_EDGE_BASE_URL", "https://cdn.example.com/");
        expect(createPublicAssetEdgeUrl("vozeb-pro/media/generation/permanent/a.png")).toBe("https://cdn.example.com/vozeb-pro/media/generation/permanent/a.png");
        expect(createPublicAssetEdgeUrl("")).toBeNull();
        vi.stubEnv("VOZEB_PRO_ASSET_EDGE_BASE_URL", "http://cdn.example.com");
        expect(createPublicAssetEdgeUrl("vozeb-pro/media/generation/a.png")).toBeNull();
    });
});
