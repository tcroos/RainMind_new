import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type LibraryTabItem = { key: string; label: string; href: string };

/**
 * 素材库三个内容区共用的切换控件。
 *
 * 刻意不用下划线 tab：那条横线是全站「不要线条」里最刺眼的一处，
 * 而且下划线 tab 在窄屏会被挤成等宽小字。改成浅底药丸段，
 * 选中态靠底色 + 字重，切换动作一眼可读，也不依赖边框。
 */
export function LibraryTabs({ tabs, active }: { tabs: readonly LibraryTabItem[]; active: string }) {
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
