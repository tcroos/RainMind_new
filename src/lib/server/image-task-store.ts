import { randomUUID } from "crypto";

import type { LogicalModelCapabilityProfile, SystemChannelAdvancedConfig } from "@/lib/auth/store";
import type { GenerationAttempt } from "@/lib/server/generation-attempt";
import type { GenerationLogSource } from "@/lib/server/generation-log-store";
import { countActiveStoredGenerationTasks, createStoredGenerationTask, getStoredGenerationTask, mutateStoredGenerationTask, touchStoredGenerationTask, transitionStoredGenerationTask, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import { GENERATION_TASK_RETENTION_MS } from "@/lib/server/generation-task-retention";

type ImageTaskKind = "generation" | "edit";
type ImageTaskStatus = "pending" | "running" | "success" | "error" | "cancelled";

export type ImageTaskConfig = {
    apiSource?: "system" | "custom";
    baseUrl: string;
    apiKey: string;
    apiFormat: "openai" | "gemini";
    model: string;
    channelId?: string;
    logicalModel?: string;
    capabilityProfile?: LogicalModelCapabilityProfile;
    quality?: string;
    size?: string;
    sizeMode?: "auto" | "ratio" | "custom";
    resolution?: string;
    style?: string;
    outputFormat?: string;
    background?: "auto" | "opaque" | "transparent";
    moderation?: string;
    responseFormat?: "url" | "b64_json";
    outputBackground?: "opaque" | "transparent";
    outputMode?: "layers";
    systemPrompt?: string;
    advancedConfig?: SystemChannelAdvancedConfig;
};

export type ImageTaskReference = {
    id?: string;
    name?: string;
    type?: string;
    dataUrl: string;
    url?: string;
    remoteUrl?: string;
    serverUrl?: string;
};

export type StoredImageTaskMediaResult = {
    dataUrl: string;
    remoteUrl?: string;
    serverUrl?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
};

export type ImageCandidateAudit = {
    initial: Array<{ channelId?: string; model: string }>;
    filtered: Array<{ channelId?: string; model: string; reason: string }>;
    fallbackCount: number;
    attempted?: Array<{
        attemptNo: number;
        channelId?: string;
        model: string;
        outcome: "failed" | "submitted" | "needs_review" | "succeeded";
        failureClass?: string;
        httpStatus?: number;
        upstreamTaskIdMasked?: string;
        durationMs: number;
    }>;
    transitions?: Array<{
        attemptNo: number;
        fromChannel?: string;
        toChannel?: string;
        failureClass?: string;
        httpStatus?: number;
        durationMs: number;
    }>;
    finalReason?: string;
};

export type ImageTask = GenerationTaskContext & {
    id: string;
    userId: string;
    username: string;
    displayName: string;
    kind: ImageTaskKind;
    source: GenerationLogSource;
    title?: string;
    status: ImageTaskStatus;
    createdAt: number;
    updatedAt: number;
    config: ImageTaskConfig;
    prompt: string;
    references: ImageTaskReference[];
    mask?: ImageTaskReference;
    result?: StoredImageTaskMediaResult & { results?: StoredImageTaskMediaResult[] };
    providerResults?: Array<{ dataUrl: string; remoteUrl?: string }>;
    providerEvidence?: Array<{ width?: number; height?: number; bytes: number; format?: string }>;
    upstream?: { id: string; mediaBaseUrl: string; pollBaseUrl: string; explicitPollUrl?: string };
    billing?: { pointsCost: number; pointsRecordId?: string; refunded: boolean };
    error?: string;
    retryable?: boolean;
    pointsRemaining?: number;
    candidateConfigs?: ImageTaskConfig[];
    candidateAudit?: ImageCandidateAudit;
    attempts?: GenerationAttempt[];
    attemptNo?: number;
};

const TASK_STALE_MS = 3 * 60 * 1000;
export async function createImageTask(input: Omit<ImageTask, "id" | "status" | "createdAt" | "updatedAt">) {
    const now = Date.now();
    const task: ImageTask = {
        ...input,
        id: randomUUID(),
        status: "pending",
        createdAt: now,
        updatedAt: now,
    };
    return createStoredGenerationTask("image", task, GENERATION_TASK_RETENTION_MS);
}

export async function getImageTask(id: string) {
    return getStoredGenerationTask<ImageTask>("image", id);
}

export function countActiveImageTasksForUser(userId: string) {
    return countActiveStoredGenerationTasks(userId, "image", TASK_STALE_MS);
}

export function transitionImageTask(
    task: ImageTask,
    allowedStatuses: ImageTaskStatus[],
    patch: Partial<Pick<ImageTask, "result" | "error" | "pointsRemaining" | "retryable" | "config" | "billing">> & { status: ImageTaskStatus },
    executionPatch?: import("@/lib/server/generation-task-scheduler").GenerationTaskSchedulePatch,
) {
    return transitionStoredGenerationTask<ImageTask>("image", task.id, task.userId, allowedStatuses, patch, GENERATION_TASK_RETENTION_MS, executionPatch);
}

export function touchImageTask(id: string) {
    return touchStoredGenerationTask("image", id, Date.now(), GENERATION_TASK_RETENTION_MS);
}

export async function updateImageTask(id: string, patch: Partial<Pick<ImageTask, "config" | "candidateConfigs" | "candidateAudit" | "attempts" | "attemptNo" | "upstream" | "billing" | "result" | "providerResults" | "providerEvidence" | "retryable">>) {
    const metadataOnly = !Object.hasOwn(patch, "billing") && !Object.hasOwn(patch, "upstream");
    return mutateStoredGenerationTask<ImageTask>("image", id, GENERATION_TASK_RETENTION_MS, (task) => ({ ...task, ...patch }), undefined, { metadataOnly });
}
