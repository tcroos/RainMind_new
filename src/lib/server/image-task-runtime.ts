import { runCustomImageTask, pollCustomImageTask } from "@/app/api/image-tasks/image-task-custom";
import { runGeminiImageTask } from "@/app/api/image-tasks/image-task-gemini";
import { runOpenAiImageTask } from "@/app/api/image-tasks/image-task-openai";
import { imageUnits, ImageQueryContractError, ImageUpstreamTerminalError, pollOpenAiImageTask } from "@/app/api/image-tasks/image-task-support";
import type { ImageTaskRunResult } from "@/app/api/image-tasks/image-task-types";
import { stableMediaUrl, writeImageGenerationLog } from "@/app/api/image-tasks/image-task-runner";
import { getAuthSettings, refundUserPoints } from "@/lib/auth/store";
import { registerGenerationTaskAssetsForUser } from "@/lib/server/creative-runtime-service";
import { finishGenerationAttempt, startGenerationAttempt, type GenerationAttempt } from "@/lib/server/generation-attempt";
import { generationModelId } from "@/lib/server/generation-channel";
import { refundImageTask } from "@/lib/server/image-task-refund";
import { deletePreparedImageTaskResults, persistedImageTaskResults, prepareImageTaskResults } from "@/lib/server/image-task-result-service";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { GenerationSubmissionSafeFailure, generationSubmissionUncertainError } from "@/lib/server/generation-submission-error";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { classifyGenerationFailure, isChannelRetryableFailure, isTerminalRequestMessage } from "@/lib/server/generation-failure-classifier";
import { getImageTask, transitionImageTask, updateImageTask, type ImageCandidateAudit, type ImageTask, type StoredImageTaskMediaResult } from "@/lib/server/image-task-store";
import { maintenanceWorkerContext } from "@/lib/server/maintenance-auth";
import { resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";
import { retainLateGenerationResult } from "./generation-late-result";
import { withImageUpstreamGate } from "./image-upstream-gate";

export type ImageUpstreamStep =
    | { state: "pending"; upstream: NonNullable<ImageTask["upstream"]>; status: string }
    | { state: "needs_review"; reason: string; status: string }
    | { state: "result_ready"; resultUrl: string; status: string }
    | { state: "completed" }
    | { state: "failed"; error: unknown; status: string; retryReason?: "upstream_failed"; errorClass?: string; httpStatus?: number };

export async function createImageTaskUpstreamStep(task: ImageTask, origin: string, publicOrigin: string, cookie = "", workerUserId = ""): Promise<ImageUpstreamStep> {
    const current = await getImageTask(task.id);
    if (!current || current.status === "cancelled") return { state: "failed", error: "任务已取消", status: "cancelled" };
    const running = current.status === "pending" ? await transitionImageTask(current, ["pending"], { status: "running" }) : current;
    if (!running) return { state: "failed", error: "图片任务状态已变化", status: "conflict" };
    const prepared = persistedImageTaskResults(running);
    if (prepared.length) return readyImageStep(running, prepared[0].serverUrl || prepared[0].dataUrl);
    if (running.result?.dataUrl) return readyImageStep(running, stableMediaUrl(running.result.dataUrl) || "inline://image-task-result");
    if (running.upstream?.id) return queryImageTaskUpstreamStep(running, origin, cookie, workerUserId);

    const authContext = cookie || maintenanceWorkerContext(workerUserId || task.userId);
    const config = running.config;
    let attempts = running.attempts || [];
    const started = startGenerationAttempt(attempts, { channelId: config.channelId, model: generationModelId(config), capability: "image" });
    attempts = started.attempts;
    const candidate = { ...running, config, attempts, attemptNo: started.attempt.attemptNo, upstream: undefined, billing: undefined };
    await updateImageTask(task.id, { config, attempts, attemptNo: candidate.attemptNo, upstream: undefined, billing: undefined });
    const submissionStartedAt = Date.now();
    await scheduleGenerationTask("image", task.id, {
        executionPhase: "submitting",
        submittedAt: submissionStartedAt,
        nextPollAt: submissionStartedAt + resolveModelRequestTimeoutMs(config, "image"),
        channelId: config.channelId,
        provider: config.advancedConfig?.protocol || config.apiFormat,
        lastUpstreamStatus: "submitting",
    });
    try {
        const result = await withImageUpstreamGate(config.channelId || "unknown", () =>
            usesDeclarativeImageProtocol(config.advancedConfig?.protocol)
                ? runCustomImageTask(candidate, origin, publicOrigin, authContext, true)
                : config.apiFormat === "gemini"
                  ? runGeminiImageTask(candidate, origin, authContext)
                  : runOpenAiImageTask(candidate, origin, publicOrigin, authContext, true),
        );
        return await handleImageProviderResult(candidate, result, origin, authContext);
    } catch (error) {
        if (error instanceof ImageUpstreamTerminalError) {
            const httpStatus = error.status;
            return { state: "failed", error, status: "failed", retryReason: "upstream_failed", errorClass: classifyGenerationFailure({ stage: "submit", status: httpStatus, message: error.message }), httpStatus };
        }
        const structuredError = error && typeof error === "object" ? error as { code?: unknown } : undefined;
        if (!(error instanceof GenerationSubmissionSafeFailure) && structuredError?.code !== "channel_config_invalid") {
            await persistCandidateAudit(candidate, "needs_review", "uncertain_submitted", "submission_outcome_unknown");
            throw generationSubmissionUncertainError(error, "图片任务创建结果未知");
        }
        const failureMessage = error instanceof Error ? error.message : "图片生成失败";
        const failureStatus = error instanceof GenerationSubmissionSafeFailure ? error.status : error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : undefined;
        const failureCode = structuredError?.code;
        if (error instanceof GenerationSubmissionSafeFailure && !isTerminalRequestMessage(failureMessage) && isChannelRetryableFailure(candidate.config.advancedConfig, failureStatus, failureMessage)) {
            return { state: "failed", error, status: "failed", retryReason: "upstream_failed", errorClass: "retryable_upstream", httpStatus: error.status };
        }
        const errorClass = failureCode === "channel_config_invalid" ? "channel_config_invalid" : classifyGenerationFailure({ stage: "submit", status: failureStatus, message: failureMessage });
        attempts = finishGenerationAttempt(attempts, candidate.attemptNo, { status: "failed", error: toSafeGenerationErrorMessage(error, "图片生成失败"), errorClass, httpStatus: failureStatus });
        await refundImageCandidate(candidate);
        await updateImageTask(task.id, { attempts, attemptNo: candidate.attemptNo, upstream: undefined, billing: undefined });
        return { state: "failed", error: failureCode === "channel_config_invalid" ? error : failureMessage, status: "failed", errorClass, httpStatus: failureStatus };
    }
}

export async function queryImageTaskUpstreamStep(task: ImageTask, origin: string, cookie = "", workerUserId = ""): Promise<ImageUpstreamStep> {
    const prepared = persistedImageTaskResults(task);
    if (prepared.length) return readyImageStep(task, prepared[0].serverUrl || prepared[0].dataUrl);
    const upstream = task.upstream;
    if (!upstream?.id) return { state: "failed", error: "图片任务缺少上游任务 ID", status: "missing_upstream_id" };
    const authContext = cookie || maintenanceWorkerContext(workerUserId || task.userId);
    try {
        const result = usesDeclarativeImageProtocol(task.config.advancedConfig?.protocol)
            ? await pollCustomImageTask(task, upstream.id, upstream.mediaBaseUrl, upstream.pollBaseUrl, authContext, true)
            : await pollOpenAiImageTask(task.config, upstream.id, upstream.mediaBaseUrl, upstream.pollBaseUrl, authContext, upstream.explicitPollUrl || "", true);
        return await handleImageProviderResult(task, { ...result, pointsCost: task.billing?.pointsCost, pointsRecordId: task.billing?.pointsRecordId }, origin, authContext);
    } catch (error) {
        if (error instanceof ImageQueryContractError) return { state: "needs_review", reason: error.message, status: "query_contract_invalid" };
        if (error instanceof ImageUpstreamTerminalError) return { state: "failed", error: error.message, status: "failed", retryReason: "upstream_failed" };
        if (error instanceof GenerationSubmissionSafeFailure) return { state: "failed", error: error.message, status: "failed" };
        throw error;
    }
}

export async function prepareImageTaskAutomaticRetry(task: ImageTask, error: unknown, errorClass?: string, httpStatus?: number) {
    const current = (await getImageTask(task.id)) || task;
    if (current.status !== "pending" && current.status !== "running") return null;
    const attemptNo = current.attemptNo || current.attempts?.at(-1)?.attemptNo || 1;
    const retryControl = (await getAuthSettings()).generationControl?.retry || { maxAttempts: 4, sameChannelRetry: true, autoRefund: true };
    // 按剩余候选数量决定还能不能重试：一次失败消耗一个候选，链路有几层就走几次；
    // 没有候选时按后台"同渠道重试"开关决定是否再试一次（单渠道模型靠这个兜瞬时错误）。
    const remainingCandidates = (current.candidateConfigs || []).filter((config) => Boolean(config?.channelId));
    const retrySameChannel = !remainingCandidates.length && retryControl.sameChannelRetry && attemptNo < 2;
    if (!remainingCandidates.length && !retrySameChannel) return null;
    if (attemptNo > retryControl.maxAttempts) return null;
    const errorMessage = toSafeGenerationErrorMessage(error, "图片生成失败");
    const attempts = finishGenerationAttempt(current.attempts || [], attemptNo, {
        status: "failed",
        error: errorMessage,
        errorClass: errorClass || classifyGenerationFailure({ stage: "submit", error: errorMessage }),
        httpStatus,
        pointsCost: current.billing?.pointsCost,
        pointsRecordId: current.billing?.pointsRecordId,
    });
    const nextConfig = remainingCandidates[0] || current.config;
    const failureClass = errorClass || classifyGenerationFailure({ stage: "submit", error: errorMessage });
    const failedAttempt = attempts.find((attempt) => attempt.attemptNo === attemptNo);
    const attempted = candidateAuditAttempt(current, failedAttempt, "failed", failureClass, httpStatus);
    const fromChannel = current.config.channelId;
    const toChannel = nextConfig.channelId;
    const audit = updateCandidateAudit(current.candidateAudit, attempted, {
        transition: fromChannel !== toChannel ? { attemptNo, fromChannel, toChannel, failureClass, httpStatus, durationMs: attempted.durationMs } : undefined,
        fallbackCount: 1,
        history: attempts,
    });
    await refundImageCandidate(current);
    return updateImageTask(current.id, {
        config: nextConfig,
        candidateConfigs: remainingCandidates.slice(1),
        candidateAudit: audit,
        attempts,
        attemptNo,
        upstream: undefined,
        billing: undefined,
        retryable: false,
    });
}

export async function queryCancelledImageTaskUpstreamStep(task: ImageTask, origin: string, cookie = "", workerUserId = "") {
    const upstream = task.upstream;
    if (!upstream?.id) return { state: "terminal" as const, status: "missing_upstream_id" };
    const authContext = cookie || maintenanceWorkerContext(workerUserId || task.userId);
    try {
        const result = usesDeclarativeImageProtocol(task.config.advancedConfig?.protocol)
            ? await pollCustomImageTask(task, upstream.id, upstream.mediaBaseUrl, upstream.pollBaseUrl, authContext, true)
            : await pollOpenAiImageTask(task.config, upstream.id, upstream.mediaBaseUrl, upstream.pollBaseUrl, authContext, upstream.explicitPollUrl || "", true);
        return result.pending ? { state: "pending" as const, status: "processing" } : { state: "terminal" as const, status: "completed" };
    } catch (error) {
        if (error instanceof ImageUpstreamTerminalError || error instanceof GenerationSubmissionSafeFailure) return { state: "terminal" as const, status: "failed" };
        throw error;
    }
}

export async function persistImageTaskResult(task: ImageTask, origin: string, resultUrl: string, cookie = "", workerUserId = "") {
    const authContext = cookie || maintenanceWorkerContext(workerUserId || task.userId);
    const current = (await getImageTask(task.id)) || task;
    let results = persistedImageTaskResults(current);
    if (results.length) return completeImageResult(current, results);

    const inlineDataUrl = resultUrl === "inline://image-task-result" ? current.result?.dataUrl || "" : resultUrl;
    const remoteUrl = resultUrl === "inline://image-task-result" ? current.result?.remoteUrl : /^https?:\/\//i.test(resultUrl) ? resultUrl : undefined;
    if (!inlineDataUrl && !remoteUrl) throw new GenerationSubmissionSafeFailure("图片任务缺少可持久化结果");
    const legacyResults = current.result?.results?.length ? current.result.results : [{ dataUrl: inlineDataUrl, remoteUrl }];
    const normalizedResults = legacyResults.map((item, index) => (index === 0 ? { ...item, dataUrl: inlineDataUrl || item.dataUrl, remoteUrl: remoteUrl || item.remoteUrl } : item));
    try {
        results = await prepareImageTaskResults(current, { ...normalizedResults[0], results: normalizedResults }, origin, authContext);
    } catch (error) {
        if (current.config.outputMode !== "layers" && current.config.outputBackground !== "transparent") throw error;
        return markImageTaskFailed(current, error instanceof Error ? error.message : "上游返回的图片文件无效或保存失败");
    }
    try {
        await updateImageTask(current.id, { result: { ...results[0], results } });
    } catch (error) {
        await deletePreparedImageTaskResults(results);
        throw error;
    }
    return completeImageResult(current, results);
}

export async function markImageTaskFailed(task: ImageTask, error: unknown, errorClass?: string, httpStatus?: number) {
    const current = (await getImageTask(task.id)) || task;
    if (current.status === "success" || current.status === "cancelled") return current;
    const safeError = toSafeGenerationErrorMessage(error, "图片生成失败");
    const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    const structured = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : undefined;
    const safeStatus = httpStatus ?? (typeof structured?.status === "number" ? structured.status : undefined);
    const errorCode = typeof structured?.code === "string" ? structured.code : undefined;
    const errorName = error instanceof Error ? error.name : undefined;
    const safeClass = errorClass || (structured?.code === "channel_config_invalid" ? "channel_config_invalid" : classifyGenerationFailure({ stage: "submit", status: safeStatus, message: rawMessage }));
    const attempts = finishGenerationAttempt(current.attempts || [], current.attemptNo || current.attempts?.at(-1)?.attemptNo || 1, {
        status: "failed",
        error: safeError,
        errorClass: safeClass,
        errorCode,
        errorName,
        httpStatus: safeStatus,
        pointsCost: current.billing?.pointsCost,
        pointsRecordId: current.billing?.pointsRecordId,
    });
    const attemptNo = current.attemptNo || current.attempts?.at(-1)?.attemptNo || 1;
    const failureClassValue = safeClass;
    const completedAttempt = attempts.find((attempt) => attempt.attemptNo === attemptNo);
    const candidateExhausted = !current.candidateConfigs?.length && attemptNo >= (current.candidateAudit?.initial.length || 1);
    const finalReason = candidateExhausted ? "candidate_exhausted" : failureClassValue;
    const candidateAudit = updateCandidateAudit(current.candidateAudit, candidateAuditAttempt(current, completedAttempt, "failed", failureClassValue, safeStatus), { finalReason, history: attempts });
    const failed = await transitionImageTask(current, ["pending", "running"], { status: "error", error: safeError.slice(0, 500), retryable: true, billing: current.billing });
    if (!failed) {
        return (await getImageTask(current.id)) || current;
    }
    await updateImageTask(current.id, { attempts, candidateAudit, candidateConfigs: [], attemptNo: attempts.at(-1)?.attemptNo });
    const refunded = await refundImageTask(failed);
    await writeImageGenerationLog({ ...refunded, retryable: true }, "failed", "", Date.now() - current.createdAt, safeError).catch((logError) => console.error("Image generation failure log write failed", logError));
    return refunded;
}

async function handleImageProviderResult(task: ImageTask, result: ImageTaskRunResult, origin: string, authContext: string): Promise<ImageUpstreamStep> {
    const billing = result.pointsRecordId ? { pointsCost: result.pointsCost ?? 0, pointsRecordId: result.pointsRecordId, refunded: false } : undefined;
    if (billing) await updateImageTask(task.id, { billing });
    if (result.needsReview) {
        const submittedAt = Date.now();
        await updateImageTask(task.id, { upstream: result.needsReview.upstream, billing });
        await persistCandidateAudit(task, "needs_review", undefined, "query_contract_missing", result.needsReview.upstream.id);
        await scheduleGenerationTask("image", task.id, {
            executionPhase: "needs_review",
            upstreamTaskId: result.needsReview.upstream.id,
            channelId: task.config.channelId,
            provider: task.config.advancedConfig?.protocol || task.config.apiFormat,
            queryPath: result.needsReview.upstream.explicitPollUrl || task.config.advancedConfig?.queryPath,
            submittedAt,
            nextPollAt: undefined,
            lastUpstreamStatus: "query_contract_missing",
            resultPayload: { reviewReason: result.needsReview.reason.slice(0, 500) },
        });
        return { state: "needs_review", reason: result.needsReview.reason, status: "query_contract_missing" };
    }
    if (result.pending) {
        const submittedAt = Date.now();
        await updateImageTask(task.id, { upstream: result.pending, billing });
        await persistCandidateAudit(task, "submitted", undefined, undefined, result.pending.id);
        await scheduleGenerationTask("image", task.id, {
            executionPhase: "submitted",
            upstreamTaskId: result.pending.id,
            channelId: task.config.channelId,
            provider: task.config.advancedConfig?.protocol || task.config.apiFormat,
            queryPath: result.pending.explicitPollUrl || task.config.advancedConfig?.queryPath,
            submittedAt,
            nextPollAt: submittedAt,
            lastUpstreamStatus: "submitted",
        });
        return { state: "pending", upstream: result.pending, status: "submitted" };
    }
    const providerResults = result.results?.length ? result.results : result.dataUrl || result.remoteUrl ? [{ dataUrl: result.dataUrl || result.remoteUrl!, remoteUrl: result.remoteUrl }] : [];
    const rawResults = task.config.outputMode === "layers" || task.config.outputBackground === "transparent" ? [] : providerResults.filter((item) => Boolean(stableMediaUrl(item.dataUrl)));
    if (rawResults.length) {
        const first = rawResults[0];
        await updateImageTask(task.id, { result: { ...first, results: rawResults }, providerResults: rawResults.map(({ dataUrl, remoteUrl }) => ({ dataUrl, remoteUrl })) });
        await readyImageStep(task, stableMediaUrl(first.dataUrl) || "inline://image-task-result");
    }
    let results: StoredImageTaskMediaResult[];
    try {
        results = await prepareImageTaskResults(task, result, origin, authContext);
    } catch (error) {
        if (rawResults.length && task.config.outputMode !== "layers" && task.config.outputBackground !== "transparent") return { state: "result_ready", resultUrl: stableMediaUrl(rawResults[0].dataUrl) || "inline://image-task-result", status: "completed" };
        return { state: "failed", error: error instanceof Error ? error.message : "上游返回的图片文件无效或保存失败", status: "failed" };
    }
    const first = results[0];
    if (!first) return { state: "failed", error: "上游返回的图片文件无效或保存失败", status: "failed" };
    const current = await getImageTask(task.id);
    if (!current || current.status === "cancelled") {
        await deletePreparedImageTaskResults(results);
        return { state: "failed", error: "任务已取消", status: "cancelled" };
    }
    try {
        await updateImageTask(task.id, { result: { ...first, results } });
    } catch (error) {
        await deletePreparedImageTaskResults(results);
        return { state: "failed", error: error instanceof Error ? error.message : "上游返回的图片文件无效或保存失败", status: "failed" };
    }
    return readyImageStep(task, first.serverUrl || first.dataUrl);
}

async function readyImageStep(task: ImageTask, resultUrl: string): Promise<ImageUpstreamStep> {
    if (!stableMediaUrl(resultUrl)) return { state: "failed", error: "上游返回的图片文件无效或保存失败", status: "failed" };
    await persistReadyImageSchedule(task, resultUrl);
    return { state: "result_ready", resultUrl, status: "completed" };
}

function persistReadyImageSchedule(task: ImageTask, resultUrl: string) {
    const submittedAt = Date.now();
    return scheduleGenerationTask("image", task.id, {
        executionPhase: "result_ready",
        channelId: task.config.channelId,
        provider: task.config.advancedConfig?.protocol || task.config.apiFormat,
        submittedAt,
        nextPollAt: submittedAt,
        lastUpstreamStatus: "completed",
        resultPayload: { url: resultUrl },
    });
}

async function refundImageCandidate(task: ImageTask) {
    const current = await getImageTask(task.id);
    const billing = current?.billing;
    if (!billing?.pointsRecordId || billing.refunded) return;
    const settings = await getAuthSettings();
    const autoRefund = settings.generationControl?.retry?.autoRefund;
    if (autoRefund === false) return;
    await refundUserPoints(
        task.userId,
        generationModelId(task.config),
        billing.pointsCost,
        "image",
        imageUnits(task.config.quality, settings.generationPointMultipliers.imageQuality),
        `image-task:${task.id}:attempt:${task.attemptNo || 1}:refund`,
        billing.pointsRecordId,
    );
}

async function completeImageResult(task: ImageTask, safeResults: StoredImageTaskMediaResult[]) {
    const beforePersistence = await getImageTask(task.id);
    if (!beforePersistence) return beforePersistence;
    task = beforePersistence;
    const current = await getImageTask(task.id);
    if (!current) return current;
    const completed = await transitionImageTask(current, ["pending", "running", "cancelled"], {
        status: "success",
        result: { ...safeResults[0], results: safeResults },
        pointsRemaining: task.pointsRemaining,
        retryable: false,
    });
    if (!completed) {
        await retainLateGenerationResult("image", task.id, { results: safeResults });
        const latest = await getImageTask(task.id);
        return latest;
    }
    const logged = await writeImageGenerationLog(completed, "success", safeResults, Date.now() - completed.createdAt).catch((logError) => {
        console.error("Image generation success log write failed", logError);
        return undefined;
    });
    const loggedAssets = logged?.assets?.length ? logged.assets : logged?.asset ? [logged.asset] : [];
    const finalResults = loggedAssets.length
        ? loggedAssets.map((asset) => ({ dataUrl: asset.serverUrl || asset.url, remoteUrl: asset.remoteUrl, serverUrl: asset.serverUrl, width: asset.width, height: asset.height, bytes: asset.bytes, mimeType: asset.mimeType }))
        : safeResults;
    const finalResult = finalResults[0];
    const attempts = finishGenerationAttempt(completed.attempts || [], completed.attemptNo || completed.attempts?.at(-1)?.attemptNo || 1, {
        status: "succeeded",
        pointsCost: completed.billing?.pointsCost,
        pointsRecordId: completed.billing?.pointsRecordId,
    });
    const succeededAttempt = attempts.find((attempt) => attempt.attemptNo === (completed.attemptNo || completed.attempts?.at(-1)?.attemptNo));
    const candidateAudit = updateCandidateAudit(completed.candidateAudit, candidateAuditAttempt(completed, succeededAttempt, "succeeded", undefined, undefined, completed.upstream?.id), { finalReason: "success" });
    const finalized = (await updateImageTask(task.id, { result: { ...finalResult, results: finalResults }, config: { ...completed.config, apiKey: "system" }, candidateConfigs: [], attempts, candidateAudit, attemptNo: attempts.at(-1)?.attemptNo })) || completed;
    const assets = (finalized.result?.results?.length ? finalized.result.results : finalized.result ? [finalized.result] : []).flatMap((item) => {
        const url = item.serverUrl || item.remoteUrl || stableMediaUrl(item.dataUrl);
        return url ? [{ type: "image" as const, url, mimeType: item.mimeType, width: item.width, height: item.height, bytes: item.bytes }] : [];
    });
    if (assets.length)
        await registerGenerationTaskAssetsForUser(finalized.userId, {
            ...finalized,
            taskId: finalized.id,
            title: finalized.title || finalized.prompt.slice(0, 80),
            assets,
        }).catch((error) => console.error("Creative image asset registration failed", error));
    return finalized;
}

function usesDeclarativeImageProtocol(protocol: NonNullable<ImageTask["config"]["advancedConfig"]>["protocol"] | undefined) {
    return protocol === "custom" || protocol === "stable-diffusion" || protocol === "yumeng";
}

async function persistCandidateAudit(
    task: ImageTask,
    outcome: "failed" | "submitted" | "needs_review" | "succeeded",
    failureClass?: string,
    finalReason?: string,
    upstreamTaskId?: string,
) {
    const attemptNo = task.attemptNo || task.attempts?.at(-1)?.attemptNo || 1;
    const attempt = task.attempts?.find((item) => item.attemptNo === attemptNo);
    const audit = updateCandidateAudit(task.candidateAudit, candidateAuditAttempt(task, attempt, outcome, failureClass, undefined, upstreamTaskId), { finalReason });
    await updateImageTask(task.id, { candidateAudit: audit });
}

function candidateAuditAttempt(
    task: Pick<ImageTask, "config"> & Partial<Pick<ImageTask, "upstream" | "attemptNo" | "attempts">>,
    attempt: GenerationAttempt | undefined,
    outcome: "failed" | "submitted" | "needs_review" | "succeeded",
    failureClass?: string,
    httpStatus?: number,
    upstreamTaskId?: string,
) {
    const attemptNo = attempt?.attemptNo || task.attemptNo || task.attempts?.at(-1)?.attemptNo || 1;
    const startedAt = attempt?.startedAt || Date.now();
    const completedAt = attempt?.completedAt || Date.now();
    return {
        attemptNo,
        channelId: attempt?.channelId || task.config.channelId,
        model: attempt?.model || generationModelId(task.config),
        outcome,
        failureClass: failureClass || attempt?.errorClass,
        httpStatus: httpStatus ?? attempt?.httpStatus,
        upstreamTaskIdMasked: maskCandidateAuditTaskId(upstreamTaskId || task.upstream?.id),
        durationMs: Math.max(0, completedAt - startedAt),
    };
}

function updateCandidateAudit(
    current: ImageCandidateAudit | undefined,
    attempted: NonNullable<ImageCandidateAudit["attempted"]>[number],
    options: {
        transition?: NonNullable<ImageCandidateAudit["transitions"]>[number];
        fallbackCount?: number;
        finalReason?: string;
        history?: GenerationAttempt[];
    },
): ImageCandidateAudit {
    const base = current || { initial: [], filtered: [], fallbackCount: 0 };
    const history = (options.history || []).map((attempt) => candidateAuditAttempt(
        { config: { model: attempt.model, baseUrl: "", apiKey: "", apiFormat: "openai", channelId: attempt.channelId } },
        attempt,
        attempt.status === "succeeded" ? "succeeded" : attempt.status === "failed" ? "failed" : "submitted",
        attempt.errorClass,
        attempt.httpStatus,
    ));
    const attemptedByNo = new Map([...(base.attempted || []), ...history].map((item) => [item.attemptNo, item]));
    attemptedByNo.set(attempted.attemptNo, attempted);
    const attempts = [...attemptedByNo.values()].sort((a, b) => a.attemptNo - b.attemptNo);
    const transitions = [...(base.transitions || [])];
    if (options.transition && !transitions.some((item) => item.attemptNo === options.transition?.attemptNo)) transitions.push(options.transition);
    return {
        ...base,
        attempted: attempts,
        transitions,
        fallbackCount: base.fallbackCount + (options.fallbackCount || 0),
        ...(options.finalReason ? { finalReason: options.finalReason } : {}),
    };
}

function maskCandidateAuditTaskId(value?: string) {
    const id = value?.trim();
    return id ? `***${id.slice(-4)}` : undefined;
}
