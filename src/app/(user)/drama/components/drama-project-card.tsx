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
        /* 卡片不套描边：实底 + 极淡落影已经能把层级托起来，hover 只把落影加深一点。 */
        <article className="group relative flex flex-col overflow-hidden rounded-2xl bg-[var(--surface-panel)] shadow-[0_2px_10px_-6px_rgba(17,17,19,0.18),0_18px_36px_-30px_rgba(17,17,19,0.42)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_14px_-6px_rgba(17,17,19,0.2),0_24px_44px_-28px_rgba(17,17,19,0.48)] motion-reduce:transition-none">
            <Link href={`/drama/${project.id}`} className="absolute inset-0 z-0 rounded-2xl outline-none" aria-label={`进入短剧项目：${project.title}`}>
                <span className="sr-only">{`进入短剧项目：${project.title}`}</span>
            </Link>

            {/* 没有封面时用一条品牌色渐变带占位，比纯白卡片更容易和列表里的其他内容区分 */}
            <div className="pointer-events-none relative h-[112px] shrink-0 overflow-hidden bg-[linear-gradient(135deg,var(--brand-soft)_0%,var(--surface-inset)_100%)] dark:bg-[linear-gradient(135deg,rgba(240,138,75,0.12)_0%,rgba(255,255,255,0.04)_100%)]">
                <Clapperboard className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-[var(--brand-600)]/55 dark:text-[var(--brand-600)]/70" />
                <span className="absolute right-3 top-3 inline-flex h-6 items-center rounded-full bg-[var(--surface-panel)]/90 px-2.5 text-[11px] font-medium text-[var(--ink-2)]">{project.ratio}</span>
                {pendingCount ? (
                    <span className="absolute left-3 top-3 inline-flex h-6 items-center rounded-full bg-amber-50 px-2.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-200">{pendingCount} 执行中</span>
                ) : null}
                {failedCount ? (
                    <span className="absolute bottom-3 right-3 inline-flex h-6 items-center rounded-full bg-rose-50 px-2.5 text-[11px] font-medium text-rose-600 dark:bg-rose-950/50 dark:text-rose-200">{failedCount} 失败</span>
                ) : null}
            </div>

            <div className="pointer-events-none relative z-[1] flex min-w-0 flex-1 flex-col p-4">
                <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate text-[15px] font-semibold leading-6 text-[var(--ink-1)]">{project.title}</h2>
                        <p className="mt-1.5 line-clamp-2 text-[12px] leading-[1.6] text-[var(--ink-3)]">{project.summary || "还没有填写项目简介"}</p>
                    </div>
                    <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-[var(--ink-3)] transition group-hover:text-[var(--brand-600)]" />
                </div>

                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-[var(--ink-3)]">
                    <span className="inline-flex h-6 items-center rounded-full bg-[var(--surface-inset)] px-2.5">{project.episodeCount} 集</span>
                    <span className="inline-flex h-6 items-center rounded-full bg-[var(--surface-inset)] px-2.5">{project.sceneCount} 场景</span>
                    <span className="inline-flex h-6 items-center rounded-full bg-[var(--surface-inset)] px-2.5">{project.shotCount} 分镜</span>
                    <span className="inline-flex h-6 items-center rounded-full bg-[var(--surface-inset)] px-2.5">{project.characterCount} 角色</span>
                </div>

                {/* 操作行不再画一条分割横线，靠 mt-auto 把它推到卡片底部、用留白和上方内容分开。 */}
                <div className="relative z-10 mt-auto flex min-w-0 items-center justify-end gap-2 pt-5">
                    <Popconfirm title="删除这个短剧项目？" onConfirm={() => deleteProject(project.id).catch((error) => message.error(error instanceof Error ? error.message : "项目删除失败"))}>
                        <Tooltip title="删除项目">
                            <button
                                type="button"
                                className="!pointer-events-auto grid size-8 place-items-center rounded-full !bg-[var(--surface-inset)] !text-[var(--ink-3)] transition hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-950/30 dark:hover:!text-rose-300"
                                aria-label="删除项目"
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        </Tooltip>
                    </Popconfirm>
                    <button
                        type="button"
                        className="!pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full !bg-[var(--surface-inset)] px-3 text-[12px] font-medium !text-[var(--ink-1)] transition hover:opacity-75"
                        onClick={() => router.push(`/works?sourceType=drama&sourceId=${encodeURIComponent(project.id)}`)}
                    >
                        <Share2 className="size-3.5" />
                        发布
                    </button>
                </div>
            </div>
        </article>
    );
}
