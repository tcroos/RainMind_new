import { getDatabaseProvider, ensurePostgresSchema, postgresQuery, withPostgresTransaction } from "@/lib/server/database";
import { listStoredGenerationTaskRecords, withGenerationTaskFileMutation, type GenerationTaskType, type StoredGenerationTaskRecord } from "@/lib/server/generation-task-store";
import { randomUUID } from "node:crypto";
import { currentGenerationTaskFence, matchesGenerationTaskFence } from "./generation-task-fence";
import { isLiveGenerationTask, LIVE_GENERATION_TASK_SQL } from "./generation-task-retention";
import { generationWorkerClaimPrefix, generationWorkerPoolId, imageChannelClaimLimit, generationClaimChannel } from "./generation-claim-capacity";
import { generationDiagnostic } from "./generation-diagnostics";

export type GenerationTaskExecutionPhase = "created" | "submitting" | "submitted" | "polling" | "result_ready" | "persisting" | "cancel_requested" | "cancel_polling" | "needs_review" | "review_pending" | "reviewing" | "review_unavailable" | "completed";

export type GenerationTaskLease = Pick<
    StoredGenerationTaskRecord,
    | "id"
    | "userId"
    | "type"
    | "status"
    | "payload"
    | "executionPhase"
    | "upstreamTaskId"
    | "channelId"
    | "provider"
    | "queryPath"
    | "submittedAt"
    | "nextPollAt"
    | "lastPollAt"
    | "lastUpstreamStatus"
    | "resultPayload"
    | "workerId"
    | "leaseUntil"
    | "lastHeartbeatAt"
>;

export type GenerationTaskSchedulePatch = Partial<Pick<GenerationTaskLease, "executionPhase" | "upstreamTaskId" | "channelId" | "provider" | "queryPath" | "submittedAt" | "nextPollAt" | "lastPollAt" | "lastUpstreamStatus" | "resultPayload">>;
type GenerationTaskScheduleOptions = { cancellation?: boolean; resetUpstreamIdentity?: boolean };

const SCHEDULABLE_TYPES = new Set<GenerationTaskType>(["image", "video", "audio", "text", "agent"]);
const ACTIVE_PHASES = new Set<GenerationTaskExecutionPhase>(["created", "submitting", "submitted", "polling", "result_ready", "persisting"]);
const REVIEW_PHASES = new Set<GenerationTaskExecutionPhase>(["review_pending", "reviewing"]);
const CANCELLATION_PHASES = new Set<GenerationTaskExecutionPhase>(["cancel_requested", "cancel_polling"]);

export async function scheduleGenerationTask(type: GenerationTaskType, id: string, patch: GenerationTaskSchedulePatch, options: GenerationTaskScheduleOptions = {}) {
    const normalized = normalizePatch(patch);
    const fence = currentGenerationTaskFence(type, id);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<Record<string, unknown>>(
            `UPDATE generation_tasks
             SET execution_phase = COALESCE($3, execution_phase), upstream_task_id = COALESCE($4, upstream_task_id),
                 channel_id = COALESCE($5, channel_id), provider = COALESCE($6, provider), query_path = COALESCE($7, query_path),
                 submitted_at = COALESCE($8, submitted_at), next_poll_at = $9, last_poll_at = COALESCE($10, last_poll_at),
                 last_upstream_status = COALESCE($11, last_upstream_status), result_payload = COALESCE($12::jsonb, result_payload)
              WHERE id = $1 AND task_type = $2
                AND ($14::text IS NULL OR (worker_id = $14 AND lease_until > now()))
               AND ($13::boolean OR status <> 'cancelled' OR execution_phase NOT IN ('cancel_requested', 'cancel_polling'))
             RETURNING *`,
            [...scheduleValues(id, type, normalized), options.cancellation === true, fence?.workerId || null],
        );
        return result.rows[0] ? mapLease(result.rows[0]) : null;
    }
    return withGenerationTaskFileMutation(async (tasks) => {
        let result: GenerationTaskLease | null = null;
        const next = tasks.map((task) => {
            if (task.id !== id || task.type !== type) return task;
            if (!matchesGenerationTaskFence(task, fence)) return task;
            if (!canApplySchedulePatch(task, options)) return task;
            const updated = applyPatch(task, normalized);
            result = toLease(updated);
            return updated;
        });
        return { tasks: next, result };
    });
}

