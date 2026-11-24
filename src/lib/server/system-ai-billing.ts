import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { VideoBillingSnapshot } from "@/lib/video-billing";

export const SYSTEM_AI_LOGICAL_MODEL_HEADER = "x-vozeb-pro-logical-model";
export const SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER = "x-vozeb-pro-points-idempotency-key";
export const SYSTEM_AI_POINTS_SIGNATURE_HEADER = "x-vozeb-pro-points-signature";
export const SYSTEM_AI_UPSTREAM_MODEL_HEADER = "x-vozeb-pro-upstream-model";
const VIDEO_BILLING_HEADER = "x-vozeb-pro-video-billing";
export const VIDEO_QUOTE_TTL_MS = 5 * 60_000;

export function signVideoQuote(userId: string, identity: string, now = Date.now()) {
    const expiresAt = now + VIDEO_QUOTE_TTL_MS;
    const fingerprint = createHash("sha256").update(identity).digest("hex");
    const payload = Buffer.from(JSON.stringify({ expiresAt, fingerprint })).toString("base64url");
    const signature = createHmac("sha256", systemAiPointsSigningSecret()).update(`video-quote-v2\0${userId}\0${payload}`).digest("base64url");
    return { confirmation: `${payload}.${signature}`, expiresAt, fingerprint };
}

export function verifyVideoQuote(value: string | undefined, userId: string, identity: string, now = Date.now()) {
    if (typeof value !== "string") return false;
    const [payload, receivedSignature] = value.split(".");
    if (!payload || !receivedSignature) return false;
    const expectedSignature = createHmac("sha256", systemAiPointsSigningSecret()).update(`video-quote-v2\0${userId}\0${payload}`).digest("base64url");
    const receivedBytes = Buffer.from(receivedSignature);
    const expectedBytes = Buffer.from(expectedSignature);
    if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) return false;
    try {
        const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { expiresAt?: unknown; fingerprint?: unknown };
        return typeof claim.expiresAt === "number" && Number.isSafeInteger(claim.expiresAt) && claim.expiresAt > now && claim.fingerprint === createHash("sha256").update(identity).digest("hex");
    } catch {
        return false;
    }
}

export function signedVideoBillingHeaders(input: { userId: string; channelId: string; model: string; upstreamModel: string; businessRequestId: string; body: string; snapshot: VideoBillingSnapshot }) {
    const value = Buffer.from(JSON.stringify({ ...input, body: createHash("sha256").update(input.body).digest("hex") })).toString("base64url");
    const signature = createHmac("sha256", systemAiPointsSigningSecret()).update(`video-v1\0${value}`).digest("base64url");
    return { [VIDEO_BILLING_HEADER]: `${value}.${signature}` };
}

export function verifiedVideoBillingSnapshot(headers: Headers, expected: { userId: string; channelId: string; model: string; upstreamModel: string; businessRequestId: string; bodyDigest: string }): VideoBillingSnapshot | undefined {
    const value = headers.get(VIDEO_BILLING_HEADER);
    if (!value) return undefined;
    const [payload, signature] = value.split(".");
    const wanted = createHmac("sha256", systemAiPointsSigningSecret()).update(`video-v1\0${payload}`).digest("base64url");
    if (!signature || signature.length !== wanted.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(wanted))) throw new Error("视频计费签名无效");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.userId !== expected.userId || data.channelId !== expected.channelId || data.model !== expected.model || data.upstreamModel !== expected.upstreamModel || data.businessRequestId !== expected.businessRequestId || data.body !== expected.bodyDigest) throw new Error("视频计费声明与请求不一致");
    const snapshot = data.snapshot as VideoBillingSnapshot;
    if (snapshot?.charge && (!Number.isFinite(snapshot.charge.units) || snapshot.charge.units < 0 || snapshot.charge.units > 1_000_000 || !Number.isFinite(snapshot.charge.points) || snapshot.charge.points < 0 || snapshot.charge.points > 1_000_000)) throw new Error("视频消费快照无效");
    if (snapshot?.version !== 1 || !Number.isFinite(snapshot.outputSeconds) || snapshot.outputSeconds <= 0 || !Number.isFinite(snapshot.totalSeconds) || !Array.isArray(snapshot.references) || snapshot.references.some((reference) => !reference || typeof reference.storageKey !== "string" || !reference.storageKey || !Number.isFinite(reference.durationMs) || reference.durationMs <= 0 || reference.billedSeconds !== Math.ceil(reference.durationMs / 1000)) || snapshot.referenceSeconds !== snapshot.references.reduce((sum, reference) => sum + reference.billedSeconds, 0) || snapshot.totalSeconds !== snapshot.outputSeconds + snapshot.referenceSeconds) throw new Error("视频计费快照无效");
    return snapshot;
}

