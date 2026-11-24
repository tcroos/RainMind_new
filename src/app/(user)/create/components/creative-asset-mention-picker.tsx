"use client";

import { ChevronDown, ChevronUp, FileAudio, FileText, FileVideo, ImageIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CreativeAsset } from "@/lib/creative-runtime-contract";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { creativeAssetMentionCandidates } from "./creative-asset-mention";
import { CreativeHoverVideo } from "./creative-hover-video";

export function CreativeAssetMentionPicker({ assets, query = "", onSelect, onDismiss }: { assets: CreativeAsset[]; query?: string; onSelect: (asset: CreativeAsset) => void; onDismiss: () => void }) {
    const gridRef = useRef<HTMLDivElement>(null);
    const [scrollEdges, setScrollEdges] = useState({ previous: false, next: false });
    const visibleAssets = useMemo(() => creativeAssetMentionCandidates(assets, query).filter((asset) => asset.type === "image" || asset.type === "video"), [assets, query]);
    const assetLabels = useMemo(() => {
        const counts = new Map<"image" | "video", number>();
        const labels = new Map<string, string>();
        for (const asset of assets) {
            if (asset.type !== "image" && asset.type !== "video") continue;
            const count = (counts.get(asset.type) || 0) + 1;
            counts.set(asset.type, count);
            labels.set(asset.id, `${asset.type === "image" ? "图" : "视频"}${count}`);
        }
        return labels;
    }, [assets]);
    useEffect(() => {
        const grid = gridRef.current;
        if (!grid || !visibleAssets.length) return;
        const update = () => {
            const maximum = Math.max(0, grid.scrollHeight - grid.clientHeight);
            const previous = grid.scrollTop > 1;
            const next = grid.scrollTop < maximum - 1;
            setScrollEdges((current) => (current.previous === previous && current.next === next ? current : { previous, next }));
        };
        const frame = window.requestAnimationFrame(update);
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(grid);
        grid.addEventListener("scroll", update, { passive: true });
        return () => {
            window.cancelAnimationFrame(frame);
            resizeObserver.disconnect();
            grid.removeEventListener("scroll", update);
        };
    }, [visibleAssets.length]);

    if (!visibleAssets.length)
        return (
            <div className="w-[min(12rem,calc(100vw-2rem))] px-3 py-5 text-center text-xs text-[#8b949f] dark:text-[#7f8996]" data-testid="creative-asset-mention-picker" onClick={onDismiss}>
                没有匹配的图片或视频
            </div>
        );
    return (
        <div className="flex w-[min(12rem,calc(100vw-2rem))] min-w-0 flex-col overflow-hidden p-1.5" data-testid="creative-asset-mention-picker" onClick={onDismiss}>
            <div className="relative min-h-0 overflow-hidden">
                <div ref={gridRef} className="hide-scrollbar grid max-h-[min(16rem,calc(100dvh-10rem))] grid-cols-1 gap-0.5 overflow-y-auto overscroll-contain p-0.5" data-testid="creative-asset-mention-grid">
                    {visibleAssets.map((asset) => (
                        <AssetMentionOption key={asset.id} asset={asset} label={assetLabels.get(asset.id) || (asset.type === "image" ? "图" : "视频")} onSelect={onSelect} />
                    ))}
                </div>
                {scrollEdges.previous ? (
                    <span
                        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-6 items-start justify-center bg-gradient-to-b from-white via-white/85 to-transparent pt-0.5 text-[#8b949f] dark:from-[#1f2328] dark:via-[#1f2328]/85 dark:text-[#929ca8]"
                        aria-hidden="true"
                    >
                        <ChevronUp className="size-3.5" />
                    </span>
                ) : null}
                {scrollEdges.next ? (
                    <span
                        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-6 items-end justify-center bg-gradient-to-t from-white via-white/85 to-transparent pb-0.5 text-[#8b949f] dark:from-[#1f2328] dark:via-[#1f2328]/85 dark:text-[#929ca8]"
                        aria-hidden="true"
                    >
                        <ChevronDown className="size-3.5" />
                    </span>
                ) : null}
            </div>
        </div>
    );
}

function AssetMentionOption({ asset, label, onSelect }: { asset: CreativeAsset; label: string; onSelect: (asset: CreativeAsset) => void }) {
    return (
        <button
            type="button"
            data-asset-id={asset.id}
            data-asset-label={label}
            aria-label={`选择${label}`}
            className="group flex h-12 min-w-0 items-center gap-2 overflow-hidden rounded-md bg-white px-2 text-left text-[#46515e] transition-colors hover:bg-[#f1f3f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:bg-[#1f2328] dark:text-[#c5cdd6] dark:hover:bg-[#292f37]"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(asset)}
        >
            <span className="relative size-9 shrink-0 overflow-hidden rounded bg-[#e6eaee] dark:bg-[#363d45]">
                <AssetPreview asset={asset} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium tabular-nums">{label}</span>
        </button>
    );
}

function AssetPreview({ asset }: { asset: CreativeAsset }) {
    const url = asset.serverUrl || asset.remoteUrl;
    if (asset.type === "image" && url) return <img src={imagePreviewUrl(url, 240)} alt="" className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />;
    const coverUrl = asset.type === "video" && typeof asset.metadata.coverUrl === "string" ? asset.metadata.coverUrl : "";
    if (asset.type === "video") return <VideoAssetPreview url={url} coverUrl={coverUrl} />;
    const Icon = asset.type === "audio" ? FileAudio : asset.type === "text" ? FileText : ImageIcon;
    return (
        <span className="grid size-full place-items-center text-[#66717e] dark:text-[#aab3bf]">
            <Icon className="size-5" />
        </span>
    );
}

function VideoAssetPreview({ url, coverUrl }: { url?: string; coverUrl: string }) {
    const [videoFailed, setVideoFailed] = useState(false);
    const showVideo = Boolean(url) && !videoFailed;
    const showCover = !showVideo && Boolean(coverUrl);
    return (
        <>
            {showVideo ? (
                <CreativeHoverVideo
                    src={url}
                    poster={coverUrl ? imagePreviewUrl(coverUrl, 240) : undefined}
                    preload={coverUrl ? "none" : "auto"}
                    aria-hidden="true"
                    className="size-full bg-black object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    onError={() => setVideoFailed(true)}
                />
            ) : null}
            {showCover ? <img src={imagePreviewUrl(coverUrl, 240)} alt="" className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" /> : null}
            {!showCover && !showVideo ? (
                <span className="grid size-full place-items-center text-[#66717e] dark:text-[#aab3bf]">
                    <FileVideo className="size-5" />
                </span>
            ) : null}
        </>
    );
}
