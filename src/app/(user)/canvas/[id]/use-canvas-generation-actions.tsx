"use client";

import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef } from "react";

import { createFreshGenerationTaskContext } from "@/lib/generation-request-context";
import { resolveImageRequestSize } from "@/lib/image-size";
import { readImageMeta } from "@/lib/image-utils";
import { createAudioGenerationTask } from "@/services/api/audio";
import { GenerationTaskNeedsReviewError, isGenerationTaskNeedsReviewError, isGenerationTaskTerminalError } from "@/services/api/generation-task-state";
import { isDefinitiveGenerationTaskRequestFailure } from "@/services/api/generation-task-request-error";
import { ImageGenerationTaskTerminalError, isImageGenerationTaskDeferredError } from "@/services/api/image";
import { createTextGenerationTask } from "@/services/api/text";
import { readGenerationTask } from "@/services/api/generation-tasks";
import { createServerVideoGenerationTask, findServerVideoGenerationTask } from "@/services/api/video";
import { VideoGenerationStorageError } from "@/services/api/video-types";
import type { InsertAssetPayload } from "../components/canvas-asset-insert";
import { CANVAS_AGENT_PANEL_MOTION_MS } from "../components/canvas-agent-panel-motion";
import { retryCanvasAgentNode } from "../components/canvas-agent-node-retry";
import { buildNodeGenerationContext, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext } from "../components/canvas-node-generation";
import { type CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "../constants";
import { CanvasNodeType, isCanvasImageNodeType, type CanvasAssistantImage, type CanvasNodeData, type Position } from "../types";
import { applyCameraPrompt } from "../utils/canvas-camera";
import { nodeSizeFromAspect, nodeSizeFromRatio, videoNodeSizeFromNatural } from "../utils/canvas-node-size";
import { buildPanoramaPrompt } from "../utils/canvas-panorama";
import { canvasVideoReferenceMetadata, resolveCanvasVideoGenerationReferences, restoreCanvasVideoGenerationReferences } from "../utils/canvas-video-references";

import { NODE_STATUS_CANCELLED, NODE_STATUS_ERROR, NODE_STATUS_IDLE, NODE_STATUS_LOADING, NODE_STATUS_NEEDS_REVIEW, NODE_STATUS_SUCCESS, createCanvasNode } from "./canvas-page-elements";
import { canvasVideoStorageFailureDetails, classifyCanvasVideoTaskFailure, isTerminalCanvasVideoTaskFailureKind } from "./canvas-video-task-recovery";
import { sourceCanvasTaskIdentity } from "./canvas-task-commit-guard";
import { canvasNodeTaskId, mergeCanvasNodeTaskState } from "./canvas-node-task-state";

import { reconcileCanvasTaskRetry } from "./canvas-task-retry";
import { hasCanvasGenerationTask, pauseCanvasGenerationReview, resumeCanvasGenerationReview } from "./canvas-generation-review";
import {
    buildAudioGenerationMetadata,
    buildGenerationConfig,
    buildImageGenerationMetadata,
    canvasNodeReferenceImage,
    findRetrySourceNode,
    getGenerationCount,
    imageMetadata,
    isGenerationCanceled,
    resolveMetadataImageEditMask,
    resolveMetadataReferences,
    sourceNodeReferenceImages,
    uploadCanvasImage,
} from "./canvas-page-utils";

import type { CanvasInteractions } from "./use-canvas-interactions";
import type { CanvasPageState } from "./use-canvas-page-state";
import type { CanvasTaskRuntime } from "./use-canvas-task-runtime";

/** 从组工具栏「添加素材」插入时：把新节点放到组框右侧并直接归入该组 */
export type CanvasAssetInsertOptions = { groupId?: string; position?: Position };

async function createCanvasVideoTask(...args: Parameters<typeof createServerVideoGenerationTask>) {
    try {
        return await createServerVideoGenerationTask(...args);
    } catch (error) {
        if (args[5]?.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
        if (isGenerationCanceled(error) || isDefinitiveGenerationTaskRequestFailure(error)) throw error;
        throw new GenerationTaskNeedsReviewError("视频创建结果暂未确认，请检查状态找回原任务；系统不会重新生成");
    }
}

export function useCanvasGenerationActions({ state, tasks, interactions }: { state: CanvasPageState; tasks: CanvasTaskRuntime; interactions: CanvasInteractions }) {
    const {
        message,
        projectId,
        containerRef,
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        currentProject,
        setNodes,
        setConnections,
        size,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setRunningNodeId,
        projectLoaded,
        setDialogNodeId,
        assistantCollapsed,
        setAssistantCollapsed,
        assistantMounted,
        setAssistantMounted,
        assistantClosing,
        setAssistantClosing,
        nodesRef,
        connectionsRef,
        generateNodeRef,
        agentCloseTimerRef,
        autoOpenedAgentRef,
        generationRequestsRef,
        projectSession,
        canvasTaskCommitIdentityByTargetRef,
    } = state;
    useEffect(() => {
        const stopVideoObservation = () => {
            generationRequestsRef.current.forEach((request, nodeId) => {
                const node = nodesRef.current.find((item) => item.id === nodeId);
                if (node?.type === CanvasNodeType.Video && (node.metadata?.videoTask || node.metadata?.videoTaskRequest)) request.controller.abort();
            });
        };
        window.addEventListener("pagehide", stopVideoObservation);
        window.addEventListener("beforeunload", stopVideoObservation);
        return () => {
            window.removeEventListener("pagehide", stopVideoObservation);
            window.removeEventListener("beforeunload", stopVideoObservation);
            stopVideoObservation();
        };
    }, [generationRequestsRef, nodesRef]);
    const {
        startGenerationRequest,
        finishGenerationRequest,
        completeVideoTask,
        recoverAndCompleteVideoTask,
        startAndCompleteImageTask,
        recoverAndCompleteImageTask,
        completeTextTask,
        recoverAndCompleteTextTask,
        completeAudioTask,
        recoverAndCompleteAudioTask,
        captureCanvasTaskIdentity,
        attachCanvasTaskId,
        beginCanvasTaskAttempt,
        registerCanvasTaskIdentity,
        canvasTaskCommitGuard,
        readProgress,
    } = tasks;
    const reviewPollsRef = useRef(new Set<string>());
    const { screenToCanvas, applyAgentOps } = interactions;
    const deferVideoTask = useCallback(
        (nodeId: string, errorDetails?: string) => {
            setNodes((prev) => prev.map((item) => (item.id === nodeId && item.metadata?.videoTask ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails } } : item)));
        },
        [setNodes],
    );
    const pauseReviewedTasks = useCallback(
        (nodeIds: string[], errorDetails: string) => {
            setNodes((prev) => pauseCanvasGenerationReview(prev, nodeIds, errorDetails));
        },
        [setNodes],
    );

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const downstreamVideo = mode === "video" && sourceNode && isCanvasImageNodeType(sourceNode.type);
            const previousVideoIdentity = mode === "video" ? canvasTaskCommitIdentityByTargetRef.current.get(nodeId) : undefined;
            const previousVideoRequest = mode === "video" ? generationRequestsRef.current.get(nodeId) : undefined;
            const runIdentity = downstreamVideo
                ? sourceCanvasTaskIdentity(canvasTaskCommitIdentityByTargetRef.current, projectSession.current, nodeId, crypto.randomUUID())
                : captureCanvasTaskIdentity(nodeId, nodeId);
            setRunningNodeId(nodeId);
            if (!downstreamVideo) setNodes((prev) => (canvasTaskCommitGuard(runIdentity) ? prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)) : prev));
            const runController = downstreamVideo || mode === "video" ? new AbortController() : startGenerationRequest(nodeId, nodeId, nodeId, new AbortController(), undefined, runIdentity);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const rawGenerationContext = buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : prompt);
            let generationContext = rawGenerationContext;
            if (mode === "image" || mode === "text") {
                try {
                    generationContext = await hydrateNodeGenerationContext(rawGenerationContext);
                    if (!canvasTaskCommitGuard(runIdentity)) return;
                } catch (error) {
                    finishGenerationRequest(nodeId, runController);
                    setRunningNodeId(null);
                    setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: error instanceof Error ? error.message : "参考图片读取失败" } } : node)));
                    message.error(error instanceof Error ? error.message : "参考图片读取失败");
                    return;
                }
            }
            const sourcePrompt = generationContext.prompt.trim();
            const panoramaPrompt = sourceNode?.type === CanvasNodeType.Panorama ? buildPanoramaPrompt(sourcePrompt, generationContext.referenceImages.length > 0) : sourcePrompt;
            const effectivePrompt = applyCameraPrompt(panoramaPrompt, sourceNode?.type === CanvasNodeType.Panorama ? undefined : sourceNode?.metadata?.cameraControl);
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = !isCanvasImageNodeType(sourceNode?.type) && !editingTextNode;
            const statusPrompt = sourceNode?.type === CanvasNodeType.Config ? effectivePrompt : prompt;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: statusPrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isPanoramaNode = sourceNode?.type === CanvasNodeType.Panorama;
                    const count = isPanoramaNode ? 1 : getGenerationCount(generationConfig.count);
                    const isImageNode = isCanvasImageNodeType(sourceNode?.type);
                    const reuseImageNode = isImageNode;
                    const referenceImages = generationContext.referenceImages;
                    const imageGenerationConfig = {
                        ...generationConfig,
                        size: resolveImageRequestSize({
                            prompt,
                            configuredSize: generationConfig.size,
                            configuredSizeExplicit: sourceNode?.metadata?.sizeLocked !== false,
                            referenceWidth: referenceImages[0]?.width,
                            referenceHeight: referenceImages[0]?.height,
                            defaultSize: effectiveConfig.size,
                        }),
                    };
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, imageGenerationConfig, count, referenceImages);
                    const resultType = isPanoramaNode ? CanvasNodeType.Panorama : CanvasNodeType.Image;
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? resultType : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[resultType];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = reuseImageNode ? nodeId : nanoid();
                    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    pendingChildIds = reuseImageNode ? childIds : [rootId, ...childIds];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: resultType,
                        title: effectivePrompt.slice(0, 32) || (isPanoramaNode ? "Generated Panorama" : "Generated Image"),
                        position: {
                            x: reuseImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap,
                            y: reuseImageNode ? parentPosition.y : parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: reuseImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: reuseImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            prompt: effectivePrompt,
                            sourcePrompt,
                            status: NODE_STATUS_LOADING,
                            isBatchRoot: count > 1,
                            batchChildIds: count > 1 ? childIds : undefined,
                            batchUsesReferenceImages: referenceImages.length > 0,
                            ...generationMetadata,
                            ...(isPanoramaNode ? { panoramaProjection: "equirectangular" as const, panoramaSourcePrompt: sourcePrompt } : {}),
                            ...(sourceNode?.metadata?.cameraControl && !isPanoramaNode ? { cameraControl: sourceNode.metadata.cameraControl } : {}),
                            imageBatchExpanded: count > 1 ? true : undefined,
                        },
                    };
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: resultType,
                        title: effectivePrompt.slice(0, 32) || (isPanoramaNode ? "Generated Panorama" : "Generated Image"),
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: {
                            prompt: effectivePrompt,
                            sourcePrompt,
                            status: NODE_STATUS_LOADING,
                            batchRootId: count > 1 ? rootId : undefined,
                            ...generationMetadata,
                            ...(isPanoramaNode ? { panoramaProjection: "equirectangular" as const, panoramaSourcePrompt: sourcePrompt } : {}),
                            ...(sourceNode?.metadata?.cameraControl && !isPanoramaNode ? { cameraControl: sourceNode.metadata.cameraControl } : {}),
                        },
                    }));
                    const batchConnections = [...(reuseImageNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, prompt: effectivePrompt, sourcePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined },
                                      }
                                    : reuseImageNode
                                      ? {
                                            ...node,
                                            position: node.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: rootNode.title,
                                            metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                        }
                                      : {
                                            ...node,
                                            type: CanvasNodeType.Text,
                                            title: prompt.slice(0, 32) || "Prompt",
                                            width: parentConfig.width,
                                            height: parentConfig.height,
                                            metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                        }
                                : node,
                        ),
                        ...(reuseImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    setConnections((prev) => [...prev, ...batchConnections]);
                    const controller = runController;
                    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
                    if (count > 1) startGenerationRequest(rootId, nodeId, nodeId, controller);
                    let hasSuccess = false;
                    let hasFailure = false;
                    let hasReview = false;
                    let hasDeferred = false;
                    await Promise.all(
                        targetIds.map(async (targetId) => {
                            try {
                                const taskIdentity = beginCanvasTaskAttempt(targetId, nodeId);
                                await startAndCompleteImageTask(targetId, { ...imageGenerationConfig, count: "1" }, effectivePrompt, referenceImages, undefined, controller, undefined, taskIdentity);
                                if (!canvasTaskCommitGuard(taskIdentity)) return false;
                                hasSuccess = true;
                                if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return false;
                                const errorDetails = error instanceof Error ? error.message : "生成失败";
                                if (isImageGenerationTaskDeferredError(error)) {
                                    const shouldNotify = !hasDeferred;
                                    hasDeferred = true;
                                    if (shouldNotify) message.info(errorDetails);
                                    setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails } } : node)));
                                    return false;
                                }
                                if (isGenerationTaskNeedsReviewError(error)) {
                                    hasReview = true;
                                    pauseReviewedTasks([targetId], errorDetails);
                                    return false;
                                }
                                hasFailure = true;
                                setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails, imageTask: undefined } } : node)));
                            } finally {
                                finishGenerationRequest(targetId, controller);
                            }
                            return false;
                        }),
                    );
                    if (count > 1) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        setNodes((prev) => prev.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
                        return;
                    }
                    if (hasFailure) message.error(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.metadata?.status === NODE_STATUS_NEEDS_REVIEW
                                ? node
                                : node.id === nodeId && isConfigNode
                                  ? {
                                        ...node,
                                        metadata: {
                                            ...node.metadata,
                                            status: hasSuccess ? NODE_STATUS_SUCCESS : hasReview ? NODE_STATUS_IDLE : hasDeferred ? NODE_STATUS_LOADING : NODE_STATUS_ERROR,
                                            errorDetails: hasSuccess || hasReview ? undefined : hasDeferred ? "图片仍在后台生成，系统会继续查询原任务" : "全部图片生成失败",
                                        },
                                    }
                                  : node.id === nodeId && reuseImageNode
                                    ? {
                                          ...node,
                                          metadata: {
                                              ...node.metadata,
                                              status: hasSuccess ? NODE_STATUS_SUCCESS : hasReview ? NODE_STATUS_NEEDS_REVIEW : hasDeferred ? NODE_STATUS_LOADING : NODE_STATUS_ERROR,
                                              errorDetails: hasSuccess ? undefined : node.metadata?.errorDetails || (hasDeferred ? "图片仍在后台生成，系统会继续查询原任务" : "全部图片生成失败"),
                                          },
                                      }
                                    : node.id === rootId && !hasSuccess
                                      ? {
                                            ...node,
                                            metadata: {
                                                ...node.metadata,
                                                status: hasReview ? NODE_STATUS_IDLE : hasDeferred ? NODE_STATUS_LOADING : NODE_STATUS_ERROR,
                                                errorDetails: hasReview ? undefined : hasDeferred ? "图片仍在后台生成，系统会继续查询原任务" : "全部图片生成失败",
                                            },
                                        }
                                      : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    const videoReferences = resolveCanvasVideoGenerationReferences({
                        metadata: sourceNode?.metadata,
                        context: generationContext,
                        availableInputs: buildNodeGenerationInputs(nodeId, nodesRef.current, connectionsRef.current),
                        sourceImage: sourceNode && isCanvasImageNodeType(sourceNode.type) && sourceNode.metadata?.content ? canvasNodeReferenceImage(sourceNode) : undefined,
                    });
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const reuseVideoNode = sourceNode?.type === CanvasNodeType.Video;
                    const videoId = reuseVideoNode ? nodeId : nanoid();
                    const videoTaskRequest = createFreshGenerationTaskContext("canvas-video", [projectId, videoId]);
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: reuseVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: reuseVideoNode ? sourceNode.width : spec.width,
                        height: reuseVideoNode ? sourceNode.height : spec.height,
                        metadata: {
                            freeResize: reuseVideoNode ? sourceNode.metadata?.freeResize : undefined,
                            sizeLocked: sourceNode?.metadata?.sizeLocked,
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            videoTaskRequest,
                            ...canvasVideoReferenceMetadata(videoReferences),
                        },
                    };
                    pendingChildIds = [videoId];
                    const videoIdentity = beginCanvasTaskAttempt(videoId, nodeId);
                    const oldVideoIdentity = reuseVideoNode ? previousVideoIdentity : undefined;
                    const oldVideoRequest = reuseVideoNode ? previousVideoRequest : undefined;
                    const oldVideoNode = reuseVideoNode ? sourceNode : undefined;
                    let createdVideoTask = false;
                    const controller = reuseVideoNode ? runController : startGenerationRequest(videoId, nodeId, nodeId, runController, undefined, videoIdentity);
                    setNodes((prev) =>
                        reuseVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node))
                            : [...prev.map((node) => (node.id === nodeId && !downstreamVideo ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!reuseVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    try {
                        const task = await createCanvasVideoTask(generationConfig, effectivePrompt, videoReferences.images, videoReferences.videos, videoReferences.audios, {
                            quoteScope: `canvas:${nodeId}`,
                            signal: controller.signal,
                            conversationId: currentProject?.creativeConversationId,
                            surface: "canvas",
                            projectId,
                            ...videoTaskRequest,
                        });
                        if (!canvasTaskCommitGuard(videoIdentity)) return;
                        createdVideoTask = true;
                        if (reuseVideoNode) startGenerationRequest(videoId, nodeId, nodeId, controller, undefined, videoIdentity);
                        const videoTaskIdentity = attachCanvasTaskId(videoId, task.id, videoIdentity);
                        if (!videoTaskIdentity || !canvasTaskCommitGuard(videoTaskIdentity)) return;
                        setNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, metadata: mergeCanvasNodeTaskState({ ...node.metadata, videoTask: task }, { taskId: task.id, status: "running", ...(task.power !== undefined ? { power: task.power } : {}) }) } : node)));
                        await completeVideoTask(videoId, generationConfig, task, controller, effectivePrompt, videoTaskIdentity);
                    } catch (error) {
                        // The create endpoint can persist a task before its upstream submission fails.
                        // Recover that task id so the failed node still exposes TaskID/refund tracking.
                        if (!controller.signal.aborted) {
                            const currentIdentity = canvasTaskCommitIdentityByTargetRef.current.get(videoId);
                            if (!createdVideoTask && oldVideoIdentity && currentIdentity?.attemptToken === videoIdentity.attemptToken) {
                                if (oldVideoIdentity) canvasTaskCommitIdentityByTargetRef.current.set(videoId, oldVideoIdentity);
                                else canvasTaskCommitIdentityByTargetRef.current.delete(videoId);
                                if (oldVideoRequest) generationRequestsRef.current.set(videoId, oldVideoRequest);
                                else generationRequestsRef.current.delete(videoId);
                                if (oldVideoNode) setNodes(prev => prev.map(item => item.id === videoId ? oldVideoNode : item));
                                message.error(error instanceof Error ? error.message : "视频任务创建失败");
                                return;
                            }
                            const recovered = await findServerVideoGenerationTask(projectId, videoTaskRequest, { signal: controller.signal }).catch(() => null);
                            if (recovered && canvasTaskCommitGuard(videoIdentity)) {
                                const errorDetails = error instanceof VideoGenerationStorageError
                                    ? canvasVideoStorageFailureDetails(error)
                                    : error instanceof Error ? error.message : "视频生成失败";
                                setNodes((prev) =>
                                    prev.map((node) =>
                                        node.id === videoId
                                            ? {
                                                  ...node,
                                                  metadata: mergeCanvasNodeTaskState(
                                                      { ...node.metadata, videoTask: recovered, status: NODE_STATUS_ERROR, errorDetails, ...(error instanceof VideoGenerationStorageError && error.remoteUrl ? { remoteUrl: error.remoteUrl } : {}), ...(error instanceof VideoGenerationStorageError && error.diagnostic ? { videoStorageDiagnostic: error.diagnostic } : {}) },
                                                      { taskId: recovered.id, status: "error" },
                                                  ),
                                              }
                                            : node,
                                    ),
                                );
                            }
                        }
                        throw error;
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        isEmptyAudioNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
                    );
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const audioIdentity = beginCanvasTaskAttempt(audioId, nodeId);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController, undefined, audioIdentity);
                    try {
                        const task = await createAudioGenerationTask(generationConfig, effectivePrompt, {
                            signal: controller.signal,
                            source: "canvas",
                            conversationId: currentProject?.creativeConversationId,
                            surface: "canvas",
                            projectId,
                            ...createFreshGenerationTaskContext("canvas-audio", [projectId, audioId]),
                        });
                        if (!canvasTaskCommitGuard(audioIdentity)) return;
                        const audioTaskIdentity = attachCanvasTaskId(audioId, task.id, audioIdentity);
                        if (!audioTaskIdentity || !canvasTaskCommitGuard(audioTaskIdentity)) return;
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: mergeCanvasNodeTaskState({ ...node.metadata, audioTask: task }, { taskId: task.id, status: "running", ...(task.power !== undefined ? { power: task.power } : {}) }) } : node)));
                        await completeAudioTask(audioId, generationConfig, task, controller, effectivePrompt, audioTaskIdentity);
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const childIds = isConfigNode || editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
                pendingChildIds = childIds.length ? childIds : [nodeId];
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Text,
                        title: effectivePrompt.slice(0, 32) || "Generated Text",
                        position: {
                            x: parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                        },
                        width: textConfig.width,
                        height: textConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14 },
                    }));
                    setNodes((prev) => [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), ...childNodes]);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                const answers = await Promise.all(
                    textTargetIds.map(async (targetNodeId) => {
                        try {
                    const taskIdentity = beginCanvasTaskAttempt(targetNodeId, nodeId);
                    startGenerationRequest(targetNodeId, nodeId, nodeId, controller, undefined, taskIdentity);
                            const task = await createTextGenerationTask(generationConfig, buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }), { signal: controller.signal });
                            if (!canvasTaskCommitGuard(taskIdentity)) return { nodeId: targetNodeId, content: "" };
                            const textTaskIdentity = attachCanvasTaskId(targetNodeId, task.id, taskIdentity);
                            if (!textTaskIdentity || !canvasTaskCommitGuard(textTaskIdentity)) return { nodeId: targetNodeId, content: "" };
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === targetNodeId
                                        ? {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              metadata: mergeCanvasNodeTaskState(
                                                  { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, textTask: { id: task.id, model: task.model }, errorDetails: undefined },
                                                  { taskId: task.id, status: "running", ...(task.power !== undefined ? { power: task.power } : {}) },
                                              ),
                                          }
                                        : node,
                                ),
                            );
                            const answer = await completeTextTask(targetNodeId, generationConfig, task, controller, effectivePrompt, textTaskIdentity);
                            streamed = answer;
                            return { nodeId: targetNodeId, content: answer };
                        } finally {
                            finishGenerationRequest(targetNodeId, controller);
                        }
                    }),
                );
                if (controller.signal.aborted) return;
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                setNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS, textTask: undefined } }
                            : node.id === nodeId && isConfigNode
                              ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } }
                              : node.id === nodeId && !editingTextNode
                                ? { ...node, type: CanvasNodeType.Text, title: prompt.slice(0, 32) || "Generated Text", metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS, textTask: undefined } }
                                : node,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof VideoGenerationStorageError
                    ? canvasVideoStorageFailureDetails(error)
                    : error instanceof Error ? error.message : "生成失败";
                if (isGenerationTaskNeedsReviewError(error) && pendingChildIds.length) {
                    pauseReviewedTasks(pendingChildIds, errorDetails);
                    return;
                }
                const videoTaskId = pendingChildIds.find((id) => nodesRef.current.find((item) => item.id === id)?.metadata?.videoTask);
                const videoFailure = mode === "video" && videoTaskId ? classifyCanvasVideoTaskFailure(error) : undefined;
                if (videoTaskId && videoFailure && (videoFailure === "query_pending" || videoFailure === "needs_review")) {
                    message.info("视频仍在后台生成，系统会继续查询原任务");
                    deferVideoTask(videoTaskId);
                    return;
                }
                const terminalVideoFailure = videoFailure ? isTerminalCanvasVideoTaskFailureKind(videoFailure) : false;
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === nodeId || pendingChildIds.includes(node.id)
                            ? node.id === nodeId && !markSourceStatus
                                ? node
                                : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails, textTask: undefined, ...(error instanceof VideoGenerationStorageError && error.remoteUrl ? { remoteUrl: error.remoteUrl } : {}), ...(error instanceof VideoGenerationStorageError && error.diagnostic ? { videoStorageDiagnostic: error.diagnostic } : {}), ...(terminalVideoFailure ? { videoTask: undefined } : {}) } }
                            : node,
                    ),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [
            attachCanvasTaskId,
            beginCanvasTaskAttempt,
            canvasTaskCommitGuard,
            captureCanvasTaskIdentity,
            completeAudioTask,
            completeTextTask,
            completeVideoTask,
            attachCanvasTaskId,
            beginCanvasTaskAttempt,
            captureCanvasTaskIdentity,
            canvasTaskCommitGuard,
            canvasTaskCommitIdentityByTargetRef,
            registerCanvasTaskIdentity,
            currentProject?.creativeConversationId,
            deferVideoTask,
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            message,
            openConfigDialog,
            pauseReviewedTasks,
            projectId,
            startAndCompleteImageTask,
            startGenerationRequest,
        ],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const recoverReviewedNode = useCallback(
        async (node: CanvasNodeData, taskSnapshot?: Awaited<ReturnType<typeof readGenerationTask>>) => {
            const metadata = node.metadata;
            if (!metadata || !hasCanvasGenerationTask(node)) return;
            const mode = isCanvasImageNodeType(node.type) ? "image" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "text";
            const model = metadata.imageTask?.model || metadata.videoTask?.model || metadata.textTask?.model || metadata.audioTask?.model || metadata.model || effectiveConfig.model;
            const taskId = metadata.task?.taskId;
            const imageTask = metadata.imageTask || (mode === "image" && taskId ? { id: taskId, kind: metadata.generationType || "generation", model } : undefined);
            const videoTask = metadata.videoTask || (mode === "video" && taskId ? { id: taskId, provider: "generation" as const, model, pollPath: "server" } : undefined);
            const textTask = metadata.textTask || (mode === "text" && taskId ? { id: taskId, model } : undefined);
            const audioTask = metadata.audioTask || (mode === "audio" && taskId ? { id: taskId, model } : undefined);
            const generationConfig = {
                ...buildGenerationConfig(effectiveConfig, node, mode),
                model,
                count: "1",
            };
            const controller = startGenerationRequest(node.id, node.id, node.id);
            const taskIdentity = canvasTaskCommitIdentityByTargetRef.current.get(node.id) || captureCanvasTaskIdentity(node.id, node.id);
            if (!canvasTaskCommitGuard(taskIdentity)) return;
            setNodes((prev) => {
                const resumed = resumeCanvasGenerationReview(prev, node.id);
                if (!taskSnapshot) return resumed;
                return resumed.map((item) => item.id === node.id
                    ? { ...item, metadata: mergeCanvasNodeTaskState(item.metadata, { taskId, status: "running", ...(taskSnapshot.billed !== undefined ? { billed: taskSnapshot.billed } : {}), ...(taskSnapshot.power !== null ? { power: taskSnapshot.power } : {}) }) }
                    : item);
            });
            setRunningNodeId(node.id);
            try {
                if (imageTask) {
                    await recoverAndCompleteImageTask(node.id, generationConfig, imageTask, controller, metadata.prompt, {
                        outputBackground: metadata.imageOutputBackground,
                        outputMode: metadata.imageOutputMode,
                    });
                } else if (videoTask) {
                    await recoverAndCompleteVideoTask(node.id, generationConfig, videoTask, controller, metadata.prompt);
                } else if (metadata.videoTaskRequest) {
                    const task = await findServerVideoGenerationTask(projectId, metadata.videoTaskRequest, { signal: controller.signal });
                    if (!task) throw new GenerationTaskNeedsReviewError("尚未找到本次视频任务，请稍后检查状态；系统不会重新生成");
                    if (!canvasTaskCommitGuard(taskIdentity)) return;
                    const videoTaskIdentity = attachCanvasTaskId(node.id, task.id, taskIdentity);
                    if (!videoTaskIdentity || !canvasTaskCommitGuard(videoTaskIdentity)) return;
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: mergeCanvasNodeTaskState({ ...item.metadata, videoTask: task }, { taskId: task.id, status: "running", ...(task.power !== undefined ? { power: task.power } : {}) }) } : item)));
                    await completeVideoTask(node.id, generationConfig, task, controller, metadata.prompt, videoTaskIdentity);
                } else if (textTask) {
                    await recoverAndCompleteTextTask(node.id, generationConfig, textTask, controller, metadata.prompt);
                } else if (audioTask) {
                    await recoverAndCompleteAudioTask(node.id, generationConfig, audioTask, controller, metadata.prompt);
                }
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "重新检查任务失败";
                const terminalFailure = error instanceof ImageGenerationTaskTerminalError || isGenerationTaskTerminalError(error) || (metadata.videoTask ? isTerminalCanvasVideoTaskFailureKind(classifyCanvasVideoTaskFailure(error)) : false);
                if (terminalFailure) {
                    setNodes((prev) =>
                        prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, imageTask: undefined, videoTask: undefined, textTask: undefined, audioTask: undefined } } : item)),
                    );
                    return;
                }
                pauseReviewedTasks([node.id], errorDetails);
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [
            attachCanvasTaskId,
            canvasTaskCommitGuard,
            captureCanvasTaskIdentity,
            completeVideoTask,
            effectiveConfig,
            finishGenerationRequest,
            pauseReviewedTasks,
            projectId,
            recoverAndCompleteAudioTask,
            recoverAndCompleteImageTask,
            recoverAndCompleteTextTask,
            recoverAndCompleteVideoTask,
            setNodes,
            setRunningNodeId,
            startGenerationRequest,
        ],
    );

    useEffect(() => {
        if (!projectLoaded) return;
        let disposed = false;
        const poll = async () => {
            const candidates = nodesRef.current.flatMap(node => {
                if (node.metadata?.status !== NODE_STATUS_NEEDS_REVIEW || !hasCanvasGenerationTask(node)) return [];
                const taskId = node.metadata?.task?.taskId || node.metadata?.imageTask?.id || node.metadata?.videoTask?.id || node.metadata?.audioTask?.id || node.metadata?.textTask?.id;
                if (!taskId) return [];
                const kind: "image" | "video" | "audio" | "text" = isCanvasImageNodeType(node.type) ? "image" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "text";
                const pollKey = `${projectId}:${node.id}:${kind}:${taskId}`;
                if (reviewPollsRef.current.has(pollKey)) return [];
                reviewPollsRef.current.add(pollKey);
                const identityAtRead = canvasTaskCommitIdentityByTargetRef.current.get(node.id);
                return [{ node, taskId, kind, pollKey, identityAtRead, attemptTokenAtRead: identityAtRead?.attemptToken, identityTaskIdAtRead: identityAtRead?.taskId }];
            });
            await Promise.all(candidates.map(async candidate => {
                const { node, taskId, kind, pollKey, identityAtRead, attemptTokenAtRead, identityTaskIdAtRead } = candidate;
                try {
                    const progress = await readProgress(taskId, kind);
                    if (disposed || !progress || progress.needsReview) return;
                    if (!["success", "error", "cancelled"].includes(progress.status)) return;
                    const task = await readGenerationTask(kind, taskId);
                    if (disposed) return;
                    const current = nodesRef.current.find(item => item.id === node.id);
                    const currentTaskId = current?.metadata?.task?.taskId || current?.metadata?.imageTask?.id || current?.metadata?.videoTask?.id || current?.metadata?.audioTask?.id || current?.metadata?.textTask?.id;
                    if (!current || current.metadata?.status !== NODE_STATUS_NEEDS_REVIEW || currentTaskId !== taskId) return;
                    const currentIdentity = canvasTaskCommitIdentityByTargetRef.current.get(node.id);
                    if (identityAtRead) {
                        if (!currentIdentity || attemptTokenAtRead !== currentIdentity.attemptToken || identityTaskIdAtRead !== taskId || currentIdentity.taskId !== taskId) return;
                    } else if (currentIdentity) return;
                    if (task.needsReview || ["pending", "running"].includes(task.status)) return;
                    if (task.status === "success") {
                        await recoverReviewedNode(current, task);
                    } else if (task.status === "error" || task.status === "cancelled") {
                        setNodes(prev => prev.map(item => item.id === node.id && item.metadata?.status === NODE_STATUS_NEEDS_REVIEW && (item.metadata.task?.taskId || item.metadata.imageTask?.id || item.metadata.videoTask?.id || item.metadata.audioTask?.id || item.metadata.textTask?.id) === taskId
                            ? { ...item, metadata: mergeCanvasNodeTaskState({ ...item.metadata, status: task.status === "cancelled" ? NODE_STATUS_CANCELLED : NODE_STATUS_ERROR, errorDetails: task.error || undefined }, { taskId, status: task.status === "cancelled" ? "cancelled" : "error", ...(task.billed !== undefined ? { billed: task.billed } : {}) }) }
                            : item));
                    }
                } catch {
                    // A failed batch/detail read leaves the node unchanged for the next poll.
                } finally {
                    reviewPollsRef.current.delete(pollKey);
                }
            }));
        };
        void poll();
        const timer = setInterval(() => { void poll(); }, 7500);
        return () => { disposed = true; clearInterval(timer); };
    }, [canvasTaskCommitIdentityByTargetRef, nodesRef, projectId, projectLoaded, readProgress, recoverReviewedNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData) => {
            const existingTaskId = canvasNodeTaskId(node.metadata);
            if (!existingTaskId && !node.metadata?.agentRunId && node.metadata?.status === NODE_STATUS_ERROR) {
                message.info("原任务缺少可核对的任务 ID，请联系管理员确认；不会自动重新生成");
                return;
            }
            if (existingTaskId && !node.metadata?.agentRunId) {
                const kind = isCanvasImageNodeType(node.type) ? "image" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "text";
                try {
                    const decision = await reconcileCanvasTaskRetry(kind, existingTaskId);
                    if (decision.action === "review") {
                        if (node.metadata?.status === NODE_STATUS_NEEDS_REVIEW && hasCanvasGenerationTask(node)) {
                            await recoverReviewedNode(node);
                        } else message.info("原任务结果或取消状态尚未确认，请检查状态或联系管理员；不会重新生成");
                        return;
                    }
                    if (decision.action === "resume") {
                        const model = node.metadata?.model || effectiveConfig.model;
                        const restored: CanvasNodeData = { ...node, metadata: { ...node.metadata, status: NODE_STATUS_NEEDS_REVIEW,
                            ...(kind === "image" ? { imageTask: { id: existingTaskId, model, kind: node.metadata?.generationType || "generation" } } :
                                kind === "video" ? { videoTask: { id: existingTaskId, model, provider: "generation" } } :
                                    kind === "audio" ? { audioTask: { id: existingTaskId, model } } : { textTask: { id: existingTaskId, model } }),
                        } };
                        await recoverReviewedNode(restored);
                        return;
                    }
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "原任务查询失败，请稍后检查；不会重新生成");
                    return;
                }
            }
            if (node.metadata?.status === NODE_STATUS_NEEDS_REVIEW && hasCanvasGenerationTask(node)) {
                await recoverReviewedNode(node);
                return;
            }
            if (node.metadata?.agentRunId && node.metadata.agentTaskId) {
                setRunningNodeId(node.id);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: "" } } : item)));
                try {
                    await retryCanvasAgentNode(node, applyAgentOps);
                    message.success("Agent 任务已重新生成");
                } catch (error) {
                    const errorDetails = error instanceof Error ? error.message : "Agent 任务重试失败";
                    message.error(errorDetails);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                } finally {
                    setRunningNodeId(null);
                }
                return;
            }
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const retryIdentity = beginCanvasTaskAttempt(node.id, sourceNode.id);
            const isVideoRetry = node.type === CanvasNodeType.Video;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = isCanvasImageNodeType(node.type) ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, isVideoRetry ? node : sourceNode, node.type === CanvasNodeType.Text ? "text" : isVideoRetry ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const retryPromptSource = isVideoRetry
                ? node.metadata?.prompt || sourceNode.metadata?.prompt || sourceNode.metadata?.composerContent || ""
                : sourceNode.type === CanvasNodeType.Config && sourceNode.metadata?.composerContent
                  ? sourceNode.metadata.composerContent
                  : sourceNode.metadata?.prompt || node.metadata?.prompt || "";
            const rawContext = hasSavedImageMetadata ? null : buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, retryPromptSource);
            const context = rawContext && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio ? await hydrateNodeGenerationContext(rawContext) : rawContext;
            if (!canvasTaskCommitGuard(retryIdentity)) return;
            const sourcePrompt = (savedImageMetadata?.sourcePrompt || sourceNode.metadata?.sourcePrompt || context?.prompt || savedImageMetadata?.prompt || sourceNode.metadata?.prompt || node.metadata?.prompt || "").trim();
            const panoramaPrompt = node.type === CanvasNodeType.Panorama ? buildPanoramaPrompt(sourcePrompt, Boolean(savedImageMetadata?.references?.length || context?.referenceImages.length)) : sourcePrompt;
            const prompt = applyCameraPrompt(panoramaPrompt, node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Panorama ? undefined : savedImageMetadata?.cameraControl || sourceNode.metadata?.cameraControl);
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (!canvasTaskCommitGuard(retryIdentity)) return;
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }
            const retryImages = retryReferenceImages || [];
            const retryMask = savedImageMetadata ? await resolveMetadataImageEditMask(savedImageMetadata) : undefined;
            if (!canvasTaskCommitGuard(retryIdentity)) return;
            if (savedImageMetadata?.imageEditMask && !retryMask) {
                message.error("背景补全蒙版已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "背景补全蒙版已丢失，无法继续重试" } } : item)));
                return;
            }

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id, new AbortController(), undefined, retryIdentity);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    const task = await createTextGenerationTask(generationConfig, buildNodeResponseMessages({ ...context, prompt }), { signal: controller.signal });
                    if (!canvasTaskCommitGuard(retryIdentity)) return;
                    const textTaskIdentity = attachCanvasTaskId(node.id, task.id, retryIdentity);
                    if (!textTaskIdentity || !canvasTaskCommitGuard(textTaskIdentity)) return;
                    setNodes((prev) =>
                        prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: mergeCanvasNodeTaskState({ ...item.metadata, prompt, status: NODE_STATUS_LOADING, textTask: { id: task.id, model: task.model }, errorDetails: undefined }, { taskId: task.id, status: "running", ...(task.power !== undefined ? { power: task.power } : {}) }) } : item)),
                    );
                    await completeTextTask(node.id, generationConfig, task, controller, prompt, textTaskIdentity);
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    if (!context) throw new Error("视频生成上下文已丢失，无法继续重试");
                    const videoReferences =
                        restoreCanvasVideoGenerationReferences(node.metadata) ||
                        resolveCanvasVideoGenerationReferences({
                            metadata: sourceNode.metadata,
                            context,
                            availableInputs: buildNodeGenerationInputs(sourceNode.id, nodesRef.current, connectionsRef.current),
                            sourceImage: isCanvasImageNodeType(sourceNode.type) && sourceNode.metadata?.content ? canvasNodeReferenceImage(sourceNode) : undefined,
                        });
                    const videoTaskRequest = createFreshGenerationTaskContext("canvas-video-retry", [projectId, node.id]);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...canvasVideoReferenceMetadata(videoReferences), status: NODE_STATUS_LOADING, videoTaskRequest, videoTask: undefined } } : item)));
                    try {
                        const task = await createCanvasVideoTask(generationConfig, prompt, videoReferences.images, videoReferences.videos, videoReferences.audios, {
                            signal: controller.signal,
                            conversationId: currentProject?.creativeConversationId,
                            surface: "canvas",
                            projectId,
                            quoteScope: `canvas:${node.id}`,
                            ...videoTaskRequest,
                        });
                        if (!canvasTaskCommitGuard(retryIdentity)) return;
                        const videoTaskIdentity = attachCanvasTaskId(node.id, task.id, retryIdentity);
                        if (!videoTaskIdentity || !canvasTaskCommitGuard(videoTaskIdentity)) return;
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: mergeCanvasNodeTaskState({ ...item.metadata, ...canvasVideoReferenceMetadata(videoReferences), videoTask: task }, { taskId: task.id, status: "running", ...(task.power !== undefined ? { power: task.power } : {}) }) } : item)));
                        await completeVideoTask(node.id, generationConfig, task, controller, prompt, videoTaskIdentity);
                    } catch (error) {
                        if (!controller.signal.aborted) {
                            const recovered = await findServerVideoGenerationTask(projectId, videoTaskRequest, { signal: controller.signal }).catch(() => null);
                            if (recovered && canvasTaskCommitGuard(retryIdentity)) {
                                const errorDetails = error instanceof Error ? error.message : "视频生成失败";
                                setNodes((prev) =>
                                    prev.map((item) =>
                                        item.id === node.id
                                            ? {
                                                  ...item,
                                                  metadata: mergeCanvasNodeTaskState(
                                                      { ...item.metadata, videoTask: recovered, status: NODE_STATUS_ERROR, errorDetails, ...(error instanceof VideoGenerationStorageError && error.remoteUrl ? { remoteUrl: error.remoteUrl } : {}), ...(error instanceof VideoGenerationStorageError && error.diagnostic ? { videoStorageDiagnostic: error.diagnostic } : {}) },
                                                      { taskId: recovered.id, status: "error" },
                                                  ),
                                              }
                                            : item,
                                    ),
                                );
                            }
                        }
                        throw error;
                    }
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const task = await createAudioGenerationTask(generationConfig, prompt, {
                        signal: controller.signal,
                        source: "canvas",
                        conversationId: currentProject?.creativeConversationId,
                        surface: "canvas",
                        projectId,
                        ...createFreshGenerationTaskContext("canvas-audio-retry", [projectId, node.id]),
                    });
                    if (!canvasTaskCommitGuard(retryIdentity)) return;
                    const audioTaskIdentity = attachCanvasTaskId(node.id, task.id, retryIdentity);
                    if (!audioTaskIdentity || !canvasTaskCommitGuard(audioTaskIdentity)) return;
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: mergeCanvasNodeTaskState({ ...item.metadata, audioTask: task }, { taskId: task.id, status: "running", ...(task.power !== undefined ? { power: task.power } : {}) }) } : item)));
                    await completeAudioTask(node.id, generationConfig, task, controller, prompt, audioTaskIdentity);
                    return;
                }

                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  type: node.type === CanvasNodeType.Panorama ? CanvasNodeType.Panorama : CanvasNodeType.Image,
                                  metadata: { ...item.metadata, prompt, sourcePrompt, ...generationMetadata, ...(node.type === CanvasNodeType.Panorama ? { panoramaProjection: "equirectangular" as const, panoramaSourcePrompt: sourcePrompt } : {}) },
                              }
                            : item,
                    ),
                );
                await startAndCompleteImageTask(node.id, generationConfig, prompt, retryImages, retryMask || undefined, controller, {
                    outputBackground: node.metadata?.imageOutputBackground,
                    outputMode: node.metadata?.imageOutputMode,
                    layerBatch: node.metadata?.imageLayerBatch,
                }, retryIdentity);
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                if (isImageGenerationTaskDeferredError(error)) {
                    message.info(errorDetails);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails } } : item)));
                    return;
                }
                if (isGenerationTaskNeedsReviewError(error)) {
                    pauseReviewedTasks([node.id], errorDetails);
                    return;
                }
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, imageTask: undefined, textTask: undefined, videoTask: undefined, audioTask: undefined } } : item)),
                );
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [
            attachCanvasTaskId,
            beginCanvasTaskAttempt,
            canvasTaskCommitGuard,
            applyAgentOps,
            completeAudioTask,
            completeTextTask,
            completeVideoTask,
            currentProject?.creativeConversationId,
            deferVideoTask,
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            message,
            openConfigDialog,
            pauseReviewedTasks,
            projectId,
            recoverReviewedNode,
            setNodes,
            setRunningNodeId,
            startAndCompleteImageTask,
            startGenerationRequest,
        ],
    );

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage, options?: CanvasAssetInsertOptions) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, remoteUrl: image.remoteUrl, serverUrl: image.serverUrl, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadCanvasImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = nodeSizeFromAspect(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${nanoid()}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: options?.position || { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt, ...(options?.groupId ? { groupId: options.groupId } : {}) },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string, options?: CanvasAssetInsertOptions) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const created = createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS });
            const node = {
                ...created,
                title: text.slice(0, 32) || "Assistant Text",
                position: options?.position || created.position,
                metadata: { ...created.metadata, ...(options?.groupId ? { groupId: options.groupId } : {}) },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload, options?: CanvasAssetInsertOptions) => {
            const groupMetadata = options?.groupId ? { groupId: options.groupId } : {};
            if (payload.kind === "text") {
                insertAssistantText(payload.content, options);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${nanoid()}`;
                const nextSize = videoNodeSizeFromNatural(payload.width || spec.width, payload.height || spec.height);
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Video,
                        title: payload.title,
                        position: options?.position || { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 },
                        width: nextSize.width,
                        height: nextSize.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, remoteUrl: payload.remoteUrl, serverUrl: payload.serverUrl, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height, ...groupMetadata },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else if (payload.kind === "audio") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `audio-${nanoid()}`;
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Audio,
                        title: payload.title,
                        position: options?.position || { x: center.x - spec.width / 2, y: center.y - spec.height / 2 },
                        width: spec.width,
                        height: spec.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, remoteUrl: payload.remoteUrl, serverUrl: payload.serverUrl, durationMs: payload.durationMs, status: NODE_STATUS_SUCCESS, ...groupMetadata },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey, remoteUrl: payload.remoteUrl, serverUrl: payload.serverUrl }, options);
            }
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    const assistantOpen = assistantMounted && !assistantCollapsed;
    const openAgent = () => {
        if (agentCloseTimerRef.current) {
            clearTimeout(agentCloseTimerRef.current);
            agentCloseTimerRef.current = null;
        }
        setAssistantMounted(true);
        setAssistantClosing(false);
        setAssistantCollapsed(false);
    };
    const closeAgent = () => {
        if (!assistantMounted || assistantClosing) return;
        setAssistantCollapsed(true);
        setAssistantClosing(true);
        agentCloseTimerRef.current = setTimeout(() => {
            agentCloseTimerRef.current = null;
            setAssistantMounted(false);
            setAssistantClosing(false);
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    };

    useEffect(() => {
        if (!projectLoaded || autoOpenedAgentRef.current) return;
        autoOpenedAgentRef.current = true;
        if (window.matchMedia("(min-width: 1024px)").matches) {
            setAssistantMounted(true);
            setAssistantClosing(false);
            setAssistantCollapsed(false);
        }
    }, [projectLoaded]);
    return {
        handleGenerateNode,
        handleRetryNode,
        generateImageFromTextNode,
        insertAssistantImage,
        insertAssistantText,
        handleAssetInsert,
        assistantOpen,
        openAgent,
        closeAgent,
    };
}

export type CanvasGenerationActions = ReturnType<typeof useCanvasGenerationActions>;
