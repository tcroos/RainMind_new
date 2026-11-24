"use client";

import { Copy, FolderPlus, Quote, X } from "lucide-react";
import { Button, Modal } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import { imagePreviewUrl, originalImageSourceUrl } from "@/lib/media-image-url";
import { cn } from "@/lib/utils";
import { formatPromptDate, type Prompt } from "@/services/api/prompts";

/**
 * 公共词库详情弹窗。
 *
 * 一整张无分隔线的详情卡：左侧图片铺满可用高度（模糊底图填充，主图完整 contain），
 * 右侧靠留白组织标题、标签、正文和操作。正文不再折叠——长文本直接在定高区域内滚动，
 * 右侧只有一条很窄的滚动进度指示，内容不溢出时完全不显示，可拖动定位。
 */
export function PromptDetailDialog({ prompt, previewUrl, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; previewUrl?: string; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const [coverState, setCoverState] = useState<"loading" | "ready" | "error">("loading");
    const [coverAttempt, setCoverAttempt] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const [thumb, setThumb] = useState({ visible: false, height: 0, top: 0 });
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
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
    const visibleTags = prompt?.tags.filter((tag) => tag !== prompt.category).slice(0, 4) || [];

    /* 原生滚动条隐藏后，用一条 4px 的指示条表达「还有多少内容」和「看到哪里」。
     * 只在 scrollHeight > clientHeight 时出现，短提示词不会有那一条线。 */
    const updateThumb = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const { scrollHeight, clientHeight, scrollTop } = el;
        const overflow = scrollHeight - clientHeight;
        if (overflow <= 2) {
            setThumb((prev) => (prev.visible ? { visible: false, height: 0, top: 0 } : prev));
            return;
        }
        const height = Math.max(24, Math.round((clientHeight / scrollHeight) * clientHeight));
        const top = Math.round((scrollTop / overflow) * (clientHeight - height));
        setThumb((prev) => (prev.visible && prev.height === height && prev.top === top ? prev : { visible: true, height, top }));
    }, []);

    useEffect(() => {
        /* antd Modal 的内容走 portal，ref 可能比父组件的 passive effect 晚一帧挂上；
         * 这里等到元素真的存在再订阅，并在布局稳定后补量一次。 */
        const frames: number[] = [];
        let cleanup = () => {};
        const attach = () => {
            const el = scrollRef.current;
            if (!el) {
                frames.push(requestAnimationFrame(attach));
                return;
            }
            updateThumb();
            frames.push(requestAnimationFrame(updateThumb));
            el.addEventListener("scroll", updateThumb, { passive: true });
            const observer = new ResizeObserver(updateThumb);
            observer.observe(el);
            if (el.firstElementChild) observer.observe(el.firstElementChild);
            cleanup = () => {
                el.removeEventListener("scroll", updateThumb);
                observer.disconnect();
            };
        };
        attach();
        return () => {
            frames.forEach(cancelAnimationFrame);
            cleanup();
        };
    }, [prompt?.id, updateThumb]);

    const seekTo = useCallback((clientY: number) => {
        const el = scrollRef.current;
        const track = trackRef.current;
        if (!el || !track) return;
        const rect = track.getBoundingClientRect();
        if (!rect.height) return;
        const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
        el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
    }, []);

    useEffect(() => {
        if (!dragging) return;
        const move = (event: PointerEvent) => seekTo(event.clientY);
        const stop = () => setDragging(false);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
        };
    }, [dragging, seekTo]);

    const scrollPercent = thumb.visible ? Math.round((thumb.top / Math.max(1, (scrollRef.current?.clientHeight || 1) - thumb.height)) * 100) : 0;

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

                        {/* 全文直出，不折叠；原生滚动条隐藏，右侧一条窄指示条只在有溢出时出现。 */}
                        <div className="relative mt-4 h-[min(38dvh,300px)] min-h-[140px] shrink-0 md:h-[min(46dvh,340px)]">
                            <div
                                ref={scrollRef}
                                id="prompt-detail-content"
                                className="thin-scrollbar size-full overflow-y-auto overscroll-contain rounded-2xl bg-[var(--surface-inset)] px-4 py-3.5 pr-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                            >
                                <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.9] text-[var(--ink-2)]">{prompt.prompt}</p>
                            </div>
                            {thumb.visible ? (
                                <div
                                    ref={trackRef}
                                    role="scrollbar"
                                    aria-controls="prompt-detail-content"
                                    aria-orientation="vertical"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={Math.min(100, Math.max(0, scrollPercent))}
                                    className="absolute inset-y-2 right-1 w-1 cursor-pointer touch-none rounded-full"
                                    onPointerDown={(event) => {
                                        event.preventDefault();
                                        setDragging(true);
                                        seekTo(event.clientY);
                                    }}
                                >
                                    <div
                                        className={cn("absolute inset-x-0 rounded-full bg-[var(--ink-2)] opacity-60 transition-opacity", dragging && "opacity-90")}
                                        style={{ height: thumb.height, top: thumb.top }}
                                    />
                                </div>
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
