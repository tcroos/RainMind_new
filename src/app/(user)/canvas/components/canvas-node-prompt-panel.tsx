"use client";

import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { ArrowUp, LoaderCircle, Maximize2, Minimize2, Square, X, Music2, ChevronDown } from "lucide-react";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { Modal, Tooltip, Popover } from "antd";
import { CanvasVideoReferenceSettings } from "./canvas-video-reference-settings";
import { canvasVideoReferenceModeLabel } from "../utils/canvas-video-references";

import { ModelPicker } from "@/components/model-picker";
import { CreditSymbol, formatCreditAmount, requestCreditCost } from "@/constant/credits";
import { defaultConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea, normalizeCanvasReferenceTokenSpacing } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasVideoTierPicker } from "./canvas-video-tier-picker";
import { normalizeVideoTiers, resolveVideoTierId, videoTierMatchesModel } from "@/lib/video-tier-config";
import { imageTierMatchesModel, normalizeImageTiers, resolveImageTierId } from "@/lib/image-tier-config";
import { CanvasVideoGroupedModelPicker } from "./canvas-video-grouped-model-picker";
import { CanvasNodeType, isCanvasImageNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { buildCanvasNodeConfig, canvasAudioConfigPatch, canvasVideoConfigPatch } from "../utils/canvas-node-config";
import { canvasModelConfigPatch } from "../utils/canvas-model-capabilities";
import { PANORAMA_IMAGE_SIZE } from "../utils/canvas-panorama";
import { logicalVideoBillingRule } from "@/lib/video-billing";
import { useVideoReferenceQuote } from "@/hooks/use-video-reference-quote";
import { canvasVideoQuoteReferences } from "../utils/canvas-video-references";
import { preloadCanvasHoverPreview, scheduleCanvasHoverPreview } from "./canvas-hover-preview";
import { REFERENCE_PREVIEW_PADDING, computeReferencePreviewAnchor, computeReferencePreviewSize } from "../utils/canvas-reference-preview-layout";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

const stopCanvasInteraction = (event: SyntheticEvent) => event.stopPropagation();
const VIDEO_TIER_STORAGE_KEY = "vozeb-pro:canvas-video-tier";
const IMAGE_TIER_STORAGE_KEY = "vozeb-pro:canvas-image-tier";

function readStoredImageTier(): string | undefined {
    if (typeof window === "undefined") return undefined;
    try {
        return window.localStorage.getItem(IMAGE_TIER_STORAGE_KEY) || undefined;
    } catch {
        return undefined;
    }
}

function storeImageTier(tier: string) {
    try {
        window.localStorage.setItem(IMAGE_TIER_STORAGE_KEY, tier);
    } catch {
        // localStorage can be unavailable in private/restricted contexts.
    }
}

function readStoredVideoTier(): string | undefined {
    if (typeof window === "undefined") return undefined;
    try {
        return window.localStorage.getItem(VIDEO_TIER_STORAGE_KEY) || undefined;
    } catch {
        return undefined;
    }
}

function storeVideoTier(tier: string) {
    try {
        window.localStorage.setItem(VIDEO_TIER_STORAGE_KEY, tier);
    } catch {
        // localStorage can be unavailable in private/restricted contexts.
    }
}

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
    onLocateReference?: (nodeId: string) => void;
    onRemoveReference?: (connectionIds: string[]) => void;
    expandedMode?: boolean;
    onCloseExpanded?: () => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], onImageSettingsOpenChange, onLocateReference, onRemoveReference, expandedMode = false, onCloseExpanded }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const controlPalette = themeName === "light"
        ? { activeBg: "#eaf1f5", activeText: "#315d78" }
        : { activeBg: "#2a3b46", activeText: "#f3f5f7" };
    const promptFontSize = 16;
    const promptLineHeight = 28.8;
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = isCanvasImageNodeType(node.type) && Boolean(node.metadata?.content);
    const isPanorama = node.type === CanvasNodeType.Panorama;
    const [prompt, setPrompt] = useState(node.metadata?.sourcePrompt || node.metadata?.prompt || "");
    const [expanded, setExpanded] = useState(false);
    const [hoveredReferenceId, setHoveredReferenceId] = useState<string | null>(null);
    const [activeControl, setActiveControl] = useState<"model" | "reference" | "settings" | null>(null);
    const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [promptHeight, setPromptHeight] = useState(144);
    const [promptHasOverflow, setPromptHasOverflow] = useState(false);
    const [promptScrollbar, setPromptScrollbar] = useState({ top: 0, height: 0, trackTop: 4, trackHeight: 0 });
    useEffect(() => {
        mentionReferences.forEach((reference) => {
            if (reference.active && reference.kind === "image" && reference.previewUrl) preloadCanvasHoverPreview(imagePreviewUrl(reference.previewUrl, 320));
        });
    }, [mentionReferences]);
    const videoTierEntries = useMemo(() => normalizeVideoTiers(config.videoTiers), [config.videoTiers]);
    const tierModels = useMemo(() => {
        const videoModelIds = new Set(config.videoModels);
        const candidates = config.logicalModels.filter((model) => model.capability === "video" && model.enabled && videoModelIds.has(model.id));
        return new Map(videoTierEntries.map((entry) => [entry.id, candidates.filter((model) => videoTierMatchesModel(entry, model)).map((model) => model.id)]));
    }, [config.logicalModels, config.videoModels, videoTierEntries]);
    const availableTierEntries = useMemo(
        () => videoTierEntries.filter((entry) => entry.enabled && (tierModels.get(entry.id)?.length || 0) > 0),
        [videoTierEntries, tierModels],
    );
    const officialVideoModelIds = useMemo(() => {
        const officialEntry = videoTierEntries.find((entry) => entry.modelTier === "official" && !entry.billingMode);
        return officialEntry ? tierModels.get(officialEntry.id) || [] : [];
    }, [tierModels, videoTierEntries]);
    const [videoTier, setVideoTier] = useState<string>(() => resolveVideoTierId(videoTierEntries, node.metadata?.videoTier || readStoredVideoTier()));
    const activeTierEntry = availableTierEntries.find((entry) => entry.id === videoTier) || availableTierEntries[0] || videoTierEntries[0];
    const videoTierModelIds = (activeTierEntry && tierModels.get(activeTierEntry.id)) || [];
    const imageTierEntries = useMemo(() => normalizeImageTiers(config.imageTiers), [config.imageTiers]);
    const imageTierModels = useMemo(() => {
        const imageModelIds = new Set(config.imageModels);
        const candidates = config.logicalModels.filter((model) => model.capability === "image" && model.enabled && imageModelIds.has(model.id));
        return new Map(imageTierEntries.map((entry) => [entry.id, candidates.filter((model) => imageTierMatchesModel(entry, model)).map((model) => model.id)]));
    }, [config.logicalModels, config.imageModels, imageTierEntries]);
    const availableImageTiers = useMemo(() => imageTierEntries.filter((entry) => entry.enabled), [imageTierEntries]);
    const imageTierOptions = useMemo(() => availableImageTiers.map((entry) => ({ value: entry.id, label: entry.label })), [availableImageTiers]);
    const [imageTier, setImageTier] = useState<string | undefined>(() => resolveImageTierId(imageTierEntries, node.metadata?.imageTier || readStoredImageTier()));
    const activeImageTierId = imageTierOptions.some((option) => option.value === imageTier) ? imageTier : imageTierOptions[0]?.value;
    const imageTierModelIds = activeImageTierId ? imageTierModels.get(activeImageTierId) || [] : undefined;
    useEffect(() => {
        setVideoTier(resolveVideoTierId(videoTierEntries, node.metadata?.videoTier || readStoredVideoTier()));
    }, [node.id]);
    useEffect(() => {
        if (!availableTierEntries.some((entry) => entry.id === videoTier)) {
            const fallback = availableTierEntries[0]?.id;
            if (fallback) setVideoTier(fallback);
        }
    }, [availableTierEntries, videoTier]);
    useEffect(() => {
        setImageTier(resolveImageTierId(imageTierEntries, node.metadata?.imageTier || readStoredImageTier()));
    }, [node.id]);
    useEffect(() => {
        if (imageTier === undefined) return;
        if (!imageTierOptions.some((option) => option.value === imageTier)) setImageTier(imageTierOptions[0]?.value);
    }, [imageTierOptions, imageTier]);
    const normalizedReferenceSpacingRef = useRef(false);
    const quoteSourceImage = mode === "video" && isCanvasImageNodeType(node.type) && node.metadata?.content
        ? { id: node.id, nodeId: node.id, kind: "image" as const, label: node.title || "图片", title: node.title || "图片", previewUrl: node.metadata.content, storageKey: node.metadata.storageKey, remoteUrl: node.metadata.remoteUrl, serverUrl: node.metadata.serverUrl, active: true }
        : undefined;
    const referenceQuote = useVideoReferenceQuote(mode === "video" && logicalVideoBillingRule(config.logicalModels, config.model)?.referenceVideoSeconds === true, { model: config.model, size: config.size, vquality: config.vquality, videoSeconds: config.videoSeconds, videoGenerateAudio: config.videoGenerateAudio, videoWatermark: config.videoWatermark }, canvasVideoQuoteReferences(mentionReferences, node.metadata, undefined, quoteSourceImage), `canvas:${node.id}`);
    const credits = referenceQuote?.quote?.points ?? requestCreditCost({
        apiSource: config.apiSource,
        modelPointCosts: config.modelPointCosts,
        logicalModels: globalConfig.logicalModels,
        imageTiers: config.imageTiers,
        generationPointMultipliers: config.generationPointMultipliers,
        kind: mode,
        model: config.model,
        count: mode === "image" ? config.count : 1,
        quality: config.quality,
        videoQuality: config.vquality,
        videoSeconds: config.videoSeconds,
    });

    /* 生成键的可用性：有提示词、且参考视频的报价已确认。空提示词时按钮退成灰色（参考创作页发送键） */
    const quotePending = Boolean(referenceQuote && !referenceQuote.quote);
    const canRun = Boolean(prompt.trim()) && !quotePending;

    const selectVideoTier = (next: string) => {
        storeVideoTier(next);
        setVideoTier(next);
        // Changing the display tier must not rewrite an existing node's selected
        // model. Keep the node model/parameters intact until the user explicitly
        // chooses a model from the picker.
        onConfigChange(node.id, { videoTier: next });
    };

    // Do not auto-rewrite the node's model when the tier changes. The tier is a
    // browsing filter; existing generated/running nodes must retain the model
    // and parameters they were created with.

    useEffect(() => {
        setPrompt(node.metadata?.sourcePrompt || node.metadata?.prompt || "");
    }, [node.id, node.metadata?.prompt, node.metadata?.sourcePrompt]);

    useEffect(() => {
        normalizedReferenceSpacingRef.current = false;
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        onPromptChange(node.id, value);
        onConfigChange(node.id, { sourcePrompt: value });
    };

    const syncPromptScrollbar = () => {
        const textarea = promptTextareaRef.current;
        if (!textarea) return;
        const maxScroll = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
        const availableHeight = Math.max(0, textarea.clientHeight - 8);
        const trackRatio = expandedMode ? 0.5 : (2 / 3);
        const thumbRatio = expandedMode ? 0.5 : (2 / 3);
        const trackHeight = availableHeight * trackRatio;
        const trackTop = (textarea.clientHeight - trackHeight) / 2;
        const height = maxScroll > 0 ? Math.max(10, (textarea.clientHeight / textarea.scrollHeight) * trackHeight * thumbRatio) : trackHeight;
        const top = maxScroll > 0 ? (textarea.scrollTop / maxScroll) * Math.max(0, trackHeight - height) : 0;
        setPromptScrollbar({ top, height, trackTop, trackHeight });
    };

    useLayoutEffect(() => {
        if (expandedMode) return;
        const textarea = promptTextareaRef.current;
        if (!textarea) return;
        const maxHeight = 172.8;
        const contentHeight = textarea.scrollHeight;
        const atMaxHeight = contentHeight > maxHeight - 1;
        setPromptHasOverflow(contentHeight > maxHeight + 0.5);
        if (atMaxHeight) {
            if (Math.abs(parseFloat(textarea.style.height) - maxHeight) > 0.5) textarea.style.height = `${maxHeight}px`;
            setPromptHeight(maxHeight);
            syncPromptScrollbar();
            return;
        }
        textarea.style.height = "auto";
        const next = Math.min(maxHeight, Math.max(144, textarea.scrollHeight));
        textarea.style.height = `${next}px`;
        setPromptHeight(next);
        syncPromptScrollbar();
    }, [expandedMode, prompt]);

    useLayoutEffect(() => {
        if (!expandedMode) return;
        const textarea = promptTextareaRef.current;
        if (!textarea) return;
        const sync = () => {
            setPromptHasOverflow(textarea.scrollHeight > textarea.clientHeight + 1);
            syncPromptScrollbar();
        };
        sync();
        const frame = requestAnimationFrame(sync);
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
        observer?.observe(textarea);
        return () => {
            cancelAnimationFrame(frame);
            observer?.disconnect();
        };
    }, [expandedMode, prompt]);

    useEffect(() => {
        if (normalizedReferenceSpacingRef.current || !prompt) return;
        const labels = Array.from(new Set(mentionReferences.filter((reference) => reference.active).map((reference) => reference.label))).sort((a, b) => b.length - a.length);
        if (!labels.length) return;
        const next = normalizeCanvasReferenceTokenSpacing(prompt, labels);
        normalizedReferenceSpacingRef.current = true;
        if (next !== prompt) updatePrompt(next);
    }, [mentionReferences, prompt, updatePrompt]);

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning || (referenceQuote && !referenceQuote.quote)) return false;
        onGenerate(node.id, mode, text);
        return true;
    };

    return (
        <div
            className={`${expandedMode ? "flex h-full min-h-0 flex-col rounded-3xl p-5" : "flex min-h-0 flex-1 flex-col rounded-[20px] p-2"} ${expandedMode ? "shadow-[0_24px_80px_rgba(0,0,0,.24)]" : "border shadow-2xl"} backdrop-blur`}
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, "--canvas-control-idle-text": theme.node.text, "--canvas-control-active": controlPalette.activeBg, "--canvas-control-active-text": controlPalette.activeText } as React.CSSProperties}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-0.5 flex items-center justify-between pl-1" data-canvas-prompt-header>
                <CanvasPromptLibrary onSelect={updatePrompt} />
                <Tooltip title={expandedMode ? "收起提示词面板" : "放大提示词输入"} placement="top">
                    <button
                        type="button"
                        data-canvas-no-drag
                        className="grid size-8 shrink-0 place-items-center rounded-lg transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2"
                        style={{ color: theme.toolbar.item }}
                        onClick={(event) => {
                            event.stopPropagation();
                            expandedMode ? onCloseExpanded?.() : setExpanded(true);
                        }}
                        onMouseDown={stopCanvasInteraction}
                        onPointerDown={stopCanvasInteraction}
                        aria-label={expandedMode ? "收起提示词面板" : "放大提示词输入"}
                    >
                        {expandedMode ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
                    </button>
                </Tooltip>
            </div>
            {mentionReferences.some((reference) => reference.kind !== "text") ? (
                <div className={`${expandedMode ? "mb-2 min-h-14 gap-3" : "mb-2 min-h-12 gap-2 pl-3"} flex w-full flex-nowrap items-center overflow-x-auto pb-0.5`} data-canvas-panel-references>
                    {mentionReferences
                        .filter((reference) => reference.kind !== "text")
                        .map((reference) => {
                            const thumbnail = (
                                <button type="button" className="h-full w-full overflow-hidden rounded-[inherit]" onClick={() => onLocateReference?.(reference.nodeId)} aria-label={`定位${reference.label}`}>
                                    {reference.kind === "image" && reference.previewUrl ? (
                                        <img className="h-full w-full rounded-[inherit] object-cover" src={imagePreviewUrl(reference.previewUrl, 160)} alt="" />
                                    ) : reference.kind === "video" && reference.previewUrl ? (
                                        <video className="h-full w-full rounded-[inherit] object-cover" src={reference.previewUrl} preload="metadata" muted playsInline aria-label={reference.label} />
                                    ) : (
                                        <Music2 className="mx-auto size-5" />
                                    )}
                                </button>
                            );
                            return (
                                <div
                                    key={reference.id}
                                    className={`${expandedMode ? "size-14 rounded-lg" : "size-12 rounded-lg"} group relative shrink-0 border`}
                                    style={{ borderColor: theme.node.stroke }}
                                    onPointerEnter={() => setHoveredReferenceId(reference.id)}
                                    onPointerLeave={() => setHoveredReferenceId(null)}
                                >
                                    {reference.previewUrl ? <ReferenceMediaPreview reference={reference} expanded={expandedMode}>{thumbnail}</ReferenceMediaPreview> : thumbnail}
                                {reference.connectionIds?.length ? (
                                    <button
                                        type="button"
                                        className="pointer-events-none absolute right-0 top-0 grid size-7 place-items-start justify-items-end p-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                                        style={{ color: theme.node.text, opacity: hoveredReferenceId === reference.id ? 1 : undefined, pointerEvents: hoveredReferenceId === reference.id ? "auto" : undefined }}
                                        aria-label={`移除${reference.label}引用`}
                                        onClick={() => onRemoveReference?.(reference.connectionIds!)}
                                    >
                                        <span className="grid size-3.5 place-items-center rounded-full backdrop-blur-sm" style={{ background: `color-mix(in srgb, ${theme.node.panel} 65%, transparent)` }}>
                                            <X className="size-2.5" />
                                        </span>
                                    </button>
                                ) : null}
                                </div>
                            );
                        })}
                </div>
            ) : null}
            <div className={`${expandedMode ? "relative min-h-0 min-w-0 flex-1" : "relative"}`}>
                <CanvasResourceMentionTextarea
                    ref={promptTextareaRef}
                    autoFocus
                    rows={expandedMode ? 4 : 3}
                    value={prompt}
                    references={mentionReferences}
                    onChange={updatePrompt}
                    onSubmit={submit}
                    requireModifierToSubmit
                    aria-label="节点提示词"
                    data-canvas-prompt-scroll={expandedMode ? "expanded" : "node"}
                    overlayBehind
                    className={`${expandedMode ? "h-full min-h-0 min-w-0 overscroll-contain px-0 py-2 text-[18px] leading-[30px]" : "block px-0 py-0 text-[16px] leading-[28.8px]"} w-full resize-none overscroll-contain border-0 bg-transparent outline-none placeholder:text-transparent [scrollbar-width:thin!important] [&::-webkit-scrollbar]:!block [&::-webkit-scrollbar]:!w-2 [&::-webkit-scrollbar-track]:!bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:!bg-current/40`}
                    style={{ color: theme.node.text, WebkitTextFillColor: "transparent", caretColor: theme.node.text, cursor: "text", scrollbarWidth: "thin", scrollbarColor: "rgba(127,127,127,.55) transparent", scrollbarGutter: "stable both-edges", overflowX: "hidden", overflowY: "auto", ...(expandedMode ? { fontSize: "18px", lineHeight: "30px", paddingLeft: "8px", paddingRight: "16px" } : { fontSize: `${promptFontSize}px`, lineHeight: `${promptLineHeight}px`, height: `${promptHeight}px`, paddingLeft: "12px", paddingRight: "16px" }) }}
                    onScroll={syncPromptScrollbar}
                    placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent, isPanorama)}
                />
                {promptHasOverflow ? (
                    <div
                        data-canvas-prompt-scrollbar
                        aria-hidden
                        className={`pointer-events-none absolute right-1 rounded-full ${expandedMode ? "w-1" : "w-[3px]"}`}
                        style={{ color: theme.node.text, top: `${promptScrollbar.trackTop}px`, height: `${promptScrollbar.trackHeight}px` }}
                    >
                        <div className="absolute inset-0 rounded-full bg-current/10">
                            <div className="absolute left-0 w-full rounded-full bg-current/45" style={{ top: promptScrollbar.top, height: promptScrollbar.height }} />
                        </div>
                    </div>
                ) : null}
            </div>

            <div className={`${expandedMode ? "mt-2 gap-3 [&_button:not(.canvas-send-circle)]:!h-12 [&_button]:!text-sm [&_button_span]:!text-sm" : "mt-auto flex-nowrap gap-2 overflow-x-auto pt-2.5 [scrollbar-width:thin] [&_button:not(.canvas-send-circle)]:!text-sm [&_button_span]:!text-sm"} flex min-w-0 items-center ${expandedMode ? "flex-wrap" : ""}`}>
                {referenceQuote ? <div className="w-full text-xs" role="status">{referenceQuote.quote ? `输出 ${referenceQuote.quote.outputSeconds} 秒 + 参考 ${referenceQuote.quote.referenceSeconds} 秒 = 计费 ${referenceQuote.quote.totalSeconds} 秒` : referenceQuote.error || "正在核实参考视频计费…"}</div> : null}
                <div className={`canvas-composer-tools flex min-w-0 flex-1 items-center gap-2 ${expandedMode ? "flex-wrap" : "flex-nowrap"}`}>
                    {mode === "image" ? (
                        <>
                            {imageTierOptions.length ? (
                                <CanvasVideoTierPicker
                                    value={activeImageTierId || ""}
                                    options={imageTierOptions}
                                    themeText={theme.node.text}
                                    activeBackground={controlPalette.activeBg}
                                    onChange={(next) => {
                                        storeImageTier(next);
                                        setImageTier(next);
                                        onConfigChange(node.id, { imageTier: next });
                                    }}
                                />
                            ) : null}
                            {imageTierModelIds && imageTierModelIds.length === 0 ? (
                                <span className="shrink-0 text-[11px] text-muted-foreground">该档位暂无模型，可在后台 → 逻辑模型挂载</span>
                            ) : null}
                            <ModelPicker placement="topLeft"
                                open={activeControl === "model"}
                                onOpenChange={(open) => setActiveControl(open ? "model" : null)}
                                showIcon={false}
                                className="canvas-composer-control !h-8 !w-auto !min-w-0 !flex-none !rounded-lg !border-0 !shadow-none !text-[var(--canvas-control-idle-text)] data-[state=open]:!bg-[var(--canvas-control-active)] data-[state=open]:!text-[var(--canvas-control-active-text)] data-[state=open]:!ring-0 [&_.canvas-model-picker-text]:!overflow-visible [&_.canvas-model-picker-text]:!text-clip"
                                config={config}
                                value={config.model}
                                allowedModels={imageTierModelIds}
                                onChange={(model) => onConfigChange(node.id, canvasModelConfigPatch(config, model, "image"))}
                                capability="image"
                                onMissingConfig={() => openConfigDialog(true)}
                            />
                            <CanvasImageSettingsPopover
                                open={activeControl === "settings"}
                                config={config}
                                placement="topLeft"
                                buttonClassName="canvas-composer-control canvas-composer-settings !h-8 !w-auto !min-w-0 !max-w-full !flex-none !justify-start !rounded-lg !px-3 !text-[var(--canvas-control-idle-text)] aria-expanded:!bg-[var(--canvas-control-active)] aria-expanded:!text-[var(--canvas-control-active-text)]"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onOpenChange={(open) => {
                                    setActiveControl(open ? "settings" : null);
                                    onImageSettingsOpenChange?.(open);
                                }}
                                fixedSizeLabel={isPanorama ? "全景 2:1" : undefined}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <CanvasVideoTierPicker
                                value={videoTier}
                                options={availableTierEntries.map((entry) => ({ value: entry.id, label: entry.label }))}
                                themeText={theme.node.text}
                                activeBackground={controlPalette.activeBg}
                                onChange={selectVideoTier}
                            />
                            {activeTierEntry?.display !== "grouped" ? (
                                <ModelPicker placement="topLeft"
                                    open={activeControl === "model"}
                                    onOpenChange={(open) => setActiveControl(open ? "model" : null)}
                                    showIcon={false}
                                    className="canvas-composer-control !h-8 !w-auto !min-w-0 !flex-none !rounded-lg !border-0 !shadow-none !text-[var(--canvas-control-idle-text)] data-[state=open]:!bg-[var(--canvas-control-active)] data-[state=open]:!text-[var(--canvas-control-active-text)] data-[state=open]:!ring-0 [&_.canvas-model-picker-text]:!overflow-visible [&_.canvas-model-picker-text]:!text-clip"
                                    config={config}
                                    value={config.model}
                                    allowedModels={videoTierModelIds}
                                    onChange={(model) => onConfigChange(node.id, canvasModelConfigPatch(config, model, "video"))}
                                    capability="video"
                                    onMissingConfig={() => openConfigDialog(true)}
                                />
                            ) : (
                                <CanvasVideoGroupedModelPicker
                                    config={config}
                                    value={config.model}
                                    models={videoTierModelIds}
                                    referenceModels={officialVideoModelIds}
                                    capability="video"
                                    themeText={theme.node.text}
                                    activeBackground={controlPalette.activeBg}
                                    panelBackground={theme.toolbar.panel}
                                    borderColor={theme.node.stroke}
                                    onChange={(model) => onConfigChange(node.id, canvasModelConfigPatch(config, model, "video"))}
                                />
                            )}
                            <Popover
                                open={activeControl === "reference"}
                                onOpenChange={(open) => setActiveControl(open ? "reference" : null)}
                                trigger="click"
                                placement="topLeft"
                                autoAdjustOverflow={false}
                                arrow={false}
                                content={
                                    <div className="w-[260px]" onPointerDown={(event) => event.stopPropagation()}>
                                        <CanvasVideoReferenceSettings metadata={node.metadata} references={mentionReferences} theme={theme} compact onChange={(patch) => onConfigChange(node.id, patch)} />
                                    </div>
                                }
                            >
                                <button
                                    type="button"
                                    className="canvas-composer-control inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-medium !text-[var(--canvas-control-idle-text)] aria-expanded:!bg-[var(--canvas-control-active)] aria-expanded:!text-[var(--canvas-control-active-text)]"
                                    aria-label="视频参考方式"
                                    aria-expanded={activeControl === "reference"}
                                >
                                    {canvasVideoReferenceModeLabel(node.metadata?.videoReferenceMode)}
                                    <ChevronDown className="size-3.5" aria-hidden />
                                </button>
                            </Popover>
                            <CanvasVideoSettingsPopover
                                open={activeControl === "settings"}
                                onOpenChange={(open) => setActiveControl(open ? "settings" : null)}
                                placement="topLeft"
                                externalReference
                                config={config}
                                metadata={node.metadata}
                                references={mentionReferences}
                                buttonClassName="canvas-composer-control canvas-composer-settings !h-8 !w-auto !min-w-0 !max-w-full !flex-none !justify-start !rounded-lg !px-3 !text-[var(--canvas-control-idle-text)] aria-expanded:!bg-[var(--canvas-control-active)] aria-expanded:!text-[var(--canvas-control-active-text)]"
                                onConfigChange={(key, value) => onConfigChange(node.id, canvasVideoConfigPatch(key, value))}
                                onMetadataChange={(patch) => onConfigChange(node.id, patch)}
                            />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker placement="topLeft" showIcon={false} className="min-w-[9rem] flex-1" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasAudioSettingsPopover
                                config={config}
                                buttonClassName="canvas-composer-settings !h-8 !min-w-[9rem] !max-w-full !flex-1 !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, canvasAudioConfigPatch(key, value))}
                            />
                        </>
                    ) : (
                        <ModelPicker placement="topLeft" showIcon={false} className="min-w-[9rem] flex-1" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} />
                    )}
                </div>
                {/* 积分从生成键里拆出来，单独一列放在左侧：和侧栏底部的积分同一套写法（图标 + 数字）。
                    生成键只负责「生成 / 停止」，不再承载金额，空提示词时也不会出现「灰色按钮里带数字」的怪样子。 */}
                <span className="inline-flex h-8 shrink-0 items-center gap-1 pl-1 text-xs font-semibold tabular-nums" style={{ color: theme.node.muted }} title="本次生成预计消耗积分">
                    <CreditSymbol className="text-sm" />
                    {quotePending ? "待核价" : formatCreditAmount(credits)}
                </span>
                {/* 生成键对齐首页输入框：36px 圆形实心键，空提示词是灰底灰箭头，有内容才转品牌橙上箭头；
                    生成中换成方块停止。积分已经在左边单独一列，按钮里不再塞数字。 */}
                <button
                    type="button"
                    className={`canvas-send-circle grid size-9 shrink-0 place-items-center rounded-full transition-[filter,background-color,color] duration-150 ${canRun || isRunning ? "hover:brightness-95" : "cursor-not-allowed"}`}
                    style={
                        isRunning
                            ? { width: 36, height: 36, background: theme.node.danger, color: theme.node.actionDangerText }
                            : canRun
                              ? { width: 36, height: 36, background: "linear-gradient(135deg, var(--brand-500), var(--brand-600))", color: "#ffffff", boxShadow: "0 6px 16px rgba(226,103,31,0.26)" }
                              : { width: 36, height: 36, background: theme.toolbar.sendIdleBg, color: theme.toolbar.sendIdleText }
                    }
                    disabled={!isRunning && !canRun}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={isRunning ? "停止生成" : "生成"}
                    title={isRunning ? "停止生成" : "生成"}
                >
                    {isRunning ? <Square className="size-3.5 fill-current" aria-hidden /> : <ArrowUp className="size-[18px]" strokeWidth={2.4} aria-hidden />}
                </button>
            </div>

            {!expandedMode ? <div className="contents" onClick={stopCanvasInteraction} onDoubleClick={stopCanvasInteraction} onMouseDown={stopCanvasInteraction} onPointerDown={stopCanvasInteraction} onWheel={stopCanvasInteraction} onContextMenu={stopCanvasInteraction}>
                <Modal
                    className="canvas-prompt-editor-modal"
                    open={expanded}
                    title={null}
                    centered
                    destroyOnHidden
                    closable={false}
                    mask={{ closable: true }}
                    width="46vw"
                    onCancel={() => setExpanded(false)}
                    styles={{
                        mask: { backdropFilter: "blur(10px)", background: "rgba(8, 12, 18, 0.42)" },
                        container: { background: "transparent", boxShadow: "none", color: theme.node.text },
                        header: { display: "none" },
                        body: { background: "transparent", padding: 0 },
                    }}
                    footer={null}
                >
                    <div data-canvas-prompt-editor="expanded" className="h-[68dvh] min-h-0 overflow-hidden rounded-3xl" style={{ background: theme.toolbar.panel }}>
                        <CanvasNodePromptPanel
                            node={node}
                            isRunning={isRunning}
                            onPromptChange={onPromptChange}
                            onConfigChange={onConfigChange}
                            onGenerate={onGenerate}
                            onStop={onStop}
                            mentionReferences={mentionReferences}
                            onImageSettingsOpenChange={onImageSettingsOpenChange}
                            onLocateReference={onLocateReference}
                            onRemoveReference={onRemoveReference}
                            expandedMode
                            onCloseExpanded={() => setExpanded(false)}
                        />
                    </div>
                </Modal>
            </div> : null}
        </div>
    );
}

