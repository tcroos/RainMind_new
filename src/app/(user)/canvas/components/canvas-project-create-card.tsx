"use client";

import { Loader2, Plus } from "lucide-react";

/**
 * 列表首格的「新建画布」入口。
 * 只留一个加号和一行标题：之前那版在中间套了白圆底 + 落影，一排空卡里它最抢眼，
 * 反而比旁边的项目卡更"重"。虚线框 + 灰色加号足够表达"这里是空的，可以点"。
 * 底部补一个和项目卡日期行等高的占位，让两种卡的标题基线对齐。
 */
export function CanvasCreateCard({ onCreate, loading = false }: { onCreate: () => void; loading?: boolean }) {
    return (
        <button type="button" onClick={onCreate} disabled={loading} className="group/create flex min-w-0 cursor-pointer flex-col text-left disabled:cursor-progress">
            {/* 底色与项目卡的空白封面用同一个令牌（--surface-inset）：两格并排时必须是同一块灰，
                之前一个 soft 一个 inset，深浅两套主题下都能看出色差。
                过渡只给 border-color / color：background 也参与过渡的话，切主题那一瞬间会从浅色底
                渐变到深色底，看起来就是「新建画布闪一下白光」。 */}
            <span className="flex aspect-[16/10] w-full items-center justify-center rounded-xl border border-dashed border-[rgba(17,17,19,0.16)] bg-[var(--surface-inset)] text-[var(--ink-3)] transition-[border-color,color] duration-200 group-hover/create:border-[rgba(17,17,19,0.32)] group-hover/create:text-[var(--ink-1)] dark:border-[rgba(255,255,255,0.14)] dark:group-hover/create:border-[rgba(255,255,255,0.3)]">
                {loading ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" strokeWidth={1.75} />}
            </span>
            <span className="mt-3 block truncate px-0.5 text-[14px] font-medium leading-5 text-[var(--ink-1)]">{loading ? "正在创建…" : "新建画布"}</span>
            {/* 与项目卡的「标题 + 日期」等高，保证两种卡的标题基线对齐 */}
            <span aria-hidden className="mt-1.5 block h-4" />
        </button>
    );
}
