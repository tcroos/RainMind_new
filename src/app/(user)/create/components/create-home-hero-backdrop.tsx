"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * 首页首屏氛围层，结构照 seko.sensetime.com 首页拆出来的四层：
 * 1. 一段 408px 高、静音自动循环的背景视频（Seko 用的是 2880×816、15 秒、24fps 的柔焦人物视频）；
 *    我们用自己生成的 15 秒循环（public/create/hero-loop.mp4，约 190KB），可直接换成品牌视频，保持 ≈3.5:1 即可；
 * 2. 视频上叠一层静态点阵：约 20px 间距、2.5px 圆点，青色 #72F3FF，以顶部中心为圆心径向渐隐（70% 处透明），整体 30% 不透明度；
 * 3. 底部 70% 高度从透明渐变到页面底色，下方再接一块实色，让视频「溶」进页面；
 * 4. 最上一层是同色遮罩，页面滚动、输入框吸底后 300ms 线性淡入，首屏视频随之压暗。
 * Seko 只有深色主题；我们默认白底，所以浅色主题用一段白底柔光循环（hero-loop-light.mp4，暖橙→淡紫→天蓝缓慢流动），
 * 深色主题才换回深色视频（hero-loop.mp4）。两段都由 CSS 按 .dark 切换显示，只有可见的那段会播放。
 */
export function CreateHomeHeroBackdrop({ dimmed = false }: { dimmed?: boolean }) {
    const lightRef = useRef<HTMLVideoElement>(null);
    const darkRef = useRef<HTMLVideoElement>(null);

    /* 只播放当前主题可见的那段，另一段暂停，避免两段同时解码 */
    useEffect(() => {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const sync = () => {
            const dark = document.documentElement.classList.contains("dark");
            const [on, off] = dark ? [darkRef.current, lightRef.current] : [lightRef.current, darkRef.current];
            off?.pause();
            if (on && !reduce) void on.play().catch(() => undefined);
        };
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    return (
        <div aria-hidden className="create-hero-backdrop pointer-events-none absolute inset-x-0 top-0 -z-0 w-full">
            <video
                ref={lightRef}
                src="/create/hero-loop-light.mp4"
                poster="/create/hero-poster-light.jpg"
                className="block h-[408px] w-full bg-white object-cover dark:hidden"
                muted
                loop
                playsInline
                preload="auto"
            />
            <video
                ref={darkRef}
                src="/create/hero-loop.mp4"
                poster="/create/hero-poster.jpg"
                className="hidden h-[408px] w-full bg-[#0c0c0d] object-cover dark:block"
                muted
                loop
                playsInline
                preload="none"
            />
            <div className="create-hero-backdrop__particles absolute inset-x-0 top-0 h-[408px]" />
            <div className="create-hero-backdrop__fade absolute inset-x-0 top-0 h-[408px]" />
            <div className={cn("absolute inset-x-0 top-0 h-[408px] bg-[var(--surface-canvas)] transition-opacity duration-300 ease-linear", dimmed ? "opacity-100" : "opacity-0")} />
        </div>
    );
}
