"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { BriefcaseBusiness, ChevronRight, CircleCheck, Image as ImageIcon, ListChecks, Music2, Palette, RefreshCw, Star, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, isCanvasImageNodeType, type CanvasNodeData, type Position } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { isCanvasVideoControlPoint } from "../utils/canvas-surface-geometry";
import { shouldStartCanvasNodeResize } from "../utils/canvas-node-resize";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionBlue = "#ffffff";

function isInteractiveTarget(target: EventTarget | null, event?: Pick<MouseEvent, "clientY">) {
    if (!(target instanceof Element)) return false;
    const video = target.closest("video");
    if (video) {
        if (!(video as HTMLVideoElement).controls) return false;
        const rect = video.getBoundingClientRect();
        if (event && !isCanvasVideoControlPoint(rect, event.clientY)) return false;
        return true;
    }
    return Boolean(target.closest("button,input,textarea,select,audio,[data-canvas-no-drag]"));
}

export type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    isNear?: boolean;
    connectingHandleSide?: "left" | "right" | null;
    animateSize?: boolean;
    editRequestNonce?: number;
    showPanel: boolean;
    showImageInfo: boolean;
    resourceLabel?: CanvasResourceReference;
    mentionReferences?: CanvasResourceReference[];
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    batchCount?: number;
    batchExpanded?: boolean;
    batchClosing?: boolean;
    batchOpening?: boolean;
    batchRecovering?: boolean;
    batchMotion?: { x: number; y: number; index: number };
    loadImage?: boolean;
    onMouseDown: (event: React.MouseEvent | React.PointerEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent | React.PointerEvent, nodeId: string, handleType: "source" | "target") => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onResizeEnd?: (nodeId: string, width: number, height: number, position?: Position) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onPromptSuggestion?: (nodeId: string, prompt: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onOpenPanel?: (node: CanvasNodeData) => void;
    onImageDimensions?: (nodeId: string, naturalWidth: number, naturalHeight: number) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

import {
    NodeContent,
    nodeContentRenderers,
    BriefNodeContent,
    TaskNodeContent,
    BrandKitNodeContent,
    LoadingContent,
    ErrorContent,
    UnknownNodeContent,
    TextContent,
    ResourceLabelBadge,
    ImageNodeContent,
    EmptyImageContent,
    VideoNodeContent,
    AudioNodeContent,
    ImageContent,
    ImageInfoBar,
    BatchFrame,
    ResizeHandle,
    ConnectionHandleDot,
} from "./canvas-node-content";

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    isNear = false,
    connectingHandleSide = null,
    animateSize = true,
    editRequestNonce = 0,
    showPanel,
    showImageInfo,
    resourceLabel,
    mentionReferences = [],
    renderPanel,
    renderNodeContent,
    batchCount = 0,
    batchExpanded = false,
    batchClosing = false,
    batchOpening = false,
    batchRecovering = false,
    batchMotion,
    loadImage = true,
    onMouseDown,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResize,
    onResizeEnd,
    onContentChange,
    onPromptSuggestion,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onGenerateImage,
    onOpenPanel,
    onImageDimensions,
    onViewImage,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [hovered, setHovered] = useState(false);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [panelMounted, setPanelMounted] = useState(false);
    const nodeRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const hasImageContent = isCanvasImageNodeType(data.type) && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isConfig = data.type === CanvasNodeType.Config;
    const statusHidesContent = data.metadata?.status === "loading" || data.metadata?.status === "error" || data.metadata?.status === "needs_review" || data.metadata?.status === "cancelled";
    /* 非配置节点不再填实色：底色交给 .rm-node-glass 的 --rm-node-bg（纯中性玻璃），
     * 这样节点透出的是画布色盘，而不是一块固定的浅蓝白/深灰。 */
    const nodeBackground = isConfig ? theme.node.panel : undefined;
    const isGenerating = data.metadata?.status === "loading" || data.metadata?.uploadState === "uploading";
    const isBatchRoot = data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    /* 缩放手柄只在鼠标已经落在这个节点上、或节点被选中时才接管指针 */
    const resizeEnabled = hovered || isSelected;
    const imageBorderColor = isActive ? selectionBlue : isRelated && !isBatchChild ? theme.node.muted : theme.node.stroke;
    /* 状态描边从 border 迁移到 box-shadow：保留 border-2 占位不动盒模型，
     * 锚点/连线坐标因此零偏移，菲涅尔描边由伪元素单独绘制。 */
    const glassShadow = isConnectionTarget
        ? "0 0 0 2px #ffffff, 0 0 0 4px rgba(56, 189, 248, 0.5), 0 0 24px rgba(255, 255, 255, 0.7)"
        : ["var(--rm-node-shadow, 0 18px 38px -10px rgba(15,23,42,.14))", isActive ? `0 0 0 1.5px ${selectionBlue}` : "", isRelated && !isBatchChild ? `0 0 0 1px ${theme.node.muted}66` : ""].filter(Boolean).join(", ");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const clickStartRef = useRef<{ x: number; y: number } | null>(null);
    const resizeRef = useRef({
        isResizing: false,
        started: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
        currentWidth: 0,
        currentHeight: 0,
        currentPosition: { x: 0, y: 0 },
    });

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!editRequestNonce || data.type !== CanvasNodeType.Text) return;
        setIsEditingContent(true);
    }, [data.type, editRequestNonce]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            /* 按下后要先真正拖动一小段才算缩放；单击、手抖、以及点在角上的普通操作不会改尺寸。
             * 跨过阈值时把起点挪到当前位置，尺寸从 0 开始平滑变化，不出现突然一跳。 */
            if (!resizeRef.current.started) {
                if (!shouldStartCanvasNodeResize(event.clientX - resizeRef.current.startX, event.clientY - resizeRef.current.startY)) return;
                resizeRef.current.started = true;
                resizeRef.current.startX = event.clientX;
                resizeRef.current.startY = event.clientY;
            }

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = 220;
            const minHeight = 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            const position = {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            };
            resizeRef.current.currentWidth = width;
            resizeRef.current.currentHeight = height;
            resizeRef.current.currentPosition = position;
            onResize(data.id, width, height, position);
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        if (!resizeRef.current.isResizing) return;
        const started = resizeRef.current.started;
        resizeRef.current.isResizing = false;
        resizeRef.current.started = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
        /* 从未跨过阈值就不提交，避免单击也写一次持久化 */
        if (!started) return;
        onResizeEnd?.(data.id, resizeRef.current.currentWidth, resizeRef.current.currentHeight, resizeRef.current.currentPosition);
    }, [data.id, handleResizeMove, onResizeEnd]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        resizeRef.current = {
            isResizing: true,
            started: false,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (isCanvasImageNodeType(data.type) && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video,
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
            currentWidth: data.width,
            currentHeight: data.height,
            currentPosition: data.position,
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    const handleNodeDoubleClick = (event: React.MouseEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("button,input,textarea,select,video,audio,[data-canvas-no-drag]")) return;
        if (isBatchRoot) {
            event.stopPropagation();
            onToggleBatch?.(data.id);
            return;
        }
        if (data.type === CanvasNodeType.Image && hasImageContent) {
            event.stopPropagation();
            onViewImage?.(data);
            return;
        }
        if (data.type === CanvasNodeType.Text) {
            event.stopPropagation();
            setIsEditingContent(true);
            return;
        }
        if (data.type === CanvasNodeType.Image || data.type === CanvasNodeType.Panorama || data.type === CanvasNodeType.Video || data.type === CanvasNodeType.Audio || data.type === CanvasNodeType.Config) {
            event.stopPropagation();
            onOpenPanel?.(data);
        }
    };

    const rememberNodePointer = (event: React.MouseEvent | React.PointerEvent) => {
        if (isInteractiveTarget(event.target, event)) return;
        clickStartRef.current = { x: event.clientX, y: event.clientY };
    };

    const handleNodeClick = (event: React.MouseEvent) => {
        const start = clickStartRef.current;
        clickStartRef.current = null;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
        if (event.shiftKey || event.ctrlKey || event.metaKey) return;
        if (isInteractiveTarget(event.target, event)) return;
        if (data.type === CanvasNodeType.Text) {
            setIsEditingContent(true);
            return;
        }
        if (data.type === CanvasNodeType.Image || data.type === CanvasNodeType.Panorama || data.type === CanvasNodeType.Video || data.type === CanvasNodeType.Audio || data.type === CanvasNodeType.Config) {
            onOpenPanel?.(data);
        }
    };

    const activateTextEditorAfterClick = (event: React.MouseEvent | React.PointerEvent) => {
        if (data.type !== CanvasNodeType.Text || isInteractiveTarget(event.target, event)) return;
        const start = clickStartRef.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 6 && !event.shiftKey && !event.ctrlKey && !event.metaKey) setIsEditingContent(true);
    };

    const applyPanelFrame = useCallback(() => {
        const nodeElement = nodeRef.current;
        const panelElement = panelRef.current;
        const surfaceElement = nodeElement?.closest<HTMLElement>("[data-canvas-surface]");
        if (!showPanel || !nodeElement || !panelElement || !surfaceElement) return;
        const nodeRect = nodeElement.getBoundingClientRect();
        const panelRect = panelElement.getBoundingClientRect();
        const surfaceRect = surfaceElement.getBoundingClientRect();
        const nextLeft = nodeRect.left + nodeRect.width / 2 - panelRect.width / 2 - surfaceRect.left;
        const nextTop = nodeRect.bottom + 12 - surfaceRect.top;
        const style = panelElement.style;
        style.transform = `translate3d(${Math.round(nextLeft)}px, ${Math.round(nextTop)}px, 0)`;
    }, [showPanel]);

    useLayoutEffect(() => {
        if (!showPanel) {
            setPanelMounted(false);
            return;
        }
        setPanelMounted(true);
    }, [showPanel]);

    useLayoutEffect(() => {
        if (!showPanel || !panelMounted) return;
        let frame = 0;
        let running = true;
        const tick = () => {
            if (!running) return;
            applyPanelFrame();
            frame = requestAnimationFrame(tick);
        };
        applyPanelFrame();
        frame = requestAnimationFrame(tick);
        const resizeObserver = new ResizeObserver(() => applyPanelFrame());
        if (panelRef.current) resizeObserver.observe(panelRef.current);
        return () => {
            running = false;
            cancelAnimationFrame(frame);
            resizeObserver.disconnect();
        };
    }, [showPanel, panelMounted, applyPanelFrame]);

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
        };
    }, [handleResizeMove, handleResizeUp]);

    return (
        <div
            ref={nodeRef}
            data-node-id={data.id}
            className={`node-element pointer-events-auto absolute flex select-none flex-col transition-shadow duration-200 ${isSelected ? "z-50" : "z-10"}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                transition: animateSize ? "box-shadow 200ms ease, width 320ms cubic-bezier(0.16, 1, 0.3, 1), height 320ms cubic-bezier(0.16, 1, 0.3, 1)" : "box-shadow 200ms ease",
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onClick={handleNodeClick}
            onMouseUp={activateTextEditorAfterClick}
            onPointerUp={(event) => {
                if (event.pointerType !== "mouse") activateTextEditorAfterClick(event);
            }}
            onDoubleClick={handleNodeDoubleClick}
            onContextMenu={(event) => onContextMenu(event, data.id)}
        >
            <div
                className={`rm-node-glass rm-node-fresnel relative h-full w-full overflow-visible rounded-[22px] border-2`}
                data-selected={isActive ? "true" : "false"}
                data-generating={isGenerating ? "true" : "false"}
                style={{
                    background: nodeBackground,
                    borderColor: "transparent",
                    boxShadow: glassShadow,
                }}
                onMouseDown={(event) => {
                    rememberNodePointer(event);
                    onMouseDown(event, data.id);
                }}
                onPointerDown={(event) => {
                    rememberNodePointer(event);
                    if (event.pointerType !== "mouse") onMouseDown(event, data.id);
                }}
            >
                {/* 斜向液态丝绸光波：只在实际生成时挂载，成图后自动卸载 */}
                {isGenerating ? <span className="rm-node-silk-wave" aria-hidden="true" /> : null}
                <div
                    className={`relative z-[3] flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: nodeBackground,
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: data.metadata?.batchRootId ? (batchClosing ? "canvas-batch-child-out 260ms cubic-bezier(.4,0,.2,1) both" : "canvas-batch-child-in 340ms cubic-bezier(.2,.85,.18,1) both") : undefined,
                            animationDelay: data.metadata?.batchRootId ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        isSelected={isSelected}
                        theme={theme}
                        scale={scale}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        batchOpening={batchOpening}
                        batchRecovering={batchRecovering}
                        renderNodeContent={renderNodeContent}
                        loadImage={loadImage}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onPromptSuggestion={onPromptSuggestion}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onGenerateImage={onGenerateImage}
                        onImageDimensions={onImageDimensions}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={() => onSetBatchPrimary?.(data)}
                    />
                </div>

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}
                {resourceLabel ? <ResourceLabelBadge reference={resourceLabel} /> : null}

                {/* 原有的底部 48px 渐隐遮罩已移除：
                 * 它用 theme.canvas.background 做底，在渐变画布上会变成一条黑带，
                 * 而空态 UI 本就居中、底部没有需要提对比的文字。 */}

                <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} scale={scale} enabled={resizeEnabled} />
                <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} scale={scale} enabled={resizeEnabled} />
                <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} scale={scale} enabled={resizeEnabled} />
                <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} scale={scale} enabled={resizeEnabled} />
            </div>

            <ConnectionHandleDot
                side="left"
                scale={scale}
                visible={connectingHandleSide !== "left" && (hovered || isNear || isSelected || isConnecting || isConnectionTarget)}
                highlight={isConnectionTarget}
                onConnectStart={(event) => onConnectStart(event, data.id, "target")}
            />
            <ConnectionHandleDot
                side="right"
                scale={scale}
                visible={connectingHandleSide !== "right" && data.type !== CanvasNodeType.Config && (hovered || isNear || isSelected || isConnecting)}
                onConnectStart={(event) => onConnectStart(event, data.id, "source")}
            />

            {showPanel && renderPanel && panelMounted
                ? createPortal(
                      <div
                          ref={panelRef}
                          data-canvas-no-drag
                          data-canvas-node-panel
                          data-canvas-node-panel-placement="bottom"
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onContextMenu={(event) => event.stopPropagation()}
                          className="pointer-events-auto absolute left-0 top-0 z-[40] flex max-w-[calc(100vw-2rem)] flex-col overflow-y-auto overscroll-contain rounded-[20px] will-change-transform"
                          style={{
                              width: `${Math.max(685, Math.min(760, data.width))}px`,
                              minHeight: "238px",
                              maxHeight: "calc(100dvh - 2rem)",
                              maxWidth: "calc(100% - 2rem)",
                          }}
                      >
                          {renderPanel(data)}
                      </div>,
                      nodeRef.current!.closest<HTMLElement>("[data-canvas-surface]")!,
                  )
                : null}
        </div>
    );
});