export async function claimDueGenerationTasks(input: { workerId: string; now?: number; limit?: number; leaseMs?: number; taskIds?: string[]; onClaimBusy?: () => void }): Promise<GenerationTaskLease[]> {
    const workerPrefix = generationWorkerClaimPrefix(input.workerId);
    if (!workerPrefix) throw new Error("Worker ID is required");
    const workerId = `${workerPrefix}:${randomUUID()}`;
    const poolId = generationWorkerPoolId(workerPrefix);
    const channelLimit = poolId ? imageChannelClaimLimit() : 0;
    const poolPrefix = poolId ? `${poolId}:lane-` : "";
    const now = finiteTime(input.now) || Date.now();
    const limit = Math.max(1, Math.min(50, Math.floor(Number(input.limit) || 20)));
    const leaseUntil = now + Math.max(30_000, Math.min(5 * 60_000, Math.floor(Number(input.leaseMs) || 90_000)));
    const taskIds = Array.from(new Set((input.taskIds || []).map((id) => clean(id, 160)).filter((id): id is string => Boolean(id)))).slice(0, 50);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            const claimStarted = Date.now();
            if (poolId && channelLimit > 0) {
                const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [`generation-claim:${poolId}`]);
                if (!lock.rows[0]?.acquired) {
                    input.onClaimBusy?.();
                    generationDiagnostic("claim_busy", { workerId, totalMs: Date.now() - claimStarted, channelLimit });
                    return [];
                }
            }
            const claimLockMs = Date.now() - claimStarted;
            const result = await client.query<Record<string, unknown>>(
                `WITH active_channels AS (
                    SELECT COALESCE(channel_id, payload->'config'->>'channelId', 'unknown') AS channel,
                           count(*) AS active
                    FROM generation_tasks
                    WHERE $7::text <> '' AND task_type = 'image' AND status IN ('pending', 'running')
                      AND execution_phase IN ('created', 'submitting') AND lease_until > now()
                      AND left(worker_id, length($7::text)) = $7::text
                    GROUP BY 1
                 ), ranked AS (
                     SELECT id, next_poll_at,
                           CASE WHEN execution_phase IN ('result_ready', 'persisting') THEN 0 ELSE 1 END AS phase_priority,
                           row_number() OVER (
                               PARTITION BY CASE WHEN task_type = 'image' AND execution_phase = 'created'
                                   THEN COALESCE(channel_id, payload->'config'->>'channelId', task_type)
                                   ELSE task_type END
                               ORDER BY next_poll_at, id
                           ) AS channel_position
                    FROM generation_tasks
                    WHERE ((status IN ('pending', 'running')
                      AND execution_phase IN ('created', 'submitting', 'submitted', 'polling', 'result_ready', 'persisting'))
                      OR (task_type = 'agent' AND status = 'success' AND execution_phase IN ('review_pending', 'reviewing'))
                      OR (status = 'cancelled' AND execution_phase IN ('cancel_requested', 'cancel_polling')))
                      AND task_type = ANY($6::text[])
                       AND expires_at > now()
                       AND $1::timestamptz IS NOT NULL
                       AND next_poll_at IS NOT NULL AND next_poll_at <= now()
                       AND (lease_until IS NULL OR lease_until <= now())
                      AND (cardinality($4::text[]) = 0 OR id = ANY($4::text[]))
                 ), due AS (
                     SELECT task.id FROM generation_tasks AS task
                    JOIN ranked ON ranked.id = task.id
                    LEFT JOIN active_channels AS capacity ON capacity.channel = COALESCE(task.channel_id, task.payload->'config'->>'channelId', 'unknown')
                    WHERE (task.lease_until IS NULL OR task.lease_until <= now())
                      AND task.next_poll_at IS NOT NULL AND task.next_poll_at <= now()
                      AND ($8::integer <= 0 OR task.task_type <> 'image' OR task.execution_phase <> 'created'
                        OR COALESCE(capacity.active, 0) + ranked.channel_position <= $8::integer)
                     ORDER BY ranked.phase_priority,
                         CASE WHEN task.task_type = 'image' AND task.execution_phase = 'created' THEN COALESCE(capacity.active, 0) ELSE 0 END,
                         ranked.channel_position, ranked.next_poll_at, task.id
                    FOR UPDATE OF task SKIP LOCKED
                    LIMIT $2
                 )
                 UPDATE generation_tasks AS task
                  SET worker_id = $3, lease_until = now() + $5::bigint * interval '1 millisecond', last_heartbeat_at = now()
                 FROM due
                  WHERE task.id = due.id AND (task.lease_until IS NULL OR task.lease_until <= now())
                 RETURNING task.*`,
                [new Date(now), limit, workerId, taskIds, leaseUntil - now, [...SCHEDULABLE_TYPES], poolPrefix, channelLimit],
            );
            const leases = result.rows.map(mapLease);
            generationDiagnostic("claim", { workerId, claimed: leases.length, lockMs: claimLockMs, totalMs: Date.now() - claimStarted, channelLimit });
            for (const lease of leases) generationDiagnostic("lease_acquired", { taskId: lease.id, workerId, phase: lease.executionPhase, channelId: lease.channelId, leaseUntil: lease.leaseUntil });
            return leases;
        });
    }
    return withGenerationTaskFileMutation(async (tasks) => {
        const activeChannels = new Map<string, number>();
        if (poolId && channelLimit > 0) for (const task of tasks) {
            if (task.type !== "image" || !["pending", "running"].includes(task.status) || !["created", "submitting"].includes(task.executionPhase || "") || Number(task.leaseUntil) <= now || !task.workerId?.startsWith(poolPrefix)) continue;
            const channel = generationClaimChannel(task);
            activeChannels.set(channel, (activeChannels.get(channel) || 0) + 1);
        }
        const eligible = tasks
            .filter((task) => isDue(task, now, taskIds))
            .sort((a, b) => Number(a.nextPollAt || 0) - Number(b.nextPollAt || 0) || a.id.localeCompare(b.id));
        const positions = new Map<string, number>();
        const ranked = eligible.map(task => {
            const config = task.payload.config as { channelId?: string } | undefined;
            const channel = task.type === "image" && task.executionPhase === "created" ? task.channelId || config?.channelId || task.type : task.type;
            const position = (positions.get(channel) || 0) + 1;
            positions.set(channel, position);
            return { task, position, active: task.type === "image" && task.executionPhase === "created" ? activeChannels.get(channel) || 0 : 0, priority: ["result_ready", "persisting"].includes(task.executionPhase || "") ? 0 : 1 };
        }).sort((a, b) => a.priority - b.priority || a.active - b.active || a.position - b.position || Number(a.task.nextPollAt || 0) - Number(b.task.nextPollAt || 0) || a.task.id.localeCompare(b.task.id));
        const selected = ranked.filter(({ task, position }) => channelLimit <= 0 || task.type !== "image" || task.executionPhase !== "created" || (activeChannels.get(generationClaimChannel(task)) || 0) + position <= channelLimit).slice(0, limit).map(item => item.task);
        const claimedIds = new Set(selected.map((task) => task.id));
        const next = tasks.map((task) => (claimedIds.has(task.id) ? { ...task, workerId, leaseUntil, lastHeartbeatAt: now } : task));
        const claimed = new Map(next.filter(task => claimedIds.has(task.id)).map(task => [task.id, task]));
        return { tasks: next, result: selected.map(task => toLease(claimed.get(task.id)!)) };
    });
}

