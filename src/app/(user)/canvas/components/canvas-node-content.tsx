"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BriefcaseBusiness, ChevronRight, CircleCheck, CircleX, Clock3, Globe2, Image as ImageIcon, ListChecks, Music2, Palette, Plus, RefreshCw, Star, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { serverMediaUrl } from "@/services/server-media-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasResourceMentionText, CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasPanoramaViewer } from "./canvas-panorama-viewer";
import { CanvasNodeTaskId, CanvasNodeTaskStateOverlay } from "./canvas-node-task-state";
import { canvasNodeSafeFailureMessage, deriveCanvasNodeTaskState } from "../[id]/canvas-node-task-state";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { canvasResizeHitSize } from "../utils/canvas-node-resize";

export type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    scale?: number;
    isSelected?: boolean;
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    loadImage?: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    onContentChange: (nodeId: string, content: string) => void;
    onPromptSuggestion?: (nodeId: string, prompt: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
    onImageDimensions?: (nodeId: string, naturalWidth: number, naturalHeight: number) => void;
};

export function NodeContent(props: NodeContentRendererProps) {
    if ([CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Panorama].includes(props.node.type)) {
        const metadata = props.node.metadata;
        const fallback = [metadata?.content, metadata?.serverUrl, metadata?.remoteUrl].find((value) => value && /^(?:https?:|data:|blob:|\/)/.test(value));
        const content = serverMediaUrl(metadata?.storageKey, fallback || "");
        if (content && content !== metadata?.content) props = { ...props, node: { ...props.node, metadata: { ...metadata, content } } };
    }
    const task = deriveCanvasNodeTaskState(props.node.metadata);
    let content: ReactNode;
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) {
        content = props.renderNodeContent(props.node);
    } else if (props.isBatchRoot) {
        content = <ImageNodeContent {...props} />;
    } else if (props.node.metadata?.status === "loading") {
        content = <LoadingContent theme={props.theme} uploading={props.node.metadata.uploadState === "uploading"} taskId={task?.taskId} />;
    } else if (props.node.metadata?.status === "error") {
        content = <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} taskId={task?.taskId} />;
    } else if (props.node.metadata?.status === "needs_review") {
        content = <ReviewContent node={props.node} theme={props.theme} onRetry={props.onRetry} taskId={task?.taskId} />;
    } else if (props.node.metadata?.status === "cancelled") {
        content = <CancelledContent theme={props.theme} taskId={task?.taskId} />;
    } else {
        const Renderer = nodeContentRenderers[props.node.type];
        content = Renderer ? <Renderer {...props} /> : <UnknownNodeContent theme={props.theme} />;
    }

    return (
        <div className="relative h-full w-full" data-canvas-node-content>
            <div className="h-full w-full">{content}</div>
            <CanvasNodeTaskStateOverlay node={props.node} theme={props.theme} />
        </div>
    );
}

export const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Panorama]: PanoramaNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Brief]: BriefNodeContent,
    [CanvasNodeType.Task]: TaskNodeContent,
    [CanvasNodeType.BrandKit]: BrandKitNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

