"use client";

import { Eye, GalleryVerticalEnd, Star, Video } from "lucide-react";
import Link from "next/link";

import { LazyMediaImage } from "@/components/media/lazy-media-image";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { userAvatarInitial } from "@/lib/user-avatar";
import type { PublicGalleryItem } from "@/services/api/work-governance";
import { PublicWorkLikeButton } from "./public-work-like-button";

export function PublicWorkGalleryCard({ item, nextPath, onOpen, onOpenAuthor }: { item: PublicGalleryItem; nextPath: string; onOpen: () => void; onOpenAuthor?: (username: string) => void }) {
    const authorUsername = item.authorUsername;
    const author = (
        <>
            {/* 默认头像与右上角、个人主页同一套品牌橙 + 单个首字，深色双字会显得是另一套系统。 */}
            <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#f6b181_0%,#e2671f_100%)] text-[9px] font-semibold !text-white">
                {item.authorAvatarUrl ? <img src={item.authorAvatarUrl} alt="" className="size-full object-cover" loading="lazy" /> : userAvatarInitial(item.authorName || "匿名作者")}
            </span>
            <span className="truncate">{item.authorName || "匿名作者"}</span>
        </>
    );

    return (
        <article className="group w-full min-w-0 text-left text-foreground">
            {/* 图片本身是卡片，不额外套描边框；hover 只给一点上浮和极淡的落影。 */}
            <button
                type="button"
                className="relative block w-full overflow-hidden rounded-2xl bg-[var(--surface-inset)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-26px_rgba(17,17,19,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                onClick={onOpen}
                aria-label={`查看作品：${item.title}`}
                aria-haspopup="dialog"
            >
                {item.preview?.mediaType === "image" ? (
                    <LazyMediaImage src={imagePreviewUrl(item.preview.url, 640)} alt={item.title} containerClassName="w-full rounded-2xl" imageClassName="block h-auto w-full transition duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
                ) : item.preview?.mediaType === "video" ? (
                    <>
                        <video src={item.preview.url} muted playsInline preload="metadata" className="aspect-video w-full object-cover transition duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
                        <span className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full bg-[var(--surface-panel)] text-[var(--ink-1)] shadow-[0_2px_10px_rgba(0,0,0,0.08)]" title="视频作品">
                            <Video className="size-3.5" />
                        </span>
                    </>
                ) : (
                    <div className="grid aspect-[4/3] w-full place-items-center text-[var(--ink-3)]">
                        <div className="flex flex-col items-center gap-2 text-xs">
                            <GalleryVerticalEnd className="size-7" />
                            公开作品
                        </div>
                    </div>
                )}
                {item.isFeatured ? (
                    <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-[var(--surface-panel)] px-2.5 py-1 text-[11px] font-semibold !text-[var(--brand-600)] shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
                        <Star className="size-3 fill-current" />
                        精选
                    </span>
                ) : null}
            </button>

            {/* 标题常显在图片下方：信息不用藏在 hover 里，图文也各自有清楚的呼吸。 */}
            <div className="min-w-0 px-0.5 pt-3">
                <button type="button" onClick={onOpen} className="block w-full truncate text-left text-[13px] font-semibold leading-5 !text-[var(--ink-1)] transition hover:!text-[var(--brand-600)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`查看作品：${item.title}`} aria-haspopup="dialog">
                    {item.title}
                </button>
                <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-[11px] text-[var(--ink-3)]">
                    {authorUsername && onOpenAuthor ? (
                        <button
                            type="button"
                            className="flex min-w-0 items-center gap-1.5 rounded-sm text-left transition hover:!text-[var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`查看 ${item.authorName || authorUsername} 的主页`}
                            aria-haspopup="dialog"
                            onClick={() => onOpenAuthor(authorUsername)}
                        >
                            {author}
                        </button>
                    ) : authorUsername ? (
                        <Link
                            href={`/u/${encodeURIComponent(authorUsername)}`}
                            className="flex min-w-0 items-center gap-1.5 rounded-sm transition hover:!text-[var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`查看 ${item.authorName || authorUsername} 的主页`}
                        >
                            {author}
                        </Link>
                    ) : (
                        <span className="flex min-w-0 items-center gap-1.5">{author}</span>
                    )}
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                        <span className="inline-flex items-center gap-1" title="访问">
                            <Eye className="size-3" /> {item.viewCount}
                        </span>
                        <PublicWorkLikeButton slug={item.slug} initialCount={item.likeCount} compact nextPath={nextPath} />
                    </span>
                </div>
            </div>
        </article>
    );
}
