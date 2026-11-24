"use client";

import { useCallback, useEffect, useRef } from "react";
import { createTaskProgressBatcher } from "@/services/api/generation-tasks";

import { createFreshGenerationTaskContext } from "@/lib/generation-request-context";
import { recoverAudioGenerationTask, storeGeneratedAudio, waitForAudioGenerationTask } from "@/services/api/audio";
import { cancelServerImageGenerationTask, createImageGenerationTask, recoverImageGenerationTask, waitForImageGenerationTask, type ImageGenerationTask } from "@/services/api/image";
import { recoverTextGenerationTask, waitForTextGenerationTask, type TextGenerationTask } from "@/services/api/text";
import { recoverVideoGenerationTask, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasNodeMetadata } from "../types";
import { nodeSizeFromAspect } from "../utils/canvas-node-size";
import { compositeCanvasImageEditResult, validateCanvasTransparentLayer } from "../utils/canvas-image-data";

import { CanvasHistoryEntry, NODE_STATUS_IDLE, NODE_STATUS_LOADING, NODE_STATUS_SUCCESS } from "./canvas-page-elements";
import { audioMetadata, imageMetadata, resolveMetadataImageEditMask, resolveMetadataImageEditValidationMask, resolveMetadataReferences, uploadCanvasImage, uploadGeneratedCanvasImage, videoMetadata } from "./canvas-page-utils";
import { applyCanvasImageLayerTaskResults, applyCanvasImageTaskResults, canvasImageLayerResultNodeId } from "./canvas-image-task-results";
import { bindCanvasTaskId, canCommitCanvasTaskResult, canvasTaskHasResult, type CanvasTaskCommitIdentity } from "./canvas-task-commit-guard";
import { beginCanvasNodeTaskAttempt as beginNodeTaskAttempt, mergeCanvasNodeTaskState } from "./canvas-node-task-state";

import type { CanvasPageState } from "./use-canvas-page-state";

type CanvasImageTaskOptions = {
    outputBackground?: "opaque" | "transparent";
    outputMode?: "layers";
    layerBatch?: { grant: string; slotId: string };
    commitResult?: boolean;
};