export function BriefNodeContent({ node, theme }: NodeContentRendererProps) {
    const brief = node.metadata?.agentBrief;
    return (
        <div className="flex h-full flex-col gap-4 overflow-y-auto p-5" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-2 text-xs font-semibold">
                <BriefcaseBusiness className="size-4" style={{ color: theme.node.activeStroke }} />
                创作目标
            </div>
            <p className="text-sm leading-6">{brief?.objective || "等待 Agent 整理创作目标"}</p>
            {brief?.audience ? (
                <div className="text-xs" style={{ color: theme.node.placeholder }}>
                    受众：{brief.audience}
                </div>
            ) : null}
            {brief?.usage ? (
                <div className="text-xs" style={{ color: theme.node.placeholder }}>
                    场景：{brief.usage}
                </div>
            ) : null}
            {brief?.coreMessage ? (
                <p className="text-xs leading-5" style={{ color: theme.node.placeholder }}>
                    核心信息：{brief.coreMessage}
                </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
                {brief?.deliverables?.map((item, index) => (
                    <span key={`${item.title}-${index}`} className="rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: theme.node.subtleBorder, background: theme.node.subtleSurface, color: theme.node.subtleText }}>
                        {item.title}
                        {item.count && item.count > 1 ? ` ×${item.count}` : ""}
                    </span>
                ))}
            </div>
        </div>
    );
}

export function TaskNodeContent({ node, theme }: NodeContentRendererProps) {
    const status = node.metadata?.agentTaskStatus || "pending";
    const statusTheme = taskStatusTheme(status, theme);
    return (
        <div className="flex h-full min-h-0 flex-col p-5" style={{ color: theme.node.text }}>
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-4 flex items-center justify-between">
                    <ListChecks className="size-5" style={{ color: theme.node.activeStroke }} />
                    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium" style={{ background: statusTheme.surface, borderColor: statusTheme.border, color: statusTheme.text }}>
                        <span className="size-1.5 rounded-full" style={{ background: statusTheme.text }} aria-hidden="true" />
                        {TASK_STATUS_LABELS[status]}
                    </span>
                </div>
                <p className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pr-1 text-sm leading-6" onWheel={(event) => event.stopPropagation()}>
                    {node.metadata?.prompt || node.metadata?.content || node.title}
                </p>
            </div>
            <div className="mt-3 flex shrink-0 items-center justify-between text-xs" style={{ color: theme.node.placeholder }}>
                <span>{node.metadata?.agentTaskType || "任务"}</span>
                <span className="flex items-center gap-1">
                    <CircleCheck className="size-3.5" />
                    尝试 {node.metadata?.agentTaskAttempts || 0}/2
                </span>
            </div>
        </div>
    );
}

export function BrandKitNodeContent({ node, theme }: NodeContentRendererProps) {
    const kit = node.metadata?.brandKit;
    return (
        <div className="flex h-full flex-col gap-4 overflow-y-auto p-5" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-2 text-xs font-semibold">
                <Palette className="size-4" style={{ color: theme.node.activeStroke }} />
                灵感与视觉方向
            </div>
            <p className="text-sm leading-6">{kit?.summary || "等待补充品牌与视觉方向"}</p>
            {kit?.composition ? (
                <p className="text-xs leading-5" style={{ color: theme.node.placeholder }}>
                    构图：{kit.composition}
                </p>
            ) : null}
            {kit?.lighting ? (
                <p className="text-xs leading-5" style={{ color: theme.node.placeholder }}>
                    光线：{kit.lighting}
                </p>
            ) : null}
            <div className="flex gap-2">
                {kit?.colors?.map((color) => (
                    <span key={color} className="size-7 rounded-full border" style={{ background: color, borderColor: theme.node.stroke }} title={color} />
                ))}
            </div>
            <div className="flex flex-wrap gap-2">
                {(kit?.keywords || kit?.visualKeywords)?.map((word) => (
                    <span key={word} className="rounded-md border px-2 py-1 text-xs" style={{ background: theme.node.subtleSurface, borderColor: theme.node.subtleBorder, color: theme.node.subtleText }}>
                        {word}
                    </span>
                ))}
            </div>
            {kit?.avoid?.length ? (
                <p className="text-xs leading-5" style={{ color: theme.node.placeholder }}>
                    避免：{kit.avoid.join("；")}
                </p>
            ) : null}
        </div>
    );
}

export function LoadingContent({ theme, uploading = false, taskId }: Pick<NodeContentRendererProps, "theme"> & { uploading?: boolean; taskId?: string }) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span role="status" className="text-[10px] tracking-[0.2em]">
                {uploading ? "上传中" : "生成中"}
            </span>
            <CanvasNodeTaskId taskId={taskId} theme={theme} />
        </div>
    );
}

export function ErrorContent({ node, theme, onRetry, taskId }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry"> & { taskId?: string }) {
    return (
        <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden px-5 py-4 text-center">
            <div className="max-h-[60%] max-w-[260px] overflow-y-auto text-xs leading-5" style={{ color: theme.node.danger }}>
                {canvasNodeSafeFailureMessage(node.metadata?.errorDetails) || "生成失败"}
            </div>
            <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: theme.node.dangerSurface, borderColor: theme.node.dangerBorder, color: theme.node.danger }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                重试
            </button>
            <CanvasNodeTaskId taskId={taskId} theme={theme} />
        </div>
    );
}

