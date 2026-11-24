import { hasAdminPermission } from "@/lib/admin-permissions";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { listCancelReviewQueue } from "@/lib/server/generation-cancel-review-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only cancel review queue (BUG-091 stage 1). No refund or state change happens here. */
export async function GET(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "generation.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要管理员权限" }, { status: 403 });

    const params = new URL(request.url).searchParams;
    const filters = {
        type: text(params.get("type")),
        executionPhase: text(params.get("executionPhase")),
        lastUpstreamStatus: text(params.get("lastUpstreamStatus")),
        requestedFrom: time(params.get("requestedFrom")),
        requestedTo: time(params.get("requestedTo")),
    };
    const options = { ...filters, cursor: text(params.get("cursor")), limit: time(params.get("limit")) };
    const defined = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;

    try {
        const data = await listCancelReviewQueue(defined(options));
        await safeRecordAuditLog({
            action: "admin.generation_task.cancel_review.list",
            status: "success",
            actor: auditActorFromRequest(request, user),
            target: { type: "generation_cancel_review_queue", id: "cancel_review" },
            metadata: { filters: defined(filters), resultCount: data.items.length, hasNextPage: Boolean(data.nextCursor) },
        });
        return NextResponse.json({ code: 0, data, msg: "OK" });
    } catch (error) {
        if (error instanceof Error && error.message === "队列游标无效") return NextResponse.json({ code: 400, data: null, msg: error.message }, { status: 400 });
        console.error("Cancel review queue read failed", { error: error instanceof Error ? error.message : "unknown" });
        return NextResponse.json({ code: 500, data: null, msg: "待核查队列读取失败" }, { status: 500 });
    }
}

function text(value: string | null) {
    const trimmed = (value || "").trim().slice(0, 160);
    return trimmed || undefined;
}

function time(value: string | null) {
    const number = Number(value);
    return value && Number.isFinite(number) && number > 0 ? number : undefined;
}