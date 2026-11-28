"use client";

import type { MenuProps } from "antd";
import { App, Dropdown } from "antd";
import { Copy, Ellipsis, Eye, FileText, ImagePlus, LoaderCircle, Plus, RefreshCw, Search, Video } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PublicWorkPreviewModal } from "@/components/works/public-work-preview-modal";
import { ResponsiveMasonryGrid } from "@/components/works/responsive-masonry-grid";
import { PublicCreatorModal } from "@/components/works/public-creator-modal";
import { PublicWorkLikeButton } from "@/components/works/public-work-like-button";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { LazyMediaImage } from "@/components/media/lazy-media-image";
import { userAvatarFallback } from "@/lib/user-avatar";
import { WORK_CATEGORY_OPTIONS } from "@/lib/work-publication-options";
import { cn } from "@/lib/utils";
import { listPublicGallery, type PublicGalleryItem } from "@/services/api/work-governance";

const categories = [{ value: "", label: "全部" }, ...WORK_CATEGORY_OPTIONS];

const PAGE_SIZE = 20;
const SKELETON_RATIOS = ["3 / 4", "16 / 9", "1 / 1", "4 / 5", "9 / 14", "4 / 3"];

/* 媒体比例在加载后才知道：先用占位比例，拿到原始宽高后再撑开，极端比例裁到 0.6~1.8 */
function clampRatio(width: number, height: number) {
    if (!width || !height) return undefined;
    return Math.min(1.8, Math.max(0.6, width / height));
}