export function ReviewContent({ node, theme, onRetry, taskId }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry"> & { taskId?: string }) {
    const reason = canvasNodeSafeFailureMessage(node.metadata?.errorDetails) || "";
    const unrecoverable = /没有保存上游任务 ID|无法安全追回/.test(reason);
    const heading = unrecoverable ? "提交结果未知" : "结果待确认";
    const description = unrecoverable ? "上游没有返回可查询的任务 ID，系统无法自动追回，也不会重复提交。" : reason || "上游任务状态尚未确认，系统不会重复创建。";
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden px-5 py-4 text-center">
            <Clock3 className="size-6 shrink-0" style={{ color: theme.node.warningText }} />
            <div className="max-h-[55%] max-w-[280px] overflow-y-auto text-xs leading-5" style={{ color: theme.node.text }}>
                <div className="font-medium" style={{ color: theme.node.warningText }}>
                    {heading}
                </div>
                <div className="mt-1">{description}</div>
            </div>
            <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition hover:brightness-95"
                style={{ background: theme.node.warningSurface, borderColor: theme.node.warningBorder, color: theme.node.warningText }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                {unrecoverable ? "重新生成" : "检查状态"}
            </button>
            <CanvasNodeTaskId taskId={taskId} theme={theme} />
        </div>
    );
}

export function CancelledContent({ theme, taskId }: Pick<NodeContentRendererProps, "theme"> & { taskId?: string }) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-5 py-4 text-center" style={{ color: theme.node.placeholder }}>
            <CircleX className="size-6" />
            <span className="text-xs">任务已取消</span>
            <CanvasNodeTaskId taskId={taskId} theme={theme} />
        </div>
    );
}

export function UnknownNodeContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    return (
        <div className="flex h-full w-full items-center justify-center text-sm" style={{ color: theme.node.placeholder }}>
            未知节点
        </div>
    );
}

export function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing, onGenerateImage }: NodeContentRendererProps) {
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = {
        fontSize: `${fontSize}px`,
        lineHeight: `${Math.round(fontSize * 1.65)}px`,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
        fontWeight: 400,
        fontStyle: "normal",
        letterSpacing: "0px",
        wordSpacing: "0px",
        fontVariantLigatures: "none",
        fontKerning: "auto",
        textRendering: "auto",
        color: theme.node.text,
        boxSizing: "border-box",
        margin: 0,
        paddingTop: 0,
        paddingRight: 56,
        paddingBottom: 16,
        paddingLeft: 16,
    } as React.CSSProperties;
    const textClassName = "thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent m-0 font-mono outline-none select-text appearance-none [scrollbar-gutter:stable]";

    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-8">
            <button
                type="button"
                className="absolute right-3 top-3 z-20 inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium opacity-85 backdrop-blur-md transition hover:scale-[1.02] hover:opacity-100"
                style={{ background: `${theme.toolbar.panel}dd`, borderColor: theme.node.stroke, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onGenerateImage?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title="用文本生图"
                aria-label="用文本生图"
            >
                <ImageIcon className="size-3.5" />
                生图
            </button>
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    className={`${textClassName} resize-none`}
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels
                    onChange={(value) => onContentChange(node.id, value)}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : (
                <div className={textClassName} style={textStyle} onWheel={(event) => event.stopPropagation()}>
                    {node.metadata?.content ? <CanvasResourceMentionText value={node.metadata.content} references={mentionReferences} /> : <span style={{ color: theme.node.placeholder }}>点击编辑文字</span>}
                </div>
            )}
        </div>
    );
}

export function ResourceLabelBadge({ reference }: { reference: CanvasResourceReference }) {
    return (
        <span className={`pointer-events-none absolute right-2 top-0 z-[80] -translate-y-[calc(100%+6px)] rounded-md px-1.5 py-0.5 text-[10px] font-medium ${reference.active ? "bg-[#2f80ff] text-white shadow-sm" : "bg-black/35 text-white/75"}`}>
            {reference.label}
        </span>
    );
}

export function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent theme={props.theme} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />
            ) : props.node.metadata?.status === "cancelled" ? (
                <CancelledContent theme={props.theme} />
            ) : (
                <EmptyImageContent {...props} isBatchRoot={false} />
            );
        return (
            <BatchFrame batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} onToggleBatch={props.onToggleBatch}>
                {content}
            </BatchFrame>
        );
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;
    return (
        <ImageContent
            node={props.node}
            scale={props.scale}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
            onImageDimensions={props.onImageDimensions}
            loadImage={props.loadImage}
        />
    );
}

