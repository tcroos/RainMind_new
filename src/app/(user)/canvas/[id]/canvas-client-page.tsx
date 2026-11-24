"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Modal } from "antd";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { CanvasConfigComposer } from "../components/canvas-config-composer";
import { CanvasConfigNodePanel } from "../components/canvas-config-node-panel";
import { CanvasNodeContextMenu } from "../components/canvas-context-menu";
import { CanvasAssetsPanel } from "../components/canvas-assets-panel";
import { CanvasSurface, type CanvasInteractionMode } from "../components/canvas-surface";
import { CanvasNodeAngleDialog } from "../components/canvas-node-angle-dialog";
import { CanvasNodeEmotionDialog } from "../components/canvas-node-emotion-dialog";
import { CanvasNodeCropDialog } from "../components/canvas-node-crop-dialog";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "../components/canvas-node-hover-toolbar";
import { CanvasNodeMaskEditDialog } from "../components/canvas-node-mask-edit-dialog";
import { CanvasNodePromptPanel } from "../components/canvas-node-prompt-panel";
import { CanvasNodeSplitDialog } from "../components/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog } from "../components/canvas-node-upscale-dialog";
import { CanvasToolbar } from "../components/canvas-toolbar";
import { CanvasShortcutsDialog } from "../components/canvas-shortcuts-dialog";
import { CanvasTopBar } from "../components/canvas-top-bar";
import { CanvasZoomControls } from "../components/canvas-zoom-controls";
import { CanvasNodeType, type CanvasNodeData, type Position } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { applyNodeGroup, buildGroupLabels } from "../utils/canvas-node-group";
import { arrangeCanvasNodes, type CanvasArrangeMode } from "../utils/canvas-node-arrange";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
import { CanvasConnectionMenuErrorBoundary, CanvasRefreshShell, ConnectionCreateMenu, NodeCreateMenu } from "./canvas-page-elements";
import { getInputSummary, isHiddenBatchChild } from "./canvas-page-utils";

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <VozebProCanvasPage />;
}

import { useCanvasPageController } from "./use-canvas-page-controller";

