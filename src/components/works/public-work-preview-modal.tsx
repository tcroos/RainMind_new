"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Tooltip } from "antd";
import { ChevronDown, Ellipsis, Eye, Flag, FolderOpen, ImageIcon, LoaderCircle, Maximize2, Plus, Share2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { createAgentPromptHref } from "@/lib/create-agent-prompt";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { userAvatarFallback } from "@/lib/user-avatar";
import { cn } from "@/lib/utils";
import type { Asset } from "@/lib/library-asset-contract";
import { listLibraryAssetPage } from "@/services/api/library-assets";
import { listPublicGallery, type PublicGalleryItem } from "@/services/api/work-governance";

import { PublicWorkLikeButton } from "./public-work-like-button";
import { PublicWorkReportButton } from "./public-work-report-button";
import { getPublicWorkPublication, recordPublicWorkPublicationView, type PublicWorkPublication } from "@/services/api/work-publications";


/*
 * 作品详情（参照 Dreamina 模板详情）：
 * - 不是居中卡片，而是盖住整个内容区的全屏层，背景是深色半透明 + 强模糊；
 * - 左边一列固定的深色面板：「做同款」——作品预览、原提示词、参考内容、其他指示、参数行、底部「生成」；
 * - 右边可滚动区域：标题「更多同款灵感」+ 瀑布流，悬停显示标题 / 作者 / 「做同款」，点击就地切换作品。
 */
export function PublicWorkPreviewModal({
    slug,
    onClose,
    onOpenCreator,
    onUsePrompt,
    onUseImage,
    onUseReferences,
    imageImporting = false,
    onSelect,
}: {
    slug?: string;
    onClose: () => void;
    onOpenCreator?: (username: string) => void;
    onUsePrompt?: (prompt: string) => void;
    onUseImage?: () => void | Promise<void>;
    /** 「参考内容」里选好的素材（上传 / 素材库 / 作品原图）统一转成文件交给调用方上传 */
    onUseReferences?: (files: File[]) => void | Promise<void>;
    imageImporting?: boolean;
    /** 旧接口：外部维护的上一个 / 下一个，新版改为右侧瀑布流切换，保留参数兼容 */
    onPrev?: () => void;
    onNext?: () => void;
    /** 在右侧瀑布流里点了另一个作品；不传时组件内部自己切换 */
    onSelect?: (slug: string) => void;
}) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const viewedSlugs = useRef(new Set<string>());
    const [innerSlug, setInnerSlug] = useState("");
    const activeSlug = innerSlug || slug || "";
    const open = Boolean(slug);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    useEffect(() => setInnerSlug(""), [slug]);

    const query = useQuery({
        queryKey: ["public-work", activeSlug],
        queryFn: () => getPublicWorkPublication(activeSlug),
        enabled: Boolean(activeSlug),
        staleTime: 30_000,
    });
    const work = query.data;

    useEffect(() => {
        if (!activeSlug || viewedSlugs.current.has(activeSlug)) return;
        viewedSlugs.current.add(activeSlug);
        void recordPublicWorkPublicationView(activeSlug)
            .then((viewCount) => queryClient.setQueryData<PublicWorkPublication>(["public-work", activeSlug], (current) => (current ? { ...current, viewCount } : current)))
            .catch(() => undefined);
    }, [queryClient, activeSlug]);

    const lightboxRef = useRef(false);
    /* Esc 关闭（先关大图）；打开期间锁住页面滚动 */
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (lightboxRef.current) setLightbox(null);
            else onClose();
        };
        window.addEventListener("keydown", onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = previous;
        };
    }, [onClose, open]);

    const [instructions, setInstructions] = useState("");
    const [useReference, setUseReference] = useState(true);
    const [references, setReferences] = useState<ReferenceItem[]>([]);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [promptOpen, setPromptOpen] = useState(false);
    const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
    const [generating, setGenerating] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [lightbox, setLightbox] = useState<{ url: string; mediaType: "image" | "video"; title: string } | null>(null);
    lightboxRef.current = Boolean(lightbox);
    useEffect(() => {
        setInstructions("");
        setPromptOpen(false);
        setDimensions(null);
        setUseReference(true);
        setReferences([]);
    }, [activeSlug]);
    /* 本地上传的预览地址在切换作品 / 关闭时统一释放，不能在每次增删时释放（会把还在用的也释放掉） */
    const referencesRef = useRef(references);
    referencesRef.current = references;
    useEffect(() => () => referencesRef.current.forEach((item) => item.objectUrl && URL.revokeObjectURL(item.objectUrl)), [activeSlug]);

    /* 右侧「复刻这个作品」：热门作品，同分类排前；滚到底自动续页 */
    const relatedQuery = useInfiniteQuery({
        queryKey: ["public-work-related-feed"],
        queryFn: ({ pageParam }) => listPublicGallery({ limit: 24, sort: "popular", cursor: pageParam || undefined }),
        initialPageParam: "",
        getNextPageParam: (last) => last.nextCursor || undefined,
        enabled: open,
        staleTime: 60_000,
    });
    const relatedItems = useMemo(() => {
        const seen = new Set<string>();
        return (relatedQuery.data?.pages || []).flatMap((page) => page.items).filter((item) => (seen.has(item.slug) ? false : (seen.add(item.slug), true)));
    }, [relatedQuery.data]);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = relatedQuery;
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasNextPage) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [fetchNextPage, hasNextPage, isFetchingNextPage, relatedItems.length]);
    const related = useMemo(
        () =>
            relatedItems
                .filter((item) => item.slug !== activeSlug && item.preview && item.preview.mediaType !== "audio")
                .sort((a, b) => Number(b.category === work?.category) - Number(a.category === work?.category)),
        [activeSlug, relatedItems, work?.category],
    );

    const contentAssets = useMemo(() => work?.assets.filter((asset) => asset.role === "content" && (asset.mediaType === "image" || asset.mediaType === "video")).sort((left, right) => left.sortOrder - right.sortOrder) || [], [work]);
    const primary = contentAssets[0];
    const canUseOriginal = Boolean((onUseReferences || (onUseImage && activeSlug === slug)) && primary?.mediaType === "image");
    const canReference = Boolean(onUseReferences || canUseOriginal);
    const totalReferences = (useReference && canUseOriginal ? 1 : 0) + references.length;
    const addFiles = (files: File[]) => {
        const accepted = files.filter((file) => /^(image|video)\//.test(file.type)).slice(0, Math.max(0, MAX_REFERENCES - totalReferences));
        if (files.length && !accepted.length) message.warning(totalReferences >= MAX_REFERENCES ? `最多添加 ${MAX_REFERENCES} 个参考` : "只支持图片或视频");
        setReferences((current) => [...current, ...accepted.map((file) => {
            const objectUrl = URL.createObjectURL(file);
            return { key: `${file.name}-${file.size}-${Math.random()}`, preview: objectUrl, objectUrl, kind: file.type.startsWith("video/") ? ("video" as const) : ("image" as const), file };
        })]);
    };
    const addLibraryAssets = (assets: Asset[]) => {
        const room = Math.max(0, MAX_REFERENCES - totalReferences);
        setReferences((current) => [
            ...current,
            ...assets.slice(0, room).flatMap((asset) => {
                if (asset.kind !== "image" && asset.kind !== "video") return [];
                const url = asset.kind === "image" ? asset.data.serverUrl || asset.data.remoteUrl || asset.data.dataUrl : asset.data.serverUrl || asset.data.remoteUrl || asset.data.url;
                return url ? [{ key: `lib-${asset.id}`, preview: asset.coverUrl || url, kind: asset.kind, url, mimeType: asset.data.mimeType, name: asset.title }] : [];
            }),
        ]);
    };
    const finalPrompt = [work?.publicPrompt?.trim(), instructions.trim() ? `修改要求：${instructions.trim()}` : ""].filter(Boolean).join("\n");
    const paramLine = [primary?.mediaType === "video" ? "视频" : "图片", dimensions ? aspectLabel(dimensions.width, dimensions.height) : "", work?.category].filter(Boolean).join(" · ");

    const share = async () => {
        if (!work) return;
        const url = new URL(`/share/${encodeURIComponent(work.slug)}`, window.location.origin).toString();
        try {
            await navigator.clipboard.writeText(url);
            message.success("分享链接已复制");
        } catch {
            message.error("分享链接复制失败");
        }
    };
    const copyPrompt = async () => {
        if (!work?.publicPrompt) return;
        try {
            await navigator.clipboard.writeText(work.publicPrompt);
            message.success("提示词已复制");
        } catch {
            message.error("复制失败，请手动选择提示词");
        }
    };
    const generate = async () => {
        if (!work || generating) return;
        setGenerating(true);
        try {
            if (onUseReferences) {
                const sources: ReferenceItem[] = [...(useReference && canUseOriginal && primary ? [{ key: "original", preview: primary.url, kind: "image" as const, url: primary.url, mimeType: primary.mimeType, name: work.slug }] : []), ...references];
                const files = await Promise.all(sources.map(referenceToFile));
                if (files.length) await onUseReferences(files);
            } else if (canUseOriginal && useReference) {
                await onUseImage?.();
            }
            onUsePrompt?.(finalPrompt);
            onClose();
        } finally {
            setGenerating(false);
        }
    };
    const select = (next: string) => {
        if (onSelect) onSelect(next);
        else setInnerSlug(next);
    };

    /* 跟 Dreamina 一样只盖住内容区：左侧应用侧栏保持清晰可见 */
    const [sidebarRight, setSidebarRight] = useState(0);
    useEffect(() => {
        if (!open) return;
        const measure = () => setSidebarRight(document.querySelector("aside[data-sidebar-mode]")?.getBoundingClientRect().right || 0);
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [open]);
    const backdropImage = primary?.mediaType === "image" ? imagePreviewUrl(primary.url, 640) : "";

    if (!open || !mounted) return null;

    /* 颜色全部走 .work-detail 的 --wd-* 变量：浅色主题白色磨砂遮罩 + 浅灰面板 + 黑色主按钮；深色主题反过来 */
    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label={work?.title || "作品详情"}
            data-testid="public-work-detail"
            className="work-detail work-detail-enter fixed inset-y-0 right-0 z-[1000] flex gap-6 overflow-hidden p-6 backdrop-blur-[40px]"
            style={{ left: sidebarRight }}
            onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
            {/* 作品图放大模糊铺底，让遮罩带上作品的颜色（Dreamina 的彩色雾感） */}
            {backdropImage ? <img src={backdropImage} alt="" aria-hidden className="pointer-events-none absolute inset-0 -z-10 size-full scale-125 object-cover opacity-[var(--wd-tint)] blur-[80px]" /> : null}
            {/* 左：换成自己的内容 */}
            <aside
                className="work-detail-panel flex w-[clamp(320px,21vw,400px)] shrink-0 flex-col overflow-hidden rounded-[20px] backdrop-blur-2xl"
                style={{ backgroundColor: "var(--wd-panel)", color: "var(--wd-text)", boxShadow: "inset 0 0 0 1px var(--wd-hairline)" }}
                aria-label="做同款"
            >
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-5">
                    <h2 className="px-0.5 text-[14px] font-medium">换成自己的内容</h2>

                    <div
                        className="group/preview relative mt-3 cursor-zoom-in overflow-hidden rounded-xl"
                        style={{ backgroundColor: "var(--wd-card)" }}
                        data-testid="work-preview-card"
                        role="button"
                        tabIndex={0}
                        aria-label="查看大图"
                        onClick={() => primary && setLightbox({ url: primary.url, mediaType: primary.mediaType as "image" | "video", title: work?.title || "" })}
                        onKeyDown={(event) => event.key === "Enter" && primary && setLightbox({ url: primary.url, mediaType: primary.mediaType as "image" | "video", title: work?.title || "" })}
                    >
                        <span className="pointer-events-none absolute right-3 top-3 z-10 grid size-7 place-items-center rounded-lg opacity-0 transition-opacity group-hover/preview:opacity-100" style={{ color: "#fff", backgroundColor: "rgba(0,0,0,0.45)" }}>
                            <Maximize2 className="size-3.5" />
                        </span>
                        <span className="absolute left-3 top-3 z-10 rounded px-1.5 py-px text-[10.5px]" style={{ backgroundColor: "var(--wd-chip)", color: "var(--wd-chip-text)" }}>作品</span>
                        <div className="grid h-[200px] place-items-center p-6 [&>img]:max-h-[156px] [&>img]:-rotate-[4deg] [&>img]:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.55)] [&>video]:max-h-[156px] [&>video]:-rotate-[4deg]">
                            {query.isLoading ? (
                                <LoaderCircle className="size-5 animate-spin" style={{ color: "var(--wd-text-3)" }} />
                            ) : primary?.mediaType === "image" ? (
                                <img key={primary.id} data-crossfade src={imagePreviewUrl(primary.url, 960)} alt={work?.title || ""} onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} className="max-w-[70%] rounded-xl object-contain" />
                            ) : primary?.mediaType === "video" ? (
                                <video key={primary.id} src={primary.url} autoPlay muted loop playsInline onLoadedMetadata={(event) => setDimensions({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })} className="max-w-[70%] rounded-xl object-contain" />
                            ) : (
                                <span className="text-[12px]" style={{ color: "var(--wd-text-3)" }}>{query.error ? "作品暂时无法打开" : "没有可展示的媒体"}</span>
                            )}
                        </div>
                    </div>

                    {work ? (
                        <div className="mt-2.5 flex min-w-0 items-center gap-2 px-0.5" data-testid="work-author-row">
                            <button
                                type="button"
                                disabled={!work.authorUsername || !onOpenCreator}
                                onClick={() => {
                                    if (!work.authorUsername || !onOpenCreator) return;
                                    onClose();
                                    onOpenCreator(work.authorUsername);
                                }}
                                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                                aria-label={`查看 ${work.authorName || "作者"} 的主页`}
                            >
                                <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] font-semibold" style={{ backgroundColor: "var(--wd-chip)", color: "var(--wd-text)" }}>
                                    {work.authorAvatarUrl ? <img src={work.authorAvatarUrl} alt="" className="size-full object-cover" /> : userAvatarFallback(work.authorName || "匿名作者")}
                                </span>
                                <span className="min-w-0 truncate text-[12.5px]" style={{ color: "var(--wd-text-2)" }}>
                                    {work.authorName || "匿名作者"}
                                </span>
                            </button>
                            <span className="inline-flex shrink-0 items-center gap-1 text-[12px]" style={{ color: "var(--wd-text-3)" }}>
                                <Eye className="size-3.5" />
                                {work.viewCount}
                            </span>
                            <span className="work-detail-like shrink-0">
                                <PublicWorkLikeButton slug={work.slug} initialCount={work.likeCount} compact nextPath="/create" />
                            </span>
                        </div>
                    ) : null}

                    {work?.publicPrompt ? (
                        <div className="relative mt-2 rounded-xl px-3 pb-3 pt-10" style={{ backgroundColor: "var(--wd-card)" }}>
                            <span className="absolute left-3 top-3 rounded px-1.5 py-px text-[10.5px]" style={{ backgroundColor: "var(--wd-chip)", color: "var(--wd-chip-text)" }}>原提示词</span>
                            <button type="button" onClick={() => void copyPrompt()} aria-label="复制提示词" className="absolute right-2.5 top-2 !text-[11.5px] leading-4" style={{ color: "var(--wd-text-3)" }}>
                                复制
                            </button>
                            <p className={cn("whitespace-pre-wrap break-words text-[12.5px] leading-5", !promptOpen && "line-clamp-3")}>{work.publicPrompt}</p>
                            {work.publicPrompt.length > 60 ? (
                                <button type="button" onClick={() => setPromptOpen((value) => !value)} className="mt-1 inline-flex items-center gap-0.5 text-[11.5px]" style={{ color: "var(--wd-text-3)" }}>
                                    {promptOpen ? "收起" : "展开"} <ChevronDown className={cn("size-3 transition-transform", promptOpen && "rotate-180")} />
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    {canReference ? (
                        <div
                            className="relative mt-2 flex min-h-[200px] flex-col rounded-xl px-3 pb-3 pt-10"
                            style={{ backgroundColor: "var(--wd-card)" }}
                            data-testid="work-reference-card"
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                addFiles(Array.from(event.dataTransfer.files));
                            }}
                        >
                            <span className="absolute left-3 top-3 rounded px-1.5 py-px text-[10.5px]" style={{ backgroundColor: "var(--wd-chip)", color: "var(--wd-chip-text)" }}>参考内容</span>
                            <div className="flex flex-1 flex-wrap content-center justify-center gap-2">
                                {useReference && canUseOriginal && primary ? <ReferenceTile preview={imagePreviewUrl(primary.url, 200)} label="作品原图" onRemove={() => setUseReference(false)} /> : null}
                                {references.map((item) => (
                                    <ReferenceTile key={item.key} preview={item.kind === "image" ? (item.objectUrl ? item.preview : imagePreviewUrl(item.preview, 200)) : item.preview} video={item.kind === "video"} label={item.name || "参考"} onRemove={() => setReferences((current) => current.filter((entry) => entry.key !== item.key))} />
                                ))}
                                {totalReferences < MAX_REFERENCES ? (
                                    <Dropdown
                                        trigger={["click"]}
                                        placement="bottomLeft"
                                        menu={{
                                            items: [
                                                { key: "upload", icon: <Upload className="size-4" />, label: "从设备上传" },
                                                ...(onUseReferences ? [{ key: "library", icon: <FolderOpen className="size-4" />, label: "从素材库选取" }] : []),
                                                ...(canUseOriginal && !useReference ? [{ key: "original", icon: <ImageIcon className="size-4" />, label: "使用作品原图" }] : []),
                                            ],
                                            onClick: ({ key }) => {
                                                if (key === "upload") fileInputRef.current?.click();
                                                if (key === "library") setLibraryOpen(true);
                                                if (key === "original") setUseReference(true);
                                            },
                                        }}
                                    >
                                        <button type="button" aria-label="添加参考内容" data-testid="work-reference-add" className="grid size-[76px] place-items-center rounded-xl transition-opacity hover:opacity-80" style={{ backgroundColor: "var(--wd-chip)", color: "var(--wd-text)", boxShadow: "inset 0 0 0 1px var(--wd-hairline)" }}>
                                            <Plus className="size-5" />
                                        </button>
                                    </Dropdown>
                                ) : null}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*,video/*"
                                    multiple
                                    hidden
                                    onChange={(event) => {
                                        addFiles(Array.from(event.target.files || []));
                                        event.target.value = "";
                                    }}
                                />
                            </div>
                            <p className="mt-2 text-center text-[11px]" style={{ color: "var(--wd-text-3)" }}>
                                {totalReferences}/{MAX_REFERENCES} · 支持图片和视频，可拖拽到这里
                            </p>
                        </div>
                    ) : null}

                    <p className="mt-7 px-0.5 text-[14px] font-medium">其他指示</p>
                    <textarea
                        value={instructions}
                        onChange={(event) => setInstructions(event.target.value)}
                        placeholder="描述你想要更改的任何内容"
                        rows={3}
                        maxLength={500}
                        className="work-detail-input mt-3 w-full resize-none rounded-xl px-3 py-2.5 !text-[13px] leading-5 outline-none"
                        style={{ backgroundColor: "var(--wd-card)", color: "var(--wd-text)" }}
                    />
                </div>

                <div className="shrink-0 px-4 pb-4 pt-1">
                    {paramLine ? <p className="mb-3 truncate px-0.5 text-[13px]" style={{ color: "var(--wd-text-2)" }}>{paramLine}</p> : null}
                    {onUsePrompt ? (
                        <button
                            type="button"
                            disabled={!work || generating || imageImporting}
                            onClick={() => void generate()}
                            aria-label="引用提示词到 Agent"
                            style={{ color: "var(--wd-btn-text)", backgroundColor: "var(--wd-btn)" }}
                            className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl text-[15px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                            {generating || imageImporting ? <LoaderCircle className="size-4 animate-spin" /> : null} 生成
                        </button>
                    ) : (
                        <Link href={createAgentPromptHref(finalPrompt)} style={{ color: "var(--wd-btn-text)", backgroundColor: "var(--wd-btn)" }} className="flex h-10 w-full items-center justify-center rounded-[10px] text-[14px] font-medium transition-opacity hover:opacity-90">
                            生成
                        </Link>
                    )}
                </div>
            </aside>

            {/* 右：复刻这个作品 */}
            <section className="relative min-w-0 flex-1 overflow-y-auto" aria-label="更多作品" data-testid="work-related">
                <div className="sticky top-0 z-20 flex justify-end gap-2 pb-2">
                    <Tooltip title="复制分享链接">
                        <button type="button" onClick={() => void share()} aria-label="分享作品" className="grid size-10 place-items-center rounded-xl backdrop-blur-md" style={ICON_BUTTON}>
                            <Share2 className="size-4" />
                        </button>
                    </Tooltip>
                    {work ? (
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomRight"
                            menu={{ items: [{ key: "report", icon: <Flag className="size-4" />, label: "举报作品" }], onClick: () => setReportOpen(true) }}
                        >
                            <button type="button" aria-label="更多操作" className="grid size-10 place-items-center rounded-xl backdrop-blur-md" style={ICON_BUTTON}>
                                <Ellipsis className="size-4" />
                            </button>
                        </Dropdown>
                    ) : null}
                    <button type="button" onClick={onClose} aria-label="关闭作品详情" title="关闭 (Esc)" className="grid size-10 place-items-center rounded-xl backdrop-blur-md" style={ICON_BUTTON}>
                        <X className="size-4" />
                    </button>
                </div>
                <div className="-mt-4 px-4 pb-12 pt-6 text-center">
                    <h2 className="text-[26px] font-semibold tracking-tight" style={{ color: "var(--wd-text)" }}>
                        <span className="italic">复刻</span>这个作品
                    </h2>
                    <p className="mt-2 text-[14px]" style={{ color: "var(--wd-text-2)" }}>用你自己的虚拟形象、产品等内容，制作同款作品。</p>
                </div>
                {relatedQuery.isLoading ? (
                    <div className="grid place-items-center py-20">
                        <LoaderCircle className="size-5 animate-spin" style={{ color: "var(--wd-text-3)" }} />
                    </div>
                ) : (
                    <div className="columns-2 gap-1.5 pb-8 md:columns-3 xl:columns-4">
                        {related.map((item) => (
                            <RelatedCard key={item.slug} item={item} onOpen={() => select(item.slug)} onExpand={() => item.preview && setLightbox({ url: item.preview.url, mediaType: item.preview.mediaType as "image" | "video", title: item.title })} />
                        ))}
                    </div>
                )}
                <div ref={sentinelRef} className="h-10" aria-hidden />
                {relatedQuery.isFetchingNextPage ? (
                    <div className="grid place-items-center pb-8">
                        <LoaderCircle className="size-5 animate-spin" style={{ color: "var(--wd-text-3)" }} />
                    </div>
                ) : null}
                {query.error ? (
                    <div className="absolute inset-x-0 top-24 text-center">
                        <Button onClick={() => void query.refetch()}>重新加载</Button>
                    </div>
                ) : null}
            </section>
            {lightbox ? (
                <div className="fixed inset-0 z-[1020] grid cursor-zoom-out place-items-center bg-black/90 p-8 backdrop-blur-sm work-detail-enter" onClick={() => setLightbox(null)} data-testid="work-lightbox" role="dialog" aria-label={`大图：${lightbox.title}`}>
                    {lightbox.mediaType === "video" ? (
                        <video src={lightbox.url} controls autoPlay loop playsInline className="max-h-full max-w-full rounded-lg" onClick={(event) => event.stopPropagation()} />
                    ) : (
                        <img src={lightbox.url} alt={lightbox.title} className="max-h-full max-w-full rounded-lg object-contain" />
                    )}
                    <button type="button" onClick={() => setLightbox(null)} aria-label="关闭大图" className="absolute right-6 top-6 grid size-10 place-items-center rounded-xl" style={{ color: "#fff", backgroundColor: "rgba(255,255,255,0.12)" }}>
                        <X className="size-4" />
                    </button>
                </div>
            ) : null}
            {work ? <PublicWorkReportButton slug={work.slug} compact open={reportOpen} onOpenChange={setReportOpen} hideTrigger /> : null}
            <LibraryPicker open={libraryOpen} onClose={() => setLibraryOpen(false)} max={Math.max(0, MAX_REFERENCES - totalReferences)} onPick={(assets) => {
                addLibraryAssets(assets);
                setLibraryOpen(false);
            }} />
        </div>,
        document.body,
    );
}

const MAX_REFERENCES = 6;

type ReferenceItem = { key: string; preview: string; kind: "image" | "video"; file?: File; objectUrl?: string; url?: string; mimeType?: string; name?: string };

async function referenceToFile(item: ReferenceItem): Promise<File> {
    if (item.file) return item.file;
    const response = await fetch(item.url!);
    if (!response.ok) throw new Error("读取参考素材失败");
    const blob = await response.blob();
    const mimeType = blob.type || item.mimeType || (item.kind === "video" ? "video/mp4" : "image/png");
    const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
    return new File([blob], `${(item.name || "reference").slice(0, 40)}.${extension}`, { type: mimeType });
}

function ReferenceTile({ preview, label, video = false, onRemove }: { preview: string; label: string; video?: boolean; onRemove: () => void }) {
    return (
        <span className="group/ref relative size-[72px] overflow-hidden rounded-xl" title={label} style={{ backgroundColor: "var(--wd-chip)" }}>
            {video ? <video src={`${preview}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" /> : <img src={preview} alt={label} className="size-full object-cover" />}
            <button type="button" onClick={onRemove} aria-label={`移除${label}`} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full opacity-0 transition-opacity group-hover/ref:opacity-100" style={{ color: "#fff", backgroundColor: "rgba(0,0,0,0.6)" }}>
                <X className="size-3" />
            </button>
        </span>
    );
}

/** 从素材库选图片 / 视频：网格多选，确认后带回 */
function LibraryPicker({ open, onClose, onPick, max }: { open: boolean; onClose: () => void; onPick: (assets: Asset[]) => void; max: number }) {
    const [selected, setSelected] = useState<string[]>([]);
    const query = useQuery({
        queryKey: ["work-detail-library"],
        queryFn: () => listLibraryAssetPage({ page: 1, pageSize: 60 }),
        enabled: open,
        staleTime: 30_000,
    });
    useEffect(() => {
        if (open) setSelected([]);
    }, [open]);
    const assets = (query.data?.assets || []).filter((asset) => asset.kind === "image" || asset.kind === "video");
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[1010] grid place-items-center bg-black/40 p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
            <div className="flex max-h-[80vh] w-[min(760px,92vw)] flex-col overflow-hidden rounded-2xl" style={{ backgroundColor: "var(--wd-panel)", color: "var(--wd-text)" }} data-testid="work-library-picker">
                <div className="flex items-center justify-between px-5 py-4">
                    <h3 className="text-[15px] font-semibold">从素材库选取</h3>
                    <button type="button" onClick={onClose} aria-label="关闭素材库" className="grid size-8 place-items-center rounded-lg" style={{ color: "var(--wd-text-2)" }}>
                        <X className="size-4" />
                    </button>
                </div>
                <div className="min-h-[240px] flex-1 overflow-y-auto px-5">
                    {query.isLoading ? (
                        <div className="grid h-48 place-items-center"><LoaderCircle className="size-5 animate-spin" style={{ color: "var(--wd-text-3)" }} /></div>
                    ) : !assets.length ? (
                        <p className="grid h-48 place-items-center text-[13px]" style={{ color: "var(--wd-text-3)" }}>素材库里还没有图片或视频</p>
                    ) : (
                        <div className="grid grid-cols-4 gap-2 pb-4 sm:grid-cols-5">
                            {assets.map((asset) => {
                                const index = selected.indexOf(asset.id);
                                const active = index >= 0;
                                return (
                                    <button
                                        key={asset.id}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => setSelected((current) => (active ? current.filter((id) => id !== asset.id) : current.length < max ? [...current, asset.id] : current))}
                                        className={cn("relative aspect-square overflow-hidden rounded-xl", active && "ring-2 ring-offset-2")}
                                        style={{ backgroundColor: "var(--wd-card)", ["--tw-ring-color" as string]: "var(--wd-text)", ["--tw-ring-offset-color" as string]: "var(--wd-panel)" }}
                                        title={asset.title}
                                    >
                                        {asset.coverUrl ? <img src={imagePreviewUrl(asset.coverUrl, 240)} alt={asset.title} className="size-full object-cover" /> : null}
                                        {active ? <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full text-[11px] font-semibold" style={{ color: "var(--wd-btn-text)", backgroundColor: "var(--wd-btn)" }}>{index + 1}</span> : null}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="flex items-center justify-between px-5 py-4">
                    <span className="text-[12px]" style={{ color: "var(--wd-text-3)" }}>已选 {selected.length}，最多 {max}</span>
                    <button type="button" disabled={!selected.length} onClick={() => onPick(assets.filter((asset) => selected.includes(asset.id)))} className="h-9 rounded-[10px] px-5 text-[13px] font-medium disabled:opacity-40" style={{ color: "var(--wd-btn-text)", backgroundColor: "var(--wd-btn)" }}>
                        确定
                    </button>
                </div>
            </div>
        </div>
    );
}

const ICON_BUTTON = { color: "var(--wd-icon-text)", backgroundColor: "var(--wd-icon)" } as const;

function RelatedCard({ item, onOpen, onExpand }: { item: PublicGalleryItem; onOpen: () => void; onExpand: () => void }) {
    return (
        <div className="group/card relative mb-1.5 break-inside-avoid">
            <button
                type="button"
                onClick={onExpand}
                aria-label={`放大查看：${item.title}`}
                title="放大查看"
                className="absolute right-2.5 top-2.5 z-10 grid size-7 place-items-center rounded-lg opacity-0 transition-opacity group-hover/card:opacity-100"
                style={{ color: "#fff", backgroundColor: "rgba(0,0,0,0.5)" }}
            >
                <Maximize2 className="size-3.5" />
            </button>
            <button type="button" onClick={onOpen} title={item.title} className="group/rel relative block w-full overflow-hidden rounded-xl text-left ring-2 ring-transparent transition-[box-shadow] duration-200 hover:ring-white" style={{ backgroundColor: "var(--wd-card)" }}>
                {item.preview?.mediaType === "image" ? (
                    <img src={imagePreviewUrl(item.preview.url, 480)} alt={item.title} loading="lazy" className="block w-full transition-transform duration-500 group-hover/rel:scale-[1.04]" />
                ) : (
                    <video src={`${item.preview!.url}#t=0.1`} muted playsInline preload="metadata" className="block aspect-video w-full object-cover" />
                )}
                <span className="pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/65 via-black/10 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover/rel:opacity-100">
                    <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-white">{item.title}</span>
                        <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-white/80">
                            <span className="grid size-4 place-items-center overflow-hidden rounded-full bg-white text-[8px] font-semibold text-[#18181b]">
                                {item.authorAvatarUrl ? <img src={item.authorAvatarUrl} alt="" className="size-full object-cover" /> : userAvatarFallback(item.authorName || "匿名")}
                            </span>
                            <span className="truncate">{item.authorName || "匿名作者"}</span>
                        </span>
                    </span>
                    <span className="self-end rounded-full bg-white px-3 py-1 text-[12px] font-medium text-[#18181b]">做同款</span>
                </span>
            </button>
        </div>
    );
}

function aspectLabel(width: number, height: number) {
    const known = [[1, 1], [4, 3], [3, 4], [16, 9], [9, 16], [3, 2], [2, 3], [4, 5], [5, 4], [21, 9]];
    const ratio = width / height;
    const match = known.find(([w, h]) => Math.abs(w / h - ratio) < 0.02);
    return match ? `${match[0]}:${match[1]}` : `${ratio.toFixed(2)}:1`;
}
