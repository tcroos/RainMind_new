"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, LoaderCircle, Music2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { mentionAtCursor, type MentionAtCursor } from "@/lib/mention-at-cursor";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { handleMentionNavigation } from "../utils/canvas-mention-navigation";
import { preloadCanvasHoverPreview, scheduleCanvasHoverPreview } from "./canvas-hover-preview";
import { REFERENCE_PREVIEW_PADDING, computeReferencePreviewAnchor, computeReferencePreviewSize } from "../utils/canvas-reference-preview-layout";

export function canvasResourceMentionAtCursor(value: string, cursor: number): MentionAtCursor | undefined {
    return mentionAtCursor(value, cursor);
}

export function shouldSubmitOnEnter(
    event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">,
    requireModifier: boolean,
) {
    if (event.key !== "Enter" || event.shiftKey) return false;
    const withModifier = event.ctrlKey || event.metaKey;
    return requireModifier ? withModifier : !withModifier;
}

export function normalizeCanvasReferenceTokenSpacing(value: string, labels: string[]) {
    let next = value;
    for (const label of [...labels].sort((a, b) => b.length - a.length)) {
        const canonical = `\u2009${label}\u2003\u2009\u2009\u2009\u2009`;
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        next = next.replace(new RegExp(`\\u2009?${escapedLabel}[\\u2003\\u2009 ]+`, "g"), canonical);
    }
    return next;
}

export function formatCanvasReferenceCopyText(value: string, labels: string[]) {
    let text = value;
    for (const label of [...labels].sort((a, b) => b.length - a.length)) {
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`@?\\u2009?${escapedLabel}[\\u2003\\u2009 ]*`, "g"), "");
    }
    return text.replace(/[ \t]{2,}/g, " ");
}

