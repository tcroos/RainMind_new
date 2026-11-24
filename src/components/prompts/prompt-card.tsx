"use client";

import { Copy, Quote } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "antd";

import { imagePreviewUrl } from "@/lib/media-image-url";
import { cn } from "@/lib/utils";
import { formatPromptDate, type Prompt } from "@/services/api/prompts";

/**
 * 词库卡片：封面 + 标题 + 摘要 + 元信息/操作。
 * 一块缩略图撑起卡片，正文只留三行信息，底部用发丝线隔开操作区 —— 一屏能扫过更多条目。
 */
export function PromptCard({
    item,
    onOpen,
    onCopy,
    actionLabel = "复制",
    actionIcon = <Copy className="size-3.5" />,
    actionType = "text",
    extraAction,
}: {
    item: Prompt;
    onOpen: (previewUrl?: string) => void;
    onCopy: () => void;
    actionLabel?: string;
    actionIcon?: ReactNode;
    actionType?: "text" | "primary";
    extraAction?: ReactNode;
}) {
    const open = () => onOpen(item.coverUrl ? imagePreviewUrl(item.coverUrl, 640) : undefined);
    // 分类已经压在封面上；模型名（gpt image 2 之类）是生成参数不是内容标签，
    // 两者都在标签行里重复出现只会挤高卡片，统一滤掉。
    const metaTags = item.tags.filter((tag) => tag !== item.category && !isModelTag(tag));
    const hasCover = Boolean(item.coverUrl);

    return (
        <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl bg-[var(--surface-panel)] text-[var(--ink-1)] shadow-[0_1px_3px_rgba(17,17,19,0.05)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-24px_rgba(17,17,19,0.38)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
            {/* 统一给每张卡一块 16:9 封面区：有图放图，没图放带引号的柔色文字封面。
                之前没图时只留一个 24px 小图标 + 分类胶囊，用户新建后看到的就是
                「00」「1」这种读不懂的碎片，和「我的素材」的文字卡完全不是一个量级。 */}
            <button type="button" className="relative block w-full overflow-hidden bg-[var(--surface-inset)] text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={`查看 ${item.title}`} onClick={open}>
                {hasCover ? (
                    <div className="aspect-[16/9] w-full overflow-hidden">
                        <PromptCover url={imagePreviewUrl(item.coverUrl || "", 640)} title={item.title} />
                    </div>
                ) : (
                    <div className="relative flex aspect-[16/9] w-full flex-col justify-between overflow-hidden bg-[linear-gradient(135deg,var(--brand-soft)_0%,var(--surface-soft)_58%,var(--surface-inset)_100%)] p-3.5">
                        <span aria-hidden className="pointer-events-none absolute -right-3 -top-12 font-serif text-[120px] leading-none text-[var(--brand-600)]/20">
                            “
                        </span>
                        <span className="relative w-fit max-w-full truncate rounded-full bg-[var(--surface-panel)]/85 px-2 py-0.5 text-[10px] font-medium leading-4 text-[var(--ink-2)] backdrop-blur-sm">
                            {item.category || (item.scope === "user" ? "我的提示词" : "公共词库")}
                        </span>
                        <p className="relative line-clamp-3 text-[12.5px] leading-5 text-[var(--ink-2)]">{item.prompt}</p>
                    </div>
                )}
                {item.category && hasCover ? (
                    <span className="pointer-events-none absolute left-2.5 top-2.5 max-w-[calc(100%-1.25rem)] truncate rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium leading-4 text-white backdrop-blur-sm">
                        {item.category}
                    </span>
                ) : null}
                {hasCover ? (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 hidden items-center justify-end bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.42))] px-2.5 pb-2 pt-8 text-[11px] font-medium text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 sm:flex">
                        查看提示词
                    </span>
                ) : null}
            </button>

            <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-3.5">
                <button type="button" className="block min-w-0 text-left outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring" onClick={open}>
                    <h2 className="truncate text-[15px] font-semibold leading-6 text-[var(--ink-1)]">{item.title}</h2>
                </button>
                <p className="mt-1 truncate text-[11px] text-[var(--ink-3)]">{item.scope === "user" ? "我的提示词" : "公共词库"}</p>

                <div className="mt-2 flex min-w-0 items-center gap-1 overflow-hidden">
                    {metaTags.length ? (
                        <>
                            {metaTags.slice(0, 2).map((tag) => (
                                <span key={tag} className="max-w-24 shrink-0 truncate rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[10px] leading-4 text-[var(--ink-2)]">
                                    {tag}
                                </span>
                            ))}
                            {metaTags.length > 2 ? <span className="shrink-0 text-[10px] leading-4 text-[var(--ink-3)]">+{metaTags.length - 2}</span> : null}
                        </>
                    ) : (
                        <span className="truncate text-[10px] text-[var(--ink-3)]">未添加标签</span>
                    )}
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    <span className="shrink-0 text-[11px] text-[var(--ink-3)]">{formatPromptDate(item.updatedAt)}</span>
                    <div className="flex shrink-0 items-center gap-0.5">
                        <Tooltip title={actionLabel}>
                            <Button size="small" type={actionType} shape="circle" icon={actionIcon} aria-label={actionLabel} className="library-card-action" onClick={onCopy} />
                        </Tooltip>
                        {extraAction}
                    </div>
                </div>
            </div>
        </article>
    );
}

