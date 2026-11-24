"use client";

import { ArrowUpRight, BookMarked, Clapperboard, CreditCard, LoaderCircle, Maximize2, RefreshCw, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { browserReadableMediaUrl } from "@/lib/browser-media-url";
import type { CreateOverviewMedia } from "@/lib/create-workbench-overview";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { cn } from "@/lib/utils";

import { useCreateWorkbenchOverview } from "../use-create-workbench-overview";

const sectionTitleClass = "text-[15px] font-semibold text-[var(--ink-1)]";
const sectionHintClass = "mt-1 text-xs text-[var(--ink-3)]";
const panelClass = "surface-panel rounded-xl";

/* 快捷入口：线性图标 + 标题 + 一句话介绍。
 * 之前是四张 3D 橙色配图叠在液态玻璃上，纯色平背景里像四块贴纸，
 * 和全站黑白灰 + 只在动作处点橙的语言冲突。现在图标统一走 --ink-2，
 * 只有 hover 才染上品牌色，把强调让给真正要操作的那张卡。 */
const quickEntries = [
    { href: "/profile", title: "个人中心", description: "套餐、资料与账户安全", Icon: UserRound },
    { href: "/wallet", title: "我的钱包", description: "积分、充值、订单与流水", Icon: CreditCard },
    { href: "/drama", title: "短剧工坊", description: "剧本分镜，一站成片", Icon: Clapperboard },
    { href: "/prompts", title: "提示词库", description: "收藏与复用优质提示词", Icon: BookMarked },
] as const;

export function CreateWorkbenchOverview() {
    const { latestProject, loading, error, reload } = useCreateWorkbenchOverview();

    return (
        <div className="mt-3 w-full pb-3 sm:mt-6 sm:pb-4">
            <section aria-labelledby="create-projects-heading">
                <div className="flex items-end justify-between gap-3 pb-3">
                    <div>
                        <h2 id="create-projects-heading" className={sectionTitleClass}>
                            项目与任务
                        </h2>
                        <p className={sectionHintClass}>回到最近的项目，或从快捷入口开始</p>
                    </div>
                    <Link href="/canvas" className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--ink-3)] transition hover:text-[var(--brand-600)]">
                        全部项目 <ArrowUpRight className="size-3.5" />
                    </Link>
                </div>
                <div className="mt-2 grid gap-2 sm:mt-3 sm:gap-3 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)]">
                    <LatestProjectCard project={latestProject} loading={loading} error={error} onRetry={reload} />
                    <QuickEntryGrid />
                </div>
            </section>

            {loading ? <span className="sr-only">正在加载工作台概览</span> : null}
        </div>
    );
}

function QuickEntryGrid() {
    return (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:h-40 lg:grid-rows-2">
            {quickEntries.map((entry) => {
                const Icon = entry.Icon;
                return (
                    <Link key={entry.href} href={entry.href} className="quick-entry-card group min-h-20 lg:h-full lg:min-h-0">
                        <span className="quick-entry-icon" aria-hidden>
                            <Icon className="size-[18px]" strokeWidth={1.7} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                            <span className="truncate text-[13px] font-semibold text-[var(--ink-1)]">{entry.title}</span>
                            <span className="truncate text-[11px] text-[var(--ink-3)]">{entry.description}</span>
                        </span>
                    </Link>
                );
            })}
        </div>
    );
}

