export const GENERATION_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * #103: a task waiting for a human decision must never expire out of sight. Nothing refreshes its
 * updated_at while it waits, so the 7-day TTL would otherwise hide it from the admin queue and let
 * the lifecycle cleanup physically delete it, charge and all.
 */
export const RETAINED_REVIEW_PHASE = "needs_review";

/** SQL predicate for "still live": not expired, or held for review regardless of expires_at. */
export const LIVE_GENERATION_TASK_SQL = `(expires_at > now() OR execution_phase = '${RETAINED_REVIEW_PHASE}')`;

export function isLiveGenerationTask(task: { expiresAt: number; executionPhase?: string }, now = Date.now()) {
    return task.expiresAt > now || task.executionPhase === RETAINED_REVIEW_PHASE;
}
