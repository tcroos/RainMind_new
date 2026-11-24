import { getCurrentUser } from "@/lib/auth/session";
import { readJsonBodyResult } from "@/lib/auth/request";
import { ensurePostgresSchema, getDatabaseProvider, postgresQuery } from "@/lib/server/database";
import { readJsonDataFile } from "@/lib/server/data-adapter";
import type { StoredGenerationTaskRecord } from "@/lib/server/generation-task-types";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { isLiveGenerationTask, LIVE_GENERATION_TASK_SQL } from "@/lib/server/generation-task-retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SummaryRow = { id: string; kind: string; status: string; progress: unknown; task_id: string | null; error: string | null; phase: string | null; result_count: unknown };

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return Response.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const parsed = await readJsonBodyResult<{ ids?: unknown }>(request, 8192);
    if (!parsed.ok) return Response.json({ code: parsed.status, data: null, msg: parsed.message }, { status: parsed.status });
    const input = parsed.data?.ids;
    if (!Array.isArray(input) || input.length < 1 || input.length > 20 || input.some(id => typeof id !== "string" || !id.trim() || id.length > 160)) {
        return Response.json({ code: 400, data: null, msg: "ids 必须包含 1–20 个有效任务 ID" }, { status: 400 });
    }
    const ids = [...new Set(input.map(id => (id as string).trim()))];
    let rows: SummaryRow[];
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<SummaryRow>(
            `SELECT id, task_type AS kind, status, payload->>'progressPercent' AS progress,
                    upstream_task_id AS task_id, payload->>'error' AS error, execution_phase AS phase,
                    CASE WHEN jsonb_typeof(payload#>'{result,results}') = 'array' THEN jsonb_array_length(payload#>'{result,results}')
                         WHEN status = 'success' AND payload->'result' IS NOT NULL AND payload->'result' <> 'null'::jsonb THEN 1 ELSE 0 END AS result_count
             FROM generation_tasks WHERE user_id = $1 AND id = ANY($2::text[]) AND ${LIVE_GENERATION_TASK_SQL}`, [user.id, ids]);
        rows = result.rows;
    } else {
        const records = await readJsonDataFile<StoredGenerationTaskRecord[]>("generation-tasks.json", []);
        rows = records.filter(record => record.userId === user.id && ids.includes(record.id) && isLiveGenerationTask(record)).map(record => {
            const result = record.payload.result as { results?: unknown[] } | undefined;
            return { id: record.id, kind: record.type, status: record.status, progress: record.payload.progressPercent, task_id: record.upstreamTaskId || null,
                error: typeof record.payload.error === "string" ? record.payload.error : null, phase: record.executionPhase || null,
                result_count: Array.isArray(result?.results) ? result.results.length : record.status === "success" && result ? 1 : 0 };
        });
    }
    const byId = new Map(rows.map(row => [row.id, row]));
    const tasks = ids.map(id => {
        const row = byId.get(id);
        if (!row) return { id, kind: null, status: "not_found", progressPercent: null, taskId: null, error: null, needsReview: false, resultCount: 0, notFound: true };
        const progress = row.progress === null || row.progress === undefined || row.progress === "" ? null : Number(row.progress);
        return { id, kind: row.kind, status: row.status, progressPercent: progress !== null && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : row.status === "success" ? 100 : null,
            taskId: row.task_id, error: row.error ? toSafeGenerationErrorMessage(row.error, "任务执行失败") : null, needsReview: row.phase === "needs_review", resultCount: Number(row.result_count) || 0 };
    });
    return Response.json({ code: 0, data: { tasks }, msg: "OK" }, { headers: { "Cache-Control": "private, no-store" } });
}