export function canvasResourceReferenceDeletion(value: string, start: number, end: number, key: "Backspace" | "Delete", references: CanvasResourceReference[]) {
    const isTokenSpace = (char: string) => char === " " || char === "\u2003" || char === "\u2009" || char === "\u00a0";
    const matches = references.filter((reference) => reference.active && reference.kind !== "text").flatMap((reference) => {
        const positions: number[] = [];
        for (let from = 0; from < value.length;) {
            const index = value.indexOf(reference.label, from);
            if (index < 0) break;
            positions.push(index);
            from = index + reference.label.length;
        }
        return positions.map((tokenStart) => {
            const visualStart = tokenStart > 0 && value[tokenStart - 1] === "\u2009" ? tokenStart - 1 : tokenStart;
            let visualEnd = tokenStart + reference.label.length;
            while (visualEnd < value.length && isTokenSpace(value[visualEnd])) visualEnd += 1;
            return { reference, visualStart, visualEnd };
        });
    });
    const hit = matches.find(({ visualStart, visualEnd }) => start === end
        ? start >= visualStart && start <= visualEnd
        : start < visualEnd && end > visualStart);
    if (!hit) return null;
    return {
        reference: hit.reference,
        value: `${value.slice(0, hit.visualStart)}${value.slice(hit.visualEnd)}`,
        cursor: hit.visualStart,
    };
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
    value: string;
    references: CanvasResourceReference[];
    onChange: (value: string) => void;
    onSubmit?: () => void;
    requireModifierToSubmit?: boolean;
    containerClassName?: string;
    highlightLabels?: boolean;
    overlayBehind?: boolean;
};

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function CanvasResourceMentionTextarea(
    { value, references, onChange, onSubmit, requireModifierToSubmit = false, onKeyDown, className, containerClassName, style, highlightLabels = true, overlayBehind = false, autoFocus, ...props },
    forwardedRef,
) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const [mention, setMention] = useState<MentionAtCursor | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [hasSelection, setHasSelection] = useState(false);

    useEffect(() => {
        references.forEach((reference) => {
            if (reference.active && reference.kind === "image" && reference.previewUrl) preloadCanvasHoverPreview(imagePreviewUrl(reference.previewUrl, 320));
        });
    }, [references]);

    useEffect(() => {
        if (!autoFocus) return;
        const frame = requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        });
        return () => cancelAnimationFrame(frame);
    }, [autoFocus]);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        const activeReferences = references.filter((item) => item.active && item.kind !== "text");
        if (!query) return activeReferences;
        return activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query));
    }, [mention, references]);
    const activeLabels = useMemo(() => (highlightLabels ? Array.from(new Set(references.filter((item) => item.active).map((item) => item.label))).sort((a, b) => b.length - a.length) : []), [highlightLabels, references]);

    const updateValue = (next: string, selectionStart?: number) => {
        onChange(next);
        if (typeof selectionStart !== "number") return;
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(selectionStart, selectionStart);
        });
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const syncMention = (nextValue: string, cursor: number) => {
        const nextMention = canvasResourceMentionAtCursor(nextValue, cursor);
        if (!nextMention || !references.some((item) => item.active)) {
            closeMention();
            return;
        }
        setMention(nextMention);
        setActiveIndex(0);
    };

    const insertReference = (reference: CanvasResourceReference) => {
        if (!mention) return;
        const textarea = textareaRef.current;
        const end = textarea?.selectionStart ?? value.length;
        const insertText = `\u2009${reference.label}\u2003\u2009\u2009\u2009\u2009`;
        const next = `${value.slice(0, mention.start)}${insertText}${value.slice(end)}`;
        closeMention();
        updateValue(next, mention.start + insertText.length);
    };

    const deleteReferenceAtCursor = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Backspace" && event.key !== "Delete") return false;
        const textarea = textareaRef.current;
        if (!textarea) return false;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const deletion = canvasResourceReferenceDeletion(value, start, end, event.key, references);
        if (!deletion) return false;
        event.preventDefault();
        onChange(deletion.value);
        requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(deletion.cursor, deletion.cursor);
        });
        return true;
    };

    const syncOverlayScroll = () => {
        if (!overlayRef.current || !textareaRef.current) return;
        overlayRef.current.scrollTop = textareaRef.current.scrollTop;
        overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    };

    const syncOverlayMetrics = () => {
        const textarea = textareaRef.current;
        const overlay = overlayRef.current;
        if (!textarea || !overlay) return;
        const computed = getComputedStyle(textarea);
        for (const property of ["font", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textIndent", "textAlign", "wordSpacing", "wordBreak", "overflowWrap", "whiteSpace", "tabSize", "boxSizing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const) {
            overlay.style[property] = computed[property];
        }
        overlay.style.width = `${textarea.clientWidth}px`;
        overlay.style.height = `${textarea.clientHeight}px`;
    };

    const updateSelectionState = () => {
        const textarea = textareaRef.current;
        setHasSelection(Boolean(textarea && textarea.selectionStart !== textarea.selectionEnd));
    };

    const hasActiveLabelInValue = activeLabels.some((label) => value.includes(label));
    const showOverlay = overlayBehind ? Boolean(value || props.placeholder) && !hasSelection : Boolean(value && hasActiveLabelInValue && !hasSelection);
    const overlayContent = value.endsWith("\n") ? `${value}\u200b` : value;
    const overlayBaseStyle: CSSProperties = { ...(style || {}) };
    delete overlayBaseStyle.overflow;
    delete overlayBaseStyle.overflowX;
    delete overlayBaseStyle.overflowY;
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea || !showOverlay) return;
        const sync = () => {
            if (!overlayRef.current) return;
            overlayRef.current.scrollTop = textarea.scrollTop;
            overlayRef.current.scrollLeft = textarea.scrollLeft;
        };
        const observer = new ResizeObserver(sync);
        observer.observe(textarea);
        let secondFrame = 0;
        const frame = requestAnimationFrame(() => {
            syncOverlayMetrics();
            sync();
            // Caret scrolling can happen one frame after the value render.
            secondFrame = requestAnimationFrame(sync);
        });
        return () => {
            cancelAnimationFrame(frame);
            cancelAnimationFrame(secondFrame);
            observer.disconnect();
        };
    }, [showOverlay, value, className, style]);
    const mergedStyle = {
        ...(style || {}),
        caretColor: style?.caretColor || style?.color || theme.node.text,
        WebkitTextFillColor: hasSelection ? "currentColor" : style?.WebkitTextFillColor,
        position: "relative",
        zIndex: showOverlay ? 0 : 1,
    } as CSSProperties;
    const menu = mention && candidates.length && textareaRef.current ? <MentionMenu textarea={textareaRef.current} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null;

    return (
        <div className={`relative h-full w-full ${containerClassName || ""}`}>
            {showOverlay ? (
                <div ref={overlayRef} className={`${className || ""} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words`} style={{ ...overlayBaseStyle, color: overlayBehind ? theme.node.text : "transparent", WebkitTextFillColor: "currentColor", position: "absolute", inset: 0, zIndex: 2, overflowX: "hidden", overflowY: "hidden", pointerEvents: "none", background: "transparent", backgroundColor: "transparent" }}>
                    <MentionHighlightText value={overlayContent || props.placeholder?.toString() || ""} labels={activeLabels} references={references} placeholder={!value} overlay referenceColors={{ background: theme.canvas.background, border: theme.node.stroke, text: theme.node.text }} />
                </div>
            ) : null}
            <textarea
                {...props}
                spellCheck={false}
                autoFocus={autoFocus}
                ref={(node) => {
                    textareaRef.current = node;
                    if (typeof forwardedRef === "function") forwardedRef(node);
                    else if (forwardedRef) forwardedRef.current = node;
                }}
                value={value}
                className={className}
                style={mergedStyle}
                onChange={(event) => {
                    const next = event.target.value;
                    onChange(next);
                    syncMention(next, event.target.selectionStart);
                    requestAnimationFrame(() => {
                        syncOverlayScroll();
                        updateSelectionState();
                    });
                }}
                onSelect={(event) => {
                    updateSelectionState();
                    props.onSelect?.(event);
                }}
                onFocus={(event) => {
                    updateSelectionState();
                    props.onFocus?.(event);
                }}
                onKeyUp={(event) => {
                    updateSelectionState();
                    syncMention(event.currentTarget.value, event.currentTarget.selectionStart);
                    props.onKeyUp?.(event);
                }}
                onClick={(event) => {
                    syncMention(event.currentTarget.value, event.currentTarget.selectionStart);
                    props.onClick?.(event);
                }}
                onPointerUp={(event) => {
                    updateSelectionState();
                    props.onPointerUp?.(event);
                }}
                onKeyDown={(event) => {
                    if (deleteReferenceAtCursor(event)) return;
                    if (mention && handleMentionNavigation(event, candidates, activeIndex, setActiveIndex, insertReference, closeMention)) return;
                    if (onSubmit && shouldSubmitOnEnter(event, requireModifierToSubmit)) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    onKeyDown?.(event);
                }}
                onScroll={(event) => {
                    syncOverlayScroll();
                    syncOverlayMetrics();
                    props.onScroll?.(event);
                }}
                onCopy={(event) => {
                    const start = event.currentTarget.selectionStart;
                    const end = event.currentTarget.selectionEnd;
                    if (start === end || !event.clipboardData) return;
                    const selected = value.slice(start, end);
                    const formatted = formatCanvasReferenceCopyText(selected, activeLabels);
                    if (formatted === selected) return;
                    event.preventDefault();
                    event.clipboardData.setData("text/plain", formatted);
                }}
                onBlur={(event) => {
                    setHasSelection(false);
                    window.setTimeout(closeMention, 120);
                    props.onBlur?.(event);
                }}
            />
            {menu}
        </div>
    );
});