export function useCanvasTaskRuntime({ state }: { state: CanvasPageState }) {
    const progressBatcher = useRef<ReturnType<typeof createTaskProgressBatcher> | null>(null);
    useEffect(() => {
        const batcher = createTaskProgressBatcher();
        progressBatcher.current = batcher;
        return () => { batcher.dispose(); progressBatcher.current = null; };
    }, [state.projectId]);
    const readProgress = useCallback((id: string, kind: string, signal?: AbortSignal) => progressBatcher.current?.readProgress(id, kind, signal) || Promise.resolve(null), []);
    const {
        message,
        modal,
        params,
        router,
        projectId,
        projectSession,
        containerRef,
        imageInputRef,
        uploadTargetRef,
        clipboardRef,
        historyRef,
        lastHistoryRef,
        historyCommitTimerRef,
        applyingHistoryRef,
        didInitialCenterRef,
        toolbarHideTimerRef,
        nodeDraggingRef,
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        addAsset,
        userId,
        hydrated,
        hydratedUserId,
        hydrate,
        createProject,
        updateProject,
        renameProject,
        deleteProjects,
        currentProject,
        theme,
        nodes,
        setNodes,
        connections,
        setConnections,
        chatSessions,
        setChatSessions,
        activeChatId,
        setActiveChatId,
        viewport,
        setViewport,
        size,
        setSize,
        selectedNodeIds,
        setSelectedNodeIds,
        selectedConnectionId,
        setSelectedConnectionId,
        hoveredNodeId,
        setHoveredNodeId,
        pendingConnectionCreate,
        setPendingConnectionCreate,
        contextMenu,
        setContextMenu,
        runningNodeId,
        setRunningNodeId,
        isMiniMapOpen,
        setIsMiniMapOpen,
        backgroundMode,
        setBackgroundMode,
        showImageInfo,
        setShowImageInfo,
        clearConfirmOpen,
        setClearConfirmOpen,
        assetPickerOpen,
        setAssetPickerOpen,
        projectLoaded,
        setProjectLoaded,
        toolbarNodeId,
        setToolbarNodeId,
        nodeImageSettingsOpen,
        setNodeImageSettingsOpen,
        dialogNodeId,
        setDialogNodeId,
        editingNodeId,
        setEditingNodeId,
        editRequestNonce,
        setEditRequestNonce,
        infoNodeId,
        setInfoNodeId,
        cropNodeId,
        setCropNodeId,
        maskEditNodeId,
        setMaskEditNodeId,
        splitNodeId,
        setSplitNodeId,
        upscaleNodeId,
        setUpscaleNodeId,
        angleNodeId,
        setAngleNodeId,
        previewNodeId,
        setPreviewNodeId,
        assistantCollapsed,
        setAssistantCollapsed,
        assistantMounted,
        setAssistantMounted,
        assistantClosing,
        setAssistantClosing,
        titleEditing,
        setTitleEditing,
        titleDraft,
        setTitleDraft,
        historyState,
        setHistoryState,
        collapsingBatchIds,
        setCollapsingBatchIds,
        openingBatchIds,
        setOpeningBatchIds,
        isNodeDragging,
        setIsNodeDragging,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        agentCloseTimerRef,
        autoOpenedAgentRef,
        pendingConnectionCreateRef,
        generationRequestsRef,
        canvasTaskCommitIdentityByTargetRef,
        resumingImageTaskIdsRef,
        resumingVideoTaskIdsRef,
        resumingTextTaskIdsRef,
        resumingAudioTaskIdsRef,
    } = state;

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController(), taskId?: string, identity?: CanvasTaskCommitIdentity) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        const previousIdentity = canvasTaskCommitIdentityByTargetRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        const nextIdentity = identity || { ...projectSession.current, attemptToken: crypto.randomUUID(), sourceNodeId: originNodeId, targetNodeId, ...(taskId ? { taskId } : {}) };
        if (previousIdentity && previousIdentity.attemptToken !== nextIdentity.attemptToken) previousIdentity.supersededHasResult = canvasTaskHasResult(nodesRef.current.find(node => node.id === targetNodeId)?.metadata);
        canvasTaskCommitIdentityByTargetRef.current.set(targetNodeId, nextIdentity);
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const captureCanvasTaskIdentity = useCallback((targetNodeId: string, sourceNodeId: string, taskId?: string) => {
        const identity: CanvasTaskCommitIdentity = { ...projectSession.current, attemptToken: crypto.randomUUID(), sourceNodeId, targetNodeId, ...(taskId ? { taskId } : {}) };
        canvasTaskCommitIdentityByTargetRef.current.set(targetNodeId, identity);
        return identity;
    }, []);
    const registerCanvasTaskIdentity = useCallback((identity: CanvasTaskCommitIdentity) => {
        canvasTaskCommitIdentityByTargetRef.current.set(identity.targetNodeId, identity);
    }, []);
    const beginCanvasTaskAttempt = useCallback((targetNodeId: string, sourceNodeId: string, taskId?: string) => {
        const previous = canvasTaskCommitIdentityByTargetRef.current.get(targetNodeId);
        const identity: CanvasTaskCommitIdentity = {
            ...projectSession.current,
            attemptToken: crypto.randomUUID(),
            sourceNodeId,
            targetNodeId,
            ...(taskId ? { taskId } : {}),
        };
        if (previous) previous.supersededHasResult = canvasTaskHasResult(nodesRef.current.find(node => node.id === targetNodeId)?.metadata);
        canvasTaskCommitIdentityByTargetRef.current.set(targetNodeId, identity);
        setNodes(current => current.map(node => node.id === targetNodeId ? { ...node, metadata: beginNodeTaskAttempt(node.metadata, identity.attemptToken) } : node));
        return identity;
    }, [setNodes]);
    const attachCanvasTaskId = useCallback((targetNodeId: string, taskId: string, captured: CanvasTaskCommitIdentity) => {
        if (captured.targetNodeId !== targetNodeId) return undefined;
        return bindCanvasTaskId(canvasTaskCommitIdentityByTargetRef.current, projectSession.current, captured, taskId);
    }, []);
    const canvasTaskCommitGuard = useCallback((identity: CanvasTaskCommitIdentity) => {
        const current = projectSession.current;
        const target = nodesRef.current.find((node) => node.id === identity.targetNodeId);
        const currentIdentity = canvasTaskCommitIdentityByTargetRef.current.get(identity.targetNodeId);
        const currentTaskId = currentIdentity?.taskId || target?.metadata?.imageTask?.id || target?.metadata?.videoTask?.id || target?.metadata?.audioTask?.id || target?.metadata?.textTask?.id;
        const result = canCommitCanvasTaskResult({ captured: identity, current, nodeIds: new Set(nodesRef.current.map((node) => node.id)), currentTaskId, registeredTaskId: currentIdentity?.taskId, registeredAttemptToken: currentIdentity?.attemptToken });
        return result.allowed;
    }, [message]);

    const warnSupersededResultOnce = useCallback((identity: CanvasTaskCommitIdentity) => {
        if (!identity.supersededHasResult || identity.supersededWarningShown) return;
        identity.supersededWarningShown = true;
        message.warning({ content: `生成结果未写入当前画布：节点已开始新的任务，旧任务结果保留在生成记录中。${identity.taskId ? `任务 ${identity.taskId}` : ""}`, key: `canvas-task-commit-guard-${identity.taskId || identity.attemptToken}`, duration: 4 });
    }, [message]);

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedNodeIds = new Set<string>();
        generationRequestsRef.current.forEach((request) => {
            if (request.runningNodeId !== runningId) return;
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
        });
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
        const imageTaskIds = nodesRef.current
            .filter((node) => affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING)
            .map((node) => node.metadata?.imageTask?.id)
            .filter((id): id is string => Boolean(id));
        for (const taskId of new Set(imageTaskIds)) {
            void cancelServerImageGenerationTask(taskId).catch(() => undefined);
        }
        setNodes((prev) =>
            prev.map((node) =>
                affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                    ? { ...node, metadata: mergeCanvasNodeTaskState({ ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined, videoTask: undefined, videoTaskRequest: undefined, imageTask: undefined, textTask: undefined, audioTask: undefined }, { status: "cancelled" }) }
                    : node,
            ),
        );
    }, []);

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: "停止生成？",
                centered: true,
                content: "当前生成请求会被中断，已经生成完成的内容会保留。",
                okText: "停止",
                cancelText: "继续生成",
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId],
    );

    const completeVideoTask = useCallback(async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["videoTask"]>, controller: AbortController, prompt?: string, identity = canvasTaskCommitIdentityByTargetRef.current.get(nodeId) || captureCanvasTaskIdentity(nodeId, nodeId)) => {
        const result = await waitForVideoGenerationTask(generationConfig, task, { signal: controller.signal, readProgress });
        if (!canvasTaskCommitGuard({ ...identity, taskId: task.id })) { warnSupersededResultOnce(identity); return; }
        const video = await storeGeneratedVideo(result);
        if (!attachCanvasTaskId(nodeId, task.id, identity)) return;
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const videoSize = node.metadata?.freeResize ? { width: node.width, height: node.height } : nodeSizeFromAspect(video.width || node.width, video.height || node.height, Math.min(node.width, node.height));
                return {
                    ...node,
                    width: videoSize.width,
                    height: videoSize.height,
                    position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
                    metadata: {
                        ...node.metadata,
                        ...videoMetadata(video),
                        prompt: prompt || node.metadata?.prompt,
                        model: generationConfig.model,
                        size: generationConfig.size,
                        seconds: generationConfig.videoSeconds,
                        vquality: generationConfig.vquality,
                        generateAudio: generationConfig.videoGenerateAudio,
                        watermark: generationConfig.videoWatermark,
                        videoTask: undefined,
                        videoTaskRequest: undefined,
                        errorDetails: undefined,
                    },
                };
            }),
        );
    }, [attachCanvasTaskId, canvasTaskCommitGuard, captureCanvasTaskIdentity, setNodes, warnSupersededResultOnce]);

    const recoverAndCompleteVideoTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["videoTask"]>, controller: AbortController, prompt?: string, identity = canvasTaskCommitIdentityByTargetRef.current.get(nodeId) || captureCanvasTaskIdentity(nodeId, nodeId)) => {
            const recovered = await recoverVideoGenerationTask(task, { signal: controller.signal });
            if (!canvasTaskCommitGuard({ ...identity, taskId: recovered.id })) return;
            if (!attachCanvasTaskId(nodeId, recovered.id, identity)) return;
            setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, videoTask: recovered, errorDetails: undefined } } : node)));
            return completeVideoTask(nodeId, generationConfig, recovered, controller, prompt, identity);
        },
        [canvasTaskCommitGuard, captureCanvasTaskIdentity, completeVideoTask, setNodes],
    );

    const completeImageTask = useCallback(async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["imageTask"]> | ImageGenerationTask, controller: AbortController, prompt?: string, options?: CanvasImageTaskOptions, identity = canvasTaskCommitIdentityByTargetRef.current.get(nodeId) || captureCanvasTaskIdentity(nodeId, nodeId)) => {
        const result = await waitForImageGenerationTask(generationConfig, task, { signal: controller.signal, readProgress });
        if (!canvasTaskCommitGuard({ ...identity, taskId: task.id })) { warnSupersededResultOnce(identity); return []; }
        if (!attachCanvasTaskId(nodeId, task.id, identity)) return [];
        const outputs = result.results?.length ? result.results : [result];
        let uploaded = await Promise.all(outputs.map(uploadGeneratedCanvasImage));
        if (!canvasTaskCommitGuard(identity)) return uploaded;
        const target = nodesRef.current.find((node) => node.id === nodeId);
        if (options?.outputBackground === "transparent" || target?.metadata?.imageOutputBackground === "transparent") {
            await Promise.all(uploaded.map((image) => validateCanvasTransparentLayer(image.serverUrl || image.url, target?.metadata?.layerName || target?.title || "图层")));
            if (!canvasTaskCommitGuard(identity)) return uploaded;
        }
        if (target?.metadata?.preserveUnmaskedPixels) {
            const [references, mask, validationMask] = await Promise.all([resolveMetadataReferences(target.metadata), resolveMetadataImageEditMask(target.metadata), resolveMetadataImageEditValidationMask(target.metadata)]);
            if (!canvasTaskCommitGuard(identity)) return uploaded;
            const source = references?.[0];
            if (!source || !mask) throw new Error("背景补全缺少原图或蒙版，无法保护未选区域");
            uploaded = await Promise.all(
                uploaded.map(async (image) => {
                    const composite = await compositeCanvasImageEditResult(source.dataUrl, image.serverUrl || image.url, mask.dataUrl, validationMask?.dataUrl);
                    return uploadCanvasImage(composite);
                }),
            );
            if (!canvasTaskCommitGuard(identity)) return uploaded;
        }
        if (options?.commitResult !== false) {
            const layerMode = (options?.outputMode || target?.metadata?.imageOutputMode) === "layers";
            setNodes((prev) =>
                layerMode
                    ? applyCanvasImageLayerTaskResults(prev, {
                          nodeId,
                          taskId: task.id,
                          images: uploaded.map((image) => ({ width: image.width, height: image.height, metadata: imageMetadata(image) })),
                          prompt,
                          model: generationConfig.model,
                          size: generationConfig.size,
                      })
                    : applyCanvasImageTaskResults(prev, {
                          nodeId,
                          taskId: task.id,
                          images: uploaded.map((image) => ({ width: image.width, height: image.height, metadata: imageMetadata(image) })),
                          prompt,
                          model: generationConfig.model,
                          size: generationConfig.size,
                      }),
            );
            const sourceNodeId = layerMode ? target?.metadata?.sourceLayerNodeId : undefined;
            if (sourceNodeId) {
                const resultNodeIds = uploaded.map((_, index) => canvasImageLayerResultNodeId(nodeId, task.id, index));
                setConnections((current) => {
                    const connectedTargets = new Set(current.filter((connection) => connection.fromNodeId === sourceNodeId).map((connection) => connection.toNodeId));
                    const missing = resultNodeIds.filter((resultNodeId) => !connectedTargets.has(resultNodeId));
                    return missing.length ? [...current, ...missing.map((resultNodeId) => ({ id: `connection-layer-${task.id}-${resultNodeIds.indexOf(resultNodeId) + 1}`, fromNodeId: sourceNodeId, toNodeId: resultNodeId }))] : current;
                });
            }
        }
        return uploaded;
    }, [attachCanvasTaskId, canvasTaskCommitGuard, captureCanvasTaskIdentity, warnSupersededResultOnce]);

    const startAndCompleteImageTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, prompt: string, references: ReferenceImage[] = [], mask: ReferenceImage | undefined, controller: AbortController, options?: CanvasImageTaskOptions, identity = captureCanvasTaskIdentity(nodeId, nodeId)) => {
            if (!canvasTaskCommitGuard(identity)) return;
            const task = await createImageGenerationTask(generationConfig, prompt, references, mask, {
                signal: controller.signal,
                logSource: "canvas",
                logTitle: prompt.slice(0, 36) || "画布生图",
                conversationId: currentProject?.creativeConversationId,
                surface: "canvas",
                projectId,
                outputBackground: options?.outputBackground,
                outputMode: options?.outputMode,
                layerBatch: options?.layerBatch,
                ...createFreshGenerationTaskContext("canvas-image", [projectId, nodeId]),
            });
            if (!canvasTaskCommitGuard(identity)) return task;
            const taskIdentity = attachCanvasTaskId(nodeId, task.id, identity);
            if (!taskIdentity || !canvasTaskCommitGuard(taskIdentity)) return task;
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId
                        ? {
                              ...node,
                              metadata: mergeCanvasNodeTaskState(
                                  {
                                      ...node.metadata,
                                      imageTask: { id: task.id, kind: task.kind, model: task.model },
                                      errorDetails: undefined,
                                  },
                                  { taskId: task.id, status: "running", ...(task.power !== undefined ? { power: task.power } : {}) },
                              ),
                          }
                        : node,
                ),
            );
            return completeImageTask(nodeId, generationConfig, task, controller, prompt, options, taskIdentity);
        },
        [attachCanvasTaskId, canvasTaskCommitGuard, captureCanvasTaskIdentity, canvasTaskCommitIdentityByTargetRef, completeImageTask, currentProject?.creativeConversationId, projectId, registerCanvasTaskIdentity, setNodes],
    );

    const recoverAndCompleteImageTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["imageTask"]>, controller: AbortController, prompt?: string, options?: CanvasImageTaskOptions, identity = canvasTaskCommitIdentityByTargetRef.current.get(nodeId) || captureCanvasTaskIdentity(nodeId, nodeId)) => {
            const recovered = await recoverImageGenerationTask(task.id, { signal: controller.signal });
            if (!canvasTaskCommitGuard({ ...identity, taskId: recovered.id })) return;
            if (!attachCanvasTaskId(nodeId, recovered.id, identity)) return;
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  imageTask: { id: recovered.id, kind: recovered.kind, model: recovered.model },
                                  errorDetails: undefined,
                              },
                          }
                        : node,
                ),
            );
            return completeImageTask(nodeId, generationConfig, recovered, controller, prompt, options, { ...identity, taskId: recovered.id });
        },
        [attachCanvasTaskId, canvasTaskCommitGuard, captureCanvasTaskIdentity, completeImageTask, setNodes],
    );

    const completeTextTask = useCallback(async (nodeId: string, generationConfig: AiConfig, task: TextGenerationTask, controller: AbortController, prompt?: string, identity = canvasTaskCommitIdentityByTargetRef.current.get(nodeId) || captureCanvasTaskIdentity(nodeId, nodeId)) => {
        const answer = await waitForTextGenerationTask(generationConfig, task, { signal: controller.signal });
        if (!canvasTaskCommitGuard({ ...identity, taskId: task.id })) { warnSupersededResultOnce(identity); return answer || "没有返回内容"; }
        if (!attachCanvasTaskId(nodeId, task.id, identity)) return answer || "没有返回内容";
        setNodes((prev) =>
            prev.map((node) =>
                node.id === nodeId
                    ? {
                          ...node,
                          type: CanvasNodeType.Text,
                          metadata: {
                              ...node.metadata,
                              content: answer || "没有返回内容",
                              prompt: prompt || node.metadata?.prompt,
                              status: NODE_STATUS_SUCCESS,
                              textTask: undefined,
                              errorDetails: undefined,
                          },
                      }
                    : node,
            ),
        );
        return answer || "没有返回内容";
    }, [attachCanvasTaskId, canvasTaskCommitGuard, captureCanvasTaskIdentity, setNodes, warnSupersededResultOnce]);

    const recoverAndCompleteTextTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["textTask"]>, controller: AbortController, prompt?: string, identity = canvasTaskCommitIdentityByTargetRef.current.get(nodeId) || captureCanvasTaskIdentity(nodeId, nodeId)) => {
            const recovered = await recoverTextGenerationTask(task.id, { signal: controller.signal });
            if (!canvasTaskCommitGuard({ ...identity, taskId: recovered.id })) return;
            if (!attachCanvasTaskId(nodeId, recovered.id, identity)) return;
            setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, textTask: { id: recovered.id, model: recovered.model }, errorDetails: undefined } } : node)));
            return completeTextTask(nodeId, generationConfig, recovered, controller, prompt, { ...identity, taskId: recovered.id });
        },
        [attachCanvasTaskId, canvasTaskCommitGuard, captureCanvasTaskIdentity, completeTextTask, setNodes],
    );

    const completeAudioTask = useCallback(async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["audioTask"]>, controller: AbortController, prompt?: string, identity = canvasTaskCommitIdentityByTargetRef.current.get(nodeId) || captureCanvasTaskIdentity(nodeId, nodeId)) => {
        const audio = await storeGeneratedAudio(await waitForAudioGenerationTask(generationConfig, task, { signal: controller.signal, readProgress }), generationConfig.audioFormat);
        if (!canvasTaskCommitGuard({ ...identity, taskId: task.id })) { warnSupersededResultOnce(identity); return; }
        if (!attachCanvasTaskId(nodeId, task.id, identity)) return;
        setNodes((prev) =>
            prev.map((node) =>
                node.id === nodeId
                    ? {
                          ...node,
                          metadata: {
                              ...node.metadata,
                              ...audioMetadata(audio),
                              prompt: prompt || node.metadata?.prompt,
                              audioTask: undefined,
                              errorDetails: undefined,
                          },
                      }
                    : node,
            ),
        );
    }, [attachCanvasTaskId, canvasTaskCommitGuard, captureCanvasTaskIdentity, setNodes, warnSupersededResultOnce]);

    const recoverAndCompleteAudioTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["audioTask"]>, controller: AbortController, prompt?: string, identity = canvasTaskCommitIdentityByTargetRef.current.get(nodeId) || captureCanvasTaskIdentity(nodeId, nodeId)) => {
            const recovered = await recoverAudioGenerationTask(task.id, { signal: controller.signal });
            if (!canvasTaskCommitGuard({ ...identity, taskId: recovered.id })) return;
            if (!attachCanvasTaskId(nodeId, recovered.id, identity)) return;
            setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, audioTask: { id: recovered.id, model: recovered.model }, errorDetails: undefined } } : node)));
            return completeAudioTask(nodeId, generationConfig, recovered, controller, prompt, { ...identity, taskId: recovered.id });
        },
        [attachCanvasTaskId, canvasTaskCommitGuard, captureCanvasTaskIdentity, completeAudioTask, setNodes],
    );
    return {
        createHistoryEntry,
        startGenerationRequest,
        finishGenerationRequest,
        stopGenerationByRunningId,
        confirmStopGeneration,
        completeVideoTask,
        recoverAndCompleteVideoTask,
        completeImageTask,
        startAndCompleteImageTask,
        recoverAndCompleteImageTask,
        completeTextTask,
        recoverAndCompleteTextTask,
        completeAudioTask,
        recoverAndCompleteAudioTask,
        captureCanvasTaskIdentity,
        registerCanvasTaskIdentity,
        beginCanvasTaskAttempt,
        attachCanvasTaskId,
        canvasTaskCommitGuard,
        warnSupersededResultOnce,
        readProgress,
    };
}

export type CanvasTaskRuntime = ReturnType<typeof useCanvasTaskRuntime>;