function VozebProCanvasPage() {
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>("select");
    const [entryReady, setEntryReady] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [agentDocked, setAgentDocked] = useState(false);
    const controller = useCanvasPageController();
    const hoverCommitHandleRef = useRef<number | null>(null);
    const queuedHoveredNodeIdRef = useRef<string | null>(null);
    const {
        message,
        modal,
        params,
        router,
        projectId,
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
        loadProject,
        createProject,
        updateProject,
        flushProjectSave,
        projectSaveState,
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
        setSize,
        viewport,
        setViewport,
        selectedNodeIds,
        setSelectedNodeIds,
        selectedConnectionId,
        setSelectedConnectionId,
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
        paletteStyle,
        showImageInfo,
        setShowImageInfo,
        clearConfirmOpen,
        setClearConfirmOpen,
        assetPickerOpen,
        setAssetPickerOpen,
        projectLoaded,
        projectLoadError,
        retryProjectLoad,
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
        emotionNodeId,
        setEmotionNodeId,
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
        resumingImageTaskIdsRef,
        resumingVideoTaskIdsRef,
        resumingTextTaskIdsRef,
        resumingAudioTaskIdsRef,
        createHistoryEntry,
        startGenerationRequest,
        finishGenerationRequest,
        stopGenerationByRunningId,
        confirmStopGeneration,
        completeVideoTask,
        completeImageTask,
        startAndCompleteImageTask,
        completeTextTask,
        completeAudioTask,
        getCanvasCenter,
        keepNodeToolbar,
        connectNodes,
        connectNodesBatch,
        createConnectedNode,
        cancelPendingConnectionCreate,
        toolbarNode,
        infoNode,
        cropNode,
        maskEditNode,
        splitNode,
        upscaleNode,
        angleNode,
        emotionNode,
        previewNode,
        hasMultipleSelectedNodes,
        activeNodeId,
        batchChildCountById,
        batchMotionById,
        relatedHighlight,
        configInputsById,
        resourceContextNodeId,
        canvasResourceReferences,
        resourceReferenceByNodeId,
        mentionReferencesByNodeId,
        agentSnapshot,
        applyAgentOps,
        createNode,
        deleteNodes,
        deleteConnection,
        deselectCanvas,
        clearCanvas,
        duplicateNode,
        copySelectedNodes,
        pasteCopiedNodes,
        resetViewport,
        locateCanvasNode,
        setZoomScale,
        applyHistory,
        undoCanvas,
        redoCanvas,
        autoLayout,
        createAndOpenProject,
        deleteCurrentProject,
        createImageFileNode,
        createVideoFileNode,
        createAudioFileNode,
        retryFileUpload,
        createTextNodeFromClipboard,
        handleImageDimensions,
        toggleNodeFreeResize,
        handleNodeContentChange,
        toggleBatchExpanded,
        setBatchPrimary,
        openTextEditor,
        handleNodePromptChange,
        handleConfigNodeChange,
        downloadNodeImage,
        downloadSelectedMedia,
        selectedMediaCount,
        selectedMediaDownloadPending,
        saveNodeAsset,
        createImageReversePromptNodes,
        appendDerivedImageNode,
        cropImageNode,
        splitImageNode,
        splitImageLayers,
        removeBackgroundImageNode,
        maskEditImageNode,
        emotionEditImageNode,
        upscaleImageNode,
        generateAngleNode,
        handleFontSizeChange,
        handleUploadRequest,
        handleImageInputChange,
        handleDrop,
        pasteAssistantImage,
        handleAssistantSessionsChange,
        startTitleEditing,
        finishTitleEditing,
        preventCanvasContextMenu,
        handleGenerateNode,
        handleRetryNode,
        generateImageFromTextNode,
        insertAssistantImage,
        insertAssistantText,
        handleAssetInsert,
        assistantOpen,
        openAgent,
        closeAgent,
    } = controller;

    /* 用户点中节点即视为已经找到目标，小地图自动收起，不用再手动关 */
    const previousSelectedNodeIdsRef = useRef<Set<string> | null>(null);
    useEffect(() => {
        const previous = previousSelectedNodeIdsRef.current;
        previousSelectedNodeIdsRef.current = selectedNodeIds;
        if (!previous || previous === selectedNodeIds) return;
        const pickedNewNode = Array.from(selectedNodeIds).some((id) => !previous.has(id));
        if (pickedNewNode && isMiniMapOpen) setIsMiniMapOpen(false);
    }, [selectedNodeIds, isMiniMapOpen, setIsMiniMapOpen]);

    useEffect(() => {
        if (!nodeCreatePosition && !pendingConnectionCreate) return;
        const dismiss = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest("[data-canvas-node-create-menu], [data-connection-create-menu]")) return;
            setNodeCreatePosition(null);
            setPendingConnectionCreate(null);
        };
        window.addEventListener("pointerdown", dismiss, true);
        return () => window.removeEventListener("pointerdown", dismiss, true);
    }, [nodeCreatePosition, pendingConnectionCreate, setPendingConnectionCreate]);
    useEffect(() => {
        const preventPageZoom = (event: WheelEvent) => {
            if (event.ctrlKey || event.metaKey) event.preventDefault();
        };
        document.addEventListener("wheel", preventPageZoom, { passive: false, capture: true });
        return () => document.removeEventListener("wheel", preventPageZoom, true);
    }, []);
    useEffect(() => {
        if (!projectLoaded) {
            setEntryReady(false);
            return;
        }
        let disposed = false;
        const startedAt = Date.now();
        let minTimer = 0;
        const finish = () => {
            if (disposed) return;
            disposed = true;
            setEntryReady(true);
        };
        const deadline = window.setTimeout(finish, 3000);
        const waitForVisibleImages = async () => {
            // Two frames let the canvas mount and lazy image nodes render.
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            if (disposed) return;
            const root = containerRef.current;
            const images = root
                ? Array.from(root.querySelectorAll<HTMLImageElement>("img[data-canvas-image]")).filter((image) => {
                      const rect = image.getBoundingClientRect();
                      return rect.width > 0 && rect.height > 0 && rect.left < window.innerWidth && rect.right > 0 && rect.top < window.innerHeight && rect.bottom > 0;
                  })
                : [];
            await Promise.all(
                images.map((image) => {
                    if (image.complete) return image.decode?.().catch(() => undefined) ?? Promise.resolve();
                    return new Promise<void>((resolve) => {
                        const done = () => resolve();
                        image.addEventListener("load", done, { once: true });
                        image.addEventListener("error", done, { once: true });
                    });
                }),
            );
            if (disposed) return;
            minTimer = window.setTimeout(finish, Math.max(0, 350 - (Date.now() - startedAt)));
        };
        void waitForVisibleImages();
        return () => {
            disposed = true;
            clearTimeout(deadline);
            clearTimeout(minTimer);
        };
    }, [projectId, projectLoaded, containerRef]);
    useEffect(() => {
        if (!userId) return;
        try {
            setInteractionMode(localStorage.getItem(`canvas:interaction:${userId}`) === "pan" ? "pan" : "select");
        } catch {
            /* Device preferences may be unavailable. */
        }
    }, [userId]);
    const scheduleHoveredNode = useCallback(
        (nodeId: string | null) => {
            queuedHoveredNodeIdRef.current = nodeId;
            if (hoverCommitHandleRef.current !== null) return;
            const commit = () => {
                hoverCommitHandleRef.current = null;
                setHoveredNodeId(queuedHoveredNodeIdRef.current);
            };
            const requestIdle = (window as Window & { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback;
            hoverCommitHandleRef.current = requestIdle ? requestIdle(commit) : requestAnimationFrame(commit);
        },
        [setHoveredNodeId],
    );
    useEffect(
        () => () => {
            if (hoverCommitHandleRef.current === null) return;
            const cancelIdle = (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
            if (cancelIdle) cancelIdle(hoverCommitHandleRef.current);
            else cancelAnimationFrame(hoverCommitHandleRef.current);
        },
        [],
    );
    const hiddenCanvasNodeIds = useMemo(() => new Set(nodes.filter((node) => isHiddenBatchChild(node, nodes, collapsingBatchIds)).map((node) => node.id)), [collapsingBatchIds, nodes]);
    const emptyMentionReferences = useMemo<CanvasResourceReference[]>(() => [], []);
    const handleHoverStart = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current) return;
            scheduleHoveredNode(nodeId);
        },
        [scheduleHoveredNode],
    );
    const handleHoverEnd = useCallback(
        (nodeId: string) => {
            if (queuedHoveredNodeIdRef.current === nodeId) scheduleHoveredNode(null);
        },
        [scheduleHoveredNode],
    );
    const handlePromptSuggestion = useCallback(
        (nodeId: string, prompt: string) => {
            handleNodePromptChange(nodeId, prompt);
            setSelectedNodeIds(new Set([nodeId]));
            setDialogNodeId(nodeId);
        },
        [handleNodePromptChange],
    );
    const handleNodeRetryAction = useCallback((node: CanvasNodeData) => (node.metadata?.uploadState ? retryFileUpload(node.id) : void handleRetryNode(node)), [handleRetryNode, retryFileUpload]);
    const handleOpenPanel = useCallback((node: CanvasNodeData) => {
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setToolbarNodeId(node.id);
        setDialogNodeId(node.id);
    }, []);
    const handleViewImage = useCallback((node: CanvasNodeData) => setPreviewNodeId(node.id), []);
    const handleRemoveReferences = useCallback((ids: string[]) => setConnections((current) => current.filter((connection) => !ids.includes(connection.id))), []);
    const handleGroupNodes = useCallback(
        (ids: string[]) => {
            if (ids.length < 2) return;
            const nextNodes = applyNodeGroup(nodesRef.current, ids, `group-${crypto.randomUUID()}`);
            setNodes(nextNodes);
            updateProject(projectId, { nodes: nextNodes });
            void flushProjectSave(projectId);
        },
        [projectId, setNodes, updateProject, flushProjectSave],
    );
    const handleUngroupNodes = useCallback(
        (ids: string[]) => {
            const nextNodes = applyNodeGroup(nodesRef.current, ids, null);
            setNodes(nextNodes);
            updateProject(projectId, { nodes: nextNodes });
            void flushProjectSave(projectId);
        },
        [projectId, setNodes, updateProject, flushProjectSave],
    );

    /* 多选悬浮工具栏的动作 —— 与底部工具栏复用同一批页面层回调 */
    const handleSaveAssets = useCallback(
        (ids: string[]) => {
            const byId = new Map(nodesRef.current.map((node) => [node.id, node]));
            const targets = ids.map((id) => byId.get(id)).filter((node): node is CanvasNodeData => Boolean(node));
            void Promise.allSettled(targets.map((node) => saveNodeAsset(node))).then((results) => {
                const failed = results.filter((result) => result.status === "rejected").length;
                if (failed) message.warning(`${failed} 项保存失败，其余已加入素材`);
            });
        },
        [message, nodesRef, saveNodeAsset],
    );

    const handleDuplicateSelection = useCallback(
        (ids: string[]) => {
            const idSet = new Set(ids);
            const sources = nodesRef.current.filter((node) => idSet.has(node.id));
            if (!sources.length) return;
            const right = Math.max(...sources.map((node) => node.position.x + node.width));
            const groupId = sources.some((node) => node.metadata?.groupId) ? `group-${crypto.randomUUID()}` : undefined;
            const copies: CanvasNodeData[] = sources.map((node) => ({
                ...node,
                id: `${node.type}-${crypto.randomUUID()}`,
                title: `${node.title} 副本`,
                position: { x: node.position.x + right + 36, y: node.position.y },
                metadata: {
                    ...node.metadata,
                    ...(groupId ? { groupId } : {}),
                    imageTask: undefined,
                    videoTask: undefined,
                    videoTaskRequest: undefined,
                    audioTask: undefined,
                    textTask: undefined,
                    uploadState: undefined,
                    errorDetails: undefined,
                    status: node.metadata?.content ? ("success" as const) : ("idle" as const),
                    isBatchRoot: false,
                    batchChildIds: undefined,
                    batchRootId: undefined,
                    primaryImageId: undefined,
                    imageBatchExpanded: false,
                },
            }));
            const nextNodes = [...nodesRef.current, ...copies];
            setNodes(nextNodes);
            updateProject(projectId, { nodes: nextNodes });
            void flushProjectSave(projectId);
            setSelectedNodeIds(new Set(copies.map((node) => node.id)));
            setToolbarNodeId(null);
        },
        [flushProjectSave, nodesRef, projectId, setNodes, setSelectedNodeIds, setToolbarNodeId, updateProject],
    );

    const handleRunSelection = useCallback(
        (ids: string[]) => {
            const idSet = new Set(ids);
            const targets = nodesRef.current.filter((node) => idSet.has(node.id) && Boolean(node.metadata?.composerContent || node.metadata?.prompt));
            if (!targets.length) {
                message.info("所选节点没有可执行的提示词");
                return;
            }
            void Promise.allSettled(targets.map((node) => handleGenerateNode(node.id, node.metadata?.generationMode || "image", node.metadata?.composerContent ?? node.metadata?.prompt ?? ""))).then((results) => {
                const failed = results.filter((result) => result.status === "rejected").length;
                if (failed) message.warning(`${failed} 项执行失败`);
            });
        },
        [handleGenerateNode, message, nodesRef],
    );

    const handleArrangeSelection = useCallback(
        (ids: string[], mode: CanvasArrangeMode) => {
            const updates = arrangeCanvasNodes(nodesRef.current, ids, mode);
            if (!updates.length) return;
            const updatesById = new Map(updates.map((update) => [update.id, update.position]));
            const nextNodes = nodesRef.current.map((node) => (updatesById.has(node.id) ? { ...node, position: updatesById.get(node.id)! } : node));
            setNodes(nextNodes);
            updateProject(projectId, { nodes: nextNodes });
            void flushProjectSave(projectId);
        },
        [flushProjectSave, nodesRef, projectId, setNodes, updateProject],
    );

    const groupLabels = useMemo(() => buildGroupLabels(nodes), [nodes]);
    const selectionActions = useMemo(
        () => ({
            onSaveAssets: handleSaveAssets,
            onDuplicate: handleDuplicateSelection,
            onDownload: () => void downloadSelectedMedia(),
            onRun: handleRunSelection,
            onAddMaterial: () => setAssetPickerOpen(true),
            onDelete: (ids: string[]) => deleteNodes(new Set(ids)),
            onArrange: handleArrangeSelection,
        }),
        [deleteNodes, downloadSelectedMedia, handleArrangeSelection, handleDuplicateSelection, handleRunSelection, handleSaveAssets, setAssetPickerOpen],
    );
    const handleImageSettingsOpenChange = useCallback((open: boolean) => {
        setNodeImageSettingsOpen(open);
        if (open) setToolbarNodeId(null);
    }, []);
    const renderCanvasConfigGenerate = useCallback(
        (nodeId: string) => {
            const target = nodesRef.current.find((item) => item.id === nodeId);
            void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
        },
        [handleGenerateNode],
    );
    const renderCanvasConfigComposer = useCallback(
        (panelNode: CanvasNodeData) => (
            <CanvasConfigComposer
                value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                inputs={configInputsById.get(panelNode.id) || []}
                onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                onClose={() => setDialogNodeId(null)}
            />
        ),
        [configInputsById, handleConfigNodeChange],
    );
    const renderCanvasPromptPanel = useCallback(
        (panelNode: CanvasNodeData) => (
            <CanvasNodePromptPanel
                node={panelNode}
                isRunning={runningNodeId === panelNode.id}
                mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || emptyMentionReferences}
                onLocateReference={locateCanvasNode}
                onRemoveReference={handleRemoveReferences}
                onPromptChange={handleNodePromptChange}
                onConfigChange={handleConfigNodeChange}
                onGenerate={handleGenerateNode}
                onStop={confirmStopGeneration}
                onImageSettingsOpenChange={handleImageSettingsOpenChange}
            />
        ),
        [confirmStopGeneration, emptyMentionReferences, handleConfigNodeChange, handleGenerateNode, handleImageSettingsOpenChange, handleNodePromptChange, handleRemoveReferences, locateCanvasNode, mentionReferencesByNodeId, runningNodeId],
    );
    const renderCanvasPanel = useCallback((panelNode: CanvasNodeData) => (panelNode.type === CanvasNodeType.Config ? renderCanvasConfigComposer(panelNode) : renderCanvasPromptPanel(panelNode)), [renderCanvasConfigComposer, renderCanvasPromptPanel]);
    const renderCanvasNodePanel = useCallback(
        (contentNode: CanvasNodeData) => (
            <CanvasConfigNodePanel
                node={contentNode}
                isRunning={runningNodeId === contentNode.id}
                inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                references={mentionReferencesByNodeId.get(contentNode.id) || emptyMentionReferences}
                onConfigChange={handleConfigNodeChange}
                onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                onStop={confirmStopGeneration}
                onGenerate={renderCanvasConfigGenerate}
            />
        ),
        [configInputsById, confirmStopGeneration, emptyMentionReferences, handleConfigNodeChange, mentionReferencesByNodeId, renderCanvasConfigGenerate, runningNodeId],
    );
    const renderCanvasNodeContent = useCallback((contentNode: CanvasNodeData) => renderCanvasNodePanel(contentNode), [renderCanvasNodePanel]);

    const canvasNodeProps = useMemo(
        () => ({
            onHoverStart: handleHoverStart,
            onHoverEnd: handleHoverEnd,
            onContentChange: handleNodeContentChange,
            onPromptSuggestion: handlePromptSuggestion,
            onToggleBatch: toggleBatchExpanded,
            onSetBatchPrimary: setBatchPrimary,
            onRetry: handleNodeRetryAction,
            onGenerateImage: generateImageFromTextNode,
            onOpenPanel: handleOpenPanel,
            onImageDimensions: handleImageDimensions,
            onViewImage: handleViewImage,
        }),
        [generateImageFromTextNode, handleHoverEnd, handleHoverStart, handleImageDimensions, handleNodeContentChange, handleNodeRetryAction, handleOpenPanel, handlePromptSuggestion, handleViewImage, setBatchPrimary, toggleBatchExpanded],
    );
    const getCanvasNodeViewProps = useCallback(
        (node: CanvasNodeData) => ({
            editRequestNonce: editingNodeId === node.id ? editRequestNonce : 0,
            showPanel: dialogNodeId === node.id,
            batchCount: batchChildCountById.get(node.id) || 0,
            batchExpanded: Boolean(node.metadata?.imageBatchExpanded),
            batchClosing: Boolean(node.metadata?.batchRootId && collapsingBatchIds.has(node.metadata.batchRootId)),
            batchOpening: openingBatchIds.has(node.id),
            batchRecovering: collapsingBatchIds.has(node.id),
            batchMotion: batchMotionById.get(node.id),
            showImageInfo,
            resourceLabel: resourceReferenceByNodeId.get(node.id),
            mentionReferences: mentionReferencesByNodeId.get(node.id) || emptyMentionReferences,
        }),
        [batchChildCountById, batchMotionById, collapsingBatchIds, dialogNodeId, editingNodeId, editRequestNonce, emptyMentionReferences, mentionReferencesByNodeId, openingBatchIds, resourceReferenceByNodeId, showImageInfo],
    );

    if (!projectLoaded)
        return projectLoadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3" style={{ background: theme.canvas.backdrop, color: theme.node.text }}>
                <span role="alert">项目加载失败：{projectLoadError}</span>
                <div className="flex gap-3">
                    <Button icon={<RotateCcw className="size-4" />} onClick={retryProjectLoad}>
                        重新加载
                    </Button>
                    <Button onClick={() => router.push("/canvas")}>返回画布列表</Button>
                </div>
            </div>
        ) : (
            <CanvasRefreshShell />
        );
    return (
        <main className="flex h-full min-h-0 w-full min-w-0 max-w-full overflow-hidden" style={{ ...paletteStyle, background: theme.canvas.backdrop, color: theme.node.text }}>
            {!entryReady ? (
                <div role="status" aria-label="项目正在加载中" className="fixed inset-0 z-[1500] flex flex-col items-center justify-center gap-4" style={{ background: theme.canvas.backdrop, color: theme.node.text }}>
                    <LoaderCircle className="size-8 animate-spin" />
                    <span className="text-sm">项目正在加载中...</span>
                </div>
            ) : null}
            <CanvasAssetsPanel
                open={assetPickerOpen}
                projectId={projectId}
                projectTitle={currentProject?.title || "未命名画布"}
                nodes={nodes}
                onOpenProject={(id) => {
                    void loadProject(id).catch(() => undefined);
                    router.push(`/canvas/${id}`);
                }}
                onOpenProjects={() => router.push("/canvas")}
                onCreateProject={createAndOpenProject}
                onInsertAsset={handleAssetInsert}
                onInsertPrompt={insertAssistantText}
                onLocateNode={locateCanvasNode}
                onClose={() => setAssetPickerOpen(false)}
            />
            <section className="relative min-w-0 max-w-full flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProject?.title || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    saveState={projectSaveState}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onWorkbench={() => router.push("/create")}
                    onDeleteProject={deleteCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    assetsOpen={assetPickerOpen}
                    onToggleAssets={() => setAssetPickerOpen((value) => !value)}
                />

                <CanvasSurface
                    onConnectStart={() => {
                        setDialogNodeId(null);
                        setToolbarNodeId(null);
                        setHoveredNodeId(null);
                        setNodeImageSettingsOpen(false);
                        setEditingNodeId(null);
                        setInfoNodeId(null);
                        setCropNodeId(null);
                        setMaskEditNodeId(null);
                        setSplitNodeId(null);
                        setUpscaleNodeId(null);
                        setAngleNodeId(null);
                        setEmotionNodeId(null);
                        setPreviewNodeId(null);
                        setAssetPickerOpen(false);
                        setContextMenu(null);
                        setNodeCreatePosition(null);
                        closeAgent();
                    }}
                    pendingConnectionCreate={pendingConnectionCreate}
                    containerRef={containerRef}
                    nodes={nodes}
                    hiddenNodeIds={hiddenCanvasNodeIds}
                    connections={connections}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    interactionMode={interactionMode}
                    minimapOpen={isMiniMapOpen}
                    selectedNodeIds={selectedNodeIds}
                    selectedConnectionId={selectedConnectionId}
                    relatedNodeIds={relatedHighlight.nodeIds}
                    relatedConnectionIds={relatedHighlight.connectionIds}
                    nodeProps={canvasNodeProps}
                    getNodeViewProps={getCanvasNodeViewProps}
                    renderPanel={renderCanvasPanel}
                    renderNode={renderCanvasNodeContent}
                    onGroupNodes={handleGroupNodes}
                    onUngroupNodes={handleUngroupNodes}
                    groupLabels={groupLabels}
                    selectionActions={selectionActions}
                    onNodesCommit={(updates) => {
                        const updatesById = new Map(updates.map((update) => [update.id, update]));
                        const nextNodes = nodesRef.current.map((node) => {
                            const update = updatesById.get(node.id);
                            return update
                                ? {
                                      ...node,
                                      position: update.position ?? node.position,
                                      width: update.width ?? node.width,
                                      height: update.height ?? node.height,
                                  }
                                : node;
                        });
                        setNodes(nextNodes);
                        updateProject(projectId, { nodes: nextNodes });
                        void flushProjectSave(projectId);
                    }}
                    onSelectionChange={(nodeIds, connectionId) => {
                        setSelectedNodeIds(nodeIds);
                        setSelectedConnectionId(connectionId);
                        setToolbarNodeId(nodeIds.size === 1 && !connectionId ? Array.from(nodeIds)[0] : null);
                        setContextMenu(null);
                    }}
                    onViewportCommit={(next) => {
                        setViewport(next);
                        setContextMenu(null);
                        setNodeCreatePosition(null);
                    }}
                    onConnect={({ source, target }) => connectNodes({ nodeId: source, handleType: "source" }, target)}
                    onConnectBatch={connectNodesBatch}
                    onConnectionCreate={({ nodeId, handleType, position, sourceNodeIds }) => setPendingConnectionCreate({ connection: { nodeId, handleType }, position, sourceNodeIds })}
                    onPaneClick={() => {
                        setNodeCreatePosition(null);
                        setDialogNodeId(null);
                        deselectCanvas();
                        pauseCanvasVideos();
                    }}
                    onPaneDoubleClick={(position) => {
                        setContextMenu(null);
                        setDialogNodeId(null);
                        setNodeCreatePosition(position);
                    }}
                    onPaneContextMenu={(event) => preventCanvasContextMenu(event as React.MouseEvent)}
                    onNodeContextMenu={(event, id) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDialogNodeId(null);
                        setEditingNodeId(null);
                        setToolbarNodeId(null);
                        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
                    }}
                    onEdgeContextMenu={(event, id) => {
                        setSelectedConnectionId(id);
                        setSelectedNodeIds(new Set());
                        setToolbarNodeId(null);
                        setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: id });
                    }}
                    onEdgeCut={(id) => {
                        deleteConnection(id);
                        message.info("已切断参考，Ctrl+Z 可撤销");
                    }}
                    onDrop={(event) => handleDrop(event as React.DragEvent<HTMLDivElement>)}
                    onSizeChange={setSize}
                    onDragStateChange={(dragging) => {
                        nodeDraggingRef.current = dragging;
                        setIsNodeDragging(dragging);
                        if (dragging) {
                            setDialogNodeId(null);
                            setToolbarNodeId(null);
                            setNodeImageSettingsOpen(false);
                        }
                    }}
                    onViewportInteractionChange={(interacting) => {
                        nodeDraggingRef.current = interacting;
                    }}
                    overlay={
                        <>
                            {pendingConnectionCreate ? (
                                <CanvasConnectionMenuErrorBoundary onClose={cancelPendingConnectionCreate}>
                                    <ConnectionCreateMenu pending={pendingConnectionCreate} scale={viewport.k} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} />
                                </CanvasConnectionMenuErrorBoundary>
                            ) : null}
                            {nodeCreatePosition ? (
                                <NodeCreateMenu
                                    position={nodeCreatePosition}
                                    scale={viewport.k}
                                    onUpload={() => {
                                        handleUploadRequest(undefined, nodeCreatePosition);
                                        setNodeCreatePosition(null);
                                    }}
                                    onCreate={(type) => {
                                        createNode(type, nodeCreatePosition);
                                        setNodeCreatePosition(null);
                                    }}
                                    onClose={() => setNodeCreatePosition(null)}
                                />
                            ) : null}
                        </>
                    }
                />

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    viewport={viewport}
                    onKeep={keepNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node).catch((error) => message.error(error instanceof Error ? error.message : "素材保存失败"))}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onSplitLayers={(node) => void splitImageLayers(node).catch((error) => message.error(error instanceof Error ? error.message : "智能分层失败"))}
                    onRemoveBackground={(node) => void removeBackgroundImageNode(node).catch((error) => message.error(error instanceof Error ? error.message : "消除背景失败"))}
                    onEmotion={(node) => setEmotionNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setUpscaleNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    selectedMediaCount={selectedMediaCount}
                    selectedMediaDownloadPending={selectedMediaDownloadPending}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    agentOpen={assistantOpen}
                    backgroundMode={backgroundMode}
                    interactionMode={interactionMode}
                    showImageInfo={showImageInfo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddPanorama={() => createNode(CanvasNodeType.Panorama)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDownloadSelectedMedia={() => void downloadSelectedMedia()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onInteractionModeChange={(mode) => {
                        setInteractionMode(mode);
                        setDialogNodeId(null);
                        if (userId) {
                            try {
                                localStorage.setItem(`canvas:interaction:${userId}`, mode);
                            } catch {
                                /* Device preferences may be unavailable. */
                            }
                        }
                    }}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                    onOpenAssets={() => {
                        setAssetPickerOpen(true);
                    }}
                    onAutoLayout={autoLayout}
                    onToggleAgent={() => (assistantOpen ? closeAgent() : openAgent())}
                    onOpenShortcuts={() => setShortcutsOpen(true)}
                />

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        onClose={() => setContextMenu(null)}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                const selectedIds = selectedNodeIdsRef.current;
                                deleteNodes(selectedIds.has(contextMenu.nodeId) ? new Set(selectedIds) : new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />

                {cropNode?.metadata?.content ? (
                    <CanvasNodeCropDialog
                        dataUrl={cropNode.metadata.content}
                        open={Boolean(cropNode)}
                        onClose={() => setCropNodeId(null)}
                        onConfirm={(crop) => void cropImageNode(cropNode!, crop).catch((error) => message.error(error instanceof Error ? error.message : "图片裁剪失败"))}
                    />
                ) : null}

                {maskEditNode?.metadata?.content ? (
                    <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} />
                ) : null}

                {splitNode?.metadata?.content ? (
                    <CanvasNodeSplitDialog
                        dataUrl={splitNode.metadata.content}
                        open={Boolean(splitNode)}
                        onClose={() => setSplitNodeId(null)}
                        onConfirm={(params) => void splitImageNode(splitNode!, params).catch((error) => message.error(error instanceof Error ? error.message : "图片切分失败"))}
                    />
                ) : null}

                {upscaleNode?.metadata?.content ? (
                    <CanvasNodeUpscaleDialog
                        dataUrl={upscaleNode.metadata.content}
                        open={Boolean(upscaleNode)}
                        onClose={() => setUpscaleNodeId(null)}
                        onConfirm={(params) => void upscaleImageNode(upscaleNode!, params).catch((error) => message.error(error instanceof Error ? error.message : "图片放大失败"))}
                    />
                ) : null}

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                {emotionNode?.metadata?.content ? (
                    <CanvasNodeEmotionDialog dataUrl={emotionNode.metadata.content} open={Boolean(emotionNode)} onClose={() => setEmotionNodeId(null)} onConfirm={(payload) => void emotionEditImageNode(emotionNode!, payload)} />
                ) : null}

                <Modal
                    title="图片详情"
                    open={Boolean(previewNode?.metadata?.content)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewNode?.metadata?.content ? <img key={previewNode.id} src={imagePreviewUrl(previewNode.metadata.content, 1920)} alt={previewNode.title || "图片"} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} /> : null}
                </Modal>

                <Modal
                    title="清空画布？"
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                清空
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
                </Modal>
            </section>
            {assistantMounted ? (
                <CanvasAssistantPanel
                    nodes={nodes}
                    selectedNodeIds={selectedNodeIds}
                    snapshot={agentSnapshot}
                    sessions={chatSessions}
                    activeSessionId={activeChatId}
                    onSelectNodeIds={setSelectedNodeIds}
                    onSessionsChange={handleAssistantSessionsChange}
                    onApplyOps={applyAgentOps}
                    onLocateNode={locateCanvasNode}
                    onPasteImage={pasteAssistantImage}
                    closing={assistantClosing}
                    onCollapse={closeAgent}
                    presentation={agentDocked ? "dock" : "float"}
                    docked={agentDocked}
                    onDock={() => setAgentDocked((value) => !value)}
                />
            ) : null}
            <CanvasShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </main>
    );
}

/**
 * Pauses every playing canvas video while keeping its current position, so clicking
 * empty space stops playback without forcing the user to hit the node again.
 */
function pauseCanvasVideos() {
    document.querySelectorAll<HTMLVideoElement>("[data-canvas-video]").forEach((video) => {
        if (!video.paused) video.pause();
    });
}
