import axios from "axios";

import { dataUrlToFile } from "@/lib/image-utils";
import { browserReadableMediaUrl } from "@/lib/browser-media-url";
import { originalImageSourceUrl } from "@/lib/media-image-url";
import { resolveGeneratedMediaUrl } from "@/lib/media-url";
import { getMediaBlob, readStoredMediaFile, uploadGeneratedMediaFile, type UploadedFile } from "@/services/file-storage";
import { GENERATION_TASK_NEEDS_REVIEW_MESSAGE, GenerationTaskNeedsReviewError, type GenerationTaskExecutionState } from "@/services/api/generation-task-state";
import { GenerationTaskRequestError, readGenerationRetryAfterMs } from "@/services/api/generation-task-request-error";
import { imageToDataUrl } from "@/services/image-storage";
import { parseServerMediaUrl, serverMediaUrl, type ServerMediaType } from "@/services/server-media-storage";
import { pointsCostFromHeaders, refreshUserPointsIfSystem, syncUserPointsFromHeaders } from "@/services/api/points";
import { throwIfClientSessionExpired } from "@/services/api/session-expiration";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { createVideoStorageDiagnostic, VideoMediaStorageError } from "./video-storage-diagnostic";
import { logicalVideoBillingRule } from "@/lib/video-billing";
import { displayedVideoQuote, quoteVideoGeneration, requestVideoQuoteRefresh } from "./video-quote";
import { isVideoQuoteExpired } from "@/lib/video-generation-quote";

import {
    type VideoResponse,
    type ApiVideoResponse,
    type SeedanceTask,
    type ApiEnvelope,
    type RequestOptions,
    type ResolvedVideoMediaUrl,
    type VideoGenerationResult,
    type VideoGenerationTask,
    type VideoGenerationTaskState,
    GLOBAL_AIOPC_VIDEO_CREATE_PATH,
    GLOBAL_AIOPC_VIDEO_RESULT_PATH,
    VIDEO_CREATE_PATHS,
    VIDEO_URL_KEYS,
    VIDEO_CONTAINER_KEYS,
    TASK_ID_KEYS,
    TASK_STATUS_KEYS,
    VIDEO_CREATE_ERROR_PREFIX,
    VIDEO_QUERY_ERROR_PREFIX,
    VIDEO_STAGE_ERROR_PREFIX,
    VIDEO_GENERATION_WAIT_TIMEOUT_MS,
    VideoGenerationStorageError,
    VideoGenerationUpstreamError,
    VideoGenerationWaitTimeoutError,
} from "./video-types";
import {
    createOpenAIVideoTask,
    pollOpenAIVideoTask,
    createCompatibleVideoTask,
    compatibleVideoCreatePaths,
    isGlobalAiOpcVideoConfig,
    pollCompatibleVideoTask,
    compatibleVideoPollUrls,
    compatibleVideoPollPaths,
    applyTaskIdToVideoPath,
    normalizeAdvancedVideoPath,
    createSeedanceTask,
    createSeedanceSpecialTask,
    pollSeedanceTask,
    assertSeedanceVideoReferences,
    assertSeedanceAudioReferences,
    seedanceApiUrl,
    buildCompatibleVideoPayloadVariants,
} from "./video-providers";
import {
    aiApiUrl,
    aiHeaders,
    readConfiguredMediaUrl,
    readConfiguredTaskStatus,
    readConfiguredStringValue,
    configuredFieldPaths,
    valueAtConfiguredPath,
    configuredValueText,
    readTaskId,
    readTaskStatus,
    readTaskMode,
    isCompletedStatus,
    isPendingStatus,
    isFailedStatus,
    readTaskError,
    findMediaUrl,
    isLikelyVideoUrl,
    resolveVideoMediaUrl,
    stringValue,
    findStringByKeys,
    buildSeedanceContent,
    resolveSeedanceImageUrl,
    resolveSeedanceVideoUrl,
    resolveSeedanceAudioUrl,
    videoResultFromUrl,
    resolveOpenAiContentRemoteUrl,
    remoteVideoSourceUrl,
    proxiedMediaSourceUrl,
    readHeader,
    assertVideoConfig,
    normalizeVideoSeconds,
    normalizeVideoSize,
    normalizeVideoResolution,
    unwrapVideoResponse,
    unwrapSeedanceTask,
    unwrapEnvelope,
    readAxiosError,
    videoCreationError,
    videoQueryError,
    videoStageError,
    prefixedVideoError,
    statusMessage,
    assertVideoBlob,
    isPublicMediaUrl,
    isExternalPublicMediaUrl,
    delay,
    blobToDataUrl,
} from "./video-support";

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    const delayMs = task.provider === "seedance" ? 5000 : 2500;
    const deadline = Date.now() + VIDEO_GENERATION_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") {
            await refreshUserPointsIfSystem(resolveModelRequestConfig(config, task.model).apiSource);
            return state.result;
        }
        if (state.status === "failed") {
            await refreshUserPointsIfSystem(resolveModelRequestConfig(config, task.model).apiSource);
            if (state.needsReview) throw new GenerationTaskNeedsReviewError(state.error);
            throw new VideoGenerationUpstreamError(state.error, state.canRetry !== false);
        }
        await delay(delayMs, options?.signal);
    }
    await refreshUserPointsIfSystem(resolveModelRequestConfig(config, task.model).apiSource);
    throw new VideoGenerationWaitTimeoutError();
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    return createServerVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
}

