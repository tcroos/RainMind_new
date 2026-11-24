import { createHash } from "node:crypto";
import { getAuthSettings } from "@/lib/auth/store";
import { protocolAuthHeaders, resolveChannelModelAdvancedConfig } from "@/lib/channel-protocol-registry";
import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";
import { readVideoProviderId } from "@/lib/server/video-provider-response";
import { resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";
import { updateVideoTask, type VideoTask } from "@/lib/server/video-task-store";
import { findConsumedPointsByIdempotencyKey } from "@/lib/server/points-wallet-service";

export function videoSubmissionChannelFingerprint(channel: { id: string; baseUrl: string; apiKey: string }) {
    return createHash("sha256")
        .update(JSON.stringify([channel.id, channel.baseUrl, channel.apiKey]))
        .digest("hex");
}

export async function recoverVideoSubmission(task: VideoTask) {
    const identity = task.submissionIdentity;
    const path = task.config.advancedConfig?.requestLookupPath;
    if (!identity || !path?.includes("{{client_request_id}}")) return null;
    const settings = await getAuthSettings();
    const channel = settings.systemChannels.find((item) => item.id === task.config.channelId && item.enabled);
    if (!channel || videoSubmissionChannelFingerprint(channel) !== identity.channelFingerprint) return null;
    const current = resolveChannelModelAdvancedConfig(channel.advancedConfig, task.config.model);
    if (current?.requestLookupPath !== path || !channel.models.some((model) => model === task.config.model)) return null;
    const url = new URL(`${channel.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "").replace("{{client_request_id}}", encodeURIComponent(identity.clientRequestId))}`);
    const response = await fetchSafeOutbound(url, {
        headers: protocolAuthHeaders(channel.apiKey, task.config.advancedConfig, channel.apiFormat),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(resolveModelRequestTimeoutMs(task.config, "video")),
    });
    if (!response.ok) {
        await response.body?.cancel();
        return null;
    }
    const data: unknown = await response.json();
    const outer = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const record = outer.data && typeof outer.data === "object" ? (outer.data as Record<string, unknown>) : outer;
    if (record.task_type === "image") return null;
    const id = readVideoProviderId(record);
    if (!id) return null;
    const charge = identity.pointsIdempotencyKey ? await findConsumedPointsByIdempotencyKey(task.userId, identity.pointsIdempotencyKey) : null;
    if (identity.pointsIdempotencyKey && !charge) return null;
    const upstream = { ...task.upstream, id, ...(charge ? { pointsCost: Math.abs(charge.amount), pointsRecordId: charge.id, pointsUnits: identity.pointsUnits } : {}) };
    await updateVideoTask(task.id, { upstream });
    return { ...task, upstream };
}