const SYSTEM_AI_POINTS_SIGNATURE_VERSION = "v1";
const SYSTEM_AI_POINTS_PROCESS_SECRET = "__vozebProSystemAiPointsProcessSecret" as const;

export type SystemAiBilling = {
    pointsCost?: number;
    pointsRecordId?: string;
};

export function encodeSystemAiHeaderValue(value: string) {
    return encodeURIComponent(value);
}

export function decodeSystemAiHeaderValue(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function systemAiBillingHeaders(logicalModel: string, idempotencyKey?: string, upstreamModel?: string) {
    const normalizedLogicalModel = logicalModel.trim();
    const normalizedIdempotencyKey = idempotencyKey?.trim();
    const normalizedUpstreamModel = upstreamModel?.trim();
    return {
        ...(normalizedLogicalModel ? { [SYSTEM_AI_LOGICAL_MODEL_HEADER]: encodeSystemAiHeaderValue(normalizedLogicalModel) } : {}),
        ...(normalizedIdempotencyKey
            ? {
                  [SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER]: normalizedIdempotencyKey,
                  [SYSTEM_AI_POINTS_SIGNATURE_HEADER]: signSystemAiBusinessRequest(normalizedLogicalModel, normalizedIdempotencyKey, normalizedUpstreamModel || ""),
              }
            : {}),
        ...(normalizedUpstreamModel ? { [SYSTEM_AI_UPSTREAM_MODEL_HEADER]: encodeSystemAiHeaderValue(normalizedUpstreamModel) } : {}),
    };
}

export function readVerifiedSystemAiBusinessRequestId(headers: Headers, logicalModel: string, upstreamModel: string) {
    const businessRequestId = headers.get(SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER)?.trim().slice(0, 200) || "";
    const signature = headers.get(SYSTEM_AI_POINTS_SIGNATURE_HEADER)?.trim() || "";
    if (!businessRequestId || !signature) return undefined;
    const expected = signSystemAiBusinessRequest(logicalModel.trim(), businessRequestId, upstreamModel.trim());
    const receivedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) return undefined;
    return businessRequestId;
}

export function systemAiPointsIdempotencyKey(input: { userId: string; businessRequestId: string; logicalModel: string; channelId: string; upstreamModel: string; callType: string }) {
    return `system-ai:${stableDigest([input.userId, input.businessRequestId, input.logicalModel, input.channelId, input.upstreamModel, input.callType])}`;
}

export function systemAiRequestFingerprint(input: { method: string; callType: string; logicalModel: string; channelId: string; upstreamModel: string; usageKind: string; amount: number; bodyDigest: string }) {
    return stableDigest([input.method.toUpperCase(), input.callType, input.logicalModel, input.channelId, input.upstreamModel, input.usageKind, String(input.amount), input.bodyDigest]);
}

export function systemAiIdempotencyKey(scope: string, ...parts: string[]) {
    const prefix =
        scope
            .trim()
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .slice(0, 40) || "system-ai";
    const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
    return `${prefix}:${digest}`;
}

function signSystemAiBusinessRequest(logicalModel: string, businessRequestId: string, upstreamModel: string) {
    return createHmac("sha256", systemAiPointsSigningSecret())
        .update([SYSTEM_AI_POINTS_SIGNATURE_VERSION, normalizeBillingModel(logicalModel), businessRequestId, normalizeBillingModel(upstreamModel)].join("\0"))
        .digest("base64url");
}

function stableDigest(parts: string[]) {
    return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function normalizeBillingModel(value: string) {
    return value
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
}

function systemAiPointsSigningSecret() {
    const configured = process.env.VOZEB_PRO_ENCRYPTION_KEY?.trim();
    if (configured) return configured;
    const scope = globalThis as typeof globalThis & { __vozebProSystemAiPointsProcessSecret?: Buffer };
    scope[SYSTEM_AI_POINTS_PROCESS_SECRET] ||= randomBytes(32);
    return scope[SYSTEM_AI_POINTS_PROCESS_SECRET];
}

export function readSystemAiBilling(headers: Headers): SystemAiBilling {
    const rawCost = headers.get("x-vozeb-pro-points-cost");
    const cost = rawCost === null ? undefined : Number(rawCost);
    return {
        pointsCost: cost !== undefined && Number.isFinite(cost) && cost >= 0 ? cost : undefined,
        pointsRecordId: headers.get("x-vozeb-pro-points-record-id") || undefined,
    };
}

export function hasSystemAiCharge(billing: SystemAiBilling): billing is Required<SystemAiBilling> {
    return billing.pointsCost !== undefined && Boolean(billing.pointsRecordId);
}
