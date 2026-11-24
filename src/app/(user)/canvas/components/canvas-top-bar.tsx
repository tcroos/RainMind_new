"use client";

import { useEffect, useRef, useState } from "react";
import { Dropdown } from "antd";
import { BookOpen, LibraryBig, Menu, MessageSquareText, Redo2, Sparkles, Trash2, Undo2, Upload } from "lucide-react";

import { FEEDBACK_FORM_URL } from "@/constant/site-links";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasProjectSaveState } from "../stores/use-canvas-store";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    saveState,
    canUndo,
    canRedo,
    onWorkbench,
    onDeleteProject,
    onImportImage,
    onUndo,
    onRedo,
    assetsOpen,
    onToggleAssets,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    saveState?: CanvasProjectSaveState;
    canUndo: boolean;
    canRedo: boolean;
    onWorkbench: () => void;
    onDeleteProject: () => void;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
    assetsOpen: boolean;
    onToggleAssets: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const menuTriggerRef = useRef<HTMLButtonElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    useEffect(() => {
        if (!menuOpen) return;
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (menuTriggerRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest(".ant-dropdown, .ant-dropdown-menu, .ant-dropdown-menu-submenu, .ant-dropdown-menu-submenu-popup")) return;
            setMenuOpen(false);
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [menuOpen]);

    return (
        <>
            <div className="canvas-topbar pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between gap-2 px-3 sm:h-20 sm:px-6" data-save-status={saveState?.status || "saved"}>
                <div className="canvas-topbar-left pointer-events-auto flex min-w-0 items-center gap-2 sm:gap-3">
                    <Dropdown
                        open={menuOpen}
                        onOpenChange={setMenuOpen}
                        trigger={["click"]}
                        menu={{
                            onClick: () => setMenuOpen(false),
                            items: [
                                { key: "workbench", icon: <Sparkles className="size-4" />, label: "工作台", onClick: onWorkbench },
                                { key: "docs", icon: <BookOpen className="size-4" />, label: "使用帮助", onClick: () => window.location.assign("/help?section=canvas") },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                                { type: "divider" },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除画布", onClick: onDeleteProject },
                            ],
                        }}
                    >
                        <button ref={menuTriggerRef} type="button" className="grid size-9 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="canvas-topbar-title flex min-w-0 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="w-[min(280px,48vw)] max-w-[280px] bg-transparent p-0 text-left text-base font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="canvas-topbar-title-button max-w-[min(34vw,280px)] truncate border-b border-dashed border-transparent text-left text-sm font-semibold tracking-normal transition hover:border-current sm:text-base"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                    <span className="h-4 w-px shrink-0" style={{ background: theme.toolbar.border }} aria-hidden="true" />
                    <button
                        type="button"
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2"
                        style={{ background: assetsOpen ? theme.toolbar.itemHover : "transparent", color: theme.node.text }}
                        onClick={onToggleAssets}
                        aria-label={assetsOpen ? "关闭资产面板" : "打开资产面板"}
                        aria-expanded={assetsOpen}
                    >
                        <LibraryBig className="size-4" aria-hidden="true" />
                        <span className="hidden sm:inline">资产</span>
                    </button>
                </div>

                <div className="canvas-topbar-actions pointer-events-auto flex min-w-0 items-center gap-2 sm:gap-2.5">
                    {/* 反馈入口：与侧边栏同一个飞书表单，新窗口打开，不打断画布编辑 */}
                    <a
                        href={FEEDBACK_FORM_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2"
                        style={{ background: "transparent", color: theme.node.text }}
                        aria-label="反馈问题"
                        title="反馈问题"
                    >
                        <MessageSquareText className="size-4" aria-hidden="true" />
                        <span className="hidden sm:inline">反馈</span>
                    </a>
                    {/* Agent 入口在底部工具栏右侧的呼吸球 */}
                    <UserStatusActions variant="canvas" />
                </div>
            </div>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}