export async function findServerVideoGenerationTask(projectId: string, request: { clientRequestId: string; attemptNo: number }, options?: Pick<RequestOptions, "signal">): Promise<VideoGenerationTask | null> {
    const params = new URLSearchParams({ projectId, clientRequestId: request.clientRequestId, attemptNo: String(request.attemptNo) });
    const response = await fetch(`/api/video-generation-tasks?${params}`, { cache: "no-store", signal: options?.signal });
    throwIfClientSessionExpired(response);
    const payload = (await response.json()) as { task?: { id: string; model: string; durationSeconds?: number } | null; error?: string };
    if (!response.ok) throw new GenerationTaskRequestError(payload.error || "找回视频任务失败", response.status);
    if (payload.task === null) return null;
    if (!payload.task?.id) throw new Error("视频任务查询响应不完整");
    return { id: payload.task.id, model: payload.task.model, provider: "generation", pollPath: "server", serverTaskId: payload.task.id, durationSeconds: payload.task.durationSeconds };
}

export async function createServerVideoGenerationTask(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    videoReferences: ReferenceVideo[] = [],
    audioReferences: ReferenceAudio[] = [],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const requestOptions = { ...options, clientRequestId: options?.clientRequestId || `video-generation:${crypto.randomUUID()}` };
    const serverReferences = await Promise.all([
        ...references.map(async (item) => ({ type: "image", role: item.videoRole || "reference", url: await providerImageReferenceUrl(item) })),
        ...videoReferences.map(async (item) => ({ type: "video", role: "reference", url: await providerMediaReferenceUrl("video", item) })),
        ...audioReferences.map(async (item) => ({ type: "audio", role: "reference", url: await providerMediaReferenceUrl("audio", item) })),
    ]);
    const quoteConfig = { model: selectedModel, size: requestConfig.size, vquality: requestConfig.vquality, videoSeconds: requestConfig.videoSeconds, videoGenerateAudio: requestConfig.videoGenerateAudio, videoWatermark: requestConfig.videoWatermark };
    const quoteReferences = serverReferences as import("@/lib/video-reference-contract").VideoGenerationReference[];
    const displayedQuote = options?.expectedQuote || displayedVideoQuote(quoteConfig, quoteReferences, options?.quoteScope);
    const requiresQuote = logicalVideoBillingRule(config.logicalModels || [], selectedModel)?.referenceVideoSeconds === true;
    const expectedQuote = requiresQuote
        ? await quoteVideoGeneration(quoteConfig, quoteReferences, requestOptions.signal, requestOptions.clientRequestId)
        : undefined;
    if (requiresQuote && displayedQuote && isVideoQuoteExpired(displayedQuote)) {
        requestVideoQuoteRefresh(quoteConfig, quoteReferences, options?.quoteScope);
        throw new GenerationTaskRequestError("视频报价已过期，正在重新核价。请检查更新后的报价后再提交", 409);
    }
    if (expectedQuote && !displayedQuote) throw new GenerationTaskRequestError("请先查看并确认视频报价后提交", 409);
    const quoteChanged = displayedQuote && expectedQuote && (
        displayedQuote.points !== expectedQuote.points ||
        displayedQuote.units !== expectedQuote.units ||
        displayedQuote.outputSeconds !== expectedQuote.outputSeconds ||
        displayedQuote.referenceSeconds !== expectedQuote.referenceSeconds ||
        displayedQuote.totalSeconds !== expectedQuote.totalSeconds ||
        displayedQuote.billingFingerprint !== expectedQuote.billingFingerprint ||
        displayedQuote.semanticFingerprint !== expectedQuote.semanticFingerprint
    );
    if (quoteChanged) {
        requestVideoQuoteRefresh(quoteConfig, quoteReferences, options?.quoteScope);
        throw new GenerationTaskRequestError("视频报价已变化，请重新确认报价后提交", 409);
    }
    const response = await fetch("/api/video-generation-tasks", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(requestOptions.clientRequestId ? { "X-VOZEB-PRO-Client-Request-Id": requestOptions.clientRequestId } : {}),
            ...(requestOptions.attemptNo ? { "X-VOZEB-PRO-Attempt-No": String(requestOptions.attemptNo) } : {}),
        },
        body: JSON.stringify({
            config: {
                model: selectedModel,
                size: requestConfig.size,
                vquality: requestConfig.vquality,
                videoSeconds: requestConfig.videoSeconds,
                videoGenerateAudio: requestConfig.videoGenerateAudio,
                videoWatermark: requestConfig.videoWatermark,
            },
            prompt,
            expectedQuote: expectedQuote || displayedQuote,
            references: serverReferences,
            source: requestOptions.source,
            context: taskContext(requestOptions),
        }),
        signal: requestOptions.signal,
    });
    throwIfClientSessionExpired(response);
    const payload = (await response.json().catch(() => ({}))) as { task?: { id?: string; model?: string; durationSeconds?: number }; error?: string; canRetry?: boolean };
    if (!response.ok) throw new GenerationTaskRequestError(payload.error || "后台视频任务创建失败", response.status, payload.canRetry === true, readGenerationRetryAfterMs(response.headers));
    if (!payload.task?.id) throw new Error(payload.error || "后台视频任务创建失败");
    return { id: payload.task.id, provider: "generation", model: payload.task.model || selectedModel, pollPath: "server", serverTaskId: payload.task.id, durationSeconds: payload.task.durationSeconds, power: pointsCostFromHeaders(response.headers) };
}