export function CreateInspirationGallery({ onUsePrompt, onUseImage, onUseReferences }: { onUsePrompt: (prompt: string) => void; onUseImage: (item: PublicGalleryItem) => Promise<void>; onUseReferences?: (files: File[]) => Promise<void> }) {
    const [category, setCategory] = useState("");
    const [keywordInput, setKeywordInput] = useState("");
    const [keyword, setKeyword] = useState("");
    const [items, setItems] = useState<PublicGalleryItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState("");
    const [reloadToken, setReloadToken] = useState(0);
    const [importingSlug, setImportingSlug] = useState("");
    const [previewSlug, setPreviewSlugState] = useState("");
    /* 详情可分享：打开时把 ?work=slug 写进地址（push，浏览器「返回」= 关闭），切换作品用 replace */
    /* 历史记录操作不能放进 setState 的 updater（开发模式下会执行两次，导致 push 两条） */
    const previewSlugRef = useRef("");
    const setPreviewSlug = useCallback((next: string) => {
        const current = previewSlugRef.current;
        if (next === current) return;
        const url = new URL(window.location.href);
        if (next) url.searchParams.set("work", next);
        else url.searchParams.delete("work");
        previewSlugRef.current = next;
        setPreviewSlugState(next);
        if (next && !current) window.history.pushState({ work: next }, "", url);
        else if (!next && window.history.state?.work) window.history.back();
        else window.history.replaceState(next ? { work: next } : null, "", url);
    }, []);
    useEffect(() => {
        const initial = new URLSearchParams(window.location.search).get("work");
        if (initial) {
            previewSlugRef.current = initial;
            setPreviewSlugState(initial);
        }
        const onPop = () => {
            const value = new URLSearchParams(window.location.search).get("work") || "";
            previewSlugRef.current = value;
            setPreviewSlugState(value);
        };
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);
    const [creatorUsername, setCreatorUsername] = useState("");
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => setKeyword(keywordInput.trim()), 320);
        return () => window.clearTimeout(timer);
    }, [keywordInput]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError("");
        void listPublicGallery({ category, keyword, limit: PAGE_SIZE, sort: "random" })
            .then((result) => {
                if (!active) return;
                setItems(result.items);
                setNextCursor(result.nextCursor);
            })
            .catch((error) => {
                if (active) setError(error instanceof Error ? error.message : "灵感作品加载失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [category, keyword, reloadToken]);

    /* 无限滚动：哨兵进入视口就续一页，没有分页器也没有「加载更多」按钮 */
    const loadMore = useCallback(() => {
        if (!nextCursor || loadingMore || loading) return;
        setLoadingMore(true);
        void listPublicGallery({ category, keyword, limit: PAGE_SIZE, sort: "random", cursor: nextCursor })
            .then((result) => {
                setItems((current) => {
                    const seen = new Set(current.map((item) => item.slug));
                    return [...current, ...result.items.filter((item) => !seen.has(item.slug))];
                });
                setNextCursor(result.nextCursor);
            })
            .catch(() => setNextCursor(undefined))
            .finally(() => setLoadingMore(false));
    }, [category, keyword, loading, loadingMore, nextCursor]);

    useEffect(() => {
        const element = sentinelRef.current;
        if (!element || !nextCursor) return;
        const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && loadMore(), { rootMargin: "600px 0px" });
        observer.observe(element);
        return () => observer.disconnect();
    }, [loadMore, nextCursor]);

    const importImage = async (item: PublicGalleryItem) => {
        setImportingSlug(item.slug);
        try {
            await onUseImage(item);
        } finally {
            setImportingSlug("");
        }
    };

    const previewItem = items.find((item) => item.slug === previewSlug);
    /* 精选图片作品做成横跨两列的大卡，但每 8 张里最多一张，避免满屏大卡 */
    const colSpans = useMemo(() => {
        let lastWide = -8;
        return items.map((item, index) => {
            if (item.isFeatured && item.preview?.mediaType === "image" && index - lastWide >= 8) {
                lastWide = index;
                return 2;
            }
            return 1;
        });
    }, [items]);
    /* 点开作品：从卡片位置放大到屏幕中央的过渡，弹窗随后淡入 */
    const [zoom, setZoom] = useState<{ src: string; rect: DOMRect; phase: "start" | "end" } | null>(null);
    const openWithZoom = (item: PublicGalleryItem, element: HTMLElement | null) => {
        const media = element?.querySelector("img,video") as HTMLImageElement | HTMLVideoElement | null;
        const src = media ? (media instanceof HTMLVideoElement ? media.poster || "" : media.currentSrc || media.src) : "";
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (!element || !src || reduce) {
            setPreviewSlug(item.slug);
            return;
        }
        setZoom({ src, rect: element.getBoundingClientRect(), phase: "start" });
        requestAnimationFrame(() => requestAnimationFrame(() => setZoom((value) => (value ? { ...value, phase: "end" } : value))));
        window.setTimeout(() => setPreviewSlug(item.slug), 260);
        window.setTimeout(() => setZoom(null), 520);
    };

    return (
        <section className="mt-10 w-full" aria-labelledby="create-inspiration-heading" data-testid="create-inspiration-gallery">
            {/* 标签、搜索与分类吸顶：瀑布流很长，滚下去也能直接切换 */}
            <div data-testid="create-inspiration-sticky" className="sticky top-0 z-30 -mx-2.5 mb-3 bg-[var(--surface-canvas)]/88 px-2.5 pt-3 backdrop-blur-md sm:-mx-8 sm:px-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div role="tablist" className="inline-flex h-8 items-center gap-6">
                    <h2 id="create-inspiration-heading" role="tab" aria-selected="true" className="m-0 text-base font-medium leading-8 text-[var(--ink-1)]">
                        灵感发现
                    </h2>
                    <Link href="/community" role="tab" aria-selected="false" className="leading-8 text-base text-[var(--ink-3)] transition hover:text-[var(--ink-1)]">
                        作品广场
                    </Link>
                    <Link href="/assets?tab=public" role="tab" aria-selected="false" className="hidden leading-8 text-base text-[var(--ink-3)] transition hover:text-[var(--ink-1)] sm:inline">
                        公共词库
                    </Link>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                    <label className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-full bg-[var(--surface-soft)] px-3 text-[var(--ink-3)] shadow-[inset_0_0_0_1px_var(--hairline)] focus-within:text-[var(--ink-1)] sm:w-56">
                        <Search className="size-3.5 shrink-0" />
                        <input value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} placeholder="输入作品名称搜索" aria-label="搜索灵感作品" className="h-full min-w-0 flex-1 bg-transparent text-xs text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]" />
                    </label>
                    <Link href="/me?tab=works" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-[var(--ink-1)] px-3 text-xs font-medium text-[var(--surface-canvas)] transition hover:opacity-85">
                        <Plus className="size-3.5" /> 发布作品
                    </Link>
                </div>
            </div>

            <nav className="hide-scrollbar flex h-10 min-w-0 items-center gap-5 overflow-x-auto" aria-label="灵感分类">
                {categories.map((item) => (
                    <button
                        key={item.value || "all"}
                        type="button"
                        className={cn("h-full shrink-0 text-sm transition", category === item.value ? "font-medium text-[var(--ink-1)]" : "text-[var(--ink-3)] hover:text-[var(--ink-1)]")}
                        aria-pressed={category === item.value}
                        onClick={() => setCategory(item.value)}
                    >
                        {item.label}
                    </button>
                ))}
            </nav>
            </div>

            {loading ? (
                <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label="正在读取灵感作品">
                    {Array.from({ length: 10 }, (_, index) => (
                        <div key={index} className="animate-pulse rounded-[12px] bg-[var(--surface-inset)]" style={{ aspectRatio: SKELETON_RATIOS[index % SKELETON_RATIOS.length] }} />
                    ))}
                </div>
            ) : error ? (
                <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-center">
                    <p className="text-xs text-[#9a5b5b] dark:text-[#d49a9a]">{error}</p>
                    <button type="button" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#697381] hover:text-[#20242a] dark:text-[#9aa3af] dark:hover:text-white" onClick={() => setReloadToken((value) => value + 1)}>
                        <RefreshCw className="size-3.5" /> 重新读取
                    </button>
                </div>
            ) : items.length ? (
                <>
                    {/* 瀑布流：列宽固定，每张按原始比例（裁到 0.6~1.8 之间）显示，高低错落 */}
                    <ResponsiveMasonryGrid className="grid-cols-2 !gap-x-3 !gap-y-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" ariaLabel="灵感作品列表" colSpans={colSpans}>
                        {items.map((item, index) => (
                            <InspirationCard key={item.slug} item={item} wide={colSpans[index] > 1} importing={importingSlug === item.slug} onOpen={(element) => openWithZoom(item, element)} onOpenAuthor={setCreatorUsername} onUsePrompt={onUsePrompt} onUseImage={() => void importImage(item)} />
                        ))}
                    </ResponsiveMasonryGrid>
                    <div ref={sentinelRef} className="flex h-16 items-center justify-center text-xs text-[var(--ink-3)]">
                        {loadingMore ? (
                            <span className="inline-flex items-center gap-1.5">
                                <LoaderCircle className="size-3.5 animate-spin" /> 加载中…
                            </span>
                        ) : !nextCursor ? (
                            "已经到底了"
                        ) : null}
                    </div>
                </>
            ) : (
                <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-[14px] bg-[var(--surface-soft)] text-sm text-[var(--ink-3)]">
                    {keyword ? `没有找到与「${keyword}」相关的作品` : "当前分类还没有公开作品"}
                    <Link href="/me?tab=works" className="text-xs text-[var(--brand-600)] hover:underline">
                        去发布第一个作品 →
                    </Link>
                </div>
            )}
            {zoom ? (
                <img
                    src={zoom.src}
                    alt=""
                    aria-hidden
                    className="pointer-events-none fixed z-[1100] rounded-[12px] object-cover shadow-2xl transition-all duration-[260ms] ease-[cubic-bezier(.2,0,0,1)]"
                    style={
                        zoom.phase === "start"
                            ? { left: zoom.rect.left, top: zoom.rect.top, width: zoom.rect.width, height: zoom.rect.height, opacity: 1 }
                            : { left: "50%", top: "50%", width: "min(72vw, 900px)", height: `min(${Math.round((zoom.rect.height / zoom.rect.width) * 72)}vw, ${Math.round((zoom.rect.height / zoom.rect.width) * 900)}px, 80vh)`, transform: "translate(-50%, -50%)", opacity: 0.9 }
                    }
                />
            ) : null}
            <PublicWorkPreviewModal
                slug={previewSlug || undefined}
                imageImporting={importingSlug === previewSlug}
                onUseReferences={onUseReferences}
                onSelect={setPreviewSlug}
                onClose={() => setPreviewSlug("")}
                onOpenCreator={setCreatorUsername}
                onUsePrompt={(prompt) => {
                    onUsePrompt(prompt);
                    setPreviewSlug("");
                }}
                onUseImage={
                    previewItem?.preview?.mediaType === "image"
                        ? async () => {
                              await importImage(previewItem);
                              setPreviewSlug("");
                          }
                        : undefined
                }
            />
            <PublicCreatorModal username={creatorUsername || undefined} nextPath="/create" onClose={() => setCreatorUsername("")} />
        </section>
    );
}

