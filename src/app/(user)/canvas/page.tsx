"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { App, Button, Pagination } from "antd";
import { Check, Download } from "lucide-react";

import { cn } from "@/lib/utils";
import { CanvasDeleteProjectsDialog } from "./components/canvas-delete-projects-dialog";
import { CanvasCreateCard } from "./components/canvas-project-create-card";
import { CanvasProjectCard } from "./components/canvas-project-card";
import { useCanvasStore } from "./stores/use-canvas-store";
import { useCanvasUiStore } from "./stores/use-canvas-ui-store";
import { resolveSiteTitle } from "@/lib/site-brand";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { useUserStore } from "@/stores/use-user-store";
import { exportCanvasProjects } from "./utils/canvas-export";

export default function CanvasPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const autoOpenRef = useRef(false);
    const [creating, setCreating] = useState(false);
    const [exporting, setExporting] = useState(false);
    /** 多选态：标题旁的小按钮点开才进入，进入后卡片右上角出现复选框，底部浮出「全选 / 取消」 */
    const [selectMode, setSelectMode] = useState(false);
    const siteTitle = usePublicSessionStore((state) => resolveSiteTitle(state.payload?.settings?.site?.title));
    const userId = useUserStore((state) => state.user?.id || "");
    const hydrated = useCanvasStore((state) => state.hydrated);
    const hydratedUserId = useCanvasStore((state) => state.hydratedUserId);
    const syncError = useCanvasStore((state) => state.syncError);
    const hydrate = useCanvasStore((state) => state.hydrate);
    const projects = useCanvasStore((state) => state.summaries);
    const total = useCanvasStore((state) => state.summaryTotal);
    const page = useCanvasStore((state) => state.summaryPage);
    const pageSize = useCanvasStore((state) => state.summaryPageSize);
    const loadProject = useCanvasStore((state) => state.loadProject);
    const createProject = useCanvasStore((state) => state.createProject);
    const summaryBusy = useCanvasStore((state) => state.summaryBusy);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setSelectedIds = useCanvasUiStore((state) => state.setSelectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const ready = Boolean(userId && hydrated && hydratedUserId === userId);
    const allSelected = projects.length > 0 && selectedIds.length === projects.length;

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        router.push(`/canvas/${id}${agentQuery}`);
    };
    const createAndEnter = async () => {
        if (creating) return;
        setCreating(true);
        try {
            enterProject(await createProject(`${siteTitle} 画布 ${total + 1}`, { insertIntoList: false }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布创建失败");
        } finally {
            setCreating(false);
        }
    };
    const exitSelectMode = () => {
        removeSelectedIds(selectedIds);
        setSelectMode(false);
    };
    const toggleSelectAll = () => {
        setSelectedIds(allSelected ? [] : projects.map((project) => project.id));
    };
    const exportSelectedProjects = async () => {
        if (!selectedIds.length || exporting) return;
        setExporting(true);
        try {
            const selected = await Promise.all(selectedIds.map((id) => loadProject(id)));
            await exportCanvasProjects(selected);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布导出失败");
        } finally {
            setExporting(false);
        }
    };

    useEffect(() => {
        void hydrate();
    }, [hydrate, userId]);

    useEffect(() => {
        if (!ready || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        void (async () => {
            try {
                const defaultName = `${siteTitle} 画布 ${total + 1}`;
                const id = mode === "new" ? await createProject(defaultName, { insertIntoList: false }) : projects[0]?.id || (await createProject(defaultName, { insertIntoList: false }));
                enterProject(id);
            } catch (error) {
                autoOpenRef.current = false;
                message.error(error instanceof Error ? error.message : "画布打开失败");
            }
        })();
    }, [createProject, message, mode, projects, ready, siteTitle, total]);

    if (creating || (ready && (mode === "new" || mode === "recent"))) {
        return <main className="flex h-full items-center justify-center gap-2 bg-background text-sm text-[var(--ink-3)]">正在打开画布...</main>;
    }

    return (
        <main className="h-full overflow-auto bg-background pb-24 text-[var(--ink-1)]">
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-5 py-6 sm:gap-8 sm:px-8 sm:py-8">
                {/* 标题与按钮同高（28px 行盒 + 28px 方块）才能严格居中对齐：
                    之前 h1 用 leading-8（32）且带着浏览器默认 margin，头部被撑到 43px，
                    items-center 之后图标中心比文字中心低了 5.5px，看起来就是一个大一个小。 */}
                <header className="flex items-center gap-3">
                    <h1
                        className="truncate text-[20px] font-semibold leading-7 tracking-tight text-[var(--ink-1)] sm:text-[22px]"
                        style={{ margin: 0 }}
                    >
                        画布
                    </h1>
                    {/* 批量操作入口：裸图标，悬停才浮出底色。22px 标题旁挂一块常驻灰底太抢眼。
                        进入多选态后图标转品牌橙，用颜色而不是色块表达「已开启」。
                        颜色写内联：这个 button 上 Tailwind 的文字尺寸类会被当成字号，设不上色。 */}
                    <button
                        type="button"
                        aria-pressed={selectMode}
                        aria-label={selectMode ? "退出多选" : "多选"}
                        title={selectMode ? "退出多选" : "多选"}
                        onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                        className={cn(
                            "grid size-7 shrink-0 place-items-center rounded-md transition-colors duration-150",
                            selectMode ? "bg-[var(--surface-soft)] hover:bg-[var(--surface-inset)]" : "hover:bg-[var(--surface-soft)]",
                        )}
                    >
                        <ThreeRowListIcon style={{ color: selectMode ? "var(--brand-500)" : "var(--ink-2)" }} />
                    </button>
                </header>

                {!ready ? (
                    <section className="flex min-h-40 flex-col items-center justify-center gap-3 text-center text-sm text-[var(--ink-3)]">
                        <span>{syncError || "正在加载画布..."}</span>
                        {syncError ? (
                            <Button size="small" onClick={() => void hydrate(true)}>
                                重新加载
                            </Button>
                        ) : null}
                    </section>
                ) : (
                    <>
                        {/* 一屏最多 5 列：列再多卡片就退化成缩略图墙，看不清封面也点不准 */}
                        <div className={cn("grid grid-cols-2 gap-x-4 gap-y-8 transition-opacity duration-200 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", summaryBusy && "pointer-events-none opacity-50")}>
                            <CanvasCreateCard onCreate={() => void createAndEnter()} loading={creating} />
                            {projects.map((project) => (
                                <CanvasProjectCard key={project.id} project={project} selectable={selectMode} />
                            ))}
                        </div>
                        {!projects.length ? <p className="pb-6 text-center text-[12px] text-[var(--ink-3)]">还没有画布，点上面的空格子开始搭第一个</p> : null}
                        {total > pageSize ? (
                            <div className="flex justify-center pb-2">
                                <Pagination current={page} pageSize={pageSize} total={total} showSizeChanger={false} onChange={(nextPage) => void hydrate(true, nextPage)} />
                            </div>
                        ) : null}
                    </>
                )}
            </div>

            {selectMode ? (
                <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
                    <div className="pointer-events-auto inline-flex items-center gap-0.5 rounded-full bg-[var(--surface-panel)] p-1 pl-1.5 text-[12px] leading-5 text-[var(--ink-1)] shadow-[0_10px_30px_-10px_rgba(17,17,19,0.35),0_2px_6px_-2px_rgba(17,17,19,0.12)] ring-1 ring-[var(--hairline)] dark:shadow-[0_12px_34px_-12px_rgba(0,0,0,0.85)]">
                        <button type="button" onClick={toggleSelectAll} className="inline-flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 transition-colors hover:bg-[var(--surface-soft)]">
                            <span
                                aria-hidden
                                className={cn(
                                    "grid size-4 shrink-0 place-items-center rounded-[4px] transition-colors",
                                    allSelected ? "bg-[var(--brand-500)] text-white ring-1 ring-[var(--brand-500)]" : "bg-white/80 ring-1 ring-black/25 dark:bg-white/5 dark:ring-white/60",
                                )}
                            >
                                {allSelected ? <Check className="size-3" strokeWidth={3.5} /> : null}
                            </span>
                            全选（{projects.length}）
                        </button>
                        {selectedIds.length ? (
                            <>
                                <span className="mx-1 h-4 w-px shrink-0 bg-[var(--hairline)]" />
                                <button
                                    type="button"
                                    disabled={exporting}
                                    onClick={() => void exportSelectedProjects()}
                                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors hover:bg-[var(--surface-soft)] disabled:opacity-50"
                                >
                                    <Download className="size-3.5 text-[var(--ink-2)]" strokeWidth={1.9} />
                                    导出
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDeleteIds(selectedIds)}
                                    className="rounded-full px-2.5 py-1 text-[var(--ink-1)] transition-colors hover:bg-[var(--surface-soft)]"
                                >
                                    删除（{selectedIds.length}）
                                </button>
                            </>
                        ) : null}
                        <span className="mx-1 h-4 w-px shrink-0 bg-[var(--hairline)]" />
                        <button type="button" onClick={exitSelectMode} className="rounded-full px-3 py-1 text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--ink-1)]">
                            取消
                        </button>
                    </div>
                </div>
            ) : null}

            <CanvasDeleteProjectsDialog />
        </main>
    );
}

/**
 * 多选入口图标：三行「点 + 划」。
 * viewBox 按字形本身收紧到 22×16（不是 24×24）：24 的方框里三行只占中间约 58%，
 * 渲染成 18px 时实际笔画只有 12px，放在 22px 的「画布」旁边就明显矮一截。
 * 收紧后 h-[19px] 出来的笔画高度和汉字基本齐平。
 * 颜色走 currentColor，由外层 style 注入 —— 这个 button 上 Tailwind 的文字尺寸类会被当成字号。
 */
function ThreeRowListIcon({ className, style }: { className?: string; style?: CSSProperties }) {
    return (
        <svg viewBox="0 0 22 16" fill="none" className={cn("h-[19px] w-[26px]", className)} style={style} aria-hidden="true" focusable="false">
            <circle cx="1.6" cy="1.8" r="1.4" fill="currentColor" />
            <path d="M6.4 1.8H20.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            <circle cx="1.6" cy="8" r="1.4" fill="currentColor" />
            <path d="M6.4 8H20.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            <circle cx="1.6" cy="14.2" r="1.4" fill="currentColor" />
            <path d="M6.4 14.2H20.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
    );
}
