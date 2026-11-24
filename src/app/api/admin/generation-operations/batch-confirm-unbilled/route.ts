import { hasAdminPermission } from "@/lib/admin-permissions";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { readJsonBodyResult } from "@/lib/auth/request";
import { auditActorFromRequest } from "@/lib/server/audit-log-store";
import { BatchCloseUnbilledError, closeUnbilledReviewTasks } from "@/lib/server/generation-batch-close-unbilled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Batch close for uncharged review tasks (#101). One charged / resulted / upstream-identified task
 * rejects the whole batch with 409 and per-item reasons. No refund path is reachable from here.
 */
export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "generation.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要管理员权限" }, { status: 403 });
    const parsed = await readJsonBodyResult<unknown>(request);
    if (!parsed.ok) return NextResponse.json({ code: parsed.status, data: null, msg: parsed.message }, { status: parsed.status });

    try {
        const data = await closeUnbilledReviewTasks(parsed.data, auditActorFromRequest(request, user));
        const { applied, conflict, notFound } = data.summary;
        const status = data.rejected ? 409 : applied > 0 ? 200 : conflict > 0 ? 409 : notFound > 0 ? 404 : 500;
        const msg = data.rejected ? "批次中有已扣款、已有结果或已有上游 ID 的任务，整批未执行" : status === 200 ? "已关闭未扣款任务" : status === 409 ? "任务状态已变化，请刷新后重试" : status === 404 ? "任务不存在或已过期" : "关闭失败";
        return NextResponse.json({ code: status === 200 ? 0 : status, data, msg }, { status });
    } catch (error) {
        if (error instanceof BatchCloseUnbilledError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Batch close unbilled failed", { error: error instanceof Error ? error.message : "unknown" });
        return NextResponse.json({ code: 500, data: null, msg: "操作失败" }, { status: 500 });
    }
}
