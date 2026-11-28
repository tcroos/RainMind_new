"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * 首页 Banner 轮播（参照 Seko）：中间一张大图，两侧各露半张，侧边图压暗；
 * 左右圆形磨砂箭头、底部条形指示器（当前项拉长），5 秒自动播放，悬停暂停。
 * 内容是运营位（功能上新、活动、教程），不再取作品广场的图——那些已经在下面的灵感发现里。
 */
type Slide = { key: string; tag: string; title: string; subtitle?: string; image: string; href?: string; cta: string };

const SLIDES: Slide[] = [
    { key: "drama", tag: "功能上新", title: "短剧工坊", subtitle: "从剧本到分镜再到成片，一站完成", image: "/profile-cover.webp", href: "/drama", cta: "开始创作" },
    { key: "topup", tag: "活动", title: "充值积分包", subtitle: "永久积分一次性到账，不随套餐过期", image: "/quick-entry/wallet.webp", href: "/wallet", cta: "去充值" },
    { key: "canvas", tag: "教程", title: "三分钟上手无限画布", subtitle: "节点式编排图片与视频，一张画布跑完整条创作链", image: "/library/asset-empty-banner.webp", href: "/canvas", cta: "打开画布" },
    { key: "referral", tag: "活动", title: "邀请好友，双方都得积分", subtitle: "好友注册与首单都有奖励，积分直接到账", image: "/generation-smoke.webp", href: "/wallet?section=referrals", cta: "复制邀请链接" },
    { key: "prompts", tag: "教程", title: "用好提示词库", subtitle: "收藏、复用、一键带入创作", image: "/library/asset-empty-banner-back.webp", href: "/assets?tab=prompts", cta: "去看看" },
];

const AUTOPLAY_MS = 5000;

export function CreateBannerCarousel() {
    const slides = SLIDES;
    const [active, setActive] = useState(0);
    const pausedRef = useRef(false);

    const count = slides.length;
    const go = useCallback((next: number) => setActive(((next % count) + count) % count), [count]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            if (!pausedRef.current) setActive((index) => (index + 1) % count);
        }, AUTOPLAY_MS);
        return () => window.clearInterval(timer);
    }, [count]);

    return (
        <section className="mt-8 w-full" aria-roledescription="carousel" aria-label="活动与推荐" data-testid="create-banner-carousel">
            <div
                className="relative overflow-hidden"
                onMouseEnter={() => (pausedRef.current = true)}
                onMouseLeave={() => (pausedRef.current = false)}
            >
                <div className="relative mx-auto aspect-[16/7] w-full sm:aspect-[5/1]">
                    {slides.map((slide, index) => {
                        let offset = index - active;
                        if (offset > count / 2) offset -= count;
                        if (offset < -count / 2) offset += count;
                        const visible = Math.abs(offset) <= 1;
                        return (
                            <div
                                key={slide.key}
                                className={cn(
                                    "absolute top-0 h-full w-[78%] overflow-hidden rounded-[14px] border border-black/5 transition-[transform,opacity] duration-500 ease-[cubic-bezier(.22,.61,.36,1)] sm:w-[41.3%] dark:border-white/5",
                                    visible ? "opacity-100" : "pointer-events-none opacity-0",
                                )}
                                style={{ left: "50%", transform: `translateX(calc(-50% + ${offset} * (100% + 12px))) scale(${offset === 0 ? 1 : 0.94})`, zIndex: offset === 0 ? 2 : 1 }}
                                aria-hidden={offset !== 0}
                            >
                                <Link href={slide.href || "#"} tabIndex={offset === 0 ? 0 : -1} className="relative block size-full" onClick={(event) => offset !== 0 && (event.preventDefault(), go(index))}>
                                    <img src={slide.image} alt={slide.title} draggable={false} className="size-full object-cover" loading={index < 3 ? "eager" : "lazy"} decoding="async" />
                                    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 to-transparent" />
                                    <span className="absolute bottom-4 left-5 right-5 text-white">
                                        <span className="mb-1.5 inline-flex rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm">{slide.tag}</span>
                                        <strong className="block truncate text-lg font-semibold sm:text-xl">{slide.title}</strong>
                                        <span className="mt-1 flex items-center justify-between gap-3">
                                            {slide.subtitle ? <span className="block min-w-0 truncate text-xs text-white/75 sm:text-sm">{slide.subtitle}</span> : <span />}
                                            <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-[#18181b]">{slide.cta}</span>
                                        </span>
                                    </span>
                                    <span className={cn("pointer-events-none absolute inset-0 bg-black/40 transition-opacity duration-500", offset === 0 ? "opacity-0" : "opacity-100")} />
                                </Link>
                            </div>
                        );
                    })}
                </div>
                <button type="button" aria-label="上一张" onClick={() => go(active - 1)} className="absolute left-3.5 top-1/2 z-30 grid size-7 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-[6px] transition hover:border-white/30 hover:bg-white/20">
                    <ChevronLeft className="size-4" />
                </button>
                <button type="button" aria-label="下一张" onClick={() => go(active + 1)} className="absolute right-3.5 top-1/2 z-30 grid size-7 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-[6px] transition hover:border-white/30 hover:bg-white/20">
                    <ChevronRight className="size-4" />
                </button>
            </div>
            <div className="mt-3 flex h-1 items-center justify-center gap-[3px]">
                {slides.map((slide, index) => (
                    <button
                        key={slide.key}
                        type="button"
                        aria-label={`第 ${index + 1} 张`}
                        aria-current={index === active}
                        onClick={() => go(index)}
                        className={cn("h-1 rounded-[2px] transition-[width,background-color] duration-300", index === active ? "w-9 bg-[var(--ink-1)]" : "w-4 bg-[var(--ink-1)]/20")}
                    />
                ))}
            </div>
        </section>
    );
}