export async function getNextGenerationTaskDueAt(now = Date.now()) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ next_due_at: Date | string | null }>(
            `SELECT min(GREATEST(next_poll_at, COALESCE(lease_until, next_poll_at))) AS next_due_at
             FROM generation_tasks
             WHERE ((status IN ('pending', 'running')
                      AND execution_phase IN ('created', 'submitting', 'submitted', 'polling', 'result_ready', 'persisting'))
                    OR (task_type = 'agent' AND status = 'success' AND execution_phase IN ('review_pending', 'reviewing'))
                    OR (status = 'cancelled' AND execution_phase IN ('cancel_requested', 'cancel_polling')))
               AND task_type = ANY($1::text[])
               AND expires_at > $2
               AND next_poll_at IS NOT NULL`,
            [[...SCHEDULABLE_TYPES], new Date(now)],
        );
        return databaseTime(result.rows[0]?.next_due_at);
    }
    const { all: tasks } = await listStoredGenerationTaskRecords({ includeAll: true, page: 1, pageSize: 1 });
    const nextDueAt = tasks.reduce((earliest, task) => {
        if (!isSchedulable(task, now)) return earliest;
        const dueAt = Math.max(Number(task.nextPollAt), Number(task.leaseUntil || 0));
        return dueAt > 0 ? Math.min(earliest, dueAt) : earliest;
    }, Number.POSITIVE_INFINITY);
    return Number.isFinite(nextDueAt) ? nextDueAt : undefined;
}

