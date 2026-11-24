import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    provider: "file" as "file" | "postgres",
    records: [] as Array<Record<string, unknown>>,
    postgresQuery: vi.fn(),
    transactionQuery: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn(() => mocks.provider),
    postgresQuery: mocks.postgresQuery,
    withPostgresTransaction: vi.fn(async (handler: (client: { query: typeof mocks.transactionQuery }) => unknown) => handler({ query: mocks.transactionQuery })),
}));
vi.mock("@/lib/server/generation-task-store", () => {
    // Mirror the real store: file mutations run one at a time through a queue.
    let queue: Promise<unknown> = Promise.resolve();
    return {
        listStoredGenerationTaskRecords: vi.fn(async () => ({ all: structuredClone(mocks.records) })),
        withGenerationTaskFileMutation: vi.fn((mutate: (records: Array<Record<string, unknown>>) => Promise<{ tasks: Array<Record<string, unknown>>; result: unknown }>) => {
            const run = queue.then(async () => {
                const result = await mutate(structuredClone(mocks.records));
                mocks.records = structuredClone(result.tasks);
                return result.result;
            });
            queue = run.catch(() => undefined);
            return run;
        }),
    };
});

import { claimDueGenerationTasks, claimGenerationTaskReview, generationTaskNextPollAt, getNextGenerationTaskDueAt, recordCancelReviewKeepPending, releaseGenerationTaskLease, releaseGenerationTaskReviewClaim, renewGenerationTaskLeases, scheduleGenerationTask } from "./generation-task-scheduler";