type ReferenceTokenColors = { background: string; border: string; text: string };

export function CanvasResourceMentionText({ value, references }: { value: string; references: CanvasResourceReference[] }) {
    const labels = Array.from(new Set(references.filter((reference) => reference.active).map((reference) => reference.label))).sort((a, b) => b.length - a.length);
    return <MentionHighlightText value={value} labels={labels} references={references} placeholder={!value} />;
}

function MentionHighlightText({ value, labels, references, placeholder, overlay = false, referenceColors }: { value: string; labels: string[]; references: CanvasResourceReference[]; placeholder: boolean; overlay?: boolean; referenceColors?: ReferenceTokenColors }) {
    if (placeholder) return <span className="opacity-45">{value}</span>;
    if (!labels.length) return <>{value}</>;
    const pattern = new RegExp(`(${labels.map(escapeRegExp).join("|")})`, "g");
    const referencesByLabel = new Map(references.filter((reference) => reference.active).map((reference) => [reference.label, reference]));
    return <>{value.split(pattern).map((part, index) => (referencesByLabel.has(part) ? <ReferenceToken key={`${part}-${index}`} reference={referencesByLabel.get(part)!} overlay={overlay} colors={referenceColors} /> : <span key={`${part}-${index}`}>{part}</span>))}</>;
}