function ReferenceMediaPreview({ reference, expanded, children }: { reference: CanvasResourceReference; expanded: boolean; children: React.ReactNode }) {
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const timerRef = useRef<(() => void) | null>(null);
    const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
    const [previewState, setPreviewState] = useState<"loading" | "loaded" | "error">("loading");
    const [imageSize, setImageSize] = useState(() => computeReferencePreviewSize(reference.width, reference.height));
    const cardWidth = imageSize.width + REFERENCE_PREVIEW_PADDING * 2;
    const cardHeight = imageSize.height + REFERENCE_PREVIEW_PADDING * 2;
    useEffect(() => {
        setImageSize(computeReferencePreviewSize(reference.width, reference.height));
        if (reference.kind === "image" && reference.previewUrl) preloadCanvasHoverPreview(imagePreviewUrl(reference.previewUrl, 320));
    }, [reference.width, reference.height, reference.kind, reference.previewUrl]);
    const clearPreview = () => {
        timerRef.current?.();
        timerRef.current = null;
        setAnchor(null);
        setPreviewState("loading");
    };
    const showPreview = () => {
        clearPreview();
        timerRef.current = scheduleCanvasHoverPreview(() => {
            timerRef.current = null;
            const rect = anchorRef.current?.getBoundingClientRect();
            if (!rect) return;
            const next = computeReferencePreviewAnchor(rect, imageSize, { width: window.innerWidth, height: window.innerHeight }, { placement: expanded ? "below" : "above" });
            setAnchor({ left: next.left, top: next.top });
        });
    };
    const content = reference.kind === "image" ? (
        <img
            src={imagePreviewUrl(reference.previewUrl!, 320)}
            alt={reference.title}
            onLoad={(event) => {
                setPreviewState("loaded");
                const next = computeReferencePreviewSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
                setImageSize((current) => (current.width === next.width && current.height === next.height ? current : next));
            }}
            onError={() => setPreviewState("error")}
            className="rounded-md object-contain"
            style={{ width: imageSize.width, height: imageSize.height }}
        />
    ) : (
        <video src={reference.previewUrl} controls muted playsInline onLoadedData={() => setPreviewState("loaded")} onError={() => setPreviewState("error")} className="rounded-md object-contain" style={{ width: imageSize.width, height: imageSize.height }} />
    );
    return (
        <div
            ref={anchorRef}
            className="block h-full w-full shrink-0 overflow-hidden rounded-[inherit]"
            style={{ flex: "0 0 auto" }}
            onPointerEnter={showPreview}
            onPointerLeave={clearPreview}
        >
            {children}
            {anchor ? createPortal(
                <div data-canvas-reference-hover-preview data-canvas-hover-preview-state={previewState} className="pointer-events-none fixed z-[1200] grid place-items-center overflow-hidden rounded-md border bg-white text-slate-500 dark:bg-slate-900" style={{ left: anchor.left, top: anchor.top, width: cardWidth, height: cardHeight, padding: REFERENCE_PREVIEW_PADDING, boxSizing: "border-box" }}>
                    {previewState === "loading" ? <LoaderCircle className="size-5 animate-spin" aria-label="预览加载中" /> : previewState === "error" ? <span role="status" className="text-xs">预览加载失败</span> : null}
                    {content}
                </div>,
                document.body,
            ) : null}
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const model = node.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model);
    const config = buildCanvasNodeConfig(globalConfig, node, mode, model);
    return node.type === CanvasNodeType.Panorama ? { ...config, size: PANORAMA_IMAGE_SIZE } : config;
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean, isPanorama: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (isPanorama) return hasImageContent ? "描述要如何调整这个全景环境" : "描述要生成的 360° 全景环境";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}