function LatestProjectCard({ project, loading, error, onRetry }: { project?: ReturnType<typeof useCreateWorkbenchOverview>["latestProject"]; loading: boolean; error?: string; onRetry: () => void }) {
    if (loading)
        return (
            <div className={cn(panelClass, "h-32 p-2.5 sm:h-40 sm:p-4")}>
                <OverviewLoading label="正在读取画布项目..." compact />
            </div>
        );
    if (error)
        return (
            <div className={cn(panelClass, "h-32 p-2.5 sm:h-40 sm:p-4")}>
                <OverviewError message={error} onRetry={onRetry} compact />
            </div>
        );
    if (!project)
        return (
            <div className={cn(panelClass, "flex h-32 items-center p-2.5 sm:h-40 sm:p-4")}>
                <OverviewEmpty label="创建第一个 Canvas 项目后，会在这里继续" compact />
            </div>
        );

    return (
        <Link
            href={`/canvas/${project.id}`}
            className={cn(panelClass, "group grid h-32 grid-cols-[minmax(100px,34%)_minmax(0,1fr)] overflow-hidden transition hover:shadow-[0_10px_28px_-12px_rgba(17,17,19,0.18)] sm:h-40 sm:grid-cols-[minmax(140px,34%)_minmax(0,1fr)]")}
        >
            <div className="relative h-full min-h-0 overflow-hidden bg-[var(--surface-soft)]">
                <CanvasProjectCover previews={project.previews} />
                <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-md bg-white/88 px-2 py-1 text-[11px] font-medium text-[#3c424b] shadow-xs backdrop-blur-sm dark:bg-black/65 dark:text-white/90">
                    <Maximize2 className="size-3" /> Canvas 项目
                </span>
            </div>
            <div className="flex min-w-0 flex-col justify-between gap-1.5 p-2.5 sm:p-4">
                <div className="min-w-0">
                    <p className="text-[11px] text-[#8b949f] dark:text-[#7f8996]">最近编辑 · {formatRecentTime(project.updatedAt)}</p>
                    <h3 className="mt-1.5 truncate text-sm font-semibold text-[#20242a] sm:text-base dark:text-[#f3f5f7]">{project.title || "未命名项目"}</h3>
                    <p className="mt-1.5 text-[11px] text-[#697381] sm:text-xs dark:text-[#9aa3af]">
                        {project.nodeCount} 个节点 · {project.connectionCount} 条连线
                    </p>
                </div>
                <span className="inline-flex w-fit items-center gap-1 text-xs font-medium text-[var(--ink-2)] transition group-hover:text-[var(--brand-600)]">
                    继续编辑 <ArrowUpRight className="size-3.5" />
                </span>
            </div>
        </Link>
    );
}

function CanvasProjectCover({ previews }: { previews: CreateOverviewMedia[] }) {
    const [previewIndex, setPreviewIndex] = useState(0);
    const previewKey = previews.map((item) => `${item.kind}:${item.url}`).join("|");
    const preview = previews[previewIndex];

    useEffect(() => setPreviewIndex(0), [previewKey]);

    if (!preview)
        return (
            <div className="grid size-full place-items-center text-[#8b949f] dark:text-[#737d89]">
                <Maximize2 className="size-8" />
            </div>
        );

    const mediaClass = "size-full object-cover transition duration-300 group-hover:scale-[1.02]";
    return preview.kind === "image" ? (
        <img src={imagePreviewUrl(preview.url, 960)} alt="" loading="lazy" className={mediaClass} onError={() => setPreviewIndex((index) => index + 1)} />
    ) : (
        <video src={browserReadableMediaUrl(preview.url)} muted preload="metadata" playsInline className={mediaClass} onError={() => setPreviewIndex((index) => index + 1)} />
    );
}

function OverviewLoading({ label, compact = false }: { label: string; compact?: boolean }) {
    return (
        <div className={cn("flex items-center justify-center gap-2 text-xs text-[#9aa2ad] dark:text-[#737d89]", compact ? "min-h-20 sm:min-h-32" : "min-h-20 pt-2 sm:min-h-36 sm:pt-3")}>
            <LoaderCircle className="size-4 animate-spin" />
            {label}
        </div>
    );
}

function OverviewEmpty({ label, compact = false }: { label: string; compact?: boolean }) {
    // 之前没有 w-full：外层是 flex 容器，内层宽度收到文字本身，justify-center 就只在自己的宽度里居中，
    // 结果空态文字贴在卡片左边，看着像没排完版。
    return <div className={cn("flex w-full items-center justify-center text-center text-xs text-[var(--ink-3)]", compact ? "min-h-20 sm:min-h-36" : "min-h-20 pt-2 sm:min-h-32 sm:pt-3")}>{label}</div>;
}

function OverviewError({ message, onRetry, compact = false }: { message: string; onRetry: () => void; compact?: boolean }) {
    return (
        <div className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "min-h-20 sm:min-h-32" : "min-h-20 pt-2 sm:min-h-36 sm:pt-3")}>
            <p className="max-w-md text-xs text-[#9a5b5b] dark:text-[#d49a9a]">{message}</p>
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#697381] transition hover:text-[#20242a] dark:text-[#9aa3af] dark:hover:text-white">
                <RefreshCw className="size-3.5" />
                重新读取
            </button>
        </div>
    );
}

function formatRecentTime(value: string) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return "刚刚";
    return new Date(time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
