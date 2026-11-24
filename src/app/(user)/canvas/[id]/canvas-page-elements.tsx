"use client";

import { Component, type ErrorInfo, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Globe2, ImageIcon, List, Music2, Settings2, Video } from "lucide-react";
import { nanoid } from "nanoid";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { getNodeSpec } from "../constants";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type ConnectionHandle, type Position } from "../types";

export type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
    sourceNodeIds?: string[];
};

export type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

export type CanvasCreatableNodeType = CanvasNodeType.Image | CanvasNodeType.Panorama | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio;

export type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

export type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

export const VIDEO_NODE_MAX_WIDTH = 640;
export const VIDEO_NODE_MAX_HEIGHT = 640;
export const CANVAS_DROP_NODE_OFFSET = 48;
export const CONNECTION_HANDLE_HIT_RADIUS = 40;
export const CONNECTION_NODE_HIT_PADDING = 32;
export const NODE_STATUS_IDLE = "idle" as const;
export const NODE_STATUS_LOADING = "loading" as const;
export const NODE_STATUS_SUCCESS = "success" as const;
export const NODE_STATUS_ERROR = "error" as const;
export const NODE_STATUS_CANCELLED = "cancelled" as const;
export const NODE_STATUS_NEEDS_REVIEW = "needs_review" as const;
export const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

export function createCanvasNode(type: CanvasNodeType, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${nanoid()}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

export function CanvasRefreshShell() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <main className="relative h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.backdrop, color: theme.node.text }}>
            <div role="status" className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-4" style={{ background: theme.canvas.backdrop }}>
                <span className="size-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
                <span className="text-sm">项目正在加载中...</span>
            </div>
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: `radial-gradient(circle, ${theme.canvas.dot} 1px, transparent 1px)`,
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="absolute bottom-5 left-1/2 z-50 flex h-14 -translate-x-1/2 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="size-8 rounded-md bg-current opacity-10" />
                ))}
            </div>

            <div className="absolute bottom-24 left-6 z-50 h-40 w-[240px] rounded-lg border shadow-2xl backdrop-blur-sm" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-5 z-50 flex h-14 w-[260px] items-center gap-2 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-hidden="true">
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="h-1 flex-1 rounded-full bg-current opacity-10" />
                <div className="h-4 w-10 rounded bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
            </div>
        </main>
    );
}

