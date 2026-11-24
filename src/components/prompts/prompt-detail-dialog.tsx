"use client";

import { ChevronDown, Copy, FolderPlus, Quote, X } from "lucide-react";
import { Button, Modal } from "antd";
import { useEffect, useState } from "react";

import { imagePreviewUrl, originalImageSourceUrl } from "@/lib/media-image-url";
import { cn } from "@/lib/utils";
import { formatPromptDate, type Prompt } from "@/services/api/prompts";

/** 正文超过这个长度就折叠：长提示词在弹窗内滚动，不把整页撑出屏幕。 */
const CLAMP_LENGTH = 220;

/**
 * 公共词库详情弹窗。
 *
 * 之前的版本是「标题栏 + 中间分栏 + 底部栏」三段，三段之间各画一条横线，
 * 预览图在小半边里被上下留白夹住，右侧是一排带描边的 antd Tag 和黑按钮——
 * 放在全站「无线条、浅底块」的语言里非常突兀。
 *
 * 现在改成一整张详情卡：左侧图片铺满可用高度（模糊底图填充，主图完整 contain），
 * 右侧靠留白组织标题、标签、正文和操作，不画任何分隔线；操作按钮复用素材库的
 * 橙色主按钮与浅底次按钮，保证和页面其他动作是同一套控件。
 */