export function EmptyImageContent({ node, theme, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch, onPromptSuggestion }: NodeContentRendererProps) {
    const suggestions = [
        { label: "文生图", prompt: "一张高质量的产品摄影图，简洁的白色背景，柔和的影棚灯光，突出产品质感与细节" },
        { label: "图生图", prompt: "参考原图的人物与构图，转换为电影感色调，柔和的自然光，保留主体特征" },
    ];
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-4" style={{ color: theme.node.placeholder }}>
            <div className="canvas-glass-tile flex size-10 items-center justify-center rounded-[12px]" style={{ color: theme.node.subtleText }}>
                <ImageIcon className="size-[18px]" strokeWidth={1.75} />
            </div>
            <span className="text-[11px] font-medium" style={{ color: theme.node.muted }}>
                描述想要的画面，或直接选一种方式
            </span>
            <SuggestionChips nodeId={node.id} theme={theme} items={suggestions} onPick={onPromptSuggestion} />
        </div>
    );
    if (isBatchRoot)
        return (
            <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
                {content}
            </BatchFrame>
        );
    return content;
}

function SuggestionChips({ nodeId, theme, items, onPick }: { nodeId: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; items: Array<{ label: string; prompt: string }>; onPick?: (nodeId: string, prompt: string) => void }) {
    if (!onPick) return null;
    return (
        <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5">
            {items.map((item) => (
                <button
                    key={item.label}
                    type="button"
                    data-canvas-no-drag
                    className="canvas-glass-chip rounded-full px-2.5 py-1 text-[11px] leading-none"
                    style={{ color: theme.node.subtleText }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onPick(nodeId, item.prompt);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}

export function VideoNodeContent({ node, theme, isSelected = false, loadImage = true, onPromptSuggestion }: NodeContentRendererProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    const handleVideoHoverStart = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        void video.play().catch(() => {
            // 浏览器自动播放策略：无用户手势时只允许静音播放，失败后静音重试一次
            video.muted = true;
            void video.play().catch(() => undefined);
        });
    }, []);

    const handleVideoHoverEnd = useCallback(() => {
        videoRef.current?.pause();
    }, []);

    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-4" style={{ color: theme.node.placeholder }}>
                <div className="canvas-glass-tile flex size-10 items-center justify-center rounded-[12px]" style={{ color: theme.node.subtleText }}>
                    <Video className="size-[18px]" strokeWidth={1.75} />
                </div>
                <span className="text-[11px] font-medium" style={{ color: theme.node.muted }}>
                    描述镜头运动，或直接选一种方式
                </span>
                <SuggestionChips
                    nodeId={node.id}
                    theme={theme}
                    items={[
                        { label: "文生视频", prompt: "一段电影感的镜头，主体位于画面中央，缓慢推进，柔和自然光，浅景深" },
                        { label: "首帧", prompt: "以输入图片作为起始画面，保持主体和构图，镜头缓慢推进，动作自然连贯" },
                        { label: "首尾帧", prompt: "从首帧平滑过渡到尾帧，保持主体一致，镜头稳定，动作连贯自然" },
                    ]}
                    onPick={onPromptSuggestion}
                />
            </div>
        );
    if (!loadImage) {
        return <div className="h-full w-full rounded-[22px]" style={{ background: "transparent" }} data-canvas-video-placeholder aria-label="画布视频延迟加载" />;
    }
    return (
        <video
            ref={videoRef}
            src={node.metadata.content}
            controls={isSelected}
            controlsList="nodownload noremoteplayback noplaybackrate nofullscreen"
            disablePictureInPicture
            disableRemotePlayback
            playsInline
            preload="metadata"
            onMouseEnter={handleVideoHoverStart}
            onMouseLeave={handleVideoHoverEnd}
            className="block h-full w-full rounded-[22px] bg-black object-cover [&::-webkit-media-controls-overflow-button]:hidden"
            data-canvas-video
            data-canvas-no-zoom
        />
    );
}

export function PanoramaNodeContent({ node, theme }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <div className="canvas-glass-tile flex size-10 items-center justify-center rounded-[12px]" style={{ color: theme.node.subtleText }}>
                    <Globe2 className="size-[18px]" strokeWidth={1.75} />
                </div>
                <span className="text-[12px] font-medium" style={{ color: theme.node.muted }}>
                    等待一张 360° 全景
                </span>
                <span className="text-[10px] opacity-55">2:1 等距投影</span>
            </div>
        );
    return <CanvasPanoramaViewer src={node.metadata.content} alt={node.title || "全景图"} />;
}

export function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <div className="canvas-glass-tile flex size-10 items-center justify-center rounded-[12px]" style={{ color: theme.node.subtleText }}>
                    <Music2 className="size-[18px]" strokeWidth={1.75} />
                </div>
                <span className="text-[12px] font-medium" style={{ color: theme.node.muted }}>
                    上传音频或让 Agent 生成
                </span>
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: "transparent", color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">{node.title || "音频"}</span>
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

export function ImageContent({
    node,
    scale = 1,
    isBatchRoot,
    batchCount,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
    onSetBatchPrimary,
    onImageDimensions,
    loadImage = true,
}: {
    node: CanvasNodeData;
    scale?: number;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
    onImageDimensions?: (nodeId: string, naturalWidth: number, naturalHeight: number) => void;
    loadImage?: boolean;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const isBatchChild = Boolean(node.metadata?.batchRootId);
    const imageRef = useRef<HTMLImageElement>(null);
    const [imageFailed, setImageFailed] = useState(false);
    const previewWidth = canvasImagePreviewWidth(node.width, scale, node.metadata?.naturalWidth);
    const previewUrl = imagePreviewUrl(node.metadata!.content!, previewWidth);
    const reportDimensions = useCallback(
        (image: HTMLImageElement) => {
            const width = node.metadata?.naturalWidth || image.naturalWidth;
            const height = node.metadata?.naturalHeight || image.naturalHeight;
            if (node.metadata?.naturalWidth && node.metadata?.naturalHeight && Math.abs(node.width / node.height - width / height) < 0.01) return;
            if (width > 0 && height > 0) onImageDimensions?.(node.id, width, height);
        },
        [node.id, node.width, node.height, node.metadata?.naturalHeight, node.metadata?.naturalWidth, onImageDimensions],
    );

    useEffect(() => {
        setImageFailed(false);
        const image = imageRef.current;
        if (image?.complete) reportDimensions(image);
    }, [previewUrl, reportDimensions]);

    const handleImageError = () => {
        setImageFailed(true);
    };

    return (
        <BatchFrame batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
            <div className="h-full w-full overflow-hidden rounded-[22px]" style={{ background: "transparent" }}>
                {imageFailed ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-xs" style={{ color: theme.node.muted }} role="img" aria-label="画布图片加载失败">
                        <ImageIcon className="size-6" />
                        <span>图片加载失败</span>
                    </div>
                ) : loadImage ? (
                    <img
                        ref={imageRef}
                        src={previewUrl}
                        alt=""
                        aria-label="画布图片"
                        data-canvas-image
                        draggable={false}
                        decoding="async"
                        onError={handleImageError}
                        onLoad={(event) => {
                            setImageFailed(false);
                            reportDimensions(event.currentTarget);
                        }}
                        onDragStart={(event) => event.preventDefault()}
                        className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                    />
                ) : (
                    <div className="h-full w-full" aria-label="画布图片预加载中" />
                )}
            </div>
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold shadow-[0_6px_18px_rgba(15,23,42,.10)] backdrop-blur-md transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    aria-label={batchExpanded ? "图片组已展开" : "图片组已收起"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none opacity-85">{batchCount}</span>
                    <ChevronRight className={`size-3.5 transition-transform ${batchExpanded ? "rotate-90" : ""}`} style={{ color: theme.node.muted }} />
                </button>
            ) : null}
            {isBatchChild ? (
                <button
                    type="button"
                    className="absolute right-3 top-3 z-30 flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium opacity-0 shadow-[0_8px_20px_rgba(68,64,60,.13)] backdrop-blur-md transition group-hover/batch:opacity-100 hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSetBatchPrimary?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <Star className="size-3.5 text-[#2f80ff]" />
                    设为主图
                </button>
            ) : null}
        </BatchFrame>
    );
}

export function canvasImagePreviewWidth(nodeWidth: number, scale: number, naturalWidth?: number) {
    const safeScale = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 1) : 1;
    const screenWidth = Math.max(1, Math.ceil(nodeWidth * safeScale * (globalThis.devicePixelRatio || 1)));
    return naturalWidth && naturalWidth > 0 ? Math.min(screenWidth, naturalWidth) : screenWidth;
}