async function providerImageReferenceUrl(image: ReferenceImage) {
    const sources = [image.serverUrl, image.remoteUrl, image.url, image.dataUrl].map((value) => originalImageSourceUrl(value || "")).filter(Boolean);
    const managed = sources.find((value) => parseServerMediaUrl(value));
    if (managed) return managed;
    const publicSource = sources.find(isPublicMediaUrl);
    if (publicSource) return publicSource;
    return publishReferenceMedia("image", await imageToDataUrl({ ...image, dataUrl: originalImageSourceUrl(image.dataUrl), url: originalImageSourceUrl(image.url || ""), serverUrl: originalImageSourceUrl(image.serverUrl || "") }));
}

async function providerMediaReferenceUrl(type: Exclude<ServerMediaType, "image">, media: ReferenceVideo | ReferenceAudio) {
    const managed = parseServerMediaUrl(media.url) || parseServerMediaUrl(serverMediaUrl(media.storageKey, media.url));
    if (managed) return managed.url;
    const proxiedSource = proxiedMediaSourceUrl(media.url);
    if (isPublicMediaUrl(proxiedSource)) return proxiedSource;
    if (isPublicMediaUrl(media.url)) return media.url;
    return publishReferenceMedia(type, await referenceBlobDataUrl(media.storageKey, media.url));
}

