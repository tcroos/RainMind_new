"use client";

import type { ReactNode } from "react";
import { Tag } from "antd";

/* 状态标签一律浅底药丸：语义靠色相，边界靠底色，不画一圈描边。 */
const compactTagClass = "!m-0 !inline-flex !h-6 !min-w-max !shrink-0 !items-center !whitespace-nowrap !rounded-full !px-2.5 !text-[11px] !font-medium !leading-6";

const statusToneClass: Record<string, string> = {
    idle: "!bg-[var(--surface-inset)] !text-[var(--ink-3)]",
    queued: "!bg-sky-50 !text-sky-700 dark:!bg-sky-950/35 dark:!text-sky-300",
    running: "!bg-amber-50 !text-amber-700 dark:!bg-amber-950/35 dark:!text-amber-300",
    success: "!bg-emerald-50 !text-emerald-700 dark:!bg-emerald-950/35 dark:!text-emerald-300",
    error: "!bg-rose-50 !text-rose-700 dark:!bg-rose-950/35 dark:!text-rose-300",
    cancelled: "!bg-[var(--surface-inset)] !text-[var(--ink-3)]",
};

const stageToneClass = {
    neutral: "bg-[var(--surface-inset)] text-[var(--ink-3)]",
    ready: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
    attention: "bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300",
    running: "bg-sky-50 text-sky-700 dark:bg-sky-950/35 dark:text-sky-300",
} as const;

export function DramaStageHeader({
    step,
    title,
    description,
    status,
    tone = "neutral",
    metrics = [],
    action,
    secondaryAction,
    className = "",
}: {
    step: string;
    title: string;
    description: string;
    status: string;
    tone?: keyof typeof stageToneClass;
    metrics?: Array<{ label: string; value: ReactNode }>;
    action?: ReactNode;
    secondaryAction?: ReactNode;
    className?: string;
}) {
    return (
        /* 阶段头不再压一条横线，也不在指标之间画竖线：标题、状态、指标靠留白排开。 */
        <header className={`pb-4 ${className}`} data-drama-stage-header>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--ink-3)]">{step}</span>
                        <h2 className="truncate text-[17px] font-semibold leading-7 tracking-[-0.01em] text-[var(--ink-1)] sm:text-[19px]">{title}</h2>
                        <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium ${stageToneClass[tone]}`}>{status}</span>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-5 text-[var(--ink-3)]">{description}</p>
                    {metrics.length ? (
                        <dl className="mt-3 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 text-[11px] leading-4 text-[var(--ink-3)]" data-drama-stage-metrics>
                            {metrics.map((item) => (
                                <div key={item.label} className="flex min-w-0 items-baseline gap-1.5">
                                    <dt className="whitespace-nowrap">{item.label}</dt>
                                    <dd className="whitespace-nowrap font-medium tabular-nums text-foreground">{item.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : null}
                </div>
                {action || secondaryAction ? (
                    <div className="flex w-full shrink-0 flex-col-reverse gap-1.5 sm:w-auto sm:flex-row sm:items-center">
                        {secondaryAction}
                        {action}
                    </div>
                ) : null}
            </div>
        </header>
    );
}

export function SectionTitle({ title, description, className = "" }: { title: string; description: string; className?: string }) {
    return (
        <div className={`mb-4 sm:mb-8 ${className}`}>
            <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground sm:mt-2 sm:leading-6">{description}</p>
        </div>
    );
}
export function GenerationTag({ status = "idle" }: { status?: string }) {
    const values: Record<string, string> = {
        idle: "未生成",
        queued: "排队中",
        running: "生成中",
        success: "已完成",
        error: "失败",
        cancelled: "已取消",
    };
    return <Tag className={`${compactTagClass} ${statusToneClass[status] || statusToneClass.idle}`}>{values[status] || values.idle}</Tag>;
}
export function StoryboardTag({ status = "idle" }: { status?: string }) {
    const values: Record<string, string> = {
        idle: "待分镜图",
        queued: "分镜排队",
        running: "分镜图生成中",
        success: "分镜图完成",
        error: "分镜图失败",
        cancelled: "分镜图取消",
    };
    return <Tag className={`${compactTagClass} ${statusToneClass[status] || statusToneClass.idle}`}>{values[status] || values.idle}</Tag>;
}
export function AudioTag({ status = "idle" }: { status?: string }) {
    const values: Record<string, string> = {
        idle: "未配音",
        queued: "配音排队",
        running: "配音中",
        success: "配音完成",
        error: "配音失败",
        cancelled: "配音取消",
    };
    return <Tag className={`${compactTagClass} ${statusToneClass[status] || statusToneClass.idle}`}>{values[status] || values.idle}</Tag>;
}
export function AssetPanel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
    return (
        <section className="rounded-2xl bg-[var(--surface-inset)]/60 p-4 sm:p-6">
            <div className="mb-4 flex items-center gap-3 text-[14px] font-semibold text-[var(--ink-1)] sm:mb-6">
                {icon}
                {title}
            </div>
            {children}
        </section>
    );
}
export function AssetList({ items }: { items: Array<{ id: string; name: string; description: string }> }) {
    return items.length ? (
        <div className="mt-4 grid gap-3 sm:mt-6 sm:gap-4">
            {items.map((item) => (
                <div key={item.id} className="rounded-xl bg-[var(--surface-panel)] p-4">
                    <div className="text-[13px] font-semibold text-[var(--ink-1)]">{item.name}</div>
                    <div className="mt-1.5 text-[12px] leading-5 text-[var(--ink-3)]">{item.description || "暂无描述"}</div>
                </div>
            ))}
        </div>
    ) : (
        <p className="mt-6 text-[13px] text-[var(--ink-3)]">暂未添加</p>
    );
}

export function stableTaskUrl(...values: Array<string | undefined>) {
    const stable = values.filter((value): value is string => Boolean(value && !value.startsWith("data:") && !value.startsWith("blob:")));
    return stable.find((value) => /^\/api\/(?:generation-log-assets|reference-assets)\//.test(value)) || stable[0] || "";
}
