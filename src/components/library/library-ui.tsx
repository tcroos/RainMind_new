import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type LibraryTabItem = { key: string; label: string; href: string };

/**
 * 素材库三个内容区共用的切换控件。
 *
 * 刻意不用下划线 tab：那条横线是全站「不要线条」里最刺眼的一处，
 * 而且下划线 tab 在窄屏会被挤成等宽小字。改成浅底药丸段，
 * 选中态靠底色 + 字重，切换动作一眼可读，也不依赖边框。
 *
 * onSelect 存在时走原生 history API 只改查询参数：Next 的 Link 会为此发一次 RSC 请求，
 * 整页内容被服务端响应替换，切换时肉眼可见地闪一下。保留 href 让「新标签页打开」仍然可用。
 */
export function LibraryTabs({ tabs, active, onSelect }: { tabs: readonly LibraryTabItem[]; active: string; onSelect?: (key: string) => void }) {
    const handleClick = (event: MouseEvent<HTMLAnchorElement>, key: string) => {
        if (!onSelect || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onSelect(key);
    };

    return (
        <nav role="tablist" aria-label="素材库内容" className="mt-4 inline-flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-[var(--surface-inset)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => {
                const selected = tab.key === active;
                return (
                    <Link
                        key={tab.key}
                        href={tab.href}
                        role="tab"
                        aria-selected={selected}
                        scroll={false}
                        onClick={(event) => handleClick(event, tab.key)}
                        className={cn(
                            "shrink-0 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] transition",
                            selected
                                ? "bg-[var(--surface-panel)] font-semibold text-[var(--ink-1)] shadow-[0_1px_3px_rgba(17,17,19,0.08)]"
                                : "font-medium text-[var(--ink-3)] hover:text-[var(--ink-1)]",
                        )}
                    >
                        {tab.label}
                    </Link>
                );
            })}
        </nav>
    );
}

/**
 * 空状态：不套描边卡、不放大地板。
 * 之前「大描边卡 + 分页器」让空页面看起来像加载失败；这里只留图标、一句人话和一个出口，
 * 层级靠留白与字号，不靠边框。
 */
export function LibraryEmptyState({ icon, title, description, action, className }: { icon: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
    return (
        <div className={cn("flex flex-col items-center justify-center px-6 py-16 text-center sm:py-24", className)}>
            <span className="grid size-12 place-items-center rounded-2xl bg-[var(--surface-inset)] text-[var(--ink-3)]">{icon}</span>
            <h2 className="mt-4 text-[15px] font-semibold text-[var(--ink-1)]">{title}</h2>
            {description ? <p className="mt-1.5 max-w-[360px] text-[12.5px] leading-5 text-[var(--ink-3)]">{description}</p> : null}
            {action ? <div className="mt-5">{action}</div> : null}
        </div>
    );
}

/**
 * 「我的素材 / 我的提示词」完全为空时的引导区。
 * 每个 tab 传自己的两张图：images[0] 是露边的底层，images[1] 是端正的前层，形成叠图效果。
 * 图片尺寸、标题间距和按钮位置两个 tab 完全一致；外层 min-height 把整组放到剩余视口更靠下的位置。
 */
export function LibraryShowcaseEmptyState({ title, description, action, images }: { title: string; description: string; action: ReactNode; images: readonly [string, string] }) {
    return (
        <div
            className="flex flex-col items-center justify-center px-4 pb-14 pt-10 text-center sm:pt-12"
            style={{ minHeight: "min(760px, calc(100dvh - 140px))" }}
        >
            <div className="relative mx-3 mb-4 mt-1 w-full max-w-[380px]">
                <div className="absolute inset-0 -translate-y-2 translate-x-3 -rotate-[4deg] overflow-hidden rounded-2xl bg-[var(--surface-inset)] shadow-[0_18px_36px_-26px_rgba(17,17,19,0.45)]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态示范图，无需经过图片服务 */}
                    <img src={images[0]} alt="" className="block aspect-[2/1] w-full object-cover" />
                </div>
                <div className="relative aspect-[2/1] overflow-hidden rounded-2xl bg-[var(--surface-inset)] shadow-[0_16px_36px_-28px_rgba(17,17,19,0.38)]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态示范图，无需经过图片服务 */}
                    <img src={images[1]} alt="素材库示范" className="block h-full w-full object-cover" />
                </div>
            </div>
            {/* 标题用包裹层承载上边距：Tailwind 的 h1..h6 { margin:0 } 重置排在工具类之后，
                直接写 mt-* 会被它盖掉（实测计算值 0px）。 */}
            <div className="mt-8">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--ink-1)]">{title}</h2>
            </div>
            <p className="mt-2 text-[12px] leading-5 text-[var(--ink-3)]">{description}</p>
            <div className="mt-6">{action}</div>
        </div>
    );
}
