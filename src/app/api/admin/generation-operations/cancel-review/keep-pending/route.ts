import { hasAdminPermission } from "@/lib/admin-permissions";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { readJsonBodyResult } from "@/lib/auth/request";
import { auditActorFromRequest } from "@/lib/server/audit-log-store";
import { CancelReviewActionError, keepCancelReviewPending } from "@/lib/server/generation-cancel-review-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * keep_pending for one or more cancel review tasks (BUG-091 stage 2). Records the review only:
 * no phase change, no refund, no create. A batch where nothing applied is reported as 409/404,
 * never as a silent success.
 */
export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "generation.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要管理员权限" }, { status: 403 });
    const parsed = await readJsonBodyResult<unknown>(request);
    if (!parsed.ok) return NextResponse.json({ code: parsed.status, data: null, msg: parsed.message }, { status: parsed.status });

    try {
        const data = await keepCancelReviewPending(parsed.data, auditActorFromRequest(request, user), { accountId: user.accountId });
        const status = data.summary.applied > 0 ? 200 : data.summary.conflict > 0 ? 409 : 404;
        const msg = status === 200 ? "已保持待处理" : status === 409 ? "任务状态已变化，请刷新队列后重试" : "任务不存在或已过期";
        return NextResponse.json({ code: status === 200 ? 0 : status, data, msg }, { status });
    } catch (error) {
        if (error instanceof CancelReviewActionError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Cancel review keep_pending failed", { error: error instanceof Error ? error.message : "unknown" });
        return NextResponse.json({ code: 500, data: null, msg: "操作失败" }, { status: 500 });
    }
}