/* 生成模型名（gpt image 2 / flux / midjourney 等）属于元数据，不是内容标签。
 * 词库里几乎每张卡都挂同一个模型名，显示出来既占高度又没有辨识度。 */
function isModelTag(tag: string) {
    return /^(gpt[\s-]?image|dall-?e|midjourney|flux|seedream|stable\s*diffusion|sdxl|imagen)\b/i.test(tag.trim());
}

/**
 * 封面：加载时是一块安静的浅底，失败时退成标题文字。
 * 不走全局 LazyMediaImage 的品牌 Logo 占位 —— 词库里不少条目没有配图，
 * 一排 Logo 水印会读成"图片全挂了"。
 *
 * 这里刻意不用浏览器懒加载：每页只有 16 张缩略图（640px），
 * 首屏懒加载会让下面两行停在 opacity-0 + 呼吸灰，一眼看过去像「有框架没内容」——
 * 用户就为此误以为公共词库是空的。改成首屏直接加载，占位也不再闪烁。
 */
function PromptCover({ url, title }: { url: string; title: string }) {
    const [status, setStatus] = useState<"loading" | "ready" | "error">(url ? "loading" : "error");
    const imgRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
        setStatus(url ? "loading" : "error");
        /* 图片可能在 hydration 之前就已完成，onLoad 不会补发；这里兜一次，
         * 否则那几张会永远停在占位层上，看起来像「图片挂了」。 */
        const img = imgRef.current;
        if (img?.complete) setStatus(img.naturalWidth > 0 ? "ready" : "error");
    }, [url]);

    return (
        <div className="relative size-full overflow-hidden bg-[var(--surface-soft)]">
            {/* 加载中与失败都直接显示标题：即使某张图慢，卡片也读得出内容，
                不会变成一块「有框架没内容」的灰砖。图片就绪后淡入盖住这层。 */}
            {status !== "ready" ? (
                <div
                    aria-hidden
                    className={cn(
                        "absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4",
                        status === "error" ? "bg-[linear-gradient(135deg,var(--brand-soft)_0%,var(--surface-soft)_56%,var(--surface-inset)_100%)]" : "bg-[var(--surface-soft)]",
                    )}
                >
                    <Quote className={cn("size-3.5 text-[var(--brand-600)]", status === "loading" && "opacity-40")} aria-hidden />
                    <span className="line-clamp-3 text-center text-[12px] font-medium leading-5 text-[var(--ink-2)]">{title}</span>
                </div>
            ) : null}
            {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- 素材域名来自用户上传与模型产物，不走 next/image 白名单
                <img
                    ref={imgRef}
                    src={url}
                    alt={title}
                    decoding="async"
                    className={cn("relative size-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.03]", status === "ready" ? "opacity-100" : "opacity-0")}
                    onLoad={() => setStatus("ready")}
                    onError={() => setStatus("error")}
                />
            ) : null}
        </div>
    );
}