export function NodeCreateMenu({ position, scale, onCreate, onClose, onUpload }: { position: Position; scale: number; onCreate: (type: CanvasCreatableNodeType) => void; onClose: () => void; onUpload: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const menuRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const menu = menuRef.current;
        const surface = menu?.closest<HTMLElement>("[data-canvas-surface]");
        if (!menu || !surface) return;
        const bounds = surface.getBoundingClientRect();
        const viewportScale = Math.max(0.01, scale);
        // 面板按原 300px 布局整体缩放到 70%，而不是把宽度压窄，避免文案被截断。
        menu.style.width = "300px";
        menu.style.maxWidth = "300px";
        menu.style.maxHeight = `${bounds.height}px`;
        menu.style.transformOrigin = "0 0";
        const panelScale = 0.7 / viewportScale;
        menu.style.transform = `translate(0px, 0px) scale(${panelScale})`;
        const rect = menu.getBoundingClientRect();
        const x = Math.max(bounds.left + 16, Math.min(rect.left, bounds.right - rect.width - 16)) - rect.left;
        const y = Math.max(bounds.top + 16, Math.min(rect.top, bounds.bottom - rect.height - 16)) - rect.top;
        menu.style.transform = `translate(${x / viewportScale}px, ${y / viewportScale}px) scale(${panelScale})`;
    }, [position, scale]);

    return (
        <div
            className="pointer-events-auto absolute z-[120] w-[300px] max-h-[70dvh] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur"
            data-canvas-node-create-menu
            ref={menuRef}
            style={{ left: position.x, top: position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    新建节点
                </span>
                <button
                    type="button"
                    className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:opacity-100"
                    onClick={onClose}
                    onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
                    onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
                    aria-label="关闭"
                >
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="上传" description="选择图片、视频或音频" onClick={onUpload} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文字" description="脚本、广告词、品牌文案" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title="音频" onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Globe2 className="size-5" />} title="全景图" description="生成 2:1 环境全景" onClick={() => onCreate(CanvasNodeType.Panorama)} />
            </div>
        </div>
    );
}

export function ConnectionCreateMenu({ pending, scale, onCreate, onClose }: { pending: PendingConnectionCreate; scale: number; onCreate: (type: CanvasCreatableNodeType) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const menuRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState({ anchorX: pending.position.x, anchorY: pending.position.y, offsetX: 0, offsetY: 0 });
    const currentPlacement = placement.anchorX === pending.position.x && placement.anchorY === pending.position.y ? placement : { anchorX: pending.position.x, anchorY: pending.position.y, offsetX: 0, offsetY: 0 };
    useLayoutEffect(() => {
        const menu = menuRef.current;
        const surface = menu?.closest<HTMLElement>("[data-canvas-surface]");
        if (!menu || !surface) return;
        const viewportScale = Math.max(0.01, scale);
        const panelScale = 0.7 / viewportScale;
        menu.style.width = "300px";
        menu.style.maxWidth = "300px";
        menu.style.transformOrigin = "0 0";
        menu.style.transform = `scale(${panelScale})`;
        const menuRect = menu.getBoundingClientRect();
        const surfaceRect = surface.getBoundingClientRect();
        const inset = 16;
        const shiftX = menuRect.left < surfaceRect.left + inset ? surfaceRect.left + inset - menuRect.left : menuRect.right > surfaceRect.right - inset ? surfaceRect.right - inset - menuRect.right : 0;
        const shiftY = menuRect.top < surfaceRect.top + inset ? surfaceRect.top + inset - menuRect.top : menuRect.bottom > surfaceRect.bottom - inset ? surfaceRect.bottom - inset - menuRect.bottom : 0;
        if (!shiftX && !shiftY) return;
        const renderedScale = menu.offsetWidth ? menuRect.width / menu.offsetWidth : 1;
        setPlacement({
            anchorX: pending.position.x,
            anchorY: pending.position.y,
            offsetX: currentPlacement.offsetX + shiftX / Math.max(renderedScale, 0.01),
            offsetY: currentPlacement.offsetY + shiftY / Math.max(renderedScale, 0.01),
        });
    }, [currentPlacement.offsetX, currentPlacement.offsetY, pending.position.x, pending.position.y, scale]);
    return (
        <div
            ref={menuRef}
            className="pointer-events-auto absolute z-[120] w-[300px] rounded-[18px] border p-3 shadow-2xl backdrop-blur"
            data-connection-create-menu
            style={{ left: pending.position.x + currentPlacement.offsetX, top: pending.position.y + currentPlacement.offsetY, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    引用该节点生成
                </span>
                <button
                    type="button"
                    className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:opacity-100"
                    onClick={onClose}
                    onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
                    onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
                    aria-label="关闭"
                >
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频生成" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title="音频参考" onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文字生成" description="脚本、广告词、品牌文案" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<Globe2 className="size-5" />} title="全景生成" description="生成 2:1 环境全景" onClick={() => onCreate(CanvasNodeType.Panorama)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title="配置节点" description="模型、尺寸、数量和输入顺序" onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

export class CanvasConnectionMenuErrorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { hasError: boolean }> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("Canvas connection-create menu failed", error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div role="alert" className="pointer-events-auto absolute z-[120] rounded-lg border bg-white p-3 text-sm text-red-700 shadow-lg">
                    <span>连线菜单暂时不可用</span>
                    <button type="button" className="ml-3 underline" onClick={this.props.onClose}>
                        关闭
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button
            type="button"
            className="group flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition-colors duration-150"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            {/* 尺寸与字号沿用调好的原值，只把图标底换成中性玻璃 */}
            <span className="canvas-glass-tile grid size-11 shrink-0 place-items-center rounded-xl [&_svg]:size-5" style={{ color: theme.node.subtleText }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? (
                    <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}
