"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Columns3, Copy, Download, GripVertical, Group, ImagePlus, LayoutGrid, Play, Rows3, Save, Trash2, Ungroup } from "lucide-react";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { type CanvasArrangeMode } from "../utils/canvas-node-arrange";

export type CanvasSelectionActions = {
    onSaveAssets: (ids: string[]) => void;
    onDuplicate: (ids: string[]) => void;
    onDownload: (ids: string[]) => void;
    onRun: (ids: string[]) => void;
    onAddMaterial: (ids: string[]) => void;
    onDelete: (ids: string[]) => void;
    onArrange: (ids: string[], mode: CanvasArrangeMode) => void;
};

type CanvasSelectionToolbarProps = {
    /** 选区在世界坐标里的左上角与宽度，用于把工具栏居中挂在选区上方 */
    anchor: { left: number; top: number; width: number };
    scale: number;
    theme: CanvasTheme;
    themeName: "light" | "dark";
    nodeIds: string[];
    groupId: string | null;
    groupLabel: string | null;
    onGroup: (ids: string[]) => void;
    onUngroup: (ids: string[]) => void;
    actions: CanvasSelectionActions;
};

const ARRANGE_ITEMS: { mode: CanvasArrangeMode; label: string; Icon: typeof LayoutGrid }[] = [
    { mode: "grid", label: "宫格排列", Icon: LayoutGrid },
    { mode: "row", label: "水平排列", Icon: Rows3 },
    { mode: "column", label: "垂直排列", Icon: Columns3 },
];

