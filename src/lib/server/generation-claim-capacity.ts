/** Shared by slot claim filtering; never includes the generated per-claim UUID. */
export function generationWorkerPoolId(workerId: string) {
    const slot = workerId.match(/^(.*):lane-\d+:slot-\d+$/);
    return slot?.[1];
}

export function imageChannelClaimLimit() {
    const raw = process.env.VOZEB_PRO_IMAGE_UPSTREAM_CHANNEL_CONCURRENCY?.trim();
    if (!raw) return 8;
    const value = Math.floor(Number(raw));
    return Number.isFinite(value) && value >= 0 ? value : 8;
}

export function generationClaimChannel(task: { channelId?: string; payload: Record<string, unknown> }) {
    const config = task.payload.config as { channelId?: string } | undefined;
    return task.channelId || config?.channelId || "unknown";
}
import { createHash } from "node:crypto";

/** Keep the slot suffix and a stable pool identity within the existing claim-owner budget. */
export function generationWorkerClaimPrefix(value: string) {
    const workerId = value.trim();
    if (workerId.length <= 110) return workerId;
    const slot = workerId.match(/^(.*)(:lane-\d+:slot-\d+)$/);
    return slot ? `pool:${createHash("sha256").update(slot[1]).digest("hex")}${slot[2]}` : workerId.slice(0, 110);
}