describe("generation task scheduler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        mocks.provider = "file";
        mocks.records = [record("due", 900), record("future", 2_000)];
    });

    afterEach(() => vi.useRealTimers());

    it("claims each due task once and only renews the current owner lease", async () => {
        const claimed = await claimDueGenerationTasks({ workerId: "worker-one", now: 1_000, leaseMs: 60_000 });

        expect(claimed.map((item) => item.id)).toEqual(["due"]);
        expect(await claimDueGenerationTasks({ workerId: "worker-two", now: 1_001, leaseMs: 60_000 })).toEqual([]);
        expect(await renewGenerationTaskLeases("worker-two", ["due"], 60_000, 2_000)).toBe(0);
        const owner = String(claimed[0]?.workerId);
        expect(await renewGenerationTaskLeases(owner, ["due"], 60_000, 2_000)).toBe(1);
        expect(mocks.records.find((item) => item.id === "due")).toMatchObject({ workerId: owner, leaseUntil: 62_000, lastHeartbeatAt: 2_000, updatedAt: 100 });
    });

    it("reports the earliest schedulable file task without treating expired work as due", async () => {
        mocks.records.push({ ...record("expired", 500), expiresAt: 999 });
        await expect(getNextGenerationTaskDueAt(1_000)).resolves.toBe(900);

        await claimDueGenerationTasks({ workerId: "worker-one", now: 1_000, leaseMs: 60_000 });
        await expect(getNextGenerationTaskDueAt(1_001)).resolves.toBe(2_000);
    });

    it("requires lease ownership when releasing and clears next poll for terminal phases", async () => {
        await claimDueGenerationTasks({ workerId: "worker-one", now: 1_000, leaseMs: 60_000 });

        const owner = String(mocks.records[0].workerId);
        await expect(releaseGenerationTaskLease("image", "due", "worker-two", { executionPhase: "completed", nextPollAt: undefined })).resolves.toBeNull();
        expect(mocks.records[0]).toMatchObject({ workerId: owner });

        await expect(releaseGenerationTaskLease("image", "due", owner, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "persisted" })).resolves.toMatchObject({
            executionPhase: "completed",
            nextPollAt: undefined,
            workerId: undefined,
            leaseUntil: undefined,
        });
    });

    it("preserves upstream identity while moving a result into persistence", async () => {
        await scheduleGenerationTask("image", "due", { executionPhase: "submitted", upstreamTaskId: "upstream-one", channelId: "channel-one", submittedAt: 500, nextPollAt: 1_500 });
        await scheduleGenerationTask("image", "due", { executionPhase: "result_ready", resultPayload: { url: "https://cdn.example/result.png" }, nextPollAt: 1_000 });

        expect(mocks.records[0]).toMatchObject({
            executionPhase: "result_ready",
            upstreamTaskId: "upstream-one",
            channelId: "channel-one",
            resultPayload: { url: "https://cdn.example/result.png" },
        });
    });

    it("clears the previous upstream identity before an automatic retry", async () => {
        mocks.records[0] = {
            ...mocks.records[0],
            workerId: "worker-one:fixture",
            leaseUntil: 60_000,
            upstreamTaskId: "upstream-failed",
            queryPath: "/jobs/upstream-failed",
            submittedAt: 500,
            lastPollAt: 900,
            resultPayload: { previous: true },
        };

        await releaseGenerationTaskLease("image", "due", String(mocks.records[0].workerId), { executionPhase: "created", nextPollAt: 1_000, lastUpstreamStatus: "automatic_retry_after_upstream_failure" }, { resetUpstreamIdentity: true });

        expect(mocks.records[0]).toMatchObject({ executionPhase: "created", nextPollAt: 1_000, lastUpstreamStatus: "automatic_retry_after_upstream_failure" });
        expect(mocks.records[0].upstreamTaskId).toBeUndefined();
        expect(mocks.records[0].queryPath).toBeUndefined();
        expect(mocks.records[0].submittedAt).toBeUndefined();
        expect(mocks.records[0].lastPollAt).toBeUndefined();
        expect(mocks.records[0].resultPayload).toBeUndefined();
    });

    it("claims a completed Agent only while a persistent review is due", async () => {
        mocks.records = [{ ...record("review", 900), type: "agent", status: "success", executionPhase: "review_pending" }];

        await expect(claimDueGenerationTasks({ workerId: "review-worker", now: 1_000 })).resolves.toEqual([expect.objectContaining({ id: "review", status: "success", executionPhase: "review_pending" })]);
    });

    it("uses SKIP LOCKED and an owner-qualified release in PostgreSQL", async () => {
        mocks.provider = "postgres";
        mocks.transactionQuery.mockResolvedValueOnce({ rows: [] });
        mocks.postgresQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ next_due_at: new Date(2_000) }] });

        await claimDueGenerationTasks({ workerId: "worker-one", now: 1_000, taskIds: ["due"] });
        await releaseGenerationTaskLease("image", "due", "worker-one", { executionPhase: "polling", nextPollAt: 2_000 });
        await expect(getNextGenerationTaskDueAt(1_000)).resolves.toBe(2_000);

        expect(String(mocks.transactionQuery.mock.calls[0]?.[0])).toContain("FOR UPDATE OF task SKIP LOCKED");
        expect(mocks.transactionQuery.mock.calls[0]?.[1]).toEqual([new Date(1_000), 20, expect.stringMatching(/^worker-one:/), ["due"], 90_000, ["image", "video", "audio", "text", "agent"], "", 0]);
        expect(String(mocks.postgresQuery.mock.calls[0]?.[0])).toContain("worker_id = $3");
        expect(mocks.postgresQuery.mock.calls[0]?.[1]).toHaveLength(15);
        expect(String(mocks.postgresQuery.mock.calls[1]?.[0])).toContain("min(GREATEST(next_poll_at");
        expect(mocks.postgresQuery.mock.calls[1]?.[1]).toEqual([["image", "video", "audio", "text", "agent"], new Date(1_000)]);
    });

    describe("manual review claim (BUG-091)", () => {
        function reviewRecord(patch: Record<string, unknown> = {}) {
            return { ...record("review", 0), executionPhase: "needs_review", nextPollAt: undefined, attemptNo: 1, updatedAt: 500, ...patch };
        }

        it("lets only one of two concurrent reviewers claim the same task", async () => {
            mocks.records = [reviewRecord()];
            const expected = { executionPhase: "needs_review" as const, updatedAt: 500, attemptNo: 1 };

            const [first, second] = await Promise.all([claimGenerationTaskReview("image", "review", expected), claimGenerationTaskReview("image", "review", expected)]);

            expect([first, second].filter(Boolean)).toHaveLength(1);
            const claim = (first || second)!;
            expect(claim.workerId).toMatch(/^admin-review:/);
            expect(mocks.records[0]).toMatchObject({ workerId: claim.workerId, executionPhase: "needs_review" });
            expect(Number(mocks.records[0].leaseUntil)).toBeGreaterThan(1_000);
        });

        it("rejects a claim when the task changed after it was read", async () => {
            mocks.records = [reviewRecord({ updatedAt: 600 })];
            await expect(claimGenerationTaskReview("image", "review", { executionPhase: "needs_review", updatedAt: 500, attemptNo: 1 })).resolves.toBeNull();

            mocks.records = [reviewRecord({ attemptNo: 2 })];
            await expect(claimGenerationTaskReview("image", "review", { executionPhase: "needs_review", updatedAt: 500, attemptNo: 1 })).resolves.toBeNull();

            mocks.records = [reviewRecord({ executionPhase: "polling" })];
            await expect(claimGenerationTaskReview("image", "review", { executionPhase: "needs_review", updatedAt: 500, attemptNo: 1 })).resolves.toBeNull();
        });

        it("does not take a task while a worker still holds an active lease", async () => {
            mocks.records = [reviewRecord({ workerId: "worker-one", leaseUntil: 60_000 })];
            await expect(claimGenerationTaskReview("image", "review", { executionPhase: "needs_review", updatedAt: 500, attemptNo: 1 })).resolves.toBeNull();
        });

        it("can claim after a previous lease expired", async () => {
            mocks.records = [reviewRecord({ workerId: "worker-one", leaseUntil: 900 })];
            await expect(claimGenerationTaskReview("image", "review", { executionPhase: "needs_review", updatedAt: 500, attemptNo: 1 })).resolves.toMatchObject({ workerId: expect.stringMatching(/^admin-review:/) });
        });

        it("releases only its own claim and keeps the schedule it set", async () => {
            mocks.records = [reviewRecord()];
            const claim = (await claimGenerationTaskReview("image", "review", { executionPhase: "needs_review", updatedAt: 500, attemptNo: 1 }))!;
            mocks.records = [{ ...mocks.records[0], executionPhase: "submitted", nextPollAt: 1_000 }];

            await expect(releaseGenerationTaskReviewClaim("image", "review", "admin-review:other")).resolves.toBe(false);
            expect(mocks.records[0].workerId).toBe(claim.workerId);

            await expect(releaseGenerationTaskReviewClaim("image", "review", claim.workerId)).resolves.toBe(true);
            expect(mocks.records[0]).toMatchObject({ executionPhase: "submitted", nextPollAt: 1_000 });
            expect(mocks.records[0].workerId).toBeUndefined();
            expect(mocks.records[0].leaseUntil).toBeUndefined();
        });

        it("compares phase, updated_at, attempt_no and an expired lease in one PostgreSQL UPDATE", async () => {
            mocks.provider = "postgres";
            mocks.postgresQuery.mockResolvedValueOnce({ rows: [] });

            await expect(claimGenerationTaskReview("image", "review", { executionPhase: "needs_review", updatedAt: 500, attemptNo: 1 })).resolves.toBeNull();

            const sql = String(mocks.postgresQuery.mock.calls[0]?.[0]);
            expect(sql).toMatch(/UPDATE generation_tasks/);
            expect(sql).toContain("execution_phase = $3");
            expect(sql).toMatch(/updated_at = \$4/);
            expect(sql).toMatch(/COALESCE\(attempt_no, 0\) = \$5/);
            expect(sql).toMatch(/lease_until IS NULL OR lease_until <= now\(\)/);
            // Bump with a millisecond Date, never now(): records read updated_at in ms, and a
            // microsecond value would make every later CAS comparison miss.
            expect(sql).toMatch(/SET .*updated_at = \$8/s);
            expect(sql).not.toMatch(/updated_at = now\(\)/);
            expect(mocks.postgresQuery.mock.calls[0]?.[1]).toEqual(["review", "image", "needs_review", new Date(500), 1, expect.stringMatching(/^admin-review:/), expect.any(Number), new Date(1_000)]);
        });

        it("releases in PostgreSQL only for the owning claim and does not touch next_poll_at", async () => {
            mocks.provider = "postgres";
            mocks.postgresQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

            await expect(releaseGenerationTaskReviewClaim("image", "review", "admin-review:one")).resolves.toBe(true);

            const sql = String(mocks.postgresQuery.mock.calls[0]?.[0]);
            expect(sql).toMatch(/SET worker_id = NULL, lease_until = NULL/);
            expect(sql).toMatch(/worker_id = \$3/);
            expect(sql).not.toMatch(/next_poll_at/);
        });
    });

    describe("cancel review keep_pending (BUG-091 stage 2)", () => {
        function pending(patch: Record<string, unknown> = {}) {
            return { ...record("pending", 0), status: "running", executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed", nextPollAt: undefined, upstreamTaskId: undefined, attemptNo: 1, updatedAt: 500, resultPayload: { cancellationRequestedAt: 400 }, ...patch };
        }
        const expected = { updatedAt: 500, attemptNo: 1 };
        const review = { accountId: "0001", at: "2026-11-05T00:00:00.000Z" };

        it("records the review without changing phase, status, identity or schedule", async () => {
            mocks.records = [pending()];

            const result = await recordCancelReviewKeepPending("image", "pending", expected, review);

            expect(result).toEqual({ updatedAt: 1_000 });
            expect(mocks.records[0]).toMatchObject({ executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed", status: "running", attemptNo: 1, updatedAt: 1_000 });
            expect(mocks.records[0].nextPollAt).toBeUndefined();
            expect(mocks.records[0].upstreamTaskId).toBeUndefined();
            expect(mocks.records[0].resultPayload).toEqual({ cancellationRequestedAt: 400, lastReview: { action: "keep_pending", accountId: "0001", at: "2026-11-05T00:00:00.000Z" } });
        });

        it("lets only one of two concurrent keep_pending requests with the same token apply", async () => {
            mocks.records = [pending()];

            const results = await Promise.all([recordCancelReviewKeepPending("image", "pending", expected, review), recordCancelReviewKeepPending("image", "pending", expected, review)]);

            expect(results.filter(Boolean)).toHaveLength(1);
        });

        it.each([
            ["a stale updated_at token", { updatedAt: 600 }],
            ["a different attempt", { attemptNo: 2 }],
            ["a task that left needs_review", { executionPhase: "polling" }],
            ["a task that is not cancel_unconfirmed", { lastUpstreamStatus: "submission_outcome_unknown" }],
            ["an active worker lease", { workerId: "worker-one", leaseUntil: 60_000 }],
        ])("rejects %s", async (_label, patch) => {
            mocks.records = [pending(patch)];
            const before = structuredClone(mocks.records[0]);

            await expect(recordCancelReviewKeepPending("image", "pending", expected, review)).resolves.toBeNull();
            expect(mocks.records[0]).toEqual(before);
        });

        it("still applies to a review task whose TTL has passed (#103)", async () => {
            mocks.records = [pending({ expiresAt: 500 })];
            await expect(recordCancelReviewKeepPending("image", "pending", expected, review)).resolves.toEqual({ updatedAt: 1_000 });
            mocks.records = [{ ...record("claim", 0), executionPhase: "needs_review", nextPollAt: undefined, attemptNo: 1, updatedAt: 500, expiresAt: 500 }];
            await expect(claimGenerationTaskReview("image", "claim", { executionPhase: "needs_review", updatedAt: 500, attemptNo: 1 })).resolves.not.toBeNull();
        });

        it("keeps review tasks live in the PostgreSQL claim and keep_pending SQL (#103)", async () => {
            mocks.provider = "postgres";
            mocks.postgresQuery.mockResolvedValue({ rows: [] });
            await recordCancelReviewKeepPending("image", "pending", expected, review);
            await claimGenerationTaskReview("image", "pending", { executionPhase: "needs_review", updatedAt: 500, attemptNo: 1 });
            for (const [sql] of mocks.postgresQuery.mock.calls) expect(String(sql)).toContain("(expires_at > now() OR execution_phase = 'needs_review')");
        });

        it("applies once a previous lease has expired", async () => {
            mocks.records = [pending({ workerId: "worker-one", leaseUntil: 900 })];
            await expect(recordCancelReviewKeepPending("image", "pending", expected, review)).resolves.toEqual({ updatedAt: 1_000 });
        });

        it("uses one conditional PostgreSQL UPDATE that never touches phase, schedule or upstream identity", async () => {
            mocks.provider = "postgres";
            mocks.postgresQuery.mockResolvedValueOnce({ rows: [{ updated_at: new Date(1_000) }] });

            await expect(recordCancelReviewKeepPending("image", "pending", expected, review)).resolves.toEqual({ updatedAt: 1_000 });

            const sql = String(mocks.postgresQuery.mock.calls[0]?.[0]);
            expect(sql).toMatch(/execution_phase = 'needs_review'/);
            expect(sql).toMatch(/last_upstream_status = 'cancel_unconfirmed'/);
            expect(sql).toMatch(/updated_at = \$3/);
            expect(sql).toMatch(/COALESCE\(attempt_no, 0\) = \$4/);
            expect(sql).toMatch(/lease_until IS NULL OR lease_until <= now\(\)/);
            const setClause = sql.slice(sql.indexOf("SET"), sql.indexOf("WHERE"));
            expect(setClause).not.toMatch(/execution_phase|next_poll_at|upstream_task_id|worker_id|\bstatus =/);
            expect(sql).not.toMatch(/updated_at = now\(\)/);
            expect(mocks.postgresQuery.mock.calls[0]?.[1]).toEqual(["pending", "image", new Date(500), 1, JSON.stringify({ action: "keep_pending", accountId: "0001", at: "2026-11-05T00:00:00.000Z" }), new Date(1_000)]);
        });
    });

    it("uses adaptive polling and bounded network-error backoff", () => {
        expect(generationTaskNextPollAt({ submittedAt: 1_000, now: 10_000 })).toBe(15_000);
        expect(generationTaskNextPollAt({ submittedAt: 1_000, now: 60_000 })).toBe(70_000);
        expect(generationTaskNextPollAt({ submittedAt: 1_000, now: 180_000 })).toBe(205_000);
        expect(generationTaskNextPollAt({ now: 1_000, consecutiveErrors: 1 })).toBe(11_000);
        expect(generationTaskNextPollAt({ now: 1_000, consecutiveErrors: 99 })).toBe(61_000);
    });
});

function record(id: string, nextPollAt: number) {
    return {
        id,
        userId: "user-one",
        type: "image",
        status: "running",
        payload: {},
        executionPhase: "polling",
        nextPollAt,
        createdAt: 100,
        updatedAt: 100,
        expiresAt: 100_000,
    };
}
