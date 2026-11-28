"use client";

import { ChevronRight, History, Plus } from "lucide-react";
import Link from "next/link";

import { useCreateWorkbenchOverview } from "../use-create-workbench-overview";

/**
 * 特色功能（参照 Seko 首页）：一行五列。
 * 第一列是引导卡（StartCard：一句引导 + 新建空白画布 / 继续最近项目两枚按钮），
 * 后四列是 16:9 封面卡：底部磨砂渐隐字幕条 + 小箭头，hover 时内发光、封面微放大、右下角浮出「去创作」。
 */
const FEATURES = [
    { href: "/drama", title: "短剧工坊", description: "剧本分镜，一站成片", cover: "/quick-entry/drama.webp" },
    { href: "/image", title: "图片创作", description: "商品图、海报、人像", cover: "/empty-cover-2.jpg" },
    { href: "/video", title: "视频生成", description: "文生视频、图生视频", cover: "/empty-cover-3.jpg" },
    { href: "/assets?tab=prompts", title: "素材与提示词", description: "收藏与复用优质提示词", cover: "/library/prompt-empty-banner.webp" },
] as const;

export function CreateFeatureRow() {
    const { latestProject } = useCreateWorkbenchOverview();
    const latestHref = latestProject ? `/canvas/${latestProject.id}` : "/canvas";
    const latestLabel = latestProject ? `继续：${latestProject.title || "未命名项目"}` : "我的画布项目";

    return (
        <section className="mt-10 w-full sm:mt-14" aria-labelledby="create-feature-heading" data-testid="create-feature-row">
            <h2 id="create-feature-heading" className="mb-4 text-lg font-normal text-[var(--ink-1)]">
                特色功能
            </h2>
            <div className="hide-scrollbar -mx-2.5 flex snap-x gap-2.5 overflow-x-auto px-2.5 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
                <StartCard latestHref={latestHref} latestLabel={latestLabel} hasLatest={Boolean(latestProject)} />
                {FEATURES.map((feature) => (
                    <Link
                        key={feature.href}
                        href={feature.href}
                        className="group relative aspect-video w-[62vw] shrink-0 snap-start overflow-hidden rounded-[14px] bg-[var(--surface-inset)] transition-shadow duration-300 sm:w-auto"
                    >
                        <span className="create-feature-card__ring" aria-hidden />
                        <img src={feature.cover} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]" />
                        <span className="pointer-events-none absolute inset-0 rounded-[14px] transition-shadow duration-300 group-hover:shadow-[inset_0_0_14px_0_rgba(255,255,255,0.22)]" aria-hidden />
                        <span className="absolute inset-x-0 bottom-0 flex min-h-13 items-center justify-between gap-2 px-3.5 py-2.5">
                            <span className="create-feature-card__scrim" aria-hidden />
                            <span className="relative z-10 flex min-w-0 items-center">
                                <span className="truncate text-sm font-medium text-white [text-shadow:0_1px_8px_rgba(0,0,0,.35)]">{feature.title}</span>
                                <ChevronRight className="size-4 shrink-0 text-white/70" />
                            </span>
                            <span className="relative z-10 shrink-0 translate-y-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-[#18181b] opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">去创作</span>
                        </span>
                    </Link>
                ))}
            </div>
        </section>
    );
}

/* 注意：antd 的 a 标签基础样式不在 CSS layer 里，会压过 Tailwind 的背景/文字色，所以这两枚链接按钮的关键样式加了 !。 */
/**
 * 第一列引导卡（对应 Seko 的深灰引导卡）：我们是白底，所以不用深色块，
 * 改成和右侧封面卡同尺寸（16:9）的一张浅色卡：左上一句引导 + 角落暖橙柔光，
 * 底部两枚按钮 —— 主按钮「新建空白画布」实心，次按钮「继续最近项目」描边。
 */
function StartCard({ latestHref, latestLabel, hasLatest }: { latestHref: string; latestLabel: string; hasLatest: boolean }) {
    return (
        <div
            data-testid="create-feature-start"
            className="relative flex aspect-video w-[62vw] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-[14px] bg-[var(--surface-soft)] p-3.5 shadow-[inset_0_0_0_1px_var(--hairline)] sm:w-auto"
        >
            <span className="pointer-events-none absolute -top-10 -right-8 size-40 rounded-full bg-[radial-gradient(circle,rgba(226,103,31,0.22),transparent_68%)]" aria-hidden />
            <span className="pointer-events-none absolute -bottom-14 -left-10 size-36 rounded-full bg-[radial-gradient(circle,rgba(124,140,255,0.16),transparent_70%)]" aria-hidden />
            <span className="relative">
                <span className="block text-[15px] font-medium text-[var(--ink-1)]">从一块空白画布开始</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-3)]">节点式编排图片、视频和音频</span>
            </span>
            {/* 一个主按钮 + 一行文字链接：不再两个等宽按钮挤在一起 */}
            <span className="relative flex flex-col items-start gap-2">
                <Link
                    href="/canvas"
                    className="inline-flex !h-8 items-center justify-center gap-1.5 rounded-full !bg-[#18181b] px-4 text-[13px] font-medium !text-white transition-opacity hover:opacity-85 dark:!bg-white dark:!text-[#18181b]"
                >
                    <Plus className="size-3.5 shrink-0" strokeWidth={2.2} />
                    新建空白画布
                </Link>
                <Link href={latestHref} title={latestLabel} className="inline-flex max-w-full items-center gap-1 text-[12px] !text-[var(--ink-3)] transition-colors hover:!text-[var(--ink-1)]">
                    <History className="size-3 shrink-0" strokeWidth={1.8} />
                    <span className="truncate">{hasLatest ? "继续最近项目" : latestLabel}</span>
                </Link>
            </span>
        </div>
    );
}
