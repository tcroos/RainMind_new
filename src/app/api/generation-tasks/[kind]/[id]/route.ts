import { getCurrentUser } from "@/lib/auth/session";
import { getAudioTask } from "@/lib/server/audio-task-store";
import { getImageTask } from "@/lib/server/image-task-store";
import { getTextTask } from "@/lib/server/text-task-store";
import { getVideoTask } from "@/lib/server/video-task-store";
import { getStoredGenerationTaskRecord } from "@/lib/server/generation-task-store";
import { getDatabaseProvider } from "@/lib/server/database";
import { createPostgresRepositories } from "@/lib/server/database/repositories";
import { readAuthDb } from "@/lib/auth/store-repository";
import { contractError, contractResponse } from "../../contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "image" | "video" | "audio" | "text";
type RouteContext = { params: Promise<{ kind: string; id: string }> };

const KINDS = new Set<Kind>(["image", "video", "audio", "text"]);

function unifiedError(status: number, code: string, message: string, traceId: string) {
    return contractError(traceId, "read", status, code, message);
}

export async function GET(request: Request, context: RouteContext) {
    const traceId = crypto.randomUUID();
    try {
        const user = await getCurrentUser(request);
        if (!user) return unifiedError(401, "UNAUTHORIZED", "请先登录", traceId);
        const { kind: rawKind, id } = await context.params;
        const kind = rawKind as Kind;
        if (!KINDS.has(kind)) return unifiedError(400, "INVALID_TASK_KIND", "不支持的任务类型", traceId);
        if (!id || id.length > 160) return unifiedError(400, "INVALID_TASK_ID", "任务 ID 不合法", traceId);

        const task = kind === "image" ? await getImageTask(id) : kind === "video" ? await getVideoTask(id) : kind === "audio" ? await getAudioTask(id) : await getTextTask(id);
        if (!task || (task.userId !== user.id && user.role !== "admin")) return unifiedError(404, "TASK_NOT_FOUND", "任务不存在或已过期", traceId);
        const record = await getStoredGenerationTaskRecord(kind, id);
        const view = task as unknown as {
            id: string;
            status: string;
            error?: string;
            result?: unknown;
            content?: unknown;
            billing?: { pointsCost?: number; pointsRecordId?: string; refunded?: boolean };
            upstream?: { pointsCost?: number; pointsRecordId?: string; refunded?: boolean };
        };
        const power = view.billing?.pointsCost ?? view.upstream?.pointsCost;
        // billed is a UI hint only. A `true` value means "this terminal state does not need
        // a "not billed" prompt"; it does not guarantee a real charge happened. For a real
        // charge audit we require a points record id or a positive points cost from billing.
        const billingRecordId = view.billing?.pointsRecordId || view.upstream?.pointsRecordId;
        const billingCost = view.billing?.pointsCost ?? view.upstream?.pointsCost;
        const hasChargeEvidence = Boolean(billingRecordId) || (typeof billingCost === "number" && billingCost > 0);
        const refunded = view.billing?.refunded ?? view.upstream?.refunded;
        const status = view.status;
        const needsReview = record?.executionPhase === "needs_review";
        const progress = record?.payload && typeof record.payload === "object" ? (record.payload as { progressPercent?: unknown }).progressPercent : undefined;

        const responseTask = {
            id: view.id,
            taskId: view.id,
            kind,
            status,
            needsReview,
            progressPercent: Number.isFinite(Number(progress)) ? Math.max(0, Math.min(100, Number(progress))) : status === "success" ? 100 : null,
            power: typeof power === "number" ? power : null,
            ...(status === "success" || hasChargeEvidence ? { billed: true } : status === "error" || status === "cancelled" ? { billed: false } : {}),
            result: view.result ?? (kind === "text" ? { content: view.content ?? null } : null),
            error: view.error || null,
            refundStatus: refunded === true ? "refunded" : (status === "error" || status === "cancelled") && Boolean(view.billing?.pointsRecordId || view.upstream?.pointsRecordId) ? "pending" : "not_required",
        };
        if (user.role === "admin") {
            const rawEvidence = record?.resultPayload?.billingEvidence;
            const evidence = (Array.isArray(rawEvidence) ? rawEvidence : []).filter((item): item is { pointsRecordId?: string; pointsCost?: number } => Boolean(item && typeof item === "object"));
            const associated = evidence.find(item => typeof item.pointsRecordId === "string" && item.pointsRecordId);
            const billingView = !view.billing?.pointsRecordId && !view.upstream?.pointsRecordId && associated ? { ...view, billing: associated } : view;
            const billing = await readAuthoritativeBilling(task.userId, billingView, status);
            const evidenceLedger = await Promise.all(evidence.map(async item => ({ ...item, ledger: await readAuthoritativeBilling(task.userId, { billing: item }, "running") })));
            (responseTask as Record<string, unknown>).billing = billing;
            (responseTask as Record<string, unknown>).billingEvidence = evidenceLedger;
            responseTask.refundStatus = billing.refundStatus;
        }

        return contractResponse(traceId, "read",
            {
                ok: true,
                data: {
                    // Snapshot only: legacy single-task readers still own recovery/refund effects.
                    readOnly: true,
                    settlementRequired: true,
                    task: responseTask,
                },
            },
        );
    } catch (error) {
        console.error("Unified generation task read failed", { traceId, error });
        return unifiedError(500, "GENERATION_TASK_READ_FAILED", "任务状态读取失败", traceId);
    }
}

