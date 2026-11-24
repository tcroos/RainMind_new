import type { VideoGenerationReference } from "./video-reference-contract";

export type VideoGenerationQuote = { targetId?: string; outputSeconds: number; referenceSeconds: number; totalSeconds: number; points: number; units?: number; billingFingerprint?: string; semanticFingerprint?: string; fingerprint?: string; expiresAt?: number; confirmation?: string };
export type VideoQuoteConfig = { model: string; size?: string; vquality?: string; videoSeconds?: string; [key: string]: unknown };

export function isVideoQuoteExpired(quote: Pick<VideoGenerationQuote, "expiresAt">, now = Date.now()) {
    return !Number.isSafeInteger(quote.expiresAt) || Number(quote.expiresAt) <= now;
}

// Only managed source identity is stable across short-lived read signatures.
// External URLs retain their query: it may select different content.
export function videoReferenceIdentity(value: string, origin?: string) {
    try {
        const url = new URL(value, origin || "https://managed-media.invalid");
        const managed = /^\/api\/(?:reference-assets|generation-log-assets)\//.test(url.pathname);
        if (managed && (!/^https?:\/\//i.test(value) || (origin && url.origin === new URL(origin).origin))) return url.pathname.split("/").map((part) => encodeURIComponent(decodeURIComponent(part))).join("/");
    } catch { /* Invalid URLs are rejected by the media input boundary. */ }
    return value;
}

export function videoQuoteKey(config: VideoQuoteConfig, references: readonly VideoGenerationReference[], origin?: string) {
    // Price and submission semantics depend on the full config and reference multiset.
    // Reference order is part of the upstream request contract (for example, first/last roles and @videoN numbering).
    // Keep it in the client cache key so a reordered list requests a matching signature instead of reusing a stale quote.
    const normalizedReferences = references.map((item) => ({ type: item.type, role: item.role || "", url: videoReferenceIdentity(item.url, origin) }));
    const normalizedConfig = Object.fromEntries(Object.entries(config).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, String(value ?? "")]));
    return JSON.stringify([normalizedConfig, normalizedReferences]);
}

export function videoBillingInputIdentity(config: VideoQuoteConfig, references: readonly VideoGenerationReference[], origin?: string) {
    const normalizedConfig = Object.fromEntries(["model", "size", "vquality", "videoSeconds"].map((key) => [key, String(config[key] ?? "")]));
    const videos = references.filter((item) => item.type === "video").map((item) => ({ role: item.role || "reference", url: videoReferenceIdentity(item.url, origin) }));
    return JSON.stringify([normalizedConfig, videos]);
}

export function videoGenerationSemanticIdentity(config: VideoQuoteConfig, references: readonly VideoGenerationReference[], origin?: string) {
    const normalizedConfig = Object.fromEntries(Object.entries(config).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, String(value ?? "")]));
    const normalizedReferences = references.map((item) => ({
        type: item.type,
        role: item.role || "",
        url: videoReferenceIdentity(item.url, origin),
    }));
    return JSON.stringify([normalizedConfig, normalizedReferences]);
}

export function videoQuoteSignatureIdentity(config: VideoQuoteConfig, references: readonly VideoGenerationReference[], quote: Pick<VideoGenerationQuote, "targetId" | "outputSeconds" | "referenceSeconds" | "totalSeconds" | "points" | "units">, billingSnapshot: unknown, origin?: string) {
    const normalizedConfig = Object.fromEntries(Object.entries(config).sort(([left], [right]) => left.localeCompare(right)));
    const normalizedReferences = references.map((item) => ({
        type: item.type,
        role: item.role || "",
        url: videoReferenceIdentity(item.url, origin),
    }));
    return JSON.stringify([normalizedConfig, normalizedReferences, quote, billingSnapshot]);
}

export function videoCharge(units: number, unitPrice: number) {
    if (!Number.isFinite(units) || units < 0 || units > 1_000_000 || !Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("视频计费单位或单价无效");
    const normalizedUnits = Number(units.toFixed(2));
    const points = Number((normalizedUnits * unitPrice).toFixed(2));
    if (!Number.isFinite(points) || points > 1_000_000) throw new Error("视频费用超过积分消费支持范围");
    return { units: normalizedUnits, points };
}