export function CanvasSelectionToolbar({ anchor, scale, theme, themeName, nodeIds, groupId, groupLabel, onGroup, onUngroup, actions }: CanvasSelectionToolbarProps) {
    const [openMenu, setOpenMenu] = useState<"group" | "arrange" | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!openMenu) return;
        const onPointerDown = (event: PointerEvent) => {
            if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpenMenu(null);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [openMenu]);

    const stop = useCallback((event: React.PointerEvent | React.MouseEvent) => event.stopPropagation(), []);
    const run = useCallback(
        (fn: (ids: string[]) => void) => {
            setOpenMenu(null);
            fn(nodeIds);
        },
        [nodeIds],
    );

    const panelBg = themeName === "light" ? "#ffffff" : theme.toolbar.panel;
    const panelBorder = themeName === "light" ? "rgba(17,17,19,0.10)" : theme.toolbar.border;
    const fg = theme.toolbar.item;
    const menuBg = panelBg;

    const buttonClass = "flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium whitespace-nowrap transition-colors";
    const divider = <span className="mx-0.5 h-4 w-px shrink-0" style={{ background: panelBorder }} aria-hidden />;

    return (
        <div
            ref={rootRef}
            data-canvas-selection-toolbar
            data-canvas-multi-selection-count
            aria-label={`已选 ${nodeIds.length} 项`}
            className="pointer-events-auto absolute flex items-center gap-0.5 whitespace-nowrap rounded-xl px-1 py-1"
            style={{
                left: anchor.left + anchor.width / 2,
                top: anchor.top - 12 / Math.max(scale, 0.01),
                transform: `translate(-50%, -100%) scale(${1 / Math.max(scale, 0.01)})`,
                transformOrigin: "50% 100%",
                background: panelBg,
                border: `1px solid ${panelBorder}`,
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                color: fg,
                zIndex: 80,
            }}
            onPointerDown={stop}
            onMouseDown={stop}
            onClick={stop}
        >
            <span className="grid size-6 shrink-0 place-items-center opacity-50" title="拖动选区即可整体移动" aria-hidden>
                <GripVertical className="size-3.5" />
            </span>

            <button type="button" className={buttonClass} style={{ color: fg }} title="把选中节点保存到素材库" onClick={() => run(actions.onSaveAssets)}>
                <Save className="size-3.5" aria-hidden />
                <span>保存到资产</span>
            </button>
            <button type="button" className={buttonClass} style={{ color: fg }} title="复制选中的节点" onClick={() => run(actions.onDuplicate)}>
                <Copy className="size-3.5" aria-hidden />
                <span>创建副本</span>
            </button>

            {divider}

            <div className="relative flex items-center gap-0.5">
                <button
                    type="button"
                    data-canvas-group-action
                    className={buttonClass}
                    style={{ color: fg, background: groupId ? theme.toolbar.activeBg : undefined }}
                    title={groupId ? `${groupLabel || "当前组"}：解除编组` : "把选中节点编为一组"}
                    onClick={() => (groupId ? run(onUngroup) : run(onGroup))}
                >
                    {groupId ? <Ungroup className="size-3.5" aria-hidden /> : <Group className="size-3.5" aria-hidden />}
                    <span>{groupId ? "解组" : "打组"}</span>
                </button>
                <button type="button" className="grid size-5 shrink-0 place-items-center rounded" style={{ color: fg }} title="编组选项" aria-label="编组选项" onClick={() => setOpenMenu((current) => (current === "group" ? null : "group"))}>
                    <ChevronDown className="size-3" aria-hidden />
                </button>
                {openMenu === "group" ? (
                    <div
                        data-canvas-no-drag
                        className="absolute left-0 top-full z-[90] mt-1 min-w-[112px] rounded-lg p-1"
                        style={{ background: menuBg, border: `1px solid ${panelBorder}`, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                        onPointerDown={stop}
                        onClick={stop}
                    >
                        <button type="button" className={`${buttonClass} w-full`} style={{ color: fg }} onClick={() => run(onGroup)}>
                            <Group className="size-3.5" aria-hidden />
                            <span>打组</span>
                        </button>
                        <button type="button" className={`${buttonClass} w-full`} style={{ color: fg }} onClick={() => run(onUngroup)}>
                            <Ungroup className="size-3.5" aria-hidden />
                            <span>解除编组</span>
                        </button>
                    </div>
                ) : null}
            </div>

            <button type="button" className={buttonClass} style={{ color: fg }} title="下载选中的图片或视频" onClick={() => run(actions.onDownload)}>
                <Download className="size-3.5" aria-hidden />
                <span>下载</span>
            </button>
            <button type="button" className={buttonClass} style={{ color: fg }} title="重新执行选中节点的生成任务" onClick={() => run(actions.onRun)}>
                <Play className="size-3.5" aria-hidden />
                <span>整组执行</span>
            </button>
            <button type="button" className={buttonClass} style={{ color: fg }} title="从素材库添加素材到画布" onClick={() => run(actions.onAddMaterial)}>
                <ImagePlus className="size-3.5" aria-hidden />
                <span>添加素材</span>
            </button>

            <div className="relative">
                <button type="button" className={buttonClass} style={{ color: fg }} title="调整选中节点的排列方式" aria-label="调整排序" onClick={() => setOpenMenu((current) => (current === "arrange" ? null : "arrange"))}>
                    <LayoutGrid className="size-3.5" aria-hidden />
                    <span>排序</span>
                    <ChevronDown className="size-3 opacity-70" aria-hidden />
                </button>
                {openMenu === "arrange" ? (
                    <div
                        data-canvas-no-drag
                        className="absolute left-0 top-full z-[90] mt-1 min-w-[112px] rounded-lg p-1"
                        style={{ background: menuBg, border: `1px solid ${panelBorder}`, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                        onPointerDown={stop}
                        onClick={stop}
                    >
                        {ARRANGE_ITEMS.map(({ mode, label, Icon }) => (
                            <button key={mode} type="button" className={`${buttonClass} w-full`} style={{ color: fg }} onClick={() => run((ids) => actions.onArrange(ids, mode))}>
                                <Icon className="size-3.5" aria-hidden />
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>

            {divider}

            <button type="button" className={`${buttonClass} text-red-500`} title="删除选中的节点" onClick={() => run(actions.onDelete)}>
                <Trash2 className="size-3.5" aria-hidden />
                <span>删除</span>
            </button>
        </div>
    );
}
