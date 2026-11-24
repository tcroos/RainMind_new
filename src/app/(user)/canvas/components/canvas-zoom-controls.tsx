import { Focus, Map as MapIcon, Minus, Plus } from "lucide-react";
import { Button, Tooltip } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_MIN_ZOOM } from "../utils/canvas-zoom";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
};

const MIN_PERCENT = Math.round(CANVAS_MIN_ZOOM * 100);
const MAX_PERCENT = 500;

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap }: CanvasZoomControlsProps) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = {
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.toolbar.item,
        boxShadow: colorTheme === "dark" ? "inset 0 1px 0 rgba(255,255,255,.06), 0 20px 44px -18px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.35)" : "inset 0 1px 0 rgba(255,255,255,.95), 0 20px 44px -22px rgba(15,23,42,.4), 0 2px 6px rgba(15,23,42,.06)",
    };
    const percent = Math.round(scale * 100);

    const nudge = (delta: number) => {
        const next = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, percent + delta));
        onScaleChange(next / 100);
    };

    return (
        <div className="canvas-zoom-controls pointer-events-none absolute bottom-5 left-5 z-50" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="canvas-zoom-dock pointer-events-auto flex h-14 items-center gap-1 rounded-[18px] border px-2 backdrop-blur-xl" style={dockStyle}>
                <Tooltip title="重置视图">
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !rounded-[10px] !p-0" style={{ color: theme.toolbar.item }} icon={<Focus className="size-4" />} onClick={onReset} aria-label="重置视图" />
                </Tooltip>

                <span className="mx-0.5 h-6 w-px shrink-0" style={{ background: theme.toolbar.border }} aria-hidden="true" />

                <Tooltip title="缩小">
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !rounded-[10px] !p-0" style={{ color: theme.toolbar.item }} icon={<Minus className="size-3.5" />} onClick={() => nudge(-10)} aria-label="缩小画布" />
                </Tooltip>
                <input type="range" min={MIN_PERCENT} max={MAX_PERCENT} step="1" value={percent} className="canvas-zoom-slider w-20" onChange={(event) => onScaleChange(Number(event.target.value) / 100)} aria-label="放大/缩小画布" />
                <Tooltip title="放大">
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !rounded-[10px] !p-0" style={{ color: theme.toolbar.item }} icon={<Plus className="size-3.5" />} onClick={() => nudge(10)} aria-label="放大画布" />
                </Tooltip>

                <span className="ml-0.5 min-w-[44px] rounded-md px-1.5 py-1 text-center text-[11px] font-semibold tabular-nums" style={{ background: theme.toolbar.itemHover, color: theme.toolbar.item }}>
                    {percent}%
                </span>

                <span className="mx-0.5 h-6 w-px shrink-0" style={{ background: theme.toolbar.border }} aria-hidden="true" />

                {/* 小地图开关放在最右，品牌橙高亮，和普通工具按钮区分开 */}
                <Tooltip title={isMiniMapOpen ? "关闭小地图" : "打开小地图"}>
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !rounded-[10px] !p-0"
                        style={{ color: "#e2671f", background: isMiniMapOpen ? "rgba(226,103,31,.14)" : "transparent" }}
                        icon={<MapIcon className="size-4" />}
                        onClick={onToggleMiniMap}
                        aria-label={isMiniMapOpen ? "关闭小地图" : "打开小地图"}
                        aria-pressed={isMiniMapOpen}
                    />
                </Tooltip>
            </div>
        </div>
    );
}