export async function renewGenerationTaskLeases(workerId: string, taskIds: string[], leaseMs = 90_000, now = Date.now()) {
    const owner = clean(workerId, 160);
    const ids = Array.from(new Set(taskIds.map((id) => clean(id, 160)).filter((id): id is string => Boolean(id)))).slice(0, 50);
    if (!owner || !ids.length) return 0;
    const leaseUntil = now + Math.max(30_000, Math.min(5 * 60_000, Math.floor(leaseMs)));
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery("UPDATE generation_tasks SET lease_until = now() + $3::bigint * interval '1 millisecond', last_heartbeat_at = now() WHERE worker_id = $1 AND id = ANY($2::text[]) AND lease_until > now()", [owner, ids, leaseUntil - now]);
        generationDiagnostic("lease_renewed", { workerId: owner, expected: ids.length, renewed: result.rowCount || 0 });
        return result.rowCount || 0;
    }
    let count = 0;
    await withGenerationTaskFileMutation(async (tasks) => ({
        tasks: tasks.map((task) => {
            if (task.workerId !== owner || !ids.includes(task.id) || Number(task.leaseUntil || 0) <= now) return task;
            count += 1;
            return { ...task, leaseUntil, lastHeartbeatAt: now };
        }),
        result: undefined,
    }));
    return count;
}

export async function releaseGenerationTaskLease(type: GenerationTaskType, id: string, workerId: string, patch: GenerationTaskSchedulePatch, options: GenerationTaskScheduleOptions = {}) {
    const normalized = normalizePatch(patch);
    const owner = clean(workerId, 160);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<Record<string, unknown>>(
            `UPDATE generation_tasks
             SET execution_phase = COALESCE($4, execution_phase), upstream_task_id = CASE WHEN $15::boolean THEN NULL ELSE COALESCE($5, upstream_task_id) END,
                 channel_id = COALESCE($6, channel_id), provider = COALESCE($7, provider), query_path = CASE WHEN $15::boolean THEN NULL ELSE COALESCE($8, query_path) END,
                 submitted_at = CASE WHEN $15::boolean THEN NULL ELSE COALESCE($9, submitted_at) END, next_poll_at = $10,
                 last_poll_at = CASE WHEN $15::boolean THEN NULL ELSE COALESCE($11, last_poll_at) END,
                 last_upstream_status = COALESCE($12, last_upstream_status), result_payload = CASE WHEN $15::boolean THEN $13::jsonb ELSE COALESCE($13::jsonb, result_payload) END,
                 worker_id = NULL, lease_until = NULL
              WHERE id = $1 AND task_type = $2 AND worker_id = $3
                AND lease_until > now()
               AND ($14::boolean OR status <> 'cancelled' OR execution_phase NOT IN ('cancel_requested', 'cancel_polling'))
             RETURNING *`,
            [id, type, owner, ...scheduleValues("", type, normalized).slice(2), options.cancellation === true, options.resetUpstreamIdentity === true],
        );
        return result.rows[0] ? mapLease(result.rows[0]) : null;
    }
    return withGenerationTaskFileMutation(async (tasks) => {
        let result: GenerationTaskLease | null = null;
        const next = tasks.map((task) => {
            if (task.id !== id || task.type !== type || task.workerId !== owner) return task;
            if (Number(task.leaseUntil || 0) <= Date.now()) return task;
            if (!canApplySchedulePatch(task, options)) return task;
            const patched = applyPatch(task, normalized);
            const updated = {
                ...patched,
                ...(options.resetUpstreamIdentity ? { upstreamTaskId: undefined, queryPath: undefined, submittedAt: undefined, lastPollAt: undefined, resultPayload: normalized.resultPayload } : {}),
                workerId: undefined,
                leaseUntil: undefined,
            };
            result = toLease(updated);
            return updated;
        });
        return { tasks: next, result };
    });
}

