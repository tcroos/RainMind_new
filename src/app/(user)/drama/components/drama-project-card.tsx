"use client";

import { App, Popconfirm, Tooltip } from "antd";
import { ArrowUpRight, Clapperboard, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { DramaProjectSummary } from "../types";
import { useDramaStore } from "../stores/use-drama-store";

export function DramaProjectCard({ project }: { project: DramaProjectSummary }) {
    const router = useRouter();
    const { message } = App.useApp();
    const deleteProject = useDramaStore((state) => state.deleteProject);
    const pendingCount = project.pendingTaskCount;
    const failedCount = project.failedTaskCount;
    return (
        /* 与「新建短剧」同一造型、同一高度：一块浅底圆角卡，不套描边、不铺封面带。
         * 尺寸向画布节点靠拢，信息只留标题、一行简介和一行元信息。 */
        <article className="group relative flex min-h-[152px] flex-col rounded-2xl bg-[var(--surface-inset)] p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-28px_rgba(17,17,19,0.42)] motion-reduce:transition-none">
            <Link href={`/drama/${project.id}`} className="absolute inset-0 z-0 rounded-2xl outline-none" aria-label={`进入短剧项目：${project.title}`}>
                <span className="sr-only">{`进入短剧项目：${project.title}`}</span>
            </Link>

            <div className="pointer-events-none relative z-[1] flex min-w-0 items-start gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-panel)] text-[var(--brand-600)]">
                    <Clapperboard className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[13px] font-semibold leading-5 text-[var(--ink-1)]">{project.title}</h2>
                    <p className="mt-1 line-clamp-1 text-[11px] leading-4 text-[var(--ink-3)]">{project.summary || "还没有填写项目简介"}</p>
                </div>
                <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-[var(--ink-3)] transition group-hover:text-[var(--brand-600)]" />
            </div>

            <div className="pointer-events-none relative z-[1] mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--ink-3)]">
                <span>{project.ratio}</span>
                <span aria-hidden>·</span>
                <span>{project.episodeCount} 集</span>
                <span aria-hidden>·</span>
                <span>{project.shotCount} 分镜</span>
                {pendingCount ? <span className="text-amber-700 dark:text-amber-300">{pendingCount} 执行中</span> : null}
                {failedCount ? <span className="text-rose-600 dark:text-rose-300">{failedCount} 失败</span> : null}
            </div>

            <div className="relative z-10 mt-auto flex min-w-0 items-center justify-end gap-2 pt-3">
                <Popconfirm title="删除这个短剧项目？" onConfirm={() => deleteProject(project.id).catch((error) => message.error(error instanceof Error ? error.message : "项目删除失败"))}>
                    <Tooltip title="删除项目">
                        <button
                            type="button"
                            className="!pointer-events-auto grid size-7 place-items-center rounded-full !bg-[var(--surface-panel)] !text-[var(--ink-3)] transition hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-950/30 dark:hover:!text-rose-300"
                            aria-label="删除项目"
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    </Tooltip>
                </Popconfirm>
                <button
                    type="button"
                    className="!pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-full !bg-[var(--surface-panel)] px-2.5 text-[11px] font-medium !text-[var(--ink-1)] transition hover:opacity-75"
                    onClick={() => router.push(`/works?sourceType=drama&sourceId=${encodeURIComponent(project.id)}`)}
                >
                    <Share2 className="size-3" />
                    发布
                </button>
            </div>
        </article>
    );
}