export function PromptDetailDialog({ prompt, previewUrl, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; previewUrl?: string; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const [expanded, setExpanded] = useState(false);
    const [coverState, setCoverState] = useState<"loading" | "ready" | "error">("loading");
    const [coverAttempt, setCoverAttempt] = useState(0);

    useEffect(() => {
        setExpanded(false);
        setCoverState("loading");
        setCoverAttempt(0);
    }, [prompt?.id]);

    /* 列表页已经缓存 640 宽的缩略图，优先复用它，弹窗打开就有画面。
     * 图片代理偶发 502 时再试一次原图地址，仍失败才退成文字占位。 */
    const previewSource = previewUrl || (prompt?.coverUrl ? imagePreviewUrl(prompt.coverUrl, 960) : "");
    const originalSource = prompt?.coverUrl ? originalImageSourceUrl(prompt.coverUrl) : "";
    const coverUrl = coverAttempt === 1 && originalSource ? originalSource : previewSource;
    const hasCover = Boolean(coverUrl) && coverState !== "error";
    const handleCoverError = () => {
        if (coverAttempt === 0 && originalSource && originalSource !== previewSource) {
            setCoverAttempt(1);
            setCoverState("loading");
        } else {
            setCoverState("error");
        }
    };
    const collapsible = Boolean(prompt && prompt.prompt.length > CLAMP_LENGTH);
    const visibleTags = prompt?.tags.filter((tag) => tag !== prompt.category).slice(0, 4) || [];

    return (
        <Modal
            open={Boolean(prompt)}
            onCancel={onClose}
            footer={null}
            title={null}
            closable={false}
            centered
            width={1080}
            styles={{
                container: { padding: 0, overflow: "hidden", borderRadius: 24 },
                body: { padding: 0, overflow: "hidden" },
                mask: { background: "rgba(17, 17, 19, 0.48)", backdropFilter: "blur(6px)" },
            }}
        >
            {prompt ? (
                <div className="flex h-[min(82dvh,640px)] max-h-[calc(100dvh-32px)] flex-col overflow-hidden bg-[var(--surface-panel)] text-[var(--ink-1)] md:grid md:grid-cols-[minmax(0,46%)_minmax(0,54%)]">
                    {/* 预览区：桌面上是一块内嵌的大图，blur 底图填满空隙，主图完整可见；移动端压成横幅。 */}
                    <div className="relative m-3 h-48 shrink-0 overflow-hidden rounded-2xl bg-[var(--surface-inset)] md:m-3 md:h-auto md:min-h-0">
                        {hasCover ? (
                            <>
                                {/* eslint-disable-next-line @next/next/no-img-element -- 素材域名来自用户上传与模型产物，不走 next/image 白名单 */}
                                <img aria-hidden src={coverUrl} alt="" decoding="async" className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-3xl saturate-150" />
                                {/* eslint-disable-next-line @next/next/no-img-element -- 同上 */}
                                <img
                                    src={coverUrl}
                                    alt={prompt.title}
                                    decoding="async"
                                    className={cn("relative size-full object-contain p-3 transition-opacity duration-300 md:p-5", coverState === "ready" ? "opacity-100" : "opacity-0")}
                                    onLoad={() => setCoverState("ready")}
                                    onError={handleCoverError}
                                />
                                {coverState === "loading" ? (
                                    <div className="absolute inset-0 grid place-items-center px-8 text-center">
                                        <div className="flex flex-col items-center gap-3">
                                            <span className="grid size-11 place-items-center rounded-2xl bg-[var(--surface-panel)] text-[var(--brand-600)]">
                                                <Quote className="size-5" aria-hidden />
                                            </span>
                                            <span className="line-clamp-3 text-[13px] font-medium text-[var(--ink-2)]">{prompt.title}</span>
                                            <span className="text-[11px] text-[var(--ink-3)]">正在加载预览图</span>
                                        </div>
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <div className="flex size-full flex-col items-center justify-center gap-3 px-8 text-center">
                                <span className="grid size-12 place-items-center rounded-2xl bg-[var(--surface-panel)] text-[var(--brand-600)]">
                                    <Quote className="size-5" aria-hidden />
                                </span>
                                <span className="line-clamp-3 text-[13px] font-medium text-[var(--ink-2)]">{prompt.title}</span>
                                <span className="text-[11px] text-[var(--ink-3)]">{coverState === "error" ? "预览图加载失败，可查看下方提示词" : "这条提示词没有预览图"}</span>
                            </div>
                        )}
                    </div>

                    {/* 内容区：没有 header/footer 横线，层级靠字号、间距和一块浅底正文区域。 */}
                    <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-1 md:py-7 md:pl-2 md:pr-7">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {prompt.category ? <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-600)]">{prompt.category}</span> : null}
                                    {visibleTags.map((tag) => (
                                        <span key={tag} className="rounded-full bg-[var(--surface-inset)] px-2.5 py-1 text-[11px] text-[var(--ink-2)]">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                                <h2 className="mt-3 text-[18px] font-semibold leading-7 tracking-[-0.01em] text-[var(--ink-1)] sm:text-[20px]">{prompt.title}</h2>
                                <p className="mt-1 text-[11.5px] text-[var(--ink-3)]">更新于 {formatPromptDate(prompt.updatedAt)} · 共 {prompt.prompt.length} 字</p>
                            </div>
                            <button type="button" className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--surface-inset)] text-[var(--ink-2)] transition hover:bg-[var(--surface-hover)]" aria-label="关闭提示词详情" title="关闭" onClick={onClose}>
                                <X className="size-4" />
                            </button>
                        </div>

                        {/* 正文区固定上限：短提示词不会拉出一大块空灰底，长提示词在区内滚动。 */}
                        <div className="relative mt-4 h-[min(38dvh,300px)] min-h-[140px] shrink-0 md:h-[min(46dvh,340px)]">
                            <div className="thin-scrollbar size-full overflow-y-auto overscroll-contain rounded-2xl bg-[var(--surface-inset)] px-4 py-3.5">
                                <p className={cn("whitespace-pre-wrap break-words text-[13px] leading-[1.9] text-[var(--ink-2)]", !expanded && collapsible && "line-clamp-6")}>{prompt.prompt}</p>
                            </div>
                            {collapsible && !expanded ? <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-2xl bg-[linear-gradient(180deg,transparent,var(--surface-inset))]" /> : null}
                        </div>

                        <div className="mt-2 flex shrink-0 justify-start">
                            {collapsible ? (
                                <button
                                    type="button"
                                    aria-expanded={expanded}
                                    className="inline-flex h-7 items-center gap-1 rounded-lg text-[12px] font-medium text-[var(--brand-600)] transition-colors hover:text-[var(--brand-500)]"
                                    onClick={() => setExpanded((value) => !value)}
                                >
                                    {expanded ? "收起" : "展开全部"}
                                    <ChevronDown className={cn("size-3.5 transition-transform duration-200", expanded && "rotate-180")} aria-hidden />
                                </button>
                            ) : null}
                        </div>

                        <footer className="mt-auto flex shrink-0 flex-wrap items-center justify-end gap-2 pt-3">
                            {onSaveAsset ? (
                                <Button size="large" className="library-tool !h-10 !rounded-xl" icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                    加入我的素材
                                </Button>
                            ) : null}
                            <Button type="primary" size="large" className="library-primary !h-10 !rounded-xl" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                复制提示词
                            </Button>
                        </footer>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}
