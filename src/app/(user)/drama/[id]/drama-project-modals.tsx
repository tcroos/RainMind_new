"use client";

import { Input, Modal, Segmented } from "antd";
import { Save } from "lucide-react";

import { buildSubtitleCues, formatTimelineTime } from "../subtitle";
import type { DramaProjectVersion, DramaShot } from "../types";

/* 功能页的几个弹窗与「新建短剧」共用一张整卡：不画分隔横线、不套描边行卡，
 * 层级靠浅底块和留白；按钮统一浅底 / 品牌橙，不再用 antd 默认那圈描边。 */
const softButtonClass = "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl !bg-[var(--surface-inset)] px-4 text-[13px] font-medium !text-[var(--ink-1)] transition hover:opacity-75";
const primaryButtonClass = "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl !bg-[var(--brand-600)] px-5 text-[13px] font-medium !text-white transition hover:opacity-90";
const modalBodyStyle = { padding: "8px 24px 24px" };

export function DramaVersionModal({ open, loading, versions, onClose, onSave, onRestore }: { open: boolean; loading: boolean; versions: DramaProjectVersion[]; onClose: () => void; onSave: () => void; onRestore: (version: DramaProjectVersion) => void }) {
    return (
        <Modal title="版本历史" open={open} onCancel={onClose} footer={null} width={640} styles={{ body: modalBodyStyle }}>
            <div className="grid gap-5">
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    <p className="text-[13px] leading-6 text-[var(--ink-3)]">关键重生成前会自动保存当前项目快照。</p>
                    <button type="button" className={softButtonClass} onClick={onSave}>
                        <Save className="size-4" />
                        保存当前版本
                    </button>
                </div>
                {loading ? (
                    <div className="grid min-h-32 place-items-center text-[13px] text-[var(--ink-3)]">正在加载版本…</div>
                ) : versions.length ? (
                    <div className="grid gap-2.5">
                        {versions.map((version) => (
                            <div key={version.id} className="flex flex-col items-stretch gap-3 rounded-xl bg-[var(--surface-inset)] p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                                <div className="min-w-0">
                                    <div className="text-[13px] font-semibold text-[var(--ink-1)]">版本 {version.version}</div>
                                    <div className="mt-1.5 text-[12px] text-[var(--ink-3)]">
                                        {version.reason} · {new Date(version.createdAt).toLocaleString()}
                                    </div>
                                </div>
                                <button type="button" className={`${softButtonClass} w-full sm:w-auto`} onClick={() => onRestore(version)}>
                                    恢复
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid min-h-32 place-items-center text-[13px] text-[var(--ink-3)]">还没有版本快照</div>
                )}
                <div className="flex justify-end">
                    <button type="button" className={softButtonClass} onClick={onClose}>
                        关闭
                    </button>
                </div>
            </div>
        </Modal>
    );
}

export function DramaJianyingModal({
    open,
    path,
    version,
    exporting,
    onClose,
    onExport,
    onPathChange,
    onVersionChange,
}: {
    open: boolean;
    path: string;
    version: "5" | "6";
    exporting: boolean;
    onClose: () => void;
    onExport: () => void;
    onPathChange: (value: string) => void;
    onVersionChange: (value: "5" | "6") => void;
}) {
    return (
        <Modal title="导出剪映草稿" open={open} onCancel={onClose} footer={null} width={560} styles={{ body: modalBodyStyle }}>
            <div className="grid gap-5">
                <p className="text-[13px] leading-6 text-[var(--ink-3)]">导出后把草稿目录交给剪映即可继续剪辑。</p>
                <div className="grid gap-2">
                    <span className="text-[13px] font-semibold text-[var(--ink-1)]">剪映草稿目录</span>
                    <Input className="library-input !h-11" value={path} onChange={(event) => onPathChange(event.target.value)} placeholder="C:\Users\你的用户名\AppData\Local\JianyingPro\User Data\Projects\com.lveditor.draft" />
                </div>
                <div className="grid gap-2">
                    <span className="text-[13px] font-semibold text-[var(--ink-1)]">剪映版本</span>
                    <Segmented
                        block
                        className="library-segmented !w-full"
                        value={version}
                        options={[
                            { label: "6.0+", value: "6" },
                            { label: "5.x", value: "5" },
                        ]}
                        onChange={(value) => onVersionChange(value as "5" | "6")}
                    />
                </div>
                <div className="flex items-center justify-end gap-3 pt-1">
                    <button type="button" className={softButtonClass} onClick={onClose}>
                        取消
                    </button>
                    <button type="button" disabled={exporting} className={primaryButtonClass} onClick={onExport}>
                        {exporting ? "导出中…" : "导出 ZIP"}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

export function DramaSubtitleModal({ open, shots, onClose }: { open: boolean; shots: DramaShot[]; onClose: () => void }) {
    const cues = buildSubtitleCues(shots);
    return (
        <Modal title="字幕时间轴" open={open} onCancel={onClose} footer={null} width={720} styles={{ body: modalBodyStyle }}>
            <div className="grid gap-5">
                <div className="max-h-[56vh] grid gap-2.5 overflow-y-auto">
                    {cues.length ? (
                        cues.map((cue) => (
                            <div key={cue.index} className="grid gap-2 rounded-xl bg-[var(--surface-inset)] p-4 sm:grid-cols-[100px_minmax(0,1fr)] sm:gap-4">
                                <div className="text-[12px] font-medium tabular-nums text-[var(--ink-3)]">
                                    {formatTimelineTime(cue.startMs)}–{formatTimelineTime(cue.endMs)}
                                </div>
                                <div className="text-[13px] leading-6 text-[var(--ink-1)]">{cue.text}</div>
                            </div>
                        ))
                    ) : (
                        <div className="grid min-h-32 place-items-center text-[13px] text-[var(--ink-3)]">还没有字幕内容</div>
                    )}
                </div>
                <div className="flex justify-end">
                    <button type="button" className={softButtonClass} onClick={onClose}>
                        关闭
                    </button>
                </div>
            </div>
        </Modal>
    );
}
