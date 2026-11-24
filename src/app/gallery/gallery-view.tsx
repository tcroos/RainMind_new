"use client";

import { ArrowRight, ChevronDown, Compass, Plus, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { PublicWorkPreviewModal } from "@/components/works/public-work-preview-modal";
import { PublicWorkGalleryCard } from "@/components/works/public-work-gallery-card";
import { PublicCreatorModal } from "@/components/works/public-creator-modal";
import { ResponsiveMasonryGrid } from "@/components/works/responsive-masonry-grid";
import { WORK_CATEGORY_OPTIONS } from "@/lib/work-publication-options";
import { cn } from "@/lib/utils";
import type { GalleryFilters, GalleryResult } from "./gallery-data";
import { GalleryPublishLink } from "./gallery-publish-link";

/* 广场与素材库共用一套「无线条」语言：不画分隔横线、不套描边输入框、不摆虚线空状态卡。
 * 层级只由留白、字重、浅底块（--surface-inset）和唯一一处品牌色动作点建立；
 * 聚焦时给一圈极淡的品牌柔光，而不是硬边框。 */
const fieldClass = "h-11 w-full min-w-0 appearance-none rounded-xl bg-[var(--surface-inset)] px-4 text-[13px] text-[var(--ink-1)] outline-none transition placeholder:text-[var(--ink-3)] focus:shadow-[0_0_0_2px_var(--brand-soft)]";
const primaryClass = "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl !bg-[var(--brand-600)] px-5 text-[13px] font-medium !text-white transition hover:opacity-90";
const softClass = "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl !bg-[var(--surface-inset)] px-5 text-[13px] font-medium !text-[var(--ink-1)] transition hover:opacity-75";

export function GalleryView({ filters, gallery, basePath, embedded = false }: { filters: GalleryFilters; gallery: GalleryResult; basePath: string; embedded?: boolean }) {
    const filtered = hasFilters(filters);
    const [previewSlug, setPreviewSlug] = useState("");
    const [creatorUsername, setCreatorUsername] = useState("");
    const [sort, setSort] = useState(filters.sort);
    const [featuredOnly, setFeaturedOnly] = useState(filters.featured === "1");
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => setSort(filters.sort), [filters.sort]);
    useEffect(() => setFeaturedOnly(filters.featured === "1"), [filters.featured]);

    return (
        <div className="mx-auto w-full max-w-[1440px] px-5 pb-20 pt-8 sm:px-9 sm:pb-24 sm:pt-12 lg:px-12">
            {/* 页头：标题与出口各自成组，留出整段呼吸，不再让按钮贴着标题挤在一条窄带里。 */}
            <section className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-4">
                <div className="min-w-0">
                    <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[var(--ink-1)] sm:text-[32px]">灵感发现</h1>
                    <p className="mt-2 text-[13px] leading-6 text-[var(--ink-3)]">从社区公开作品里，找到下一个创作的起点</p>
                </div>
                {embedded ? (
                    <Link href="/me?tab=works" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl !bg-[var(--surface-inset)] px-4 text-[13px] font-medium !text-[var(--ink-1)] transition hover:opacity-75">
                        <Plus className="size-4" />
                        管理我的作品
                    </Link>
                ) : null}
            </section>

            {/* 分类：整排浅底药丸，选中靠品牌柔色 + 字重，底下不再压一条横线。 */}
            <nav className="mt-8 flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mt-9" aria-label="作品分类">
                <Link href={galleryFilterHref(basePath, filters, "")} className={categoryClass(!filters.category)}>
                    全部
                </Link>
                {WORK_CATEGORY_OPTIONS.map((option) => (
                    <Link key={option.value} href={galleryFilterHref(basePath, filters, option.value)} className={categoryClass(filters.category === option.value)}>
                        {option.label}
                    </Link>
                ))}
            </nav>

            {/* 筛选：全部控件都是同一高度的浅底块，桌面一行、窄屏两列；
                排序改成原生 select（避开 antd 的描边），选完即提交，不用再多点一次。 */}
            <form ref={formRef} className="mt-5 grid min-w-0 grid-cols-2 gap-2.5 sm:mt-6 sm:gap-3 md:grid-cols-[minmax(240px,1fr)_minmax(140px,0.45fr)_168px_auto_auto]" action={basePath}>
                <input type="hidden" name="category" value={filters.category} />
                <label className="relative col-span-2 min-w-0 md:col-span-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-3)]" />
                    <input name="keyword" defaultValue={filters.keyword} placeholder="搜索标题、说明或提示词" aria-label="搜索作品" className={cn(fieldClass, "pl-11 pr-4")} />
                </label>
                <input name="tag" defaultValue={filters.tag} placeholder="标签" aria-label="作品标签" className={fieldClass} />
                <label className="relative min-w-0">
                    <select
                        name="sort"
                        aria-label="作品排序"
                        value={sort}
                        onChange={(event) => {
                            setSort(event.target.value);
                            requestAnimationFrame(() => formRef.current?.requestSubmit());
                        }}
                        className={cn(fieldClass, "cursor-pointer pr-9")}
                    >
                        <option value="random">随机发现</option>
                        <option value="featured">精选优先</option>
                        <option value="latest">最新发布</option>
                        <option value="popular">最多访问</option>
                        <option value="weekly">本周热榜</option>
                        <option value="monthly">本月热榜</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-3)]" />
                </label>
                <button
                    type="button"
                    aria-pressed={featuredOnly}
                    onClick={() => setFeaturedOnly((value) => !value)}
                    className={cn(
                        "col-span-1 inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-medium transition md:col-span-1",
                        featuredOnly ? "!bg-[var(--brand-soft)] !text-[var(--brand-600)]" : "!bg-[var(--surface-inset)] !text-[var(--ink-2)] hover:opacity-75",
                    )}
                >
                    <span className={cn("size-2 shrink-0 rounded-full", featuredOnly ? "bg-[var(--brand-600)]" : "bg-[var(--ink-3)]/45")} />
                    只看精选
                </button>
                {featuredOnly ? <input type="hidden" name="featured" value="1" /> : null}
                {/* 窄屏时「只看精选」与「筛选」并成最后一行，不再留一个半宽的空格子；
                    清除是次要动作，移动端交给空状态里的「清除筛选」，避免挤窄主按钮。 */}
                <div className="col-span-1 flex min-w-0 items-center justify-end gap-4 md:col-span-1">
                    {filtered ? (
                        <Link href={basePath} className="hidden shrink-0 text-[13px] font-medium !text-[var(--ink-3)] transition hover:!text-[var(--ink-1)] md:inline-flex">
                            清除
                        </Link>
                    ) : null}
                    <button className={cn(primaryClass, "w-full")} type="submit">
                        <Search className="size-4" />
                        筛选
                    </button>
                </div>
            </form>

            {gallery.error ? (
                <EmptyState
                    title="作品广场暂时不可用"
                    description={gallery.error}
                />
            ) : gallery.items.length ? (
                <ResponsiveMasonryGrid className="grid-cols-2 gap-x-4 gap-y-8 pt-8 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-10 sm:pt-10 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6" ariaLabel="作品列表">
                    {gallery.items.map((item) => (
                        <PublicWorkGalleryCard key={item.slug} item={item} nextPath={basePath} onOpen={() => setPreviewSlug(item.slug)} onOpenAuthor={setCreatorUsername} />
                    ))}
                </ResponsiveMasonryGrid>
            ) : (
                <EmptyState
                    title={filtered ? "没有匹配的公开作品" : "还没有公开作品"}
                    description={filtered ? "换个关键词或分类，再看看别的创作。" : "审核通过并公开发布的作品会出现在这里。"}
                    action={
                        filtered ? (
                            <Link href={basePath} className={primaryClass}>
                                清除筛选
                            </Link>
                        ) : (
                            <>
                                <GalleryPublishLink className={primaryClass} label="发布第一个作品" />
                                <Link href="/create" className={softClass}>
                                    <Sparkles className="size-4" />
                                    开始创作
                                </Link>
                            </>
                        )
                    }
                />
            )}

            {gallery.nextCursor ? (
                <div className="flex justify-center pt-10 sm:pt-14">
                    <Link href={nextPageHref(basePath, filters, gallery.nextCursor)} className="inline-flex h-11 items-center gap-2 rounded-xl !bg-[var(--surface-inset)] px-6 text-[13px] font-medium !text-[var(--ink-1)] transition hover:opacity-75">
                        查看更多
                        <ArrowRight className="size-4" />
                    </Link>
                </div>
            ) : null}
            <PublicWorkPreviewModal slug={previewSlug || undefined} onClose={() => setPreviewSlug("")} onOpenCreator={setCreatorUsername} />
            <PublicCreatorModal username={creatorUsername || undefined} nextPath={basePath} onClose={() => setCreatorUsername("")} />
        </div>
    );
}

