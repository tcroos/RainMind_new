/**
 * Server-side evidence about a generation task that admin tooling must not guess from status or UI
 * state (BUG-091 / #101). Every helper here errs towards "yes": a task that looks charged, has a
 * result or carries an upstream identity is kept out of any batch close.
 */

type EvidenceRecord = {
    status?: string;
    upstreamTaskId?: string;
    payload?: Record<string, unknown>;
    resultPayload?: Record<string, unknown>;
};

export type GenerationChargeEvidence = { charged: boolean; amount?: number; pointsRecordId?: string; refunded: boolean };

/** Charged when a points record exists, or billing/upstream carries a positive cost. */
export function generationTaskChargeEvidence(record: Pick<EvidenceRecord, "payload">): GenerationChargeEvidence {
    const payload = record.payload || {};
    const billing = object(payload.billing);
    const upstream = object(payload.upstream);
    const attempts = Array.isArray(payload.attempts) ? payload.attempts.map(object) : [];
    const pointsRecordId = text(billing.pointsRecordId) || text(upstream.pointsRecordId) || attempts.map((attempt) => text(attempt.pointsRecordId)).find(Boolean) || "";
    const amount = positive(billing.pointsCost) || positive(upstream.pointsCost) || positive(payload.pointsCost);
    const charged = Boolean(pointsRecordId) || amount > 0;
    return {
        charged,
        ...(charged && amount > 0 ? { amount: Number(amount.toFixed(2)) } : {}),
        ...(pointsRecordId ? { pointsRecordId } : {}),
        refunded: billing.refunded === true || upstream.refunded === true,
    };
}

export function generationTaskHasResult(record: EvidenceRecord) {
    const payload = record.payload || {};
    const resultPayload = record.resultPayload || {};
    if (record.status === "success") return true;
    return [payload.result, payload.providerResults, resultPayload.url, resultPayload.lateResult, resultPayload.lateWorkerEvidence].some(hasEvidence);
}

export function generationTaskHasUpstreamId(record: Pick<EvidenceRecord, "upstreamTaskId" | "payload">) {
    return Boolean(text(record.upstreamTaskId) || text(object(record.payload?.upstream).id));
}

function hasEvidence(value: unknown): boolean {
    if (typeof value === "string") return Boolean(value.trim());
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return false;
}

function positive(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function object(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