const REVIEW_CLAIM_LEASE_MS = 120_000;

export type GenerationTaskReviewExpectation = { executionPhase: GenerationTaskExecutionPhase; updatedAt: number; attemptNo?: number };
export type GenerationTaskReviewClaim = { workerId: string; leaseUntil: number };

/**
 * Serialize manual review decisions (BUG-091). Take a short admin lease only if the task still has
 * the phase, updated_at and attempt that the reviewer read, and no worker holds an active lease.
 * The lease makes a second reviewer fail its CAS, and keeps workers from claiming the task while
 * the decision runs. updated_at is bumped with a millisecond Date so later CAS comparisons match.
 */
export async function claimGenerationTaskReview(type: GenerationTaskType, id: string, expected: GenerationTaskReviewExpectation): Promise<GenerationTaskReviewClaim | null> {
    const workerId = `admin-review:${randomUUID()}`;
    const now = Date.now();
    const leaseUntil = now + REVIEW_CLAIM_LEASE_MS;
    const attemptNo = Math.floor(Number(expected.attemptNo) || 0);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<Record<string, unknown>>(
            `UPDATE generation_tasks
             SET worker_id = $6, lease_until = now() + $7::bigint * interval '1 millisecond', updated_at = $8
             WHERE id = $1 AND task_type = $2
               AND execution_phase = $3
               AND updated_at = $4
               AND COALESCE(attempt_no, 0) = $5
               AND (lease_until IS NULL OR lease_until <= now())
               AND ${LIVE_GENERATION_TASK_SQL}
             RETURNING worker_id, lease_until`,
            [id, type, expected.executionPhase, new Date(expected.updatedAt), attemptNo, workerId, REVIEW_CLAIM_LEASE_MS, new Date(now)],
        );
        return result.rows[0] ? { workerId, leaseUntil } : null;
    }
    return withGenerationTaskFileMutation(async (tasks) => {
        let claim: GenerationTaskReviewClaim | null = null;
        const next = tasks.map((task) => {
            if (task.id !== id || task.type !== type) return task;
            if (task.executionPhase !== expected.executionPhase || task.updatedAt !== expected.updatedAt) return task;
            if (Math.floor(Number(task.attemptNo) || 0) !== attemptNo) return task;
            if (task.workerId && Number(task.leaseUntil || 0) > now) return task;
            if (!isLiveGenerationTask(task, now)) return task;
            claim = { workerId, leaseUntil };
            return { ...task, workerId, leaseUntil, updatedAt: now };
        });
        return { tasks: next, result: claim };
    });
}

/** Drop only the review lease owned by this claim. Leaves phase and next_poll_at as the decision set them. */
export async function releaseGenerationTaskReviewClaim(type: GenerationTaskType, id: string, workerId: string): Promise<boolean> {
    const owner = clean(workerId, 160);
    if (!owner) return false;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery("UPDATE generation_tasks SET worker_id = NULL, lease_until = NULL WHERE id = $1 AND task_type = $2 AND worker_id = $3", [id, type, owner]);
        return Number(result.rowCount || 0) > 0;
    }
    return withGenerationTaskFileMutation(async (tasks) => {
        let released = false;
        const next = tasks.map((task) => {
            if (task.id !== id || task.type !== type || task.workerId !== owner) return task;
            released = true;
            return { ...task, workerId: undefined, leaseUntil: undefined };
        });
        return { tasks: next, result: released };
    });
}

export type CancelReviewMarker = { accountId: string; at: string };

/**
 * keep_pending for the cancel review queue (BUG-091 stage 2). Records who looked at the task and
 * when, and nothing else: execution phase, status, schedule, attempt and upstream identity stay as
 * they are, so it cannot refund, create or hand the task to a worker. One conditional UPDATE on the
 * queue's updatedAt token, so a stale list or a concurrent click returns null (a conflict) instead
 * of silently succeeding. updated_at is written as a millisecond Date to keep later tokens exact.
 */
