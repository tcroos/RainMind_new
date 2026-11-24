"use client";

import { useCallback, useEffect, useRef } from "react";

import { clipboardImageFiles } from "@/lib/clipboard-image-files";
import { uploadMediaFile } from "@/services/file-storage";
import { NODE_DEFAULT_SIZE } from "../constants";
import { CanvasNodeType, type CanvasNodeMetadata, type Position } from "../types";
import { nodeSizeFromAspect, videoNodeSizeFromNatural } from "../utils/canvas-node-size";

import { CANVAS_DROP_NODE_OFFSET, NODE_STATUS_SUCCESS, createCanvasNode } from "./canvas-page-elements";
import { audioMetadata, imageMetadata, uploadCanvasImage, videoMetadata } from "./canvas-page-utils";

import type { CanvasInteractions } from "./use-canvas-interactions";
import type { CanvasPageState } from "./use-canvas-page-state";

export function useCanvasFileActions({ state, interactions }: { state: CanvasPageState; interactions: CanvasInteractions }) {
    const {
        message,
        setNodes,
        size,
        setSelectedNodeIds,
        selectedConnectionId,
        setSelectedConnectionId,
        setHoveredNodeId,
        setPendingConnectionCreate,
        setContextMenu,
        setToolbarNodeId,
        setDialogNodeId,
        setEditingNodeId,
        setInfoNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        setEmotionNodeId,
        nodesRef,
        selectedNodeIds,
    } = state;
    const { getCanvasCenter, deleteNodes, deleteConnection, copySelectedNodes, pasteCopiedNodes, undoCanvas, redoCanvas } = interactions;

    const pendingUploadsRef = useRef(new Map<string, { file: File; type: CanvasNodeType }>());
    const uploadFileNode = useCallback(
        async (id: string, file: File, type: CanvasNodeType) => {
            setNodes((prev) => prev.map((node) => (node.id === id ? { ...node, metadata: { ...node.metadata, status: "loading", uploadState: "uploading", errorDetails: undefined } } : node)));
            try {
                let metadata: CanvasNodeMetadata;
                let nextSize = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                if (type === CanvasNodeType.Image) {
                    const image = await uploadCanvasImage(file);
                    metadata = imageMetadata(image);
                    nextSize = { ...nextSize, ...nodeSizeFromAspect(image.width, image.height) };
                } else {
                    const media = await uploadMediaFile(file, type === CanvasNodeType.Video ? "video" : "audio");
                    metadata = type === CanvasNodeType.Video ? videoMetadata(media) : audioMetadata(media);
                    if (type === CanvasNodeType.Video) nextSize = { ...nextSize, ...videoNodeSizeFromNatural(media.width || 1280, media.height || 720) };
                }
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === id
                            ? {
                                  ...node,
                                  position: { x: node.position.x + (node.width - nextSize.width) / 2, y: node.position.y + (node.height - nextSize.height) / 2 },
                                  width: nextSize.width,
                                  height: nextSize.height,
                                  metadata,
                              }
                            : node,
                    ),
                );
                pendingUploadsRef.current.delete(id);
                return id;
            } catch (error) {
                setNodes((prev) => prev.map((node) => (node.id === id ? { ...node, metadata: { ...node.metadata, status: "error", uploadState: "failed", errorDetails: error instanceof Error ? error.message : "文件上传失败" } } : node)));
                throw error;
            }
        },
        [setNodes],
    );
    const createFileNode = useCallback(
        (file: File, type: CanvasNodeType, position: Position, preserveSelection: boolean, openDialog: boolean) => {
            const node = { ...createCanvasNode(type, position, { status: "loading", uploadState: "uploading" }), title: file.name };
            pendingUploadsRef.current.set(node.id, { file, type });
            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds((current) => (preserveSelection ? new Set([...current, node.id]) : new Set([node.id])));
            setSelectedConnectionId(null);
            if (openDialog) setDialogNodeId(node.id);
            return uploadFileNode(node.id, file, type);
        },
        [setNodes, setSelectedNodeIds, setSelectedConnectionId, setDialogNodeId, uploadFileNode],
    );
    const createImageFileNode = useCallback((file: File, position: Position, preserveSelection = false, openDialog = true) => createFileNode(file, CanvasNodeType.Image, position, preserveSelection, openDialog), [createFileNode]);
    const createVideoFileNode = useCallback((file: File, position: Position, preserveSelection = false, openDialog = true) => createFileNode(file, CanvasNodeType.Video, position, preserveSelection, openDialog), [createFileNode]);
    const createAudioFileNode = useCallback((file: File, position: Position, preserveSelection = false) => createFileNode(file, CanvasNodeType.Audio, position, preserveSelection, false), [createFileNode]);
    const retryFileUpload = useCallback(
        (nodeId: string) => {
            const pending = pendingUploadsRef.current.get(nodeId);
            if (pending) void uploadFileNode(nodeId, pending.file, pending.type).catch(() => undefined);
            else {
                state.uploadTargetRef.current = { nodeId };
                state.imageInputRef.current?.click();
            }
        },
        [state.uploadTargetRef, state.imageInputRef, uploadFileNode],
    );

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || "剪切板文本",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter],
    );

    useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom]")) return;
            if (!event.clipboardData) return;
            const images = clipboardImageFiles(event.clipboardData);
            if (images.length) {
                event.preventDefault();
                setSelectedNodeIds(new Set());
                const center = getCanvasCenter();
                void Promise.allSettled(images.map((file, index) => createImageFileNode(file, { x: center.x + index * CANVAS_DROP_NODE_OFFSET, y: center.y + index * CANVAS_DROP_NODE_OFFSET }, true, false))).then((results) => {
                    const failures = results.filter((result) => result.status === "rejected");
                    if (failures.length) message.error(failures.length === images.length ? "剪切板图片添加失败" : `有 ${failures.length} 张剪切板图片添加失败`);
                    if (failures.length < images.length) message.success(`已从剪切板添加 ${images.length - failures.length} 张图片`);
                });
                return;
            }
            const text = event.clipboardData?.getData("text/plain") || "";
            if (!text.trim()) return;
            event.preventDefault();
            if (createTextNodeFromClipboard(text)) message.success("已从剪切板添加文本");
        };

        window.addEventListener("paste", handlePaste);
        return () => window.removeEventListener("paste", handlePaste);
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message, setSelectedNodeIds]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.defaultPrevented) return;
            if (event.key === "Escape") {
                if (document.querySelector(".ant-modal-wrap:not([style*='display: none']),.ant-popover:not(.ant-popover-hidden),[data-canvas-resource-mention-menu]")) return;
                setDialogNodeId(null);
            }
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom]")) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                if (pasteCopiedNodes()) event.preventDefault();
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIds.size || selectedConnectionId) event.preventDefault();
                if (selectedNodeIds.size) {
                    deleteNodes(new Set(selectedNodeIds));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setEmotionNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, deleteNodes, pasteCopiedNodes, redoCanvas, selectedConnectionId, selectedNodeIds, undoCanvas]);
    return {
        createImageFileNode,
        createVideoFileNode,
        createAudioFileNode,
        createTextNodeFromClipboard,
        retryFileUpload,
    };
}

export type CanvasFileActions = ReturnType<typeof useCanvasFileActions>;