async function readAuthoritativeBilling(userId: string, view: { billing?: { pointsCost?: number; pointsRecordId?: string; refunded?: boolean }; upstream?: { pointsCost?: number; pointsRecordId?: string; refunded?: boolean } }, status: string) {
    const recordId = view.billing?.pointsRecordId || view.upstream?.pointsRecordId;
    const fallbackCost = view.billing?.pointsCost ?? view.upstream?.pointsCost ?? 0;
    const records = getDatabaseProvider() === "postgres"
        ? await readPostgresBillingRecords(userId, recordId)
        : await readFileBillingRecords(userId, recordId);
    const consume = records.consume;
    const refund = records.refund;
    const originalPoints = consume ? Math.abs(consume.amount) : fallbackCost;
    const refundedPoints = refund ? Math.max(0, refund.amount) : 0;
    const isRefunded = Boolean(refund);
    const snapshotConflict = !refund && Boolean(view.billing?.refunded || view.upstream?.refunded);
    const refundStatus = isRefunded ? "refunded" : snapshotConflict ? "unknown" : status === "success" ? "not_required" : consume ? (status === "error" || status === "cancelled" ? "pending" : "unknown") : "unknown";
    const unrestoredPoints = isRefunded ? Math.max(0, originalPoints - refundedPoints) : 0;
    return {
        originalPoints,
        refundedPoints,
        refundRecordId: refund?.id || null,
        refundStatus,
        unrestoredPoints,
        unrestoredReason: unrestoredPoints > 0 ? "退款记录金额低于原消费记录，需管理员核查" : null,
        originalRecordId: consume?.id || recordId || null,
        settlementConflict: snapshotConflict ? "snapshot_refunded_without_ledger" : null,
    };
}

async function readFileBillingRecords(userId: string, recordId?: string) {
    const records = (await readAuthDb()).pointRecords.filter(record => record.userId === userId);
    const consume = records.find(record => record.id === recordId && record.type === "consume") || records.find(record => record.type === "consume" && record.id === recordId);
    const refund = consume ? records.find(record => record.type === "refund" && record.sourceRecordId === consume.id) : undefined;
    return { consume, refund };
}

async function readPostgresBillingRecords(userId: string, recordId?: string) {
    if (!recordId) return { consume: null, refund: null };
    const points = createPostgresRepositories().points;
    const consume = await points.getRecordById(recordId);
    if (!consume || consume.userId !== userId || consume.type !== "consume") return { consume: null, refund: null };
    const refund = await points.getRefundRecordBySourceRecordId(consume.id);
    return { consume, refund: refund?.userId === userId ? refund : null };
}