export async function recordCancelReviewKeepPending(type: GenerationTaskType, id: string, expected: { updatedAt: number; attemptNo?: number }, review: CancelReviewMarker): Promise<{ updatedAt: number } | null> {
    const now = Date.now();
    const attemptNo = Math.floor(Number(expected.attemptNo) || 0);
    const marker = { action: "keep_pending", accountId: review.accountId, at: review.at };
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ updated_at: Date | string }>(
            `UPDATE generation_tasks
             SET result_payload = COALESCE(result_payload, '{}'::jsonb) || jsonb_build_object('lastReview', $5::jsonb), updated_at = $6
             WHERE id = $1 AND task_type = $2
               AND execution_phase = 'needs_review'
               AND last_upstream_status = 'cancel_unconfirmed'
               AND updated_at = $3
               AND COALESCE(attempt_no, 0) = $4
               AND (lease_until IS NULL OR lease_until <= now())
               AND ${LIVE_GENERATION_TASK_SQL}
             RETURNING updated_at`,
            [id, type, new Date(expected.updatedAt), attemptNo, JSON.stringify(marker), new Date(now)],
        );
        return result.rows[0] ? { updatedAt: new Date(result.rows[0].updated_at).getTime() } : null;
    }
    return withGenerationTaskFileMutation(async (tasks) => {
        let applied: { updatedAt: number } | null = null;
        const next = tasks.map((task) => {
            if (task.id !== id || task.type !== type) return task;
            if (task.executionPhase !== "needs_review" || task.lastUpstreamStatus !== "cancel_unconfirmed") return task;
            if (task.updatedAt !== expected.updatedAt || Math.floor(Number(task.attemptNo) || 0) !== attemptNo) return task;
            if (task.workerId && Number(task.leaseUntil || 0) > now) return task;
            if (!isLiveGenerationTask(task, now)) return task;
            applied = { updatedAt: now };
            return { ...task, resultPayload: { ...(task.resultPayload || {}), lastReview: marker }, updatedAt: now };
        });
        return { tasks: next, result: applied };
    });
}

export function generationTaskNextPollAt(input: { submittedAt?: number; consecutiveErrors?: number; now?: number; webhook?: boolean }) {
    const now = finiteTime(input.now) || Date.now();
    const submittedAt = finiteTime(input.submittedAt) || now;
    const errors = Math.max(0, Math.floor(Number(input.consecutiveErrors) || 0));
    if (errors) return now + Math.min(60_000, 5_000 * 2 ** Math.min(errors, 4));
    const age = Math.max(0, now - submittedAt);
    const interval = input.webhook ? 30_000 : age < 30_000 ? 5_000 : age < 120_000 ? 10_000 : 25_000;
    return now + interval;
}

function scheduleValues(id: string, type: GenerationTaskType, patch: GenerationTaskSchedulePatch) {
    return [
        id,
        type,
        patch.executionPhase || null,
        patch.upstreamTaskId || null,
        patch.channelId || null,
        patch.provider || null,
        patch.queryPath || null,
        toDate(patch.submittedAt),
        toDate(patch.nextPollAt),
        toDate(patch.lastPollAt),
        patch.lastUpstreamStatus || null,
        patch.resultPayload ? JSON.stringify(patch.resultPayload) : null,
    ];
}

function normalizePatch(patch: GenerationTaskSchedulePatch): GenerationTaskSchedulePatch {
    return {
        executionPhase: isPhase(patch.executionPhase) ? patch.executionPhase : undefined,
        upstreamTaskId: clean(patch.upstreamTaskId, 500),
        channelId: clean(patch.channelId, 160),
        provider: clean(patch.provider, 80),
        queryPath: clean(patch.queryPath, 1000),
        submittedAt: finiteTime(patch.submittedAt),
        nextPollAt: finiteTime(patch.nextPollAt),
        lastPollAt: finiteTime(patch.lastPollAt),
        lastUpstreamStatus: clean(patch.lastUpstreamStatus, 160),
        resultPayload: record(patch.resultPayload),
    };
}