export function taskContext(options?: RequestOptions) {
    if (!options) return undefined;
    return {
        conversationId: options.conversationId,
        runId: options.runId,
        surface: options.surface,
        projectId: options.projectId,
        episodeId: options.episodeId,
        shotId: options.shotId,
        estimatedPoints: options.estimatedPoints,
        parentTaskId: options.parentTaskId,
        attemptNo: options.attemptNo,
        clientRequestId: options.clientRequestId,
        generationLogId: options.generationLogId,
        generationSlotId: options.generationSlotId,
    };
}

export async function publishReferenceMedia(type: "image" | "video" | "audio", dataUrl: string, persistent = false) {
    if (!dataUrl) throw new Error("参考素材读取失败，请重新上传");
    const response = await fetch("/api/reference-assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, dataUrl, persistent }) });
    const payload = (await response.json().catch(() => ({}))) as { upstreamUrl?: string; error?: string };
    if (!response.ok || !payload.upstreamUrl) throw new Error(payload.error || "站内参考素材签名不可用，请配置 VOZEB_PRO_ENCRYPTION_KEY");
    return payload.upstreamUrl;
}

export async function referenceBlobDataUrl(storageKey?: string, url = "") {
    if (url.startsWith("data:")) return url;
    const blob = storageKey ? await getMediaBlob(storageKey, url) : url.startsWith("blob:") ? await (await fetch(url)).blob() : null;
    if (!blob) throw new Error("参考素材已失效，请重新上传");
    return blobToDataUrl(blob);
}

export async function createUpstreamVideoGenerationTask(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    videoReferences: ReferenceVideo[] = [],
    audioReferences: ReferenceAudio[] = [],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    assertVideoConfig(requestConfig, requestConfig.model);
    const protocol = requestConfig.advancedConfig?.protocol === "sub2api" ? "auto" : requestConfig.advancedConfig?.protocol || "auto";
    if (protocol === "yumeng") {
        return createCompatibleVideoTask(requestConfig, selectedModel, prompt, references, options, videoReferences, audioReferences);
    }
    if (protocol === "seedance-special") {
        return createSeedanceSpecialTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (protocol === "seedance" || protocol === "volcengine-video" || (protocol === "auto" && isSeedanceVideoConfig(requestConfig))) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (protocol === "globalaiopc" || protocol === "compatible") {
        return createCompatibleVideoTask(requestConfig, selectedModel, prompt, references, options, videoReferences, audioReferences);
    }
    if (videoReferences.length || audioReferences.length) {
        if (isGlobalAiOpcVideoConfig(requestConfig, selectedModel)) {
            return createCompatibleVideoTask(requestConfig, selectedModel, prompt, references, options, videoReferences, audioReferences);
        }
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考素材");
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.pollPath === "server") return pollServerVideoTask(task, options);
    return pollUpstreamVideoGenerationTask(config, task, options);
}

export async function pollServerVideoTask(task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (options?.readProgress) {
        const progress = await options.readProgress(task.serverTaskId || task.id, "video", options.signal);
        if (progress && !progress.needsReview && ["pending", "running"].includes(progress.status)) return { status: "pending" };
    }
    const response = await fetch(`/api/video-tasks/${encodeURIComponent(task.serverTaskId || task.id)}`, { cache: "no-store", signal: options?.signal });
    throwIfClientSessionExpired(response);
    syncUserPointsFromHeaders(response.headers, "system");
    const payload = (await response.json().catch(() => ({}))) as ServerVideoTaskPayload;
    if (!response.ok) throw new Error(payload.error || "后台视频任务查询失败");
    return serverVideoTaskState(payload.task);
}

export async function recoverVideoGenerationTask(task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTask> {
    const taskId = task.serverTaskId || task.id;
    const response = await fetch(`/api/video-tasks/${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recover" }),
        signal: options?.signal,
    });
    throwIfClientSessionExpired(response);
    syncUserPointsFromHeaders(response.headers, "system");
    const payload = (await response.json().catch(() => ({}))) as ServerVideoTaskPayload;
    if (!response.ok || !payload.task) throw new Error(payload.error || "重新检查视频任务失败");
    const state = serverVideoTaskState(payload.task);
    if (state.status === "failed") {
        if (state.needsReview) throw new GenerationTaskNeedsReviewError(state.error);
        throw new VideoGenerationUpstreamError(state.error, state.canRetry !== false);
    }
    return {
        ...task,
        id: payload.task.id || taskId,
        provider: "generation",
        model: payload.task.model || task.model,
        pollPath: "server",
        serverTaskId: payload.task.id || taskId,
        durationSeconds: payload.task.durationSeconds || task.durationSeconds,
    };
}

type ServerVideoTaskPayload = {
    task?: GenerationTaskExecutionState & {
        id?: string;
        model?: string;
        status?: string;
        durationSeconds?: number;
        result?: VideoGenerationResult;
        error?: string;
        canRetry?: boolean;
    };
    error?: string;
};

function serverVideoTaskState(task?: ServerVideoTaskPayload["task"]): VideoGenerationTaskState {
    if (task?.needsReview) return { status: "failed", error: task.reviewReason || GENERATION_TASK_NEEDS_REVIEW_MESSAGE, needsReview: true };
    if (task?.status === "success") return { status: "completed", result: task.result || {} };
    if (task?.status === "error" || task?.status === "cancelled") return { status: "failed", error: task.error || "视频生成失败", canRetry: task.canRetry === true };
    return { status: "pending" };
}

export async function cancelServerVideoGenerationTask(task: VideoGenerationTask) {
    const taskId = task.serverTaskId || task.id;
    const response = await fetch(`/api/video-tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
    });
    throwIfClientSessionExpired(response);
    syncUserPointsFromHeaders(response.headers, "system");
    const payload = (await response.json().catch(() => ({}))) as { task?: { id?: string; status?: string }; error?: string };
    if (!response.ok) throw new Error(payload.error || "视频任务取消失败");
    if (payload.task?.status !== "cancelled") throw new Error(payload.error || "视频任务尚未取消");
}

export async function pollUpstreamVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "generation" && task.resultUrl) {
        return { status: "completed", result: await videoResultFromUrl(resolveVideoMediaUrl(requestConfig, task.resultUrl, aiApiUrl(requestConfig, task.pollPath || VIDEO_CREATE_PATHS[0])), options) };
    }
    if (task.provider === "seedance") return pollSeedanceTask(requestConfig, task, options);
    if (task.provider === "generation") return pollCompatibleVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    try {
        if (result.blob) return { ...(await uploadGeneratedMediaFile(result.blob, "video")), remoteUrl: result.remoteUrl };
        if (result.url) {
            const existing = await readStoredMediaFile(result.url, "video", result.mimeType || "video/mp4");
            if (existing) return { ...existing, remoteUrl: result.remoteUrl };
            const stored = await uploadGeneratedMediaFile(result.url, "video");
            return { ...stored, remoteUrl: result.remoteUrl || (/^https?:\/\//i.test(result.url) ? result.url : undefined) };
        }
        throw new Error("视频接口没有返回可播放的视频");
    } catch (error) {
        if (error instanceof VideoGenerationStorageError) throw error;
        const fallback = createVideoStorageDiagnostic("upload", error, { sourceUrl: result.remoteUrl || result.url, bytes: result.blob?.size, mimeType: result.blob?.type || result.mimeType });
        const diagnostic = error instanceof VideoMediaStorageError
            ? { ...error.diagnostic, bytes: error.diagnostic.bytes ?? result.blob?.size, mimeType: error.diagnostic.mimeType || result.blob?.type || result.mimeType, sourceUrlType: error.diagnostic.sourceUrlType === "unknown" ? fallback.sourceUrlType : error.diagnostic.sourceUrlType }
            : fallback;
        console.warn("Video result storage failed", diagnostic);
        throw new VideoGenerationStorageError(diagnostic.messageSummary, result.remoteUrl || result.url, diagnostic);
    }
}