function ReferenceToken({ reference, overlay = false, colors }: { reference: CanvasResourceReference; overlay?: boolean; colors?: ReferenceTokenColors }) {
    const [previewAnchor, setPreviewAnchor] = useState<{ left: number; top: number } | null>(null);
    const [previewState, setPreviewState] = useState<"loading" | "loaded" | "error">("loading");
    const [imageSize, setImageSize] = useState(() => computeReferencePreviewSize(reference.width, reference.height));
    const previewTimerRef = useRef<(() => void) | null>(null);
    const cardWidth = imageSize.width + REFERENCE_PREVIEW_PADDING * 2;
    const cardHeight = imageSize.height + REFERENCE_PREVIEW_PADDING * 2;
    useEffect(() => {
        setImageSize(computeReferencePreviewSize(reference.width, reference.height));
        if (reference.kind === "image" && reference.previewUrl) preloadCanvasHoverPreview(imagePreviewUrl(reference.previewUrl, 320));
    }, [reference.width, reference.height, reference.kind, reference.previewUrl]);
    const preview =
        reference.kind === "image" && reference.previewUrl ? (
            <img src={imagePreviewUrl(reference.previewUrl, 64)} alt="" className="pointer-events-auto size-[1em] shrink-0 rounded-[0.2em] object-cover" />
        ) : reference.kind === "video" && reference.previewUrl ? (
            <video src={reference.previewUrl} muted playsInline preload="metadata" aria-hidden="true" className="pointer-events-auto size-[1em] shrink-0 rounded-[0.2em] bg-black object-cover" />
        ) : (
            <ReferencePreviewIcon kind={reference.kind} />
        );
    if (overlay) return (
        <span data-canvas-resource-reference={reference.nodeId} className="pointer-events-none relative inline-block align-baseline font-normal text-transparent"
            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onPointerEnter={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setPreviewState("loading");
                previewTimerRef.current?.();
                previewTimerRef.current = scheduleCanvasHoverPreview(() => {
                    previewTimerRef.current = null;
                    const next = computeReferencePreviewAnchor(rect, imageSize, { width: window.innerWidth, height: window.innerHeight }, { placement: "above" });
                    setPreviewAnchor({ left: next.left, top: next.top });
                });
            }}
            onPointerLeave={() => {
                previewTimerRef.current?.();
                previewTimerRef.current = null;
                setPreviewAnchor(null);
                setPreviewState("loading");
            }}
        >
            <span data-reference-token-width className="whitespace-pre">{reference.label}</span>
            <span data-reference-token-visual className="pointer-events-auto absolute left-0 top-1/2 inline-flex h-[1.5em] -translate-y-1/2 items-center gap-[0.15em] whitespace-nowrap rounded-md border border-[#d9e1e7] bg-[#f0f4f6] py-0 px-[0.15em] text-[#435261] dark:border-[#414b56] dark:bg-[#252c33] dark:text-[#d3dce4]" style={{ width: "calc(100% + 1.55em)", boxSizing: "border-box", ...(colors ? { backgroundColor: colors.background, borderColor: colors.border, color: colors.text } : {}) }}>
                {preview}
                <span className="text-[1em]">{reference.label}</span>
            </span>
            {previewAnchor && reference.previewUrl && (reference.kind === "image" || reference.kind === "video") ? createPortal(
                <div data-canvas-reference-hover-preview data-canvas-hover-preview-state={previewState} className="pointer-events-none fixed z-[1200] grid place-items-center overflow-hidden rounded-md border border-[#d8dde3] bg-white text-slate-500 dark:border-[#414a54] dark:bg-[#20252a]" style={{ left: previewAnchor.left, top: previewAnchor.top, width: cardWidth, height: cardHeight, padding: REFERENCE_PREVIEW_PADDING, boxSizing: "border-box" }}>
                    {previewState === "loading" ? <LoaderCircle className="size-5 animate-spin" aria-label="预览加载中" /> : previewState === "error" ? <span role="status" className="text-xs">预览加载失败</span> : null}
                    {reference.kind === "image" ? <img src={imagePreviewUrl(reference.previewUrl, 320)} alt={reference.label} onLoad={(event) => { setPreviewState("loaded"); const next = computeReferencePreviewSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); setImageSize((current) => (current.width === next.width && current.height === next.height ? current : next)); }} onError={() => setPreviewState("error")} className="object-contain" style={{ width: imageSize.width, height: imageSize.height }} /> : <video src={reference.previewUrl} muted playsInline preload="metadata" onLoadedData={() => setPreviewState("loaded")} onError={() => setPreviewState("error")} className="object-contain" style={{ width: imageSize.width, height: imageSize.height }} />}
                </div>, document.body,
            ) : null}
        </span>
    );
    return (
        <span data-canvas-resource-reference={reference.nodeId} title={reference.title} className="mx-[0.15em] inline-flex max-w-full items-center gap-0 rounded-md bg-[#2f80ff]/12 py-[0.05em] align-middle font-medium leading-none text-[#2f80ff] ring-1 ring-[#2f80ff]/24">
            {preview}
            <span className="whitespace-nowrap text-[1em]">{reference.label}</span>
        </span>
    );
}