function applyPatch(task: StoredGenerationTaskRecord, patch: GenerationTaskSchedulePatch): StoredGenerationTaskRecord {
    return {
        ...task,
        ...(patch.executionPhase ? { executionPhase: patch.executionPhase } : {}),
        ...(patch.upstreamTaskId ? { upstreamTaskId: patch.upstreamTaskId } : {}),
        ...(patch.channelId ? { channelId: patch.channelId } : {}),
        ...(patch.provider ? { provider: patch.provider } : {}),
        ...(patch.queryPath ? { queryPath: patch.queryPath } : {}),
        ...(patch.submittedAt ? { submittedAt: patch.submittedAt } : {}),
        nextPollAt: patch.nextPollAt,
        ...(patch.lastPollAt ? { lastPollAt: patch.lastPollAt } : {}),
        ...(patch.lastUpstreamStatus ? { lastUpstreamStatus: patch.lastUpstreamStatus } : {}),
        ...(patch.resultPayload ? { resultPayload: patch.resultPayload } : {}),
    };
}

function isDue(task: StoredGenerationTaskRecord, now: number, taskIds: string[]) {
    return isSchedulable(task, now) && Number(task.nextPollAt) <= now && Number(task.leaseUntil || 0) <= now && (!taskIds.length || taskIds.includes(task.id));
}

function isSchedulable(task: StoredGenerationTaskRecord, now: number) {
    const active = (task.status === "pending" || task.status === "running") && ACTIVE_PHASES.has(task.executionPhase || "created");
    const review = task.type === "agent" && task.status === "success" && REVIEW_PHASES.has(task.executionPhase || "created");
    const cancellation = task.status === "cancelled" && CANCELLATION_PHASES.has(task.executionPhase || "created");
    return SCHEDULABLE_TYPES.has(task.type) && (active || review || cancellation) && task.expiresAt > now && Number(task.nextPollAt || 0) > 0;
}

function canApplySchedulePatch(task: StoredGenerationTaskRecord, options: GenerationTaskScheduleOptions) {
    return options.cancellation === true || task.status !== "cancelled" || !CANCELLATION_PHASES.has(task.executionPhase || "created");
}

function mapLease(row: Record<string, unknown>): GenerationTaskLease {
    return {
        id: String(row.id || ""),
        userId: String(row.user_id || ""),
        type: isTaskType(row.task_type) ? row.task_type : "text",
        status: row.status === "pending" || row.status === "running" || row.status === "success" || row.status === "error" || row.status === "paused" || row.status === "cancelled" ? row.status : "error",
        payload: record(row.payload) || {},
        executionPhase: isPhase(row.execution_phase) ? row.execution_phase : "created",
        upstreamTaskId: clean(row.upstream_task_id, 500),
        channelId: clean(row.channel_id, 160),
        provider: clean(row.provider, 80),
        queryPath: clean(row.query_path, 1000),
        submittedAt: databaseTime(row.submitted_at),
        nextPollAt: databaseTime(row.next_poll_at),
        lastPollAt: databaseTime(row.last_poll_at),
        lastUpstreamStatus: clean(row.last_upstream_status, 160),
        resultPayload: record(row.result_payload),
        workerId: clean(row.worker_id, 160),
        leaseUntil: databaseTime(row.lease_until),
        lastHeartbeatAt: databaseTime(row.last_heartbeat_at),
    };
}

function toLease(task: StoredGenerationTaskRecord): GenerationTaskLease {
    return { ...task, executionPhase: task.executionPhase || "created" };
}

function clean(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) || undefined : undefined;
}

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function finiteTime(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

function toDate(value: unknown) {
    const time = finiteTime(value);
    return time ? new Date(time) : null;
}

function databaseTime(value: unknown) {
    if (!value) return undefined;
    const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    return Number.isFinite(time) ? time : undefined;
}

function isPhase(value: unknown): value is GenerationTaskExecutionPhase {
    return (
        value === "created" ||
        value === "submitting" ||
        value === "submitted" ||
        value === "polling" ||
        value === "result_ready" ||
        value === "persisting" ||
        value === "cancel_requested" ||
        value === "cancel_polling" ||
        value === "needs_review" ||
        value === "review_pending" ||
        value === "reviewing" ||
        value === "review_unavailable" ||
        value === "completed"
    );
}

function isTaskType(value: unknown): value is GenerationTaskType {
    return value === "text" || value === "image" || value === "video" || value === "audio" || value === "agent" || value === "render";
}