export function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

export function BatchFrame({
    batchCount,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
    children,
}: {
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    onToggleBatch?: () => void;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
            onDoubleClick={
                isBatchRoot
                    ? (event) => {
                          event.stopPropagation();
                          onToggleBatch?.();
                      }
                    : undefined
            }
        >
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_14px_34px_rgba(68,64,60,.16)] transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform:
                                    batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
export function ResizeHandle({
    corner,
    onMouseDown,
    scale = 1,
    enabled = true,
}: {
    corner: ResizeCorner;
    onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void;
    scale?: number;
    enabled?: boolean;
}) {
    const cursorClass = {
        "top-left": "cursor-nwse-resize",
        "top-right": "cursor-nesw-resize",
        "bottom-left": "cursor-nesw-resize",
        "bottom-right": "cursor-nwse-resize",
    }[corner];

    /* 命中区按屏幕像素恒定（默认 24px），不再用常驻的 44px 大方块：
     * 角外只伸出 12px，且节点未 hover/选中时完全不接管指针。 */
    const hit = canvasResizeHitSize(scale);
    const offset = hit / 2;
    const style: React.CSSProperties = {
        width: hit,
        height: hit,
        touchAction: "none",
        ...(corner.includes("left") ? { left: -offset } : { right: -offset }),
        ...(corner.includes("top") ? { top: -offset } : { bottom: -offset }),
    };

    return (
        <div
            data-canvas-resize-corner={corner}
            aria-label="调整节点大小"
            className={`absolute z-50 select-none ${cursorClass} ${enabled ? "" : "pointer-events-none"}`}
            style={style}
            onPointerDown={(event) => {
                if (!enabled) return;
                event.stopPropagation();
                event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onMouseDown={(event) => {
                if (enabled) onMouseDown(event, corner);
            }}
        />
    );
}

export function ConnectionHandleDot({
    side,
    visible,
    highlight = false,
    scale = 1,
    onConnectStart,
}: {
    side: "left" | "right";
    visible: boolean;
    highlight?: boolean;
    scale?: number;
    onConnectStart: (event: React.MouseEvent | React.PointerEvent) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const hitRef = useRef<HTMLDivElement>(null);
    const [magnetOffset, setMagnetOffset] = useState({ x: 0, y: 0 });
    const knobScreenScale = Math.max(0.5, Math.min(1, scale));
    // The knob's visual radius shrinks with zoom, so measure the gap from its edge.
    const knobCenterScreen = 11 * knobScreenScale + 9;
    const handleOffset = knobCenterScreen / Math.max(scale, 0.01) + 24;

    const updateMagnet = (event: React.PointerEvent<HTMLDivElement>) => {
        const rect = hitRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const distance = Math.hypot(dx, dy);
        const radius = 72;
        if (distance > radius) {
            setMagnetOffset({ x: 0, y: 0 });
            return;
        }
        const strength = 1 - distance / radius;
        const offset = 18 * strength;
        const length = Math.max(1, distance);
        setMagnetOffset({ x: (dx / length) * offset, y: (dy / length) * offset });
    };

    return (
        <div
            ref={hitRef}
            data-canvas-handle={side === "left" ? "target" : "source"}
            aria-label={side === "left" ? "输入连接点" : "输出连接点"}
            className={`absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onMouseDown={onConnectStart}
            onPointerMove={updateMagnet}
            onPointerLeave={() => setMagnetOffset({ x: 0, y: 0 })}
            onPointerDown={(event) => {
                setMagnetOffset({ x: 0, y: 0 });
                if (event.pointerType !== "mouse") onConnectStart(event);
            }}
            style={{
                touchAction: "none",
                left: side === "left" ? -handleOffset : undefined,
                right: side === "right" ? -handleOffset : undefined,
            }}
        >
            <div
                className={`canvas-glass-knob pointer-events-none grid size-7 place-items-center rounded-full transition-transform duration-75 ease-out ${highlight ? "is-target" : ""}`}
                style={{
                    color: theme.node.text,
                    transform: `translate(${magnetOffset.x / Math.max(scale, 0.01)}px, ${magnetOffset.y / Math.max(scale, 0.01)}px) scale(${knobScreenScale / Math.max(scale, 0.01)})`,
                }}
            >
                <Plus className="size-3" aria-hidden />
            </div>
        </div>
    );
}

const TASK_STATUS_LABELS = {
    ready: "等待执行",
    pending: "等待执行",
    running: "执行中",
    paused: "已暂停",
    waiting_user: "等待确认",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
} as const;

function taskStatusTheme(status: keyof typeof TASK_STATUS_LABELS, theme: NodeContentRendererProps["theme"]) {
    if (status === "running") return { surface: theme.node.infoSurface, border: theme.node.infoBorder, text: theme.node.infoText };
    if (status === "completed") return { surface: theme.node.successSurface, border: theme.node.successBorder, text: theme.node.successText };
    if (status === "paused" || status === "waiting_user") return { surface: theme.node.warningSurface, border: theme.node.warningBorder, text: theme.node.warningText };
    if (status === "failed") return { surface: theme.node.dangerSurface, border: theme.node.dangerBorder, text: theme.node.danger };
    return { surface: theme.node.subtleSurface, border: theme.node.subtleBorder, text: theme.node.subtleText };
}
