import { createHmac, timingSafeEqual } from "node:crypto";

export type AssetEdgeConfig = {
    baseUrl: string;
    secret: string;
};

export function getAssetEdgeConfig(): AssetEdgeConfig | null {
    const baseUrl = (process.env.VOZEB_PRO_ASSET_EDGE_BASE_URL || "").trim().replace(/\/+$/, "");
    const secret = (process.env.VOZEB_PRO_ASSET_EDGE_SECRET || "").trim();
    if (!baseUrl || !secret) return null;
    try {
        const url = new URL(baseUrl);
        if (url.protocol !== "https:") return null;
    } catch {
        return null;
    }
    return { baseUrl, secret };
}

export function createAssetEdgeUrl(objectKey: string, options: { expiresIn?: number; now?: number } = {}) {
    const config = getAssetEdgeConfig();
    if (!config) return null;
    const key = normalizeAssetEdgeKey(objectKey);
    if (!key) return null;
    const now = Math.floor((options.now ?? Date.now()) / 1000);
    const exp = now + Math.max(60, Math.min(3600, Math.floor(options.expiresIn || 3600)));
    const payload = base64UrlEncode(JSON.stringify({ key, exp }));
    const signature = signAssetEdgePayload(config.secret, payload);
    return `${config.baseUrl}/${key.split("/").map(encodeURIComponent).join("/")}?token=v1.${payload}.${signature}`;
}

/**
 * Public CDN URL for generated output. It intentionally carries no token;
 * callers must only use it for the generation scope after the application's
 * own access check has passed. Reference assets must keep the signed route.
 */
export function createPublicAssetEdgeUrl(objectKey: string) {
    const baseUrl = (process.env.VOZEB_PRO_ASSET_EDGE_BASE_URL || "").trim().replace(/\/+$/, "");
    if (!baseUrl) return null;
    try {
        if (new URL(baseUrl).protocol !== "https:") return null;
    } catch {
        return null;
    }
    const key = normalizeAssetEdgeKey(objectKey);
    if (!key) return null;
    return `${baseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeAssetEdgeKey(objectKey: string) {
    return objectKey.trim().replace(/^\/+/, "");
}

export function verifyAssetEdgeToken(token: string, objectKey: string, secret: string, now = Date.now()) {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return false;
    const expected = signAssetEdgePayload(secret, parts[1]);
    const actual = parts[2];
    if (expected.length !== actual.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return false;
    try {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { key?: unknown; exp?: unknown };
        if (payload.key !== objectKey) return false;
        if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now / 1000)) return false;
        return true;
    } catch {
        return false;
    }
}

function signAssetEdgePayload(secret: string, payload: string) {
    return createHmac("sha256", secret).update(`v1.${payload}`).digest("base64url");
}

function base64UrlEncode(value: string) {
    return Buffer.from(value, "utf8").toString("base64url");
}