function InspirationCard({
    item,
    wide = false,
    importing,
    onOpen,
    onOpenAuthor,
    onUsePrompt,
    onUseImage,
}: {
    item: PublicGalleryItem;
    wide?: boolean;
    importing: boolean;
    onOpen: (element: HTMLElement | null) => void;
    onOpenAuthor: (username: string) => void;
    onUsePrompt: (prompt: string) => void;
    onUseImage: () => void;
}) {
    const { message } = App.useApp();
    const image = item.preview?.mediaType === "image";
    const authorUsername = item.authorUsername;
    const menuItems: MenuProps["items"] = [
        item.publicPrompt ? { key: "prompt", icon: <FileText className="size-4" />, label: "使用提示词" } : null,
        item.publicPrompt ? { key: "copy", icon: <Copy className="size-4" />, label: "复制提示词" } : null,
        image ? { key: "image", icon: <ImagePlus className="size-4" />, label: "使用图片" } : null,
    ].filter(Boolean) as MenuProps["items"];

    const runAction: MenuProps["onClick"] = ({ key }) => {
        if (key === "prompt") return onUsePrompt(item.publicPrompt);
        if (key === "image") return onUseImage();
        if (key === "copy") {
            void navigator.clipboard
                .writeText(item.publicPrompt)
                .then(() => message.success("提示词已复制"))
                .catch(() => message.error("复制失败，请打开作品详情后手动复制"));
        }
    };

    const videoRef = useRef<HTMLVideoElement>(null);
    const isVideo = item.preview?.mediaType === "video";
    const [ratio, setRatio] = useState<number>();
    const articleRef = useRef<HTMLElement>(null);
    const previewSrc = image ? imagePreviewUrl(item.preview!.url, wide ? 1280 : 640) : "";
    useEffect(() => {
        if (!previewSrc) return;
        const probe = new Image();
        probe.onload = () => setRatio(clampRatio(probe.naturalWidth, probe.naturalHeight));
        probe.src = previewSrc;
        return () => {
            probe.onload = null;
        };
    }, [previewSrc]);
    /* hover 播放视频预览（参照 Seko：封面 → 动态画面），移出后回到首帧 */
    const playPreview = () => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = 0;
        void video.play().catch(() => undefined);
    };
    const stopPreview = () => {
        const video = videoRef.current;
        if (!video) return;
        video.pause();
        video.currentTime = 0;
    };

    return (
        <article
            ref={articleRef}
            role="listitem"
            data-wide={wide || undefined}
            className="group relative w-full min-w-0 overflow-hidden rounded-[12px] bg-[var(--surface-inset)] text-white"
            /* 大卡横跨两列：比例压扁一些（至少 4:3 横幅），避免一张图占半屏 */
            style={{ aspectRatio: wide ? Math.max(ratio ?? 1.6, 1.33) : (ratio ?? (isVideo ? 16 / 9 : 4 / 5)) }} onMouseEnter={playPreview} onMouseLeave={stopPreview}>
            <button type="button" className="absolute inset-0 z-10 block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6e87db]" onClick={() => onOpen(articleRef.current)} aria-label={`查看作品：${item.title}`} aria-haspopup="dialog" />
            {image ? (
                <LazyMediaImage src={previewSrc} alt={item.title} containerClassName="absolute inset-0 size-full" imageClassName="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
            ) : isVideo ? (
                <video
                    ref={videoRef}
                    src={`${item.preview!.url}#t=0.1`}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(event) => setRatio(clampRatio(event.currentTarget.videoWidth, event.currentTarget.videoHeight))}
                    className="pointer-events-none absolute inset-0 size-full object-cover"
                />
            ) : (
                <span className="absolute inset-0 grid place-items-center text-[#8b949f] dark:text-[#737d89]">
                    <ImagePlus className="size-7" />
                </span>
            )}
            {wide ? <span className="pointer-events-none absolute left-2.5 top-2.5 z-20 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">精选</span> : null}
            {isVideo ? (
                <span className="pointer-events-none absolute left-2 top-2 z-20 grid size-6 place-items-center rounded-md bg-black/45 text-white backdrop-blur-sm" title="视频作品">
                    <Video className="size-3.5" />
                </span>
            ) : null}

            {/* 文字信息平时隐藏，只留纯画面；悬停时底部渐隐浮出标题、作者与操作（参考 Seko / 小红书式瀑布流） */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 translate-y-2 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-2.5 pt-10 opacity-0 transition duration-300 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
                <div className={cn("truncate font-medium [text-shadow:0_1px_6px_rgba(0,0,0,.4)]", wide ? "text-[16px]" : "text-[13px]")}>{item.title || "未命名作品"}</div>
                <div className="pointer-events-auto mt-1 flex min-w-0 items-center justify-between gap-2 text-[11.5px] text-white/80">
                    {authorUsername ? (
                        <button
                            type="button"
                            className="flex min-w-0 items-center gap-1.5 rounded-sm text-left transition hover:text-white focus-visible:outline-none"
                            aria-label={`查看 ${item.authorName || authorUsername} 的主页`}
                            aria-haspopup="dialog"
                            onClick={() => onOpenAuthor(authorUsername)}
                        >
                            <AuthorAvatar item={item} />
                            <span className="truncate">{item.authorName || "匿名作者"}</span>
                        </button>
                    ) : (
                        <span className="flex min-w-0 items-center gap-1.5">
                            <AuthorAvatar item={item} />
                            <span className="truncate">{item.authorName || "匿名作者"}</span>
                        </span>
                    )}
                    <span className="flex shrink-0 items-center gap-2 tabular-nums [&_button]:!text-white/85">
                        <span className="inline-flex items-center gap-1" title="访问">
                            <Eye className="size-3.5" />
                            {item.viewCount}
                        </span>
                        <PublicWorkLikeButton slug={item.slug} initialCount={item.likeCount} compact nextPath="/create" />
                        {menuItems?.length ? (
                            <Dropdown menu={{ items: menuItems, onClick: runAction }} trigger={["click"]} placement="bottomRight">
                                <button
                                    type="button"
                                    disabled={importing}
                                    className="grid size-6 place-items-center rounded-md transition hover:bg-white/15 disabled:cursor-wait disabled:opacity-60"
                                    aria-label={`使用作品：${item.title}`}
                                    aria-haspopup="menu"
                                >
                                    {importing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Ellipsis className="size-4" />}
                                </button>
                            </Dropdown>
                        ) : null}
                    </span>
                </div>
            </div>
        </article>
    );
}

function AuthorAvatar({ item }: { item: PublicGalleryItem }) {
    return (
        <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full bg-[#20242a] text-[8px] font-semibold text-white dark:bg-[#f3f5f7] dark:text-[#20242a]">
            {item.authorAvatarUrl ? <img src={item.authorAvatarUrl} alt="" className="size-full object-cover" loading="lazy" /> : userAvatarFallback(item.authorName || "匿名作者")}
        </span>
    );
}
