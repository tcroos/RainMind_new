"use client";

import { Modal } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

/* 快捷键说明弹窗。原先是画布顶栏右下角的入口，现在由底部工具栏触发，
 * 所以从 canvas-top-bar 里抽出来独立管理。 */
export function CanvasShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Modal title="快捷键" open={open} onCancel={onClose} footer={null} centered width={640}>
            <div className="max-h-[min(72vh,620px)] space-y-0.5 overflow-y-auto border-t pt-3 text-sm" style={{ borderColor: theme.node.stroke }}>
                <Shortcut keys={["拖动画布"]} value="平移视图" theme={theme} />
                <Shortcut keys={["滚轮"]} value="缩放画布" theme={theme} />
                <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" theme={theme} />
                <Shortcut keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" theme={theme} />
                <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" theme={theme} />
                <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" theme={theme} />
                <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" theme={theme} />
                <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" theme={theme} />
                <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" theme={theme} />
                <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" theme={theme} />
                <Shortcut keys={["Delete / Backspace"]} value="删除选中" theme={theme} />
                <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" theme={theme} />
                <Shortcut keys={["拖入图片/视频/音频"]} value="上传到画布" theme={theme} />
            </div>
        </Modal>
    );
}

function Shortcut({ keys, value, theme }: { keys: string[]; value: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(120px,190px)] items-start gap-4 rounded-lg px-1.5 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2 py-1 text-center text-xs font-medium leading-4 shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: theme.toolbar.border, background: theme.toolbar.itemHover, color: theme.toolbar.item }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-left text-xs leading-5" style={{ color: theme.node.muted }}>
                {value}
            </span>
        </div>
    );
}
