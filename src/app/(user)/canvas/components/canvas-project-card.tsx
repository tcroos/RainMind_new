"use client";

import { Check, Download, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { App, Dropdown, Input } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { useCanvasStore, type CanvasProjectSummary } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";
import { exportCanvasProjects } from "../utils/canvas-export";
import { CanvasProjectCover } from "./canvas-project-cover";
import { formatCanvasUpdatedDate } from "./canvas-project-format";

/** 选择控件是白底浮在封面上，深色主题有一条未分层的 `button` 颜色规则会把图标刷白，这里用内联色兜住。 */
const actionSurface =
    "bg-white/95 ring-1 ring-black/10 shadow-[0_2px_8px_rgba(17,17,19,0.28)] hover:bg-white dark:bg-white/92 dark:hover:bg-white";
const controlInk = { color: "#3f3f46" } as const;
/** 默认隐形，指针悬停或键盘聚焦时才露出来，避免缩略图上长期压着小按钮 */
const revealClass = "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100";

export function CanvasProjectCard({ project }: { project: CanvasProjectSummary }) {
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const loadProject = useCanvasStore((state) => state.loadProject);
    const [exporting, setExporting] = useState(false);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const updatedLabel = formatCanvasUpdatedDate(project.updatedAt);
    const href = `/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    const preload = () => {
        router.prefetch(href);
        void loadProject(project.id).catch(() => undefined);
    };
    const open = () => {
        preload();
        router.push(href);
    };
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };
    const exportProject = async () => {
        if (exporting) return;
        setExporting(true);
        try {
            const detail = await loadProject(project.id);
            await exportCanvasProjects([detail]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布导出失败");
        } finally {
            setExporting(false);
        }
    };
    const menuItems: MenuProps["items"] = [
        { key: "rename", label: "重命名", icon: <Pencil className="size-3.5" /> },
        { key: "export", label: exporting ? "导出中…" : "导出画布", icon: <Download className="size-3.5" />, disabled: exporting },
        { key: "publish", label: "发布作品", icon: <Share2 className="size-3.5" /> },
        { type: "divider" },
        { key: "delete", label: "删除", icon: <Trash2 className="size-3.5" />, danger: true },
    ];
    const runAction = (key: string) => {
        if (key === "rename") startEditing(project.id, project.title);
        else if (key === "export") void exportProject();
        else if (key === "publish") router.push(`/works?sourceType=canvas&sourceId=${encodeURIComponent(project.id)}`);
        else if (key === "delete") setDeleteIds([project.id]);
    };

    return (
        <article className="group/card relative flex min-w-0 flex-col">
            {/* 卡片本体保持静止，只让边框与投影轻微加深：列表里一排卡片同时上浮会显得吵 */}
            <div
                className={cn(
                    "relative aspect-[16/10] overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface-soft)] transition-[border-color,box-shadow] duration-200",
                    "group-hover/card:border-[rgba(17,17,19,0.16)] group-hover/card:shadow-[0_6px_18px_-14px_rgba(17,17,19,0.3)]",
                    "dark:border-transparent dark:group-hover/card:border-[rgba(255,255,255,0.1)] dark:group-hover/card:shadow-none",
                    // 用 outline 而不是 shadow 画选中框，免得和落影互相覆盖
                    selected && "outline outline-2 -outline-offset-1 outline-[var(--brand-500)]",
                )}
            >
                <button
                    type="button"
                    onClick={open}
                    onPointerEnter={preload}
                    onFocus={preload}
                    aria-label={`打开画布 ${project.title}`}
                    className="absolute inset-0 block size-full cursor-pointer overflow-hidden"
                >
                    <CanvasProjectCover previews={project.previews ?? []} />
                </button>

                <button
                    type="button"
                    aria-label={selected ? `取消选择 ${project.title}` : `选择 ${project.title}`}
                    aria-pressed={selected}
                    onClick={(event) => {
                        event.stopPropagation();
                        toggleSelected(project.id, !selected);
                    }}
                    className={cn(
                        "absolute left-2 top-2 grid size-6 place-items-center rounded-md transition-opacity duration-150",
                        selected ? "bg-[var(--brand-500)] shadow-[0_2px_8px_rgba(226,103,31,0.42)] ring-1 ring-white/70 hover:bg-[var(--brand-600)]" : cn(actionSurface, revealClass),
                    )}
                    style={selected ? { color: "#ffffff" } : controlInk}
                >
                    {/* 方形空框＝未选中，橙色勾＝已选中；圆点太容易被当成装饰 */}
                    <Check className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} strokeWidth={3.5} />
                </button>
            </div>

            <div className="mt-2 flex min-w-0 items-center gap-1">
                {editing ? (
                    <Input
                        size="small"
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") saveTitle();
                            if (event.key === "Escape") stopEditing();
                        }}
                        onBlur={saveTitle}
                        autoFocus
                        aria-label="画布名称"
                    />
                ) : (
                    <>
                        <button type="button" onPointerEnter={preload} onClick={open} className="min-w-0 flex-1 cursor-pointer text-left">
                            <h2 className="truncate text-[13px] font-medium leading-5 text-[var(--ink-1)]">{project.title}</h2>
                        </button>
                        <Dropdown
                            menu={{
                                items: menuItems,
                                onClick: ({ key, domEvent }) => {
                                    domEvent.stopPropagation();
                                    runAction(key);
                                },
                            }}
                            trigger={["click"]}
                            placement="bottomRight"
                        >
                            <button
                                type="button"
                                aria-label={`${project.title} 的更多操作`}
                                onClick={(event) => event.stopPropagation()}
                                className={cn(
                                    "grid size-6 shrink-0 place-items-center rounded-md text-[var(--ink-3)] transition-colors duration-150 hover:bg-[var(--surface-soft)] hover:text-[var(--ink-1)]",
                                    revealClass,
                                )}
                            >
                                <MoreHorizontal className="size-4" />
                            </button>
                        </Dropdown>
                    </>
                )}
            </div>
            {updatedLabel ? <p className="mt-0.5 truncate px-0.5 text-[11px] leading-4 text-[var(--ink-3)]">{updatedLabel}</p> : null}
        </article>
    );
}
