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

/** 默认隐形，指针悬停或键盘聚焦时才露出来，避免缩略图上长期压着小按钮 */
const revealClass = "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100";

export function CanvasProjectCard({ project, selectable = false }: { project: CanvasProjectSummary; selectable?: boolean }) {
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
        if (selectable) return;
        router.prefetch(href);
        void loadProject(project.id).catch(() => undefined);
    };
    const open = () => {
        // 多选态下整张卡就是复选框的点击区，不要再跳走
        if (selectable) {
            toggleSelected(project.id, !selected);
            return;
        }
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
                    // 用 outline 而不是 shadow 画选中框，免得和落影互相覆盖；1.5px 够辨认又不喧宾夺主
                    selected && "outline outline-[1.5px] -outline-offset-1 outline-[var(--brand-500)]",
                )}
            >
                <button
                    type="button"
                    onClick={open}
                    onPointerEnter={preload}
                    onFocus={preload}
                    aria-label={selectable ? `${selected ? "取消选择" : "选择"} ${project.title}` : `打开画布 ${project.title}`}
                    aria-pressed={selectable ? selected : undefined}
                    className="absolute inset-0 block size-full cursor-pointer overflow-hidden"
                >
                    <CanvasProjectCover previews={project.previews ?? []} />
                </button>

                {/* 复选框落在封面右上角、16px 见方：参考稿就是这个位置和体量。
                    之前是左上角 24px 白底浮块，压住封面又抢视线，和批量操作的心理模型也不符（勾选通常在右上） */}
                {selectable ? (
                    <span
                        aria-hidden
                        className={cn(
                            "pointer-events-none absolute right-2 top-2 grid size-4 place-items-center rounded-[4px] transition-colors duration-150",
                            selected
                                ? "bg-[var(--brand-500)] text-white ring-1 ring-[var(--brand-500)]"
                                : "bg-white/85 ring-1 ring-black/25 dark:bg-white/5 dark:ring-white/60",
                        )}
                    >
                        {selected ? <Check className="size-3" strokeWidth={3.5} /> : null}
                    </span>
                ) : null}
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
                        {/* 多选态下只留勾选，收起更多操作，避免两个入口抢同一块区域 */}
                        {selectable ? null : (
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
                        )}
                    </>
                )}
            </div>
            {updatedLabel ? <p className="mt-0.5 truncate px-0.5 text-[12px] leading-4 text-[var(--ink-3)]">{updatedLabel}</p> : null}
        </article>
    );
}
