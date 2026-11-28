"use client";

import { Film, Image as ImageIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { LazyMediaImage } from "@/components/media/lazy-media-image";
import type { PublicWorkPublication } from "@/services/api/work-publications";

type PublicWorkAsset = PublicWorkPublication["assets"][number];

export function PublicWorkMediaBrowser({ assets, title, compact = false, stage = false, onDimensions }: { assets: PublicWorkAsset[]; title: string; compact?: boolean; stage?: boolean; onDimensions?: (width: number, height: number) => void }) {
    const ordered = useMemo(() => assets.filter((asset) => asset.mediaType === "image" || asset.mediaType === "video"), [assets]);
    const [activeId, setActiveId] = useState(ordered[0]?.id || "");
    const active = ordered.find((asset) => asset.id === activeId) || ordered[0];

    useEffect(() => setActiveId(ordered[0]?.id || ""), [ordered]);

    if (!active) return <div className="grid min-h-56 place-items-center border-y border-dashed border-border text-sm text-muted-foreground">作品没有可展示的媒体</div>;

    /* 舞台模式（作品详情弹窗）：深色底铺满、媒体居中；只有多张时才在底部浮一排缩略图 */
    if (stage) {
        return (
            <section className="relative flex size-full min-h-[50dvh] items-center justify-center overflow-hidden bg-[#0d0d0f]" aria-label="作品媒体" data-testid="work-media-stage">
                {active.mediaType === "image" ? (
                    <img
                        key={active.id}
                        src={imagePreviewUrl(active.url, 1920)}
                        alt={title}
                        onLoad={(event) => onDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
                        className="max-h-full max-w-full object-contain p-10 drop-shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
                    />
                ) : (
                    <video
                        key={active.id}
                        src={active.url}
                        controls
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(event) => onDimensions?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
                        className="max-h-full max-w-full object-contain p-10"
                        aria-label={title}
                    />
                )}
                {ordered.length > 1 ? (
                    <div className="absolute inset-x-0 bottom-4 flex justify-center">
                        <div className="flex max-w-[90%] gap-1.5 overflow-x-auto rounded-xl bg-black/45 p-1.5 backdrop-blur-md">
                            {ordered.map((asset, index) => (
                                <button
                                    key={asset.id}
                                    type="button"
                                    onClick={() => setActiveId(asset.id)}
                                    className={cn("relative size-12 shrink-0 overflow-hidden rounded-lg transition", asset.id === active.id ? "ring-2 ring-white" : "opacity-60 hover:opacity-100")}
                                    aria-label={`查看${mediaLabel(asset.mediaType)} ${index + 1}`}
                                    aria-pressed={asset.id === active.id}
                                >
                                    {asset.mediaType === "image" ? <LazyMediaImage src={imagePreviewUrl(asset.url, 256)} alt="" containerClassName="size-full min-h-0" imageClassName="size-full object-cover" /> : <video src={asset.url} muted playsInline preload="metadata" className="size-full object-cover" aria-hidden="true" />}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
            </section>
        );
    }

    return (
        <section className={cn("grid min-w-0 gap-3", compact ? "md:grid-cols-[64px_minmax(0,1fr)]" : "lg:grid-cols-[72px_minmax(0,1fr)]")} aria-label="作品媒体">
            <div
                className={cn(
                    "order-2 flex min-w-0 gap-2 overflow-x-auto pb-1",
                    compact ? "md:order-1 md:max-h-[min(68dvh,680px)] md:flex-col md:overflow-x-hidden md:overflow-y-auto md:pr-1" : "lg:order-1 lg:max-h-[min(74dvh,800px)] lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1",
                )}
            >
                {ordered.map((asset, index) => (
                    <button
                        key={asset.id}
                        type="button"
                        onClick={() => setActiveId(asset.id)}
                        className={cn(
                            "relative size-16 shrink-0 overflow-hidden rounded-md border bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            asset.id === active.id ? "border-foreground ring-1 ring-foreground" : "border-border hover:border-foreground/40",
                        )}
                        aria-label={`查看${mediaLabel(asset.mediaType)} ${index + 1}`}
                        aria-pressed={asset.id === active.id}
                    >
                        {asset.mediaType === "image" ? (
                            <LazyMediaImage src={imagePreviewUrl(asset.url, 256)} alt="" containerClassName="size-full min-h-0" imageClassName="size-full object-cover" />
                        ) : asset.mediaType === "video" ? (
                            <video src={asset.url} muted playsInline preload="metadata" className="size-full object-cover" aria-hidden="true" />
                        ) : null}
                        <span className="absolute bottom-1 right-1 grid size-4 place-items-center rounded bg-black/65 text-white" aria-hidden="true">
                            {asset.mediaType === "image" ? <ImageIcon className="size-2.5" /> : <Film className="size-2.5" />}
                        </span>
                    </button>
                ))}
            </div>

            <div
                className={cn(
                    "order-1 flex min-h-56 min-w-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/45",
                    compact ? "h-[min(52dvh,540px)] md:order-2 md:h-[min(68dvh,680px)]" : "h-[min(58dvh,560px)] lg:order-2 lg:h-[min(76dvh,860px)]",
                )}
            >
                {active.mediaType === "image" ? (
                    <LazyMediaImage src={imagePreviewUrl(active.url, 1920)} alt={title} containerClassName="flex size-full min-h-0 items-center justify-center bg-transparent" imageClassName="max-h-full max-w-full object-contain" />
                ) : active.mediaType === "video" ? (
                    <video key={active.id} src={active.url} controls playsInline preload="metadata" className="max-h-full max-w-full object-contain" aria-label={title} />
                ) : null}
            </div>
        </section>
    );
}

function mediaLabel(type: PublicWorkAsset["mediaType"]) {
    return type === "image" ? "图片" : "视频";
}