function ReferencePreviewIcon({ kind }: Pick<CanvasResourceReference, "kind">) {
    const Icon = kind === "audio" ? Music2 : kind === "video" ? Video : kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-[1em] shrink-0 place-items-center rounded-[0.2em] bg-current/10">
            <Icon className="size-[0.8em]" aria-hidden="true" />
        </span>
    );
}

function MentionMenu({
    textarea,
    references,
    activeIndex,
    theme,
    onSelect,
}: {
    textarea: HTMLTextAreaElement;
    references: CanvasResourceReference[];
    activeIndex: number;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onSelect: (reference: CanvasResourceReference) => void;
}) {
    const selectedRef = useRef(false);
    const [caret, setCaret] = useState(() => measureResourceCaret(textarea));
    useEffect(() => {
        const update = () => setCaret(measureResourceCaret(textarea));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(textarea);
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        window.visualViewport?.addEventListener("resize", update);
        return () => {
            observer.disconnect();
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
            window.visualViewport?.removeEventListener("resize", update);
        };
    }, [textarea, textarea.value, textarea.selectionStart]);
    const viewport = window.visualViewport;
    const boundary = { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0, right: (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth), bottom: (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight) };
    const menuWidth = Math.min(176, boundary.right - boundary.left - 16);
    const maxMenuHeight = 224;
    const gap = 6;
    const left = clamp(caret.left, boundary.left + 8, boundary.right - menuWidth - 8);
    const availableAbove = caret.top - gap - boundary.top - 8;
    const availableBelow = boundary.bottom - caret.bottom - gap - 8;
    const desiredHeight = Math.min(maxMenuHeight, references.length * 48 + 8);
    const showAbove = availableAbove >= desiredHeight || availableAbove > availableBelow;
    const height = Math.max(0, Math.min(desiredHeight, showAbove ? availableAbove : availableBelow));
    const top = showAbove ? caret.top - gap - height : caret.bottom + gap;

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
    };
    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };

    return createPortal(
        <div
            data-canvas-resource-mention-menu="true"
            className="fixed z-[1100] max-h-56 overflow-y-auto rounded-lg border p-1 shadow-lg backdrop-blur-md"
            style={{ left, top, width: menuWidth, maxHeight: height, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onClick={(event) => event.stopPropagation()}
        >
            {references.map((reference, index) => (
                <button
                    key={reference.id}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                >
                    <ReferencePreview reference={reference} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{reference.label}</span>
                    </span>
                </button>
            ))}
        </div>,
        document.body,
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={imagePreviewUrl(reference.previewUrl, 96)} alt="" className="size-9 rounded-md object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

function measureResourceCaret(textarea: HTMLTextAreaElement) {
    const rect = textarea.getBoundingClientRect();
    const computed = getComputedStyle(textarea);
    const mirror = document.createElement("div");
    const marker = document.createElement("span");
    for (const property of ["font", "letter-spacing", "line-height", "text-align", "text-indent", "word-spacing", "word-break", "overflow-wrap", "tab-size", "padding", "border", "box-sizing"]) mirror.style.setProperty(property, computed.getPropertyValue(property));
    Object.assign(mirror.style, { position: "fixed", left: "0", top: "0", width: `${textarea.clientWidth + parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth)}px`, height: "auto", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
    mirror.textContent = textarea.value.slice(0, textarea.selectionStart);
    marker.textContent = "\u200b";
    mirror.append(marker);
    document.body.append(mirror);
    const position = marker.getBoundingClientRect();
    const scaleX = rect.width / textarea.offsetWidth || 1;
    const scaleY = rect.height / textarea.offsetHeight || 1;
    const left = rect.left + (position.left - textarea.scrollLeft) * scaleX;
    const top = rect.top + (position.top - textarea.scrollTop) * scaleY;
    mirror.remove();
    return { left, top, bottom: top + parseFloat(computed.lineHeight) * scaleY };
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
