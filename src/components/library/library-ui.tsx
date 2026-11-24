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
 * 「我的素材」完全为空时的引导区。
 * 用户反馈：只有文字 + 一个按钮太单薄，参考品牌工具的做法给一张成品拼板做示范，
 * 让用户一眼知道「存进来之后能做什么」。图片是本地静态资源，不依赖任何后端接口。
 */
export function LibraryShowcaseEmptyState({ title, description, action }: { title: string; description: string; action: ReactNode }) {
    return (
        <div className="flex flex-col items-center px-4 pb-6 pt-6 text-center sm:pt-8">
            <div className="w-full max-w-[560px] overflow-hidden rounded-2xl bg-[var(--surface-inset)] shadow-[0_18px_42px_-30px_rgba(17,17,19,0.45)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态示范图，无需经过图片服务 */}
                <img src="/library/asset-empty-preview.webp" alt="素材示范：字体、人像、插画与配色拼板" className="block h-auto w-full object-cover" />
            </div>
            <p className="mt-3.5 text-[11.5px] text-[var(--ink-3)]">示例：把常用的字体、人像、插画与配色放在一起</p>
            <h2 className="mt-5 text-[16px] font-semibold text-[var(--ink-1)] sm:text-[17px]">{title}</h2>
            <p className="mt-1.5 max-w-[380px] text-[12.5px] leading-6 text-[var(--ink-3)]">{description}</p>
            <div className="mt-5">{action}</div>
        </div>
    );
}