/* 空状态 / 错误态：不套虚线框，也不让一条横线把页面切成上下两半。
 * 只有一枚浅底图标、一句标题、一行说明和一个动作，靠上下大留白把视线收在中间。 */
function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
    return (
        <section className="flex min-h-[320px] flex-col items-center justify-center px-6 py-16 text-center sm:min-h-[400px] sm:py-24">
            <span className="grid size-14 place-items-center rounded-2xl bg-[var(--surface-inset)] text-[var(--ink-3)]">
                <Compass className="size-6" />
            </span>
            {/* h2 的 margin 被 antd 重置，上边距交给包裹层承载。 */}
            <div className="mt-6">
                <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--ink-1)]">{title}</h2>
            </div>
            <p className="mt-2 max-w-sm text-[13px] leading-6 text-[var(--ink-3)]">{description}</p>
            {action ? <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{action}</div> : null}
        </section>
    );
}

function hasFilters(filters: GalleryFilters) {
    return Boolean(filters.keyword || filters.category || filters.tag || filters.featured || filters.sort !== "random");
}

function categoryClass(active: boolean) {
    return cn(
        "inline-flex h-9 shrink-0 items-center rounded-full px-4 text-[13px] transition",
        active
            ? "!bg-[var(--brand-soft)] font-semibold !text-[var(--brand-600)]"
            : "font-medium !text-[var(--ink-3)] hover:!bg-[var(--surface-inset)] hover:!text-[var(--ink-1)]",
    );
}

function galleryFilterHref(basePath: string, filters: GalleryFilters, category: string) {
    const params = new URLSearchParams();
    Object.entries({ ...filters, category, cursor: "" }).forEach(([key, value]) => {
        if (value) params.set(key, value);
    });
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
}

function nextPageHref(basePath: string, filters: GalleryFilters, cursor: string) {
    const params = new URLSearchParams();
    Object.entries({ ...filters, cursor }).forEach(([key, value]) => {
        if (value) params.set(key, value);
    });
    return `${basePath}?${params}`;
}
