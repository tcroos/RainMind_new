"use client";

import { Button, Input, Popover, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { ArrowUp, AtSign, Boxes, Check, ChevronDown, ChevronLeft, ChevronRight, FileAudio, FileVideo, ImageIcon, Plus, Sparkles, Square, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEventHandler, type PointerEventHandler, type RefObject, type WheelEvent } from "react";

import type { CreativeAsset, CreativeGenerationMode, CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";
import { CreditSymbol, formatCreditAmount } from "@/constant/credits";
import type { CreativeModelCapabilityProfile } from "@/lib/creative-model-capabilities";
import { creativeAssetReferenceAliases } from "@/lib/creative-asset-references";
import { clipboardImageFiles } from "@/lib/clipboard-image-files";
import { creativeReferenceCounts } from "@/lib/creative-reference-capabilities";
import { imagePreviewUrl } from "@/lib/media-image-url";
import type { VideoReferenceRole } from "@/lib/video-reference-contract";
import { cn } from "@/lib/utils";

import { creativeComposerPopoverOverflow } from "@/components/creative-composer-popover";
import { creativeComposerToolButtonClass, creativeComposerCompactIconButtonClass, creativeComposerSendButtonClass, creativeComposerIconButtonClass } from "@/components/creative-composer-styles";
import { shouldShowVideoFrameControls } from "./creative-composer-video-mode";
import { creativeAssetMentionAtCursor, creativeAssetMentionCandidates, creativeAssetMentionDeletionAtKey, creativeAssetMentionSegments, replaceCreativeAssetMention, type CreativeAssetMentionSegment } from "./creative-asset-mention";
import { CreativeAssetMentionPicker } from "./creative-asset-mention-picker";
import { CreativeHoverVideo } from "./creative-hover-video";
import { CreativeGenerationControls, type CreativeModelOption } from "./creative-generation-controls";
import { CreativeModeIcon, creativeModeOptions } from "@/components/creative-generation-preferences";
import { CreativeVideoFrameControls } from "./creative-video-frame-controls";

type SkillOption = {
    id: string;
    name: string;
    description: string;
    action?: "generate" | "edit";
    workspaces?: Array<"image" | "video" | "canvas" | "drama">;
};
type SkillCategory = "all" | "image" | "video" | "canvas" | "drama" | "edit";

export function CreativeComposer({
    inputRef,
    value,
    busy,
    optimizing,
    onChange,
    onOptimize,
    onSubmit,
    onCancel,
    onReferenceUpload,
    onPasteImages,
    attachments,
    referenceAssets,
    selectedAssetIds,
    skills,
    skillsLoading,
    selectedSkill,
    models,
    selectedModels,
    smartPlanning,
    creationMode,
    generationPreferences,
    referenceProfile,
    estimatedVideoCost,
    uploading,
    onRemoveAttachment,
    onReferenceAsset,
    onSelectSkill,
    onRemoveSkill,
    onSelectModel,
    onClearModels,
    onToggleSmartPlanning,
    onChangeCreationMode,
    onChangeGenerationCapability,
    onChangeGenerationPreference,
    onSelectVideoFrame,
    onUploadVideoFrame,
    onRemoveVideoFrame,
    centered = false,
    compact = false,
    floating = false,
    onExpand,
}: {
    inputRef: RefObject<TextAreaRef | null>;
    value: string;
    busy: boolean;
    optimizing: boolean;
    onChange: (value: string) => void;
    onOptimize: () => void;
    onSubmit: () => void;
    onCancel: () => void;
    onReferenceUpload: () => void;
    onPasteImages: (files: File[]) => void;
    attachments: CreativeAsset[];
    referenceAssets: CreativeAsset[];
    selectedAssetIds: string[];
    skills: SkillOption[];
    skillsLoading: boolean;
    selectedSkill?: SkillOption;
    models: CreativeModelOption[];
    selectedModels: CreativeModelOption[];
    smartPlanning: boolean;
    creationMode: "agent" | CreativeGenerationMode;
    generationPreferences: CreativeGenerationPreferences;
    referenceProfile?: CreativeModelCapabilityProfile;
    estimatedVideoCost?: number;
    uploading: boolean;
    onRemoveAttachment: (id: string) => void;
    onReferenceAsset: (id: string) => void;
    onSelectSkill: (skill: SkillOption) => void;
    onRemoveSkill: () => void;
    onSelectModel: (model: CreativeModelOption) => void;
    onClearModels: () => void;
    onToggleSmartPlanning: () => void;
    onChangeCreationMode: (mode: "agent" | CreativeGenerationMode) => void;
    onChangeGenerationCapability: (capability: CreativeModelOption["capability"]) => void;
    onChangeGenerationPreference: (capability: CreativeModelOption["capability"], patch: Record<string, string | number | boolean>) => void;
    onSelectVideoFrame: (role: Extract<VideoReferenceRole, "first_frame" | "last_frame">, assetId: string) => void;
    onUploadVideoFrame: (role: Extract<VideoReferenceRole, "first_frame" | "last_frame">) => void;
    onRemoveVideoFrame: (role: Extract<VideoReferenceRole, "first_frame" | "last_frame">) => void;
    centered?: boolean;
    compact?: boolean;
    floating?: boolean;
    onExpand?: () => void;
}) {
    const [ready, setReady] = useState(false);
    const [skillPickerOpen, setSkillPickerOpen] = useState(false);
    const [modePickerOpen, setModePickerOpen] = useState(false);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionAnchor, setMentionAnchor] = useState<{ left: number; top: number } | null>(null);
    const [promptScrollProgress, setPromptScrollProgress] = useState<{ top: number; thumbHeight: number; value: number } | null>(null);
    const [skillCategory, setSkillCategory] = useState<SkillCategory>("all");
    const caretRef = useRef(0);
    const mentionBlurTimeoutRef = useRef<number | null>(null);
    const composerInputContainerRef = useRef<HTMLDivElement>(null);
    const mentionHighlightRef = useRef<HTMLDivElement>(null);
    const { scrollRef: skillCategoryScrollRef, dragScrollProps: skillCategoryDragScrollProps } = useHorizontalMouseDragScroll<HTMLDivElement>();

    const skillCategories = skillCategoryOptions(skills);
    const visibleSkills = skills.filter((skill) => matchesSkillCategory(skill, skillCategory));
    const currentMode = creativeModeOptions.find((option) => option.value === creationMode) || creativeModeOptions[0];
    const videoPreference = generationPreferences.video;
    const frameMode = videoPreference?.referenceMode || "reference";
    const showVideoFrames = shouldShowVideoFrameControls(creationMode, generationPreferences);
    const frameAssetIds = new Set([videoPreference?.firstFrameAssetId, videoPreference?.lastFrameAssetId].filter(Boolean));
    const composerPopoverPlacement = "topLeft" as const;
    const syncPromptScrollProgress = useCallback(
        (element?: HTMLTextAreaElement) => {
            const textarea = element || inputRef.current?.resizableTextArea?.textArea;
            if (!textarea) return;
            mentionHighlightRef.current?.style.setProperty("transform", `translate3d(0, -${textarea.scrollTop}px, 0)`);
            const maxScroll = textarea.scrollHeight - textarea.clientHeight;
            const trackHeight = Math.max(0, textarea.clientHeight - 16);
            if (maxScroll <= 1 || trackHeight <= 0) {
                setPromptScrollProgress(null);
                return;
            }
            const thumbHeight = Math.min(trackHeight, Math.max(22, (trackHeight * textarea.clientHeight) / textarea.scrollHeight));
            const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
            setPromptScrollProgress({
                top: (textarea.scrollTop / maxScroll) * maxThumbTop,
                thumbHeight,
                value: Math.round((textarea.scrollTop / maxScroll) * 100),
            });
        },
        [inputRef],
    );
    const referenceAliasAssets = useMemo(() => Array.from(new Map([...referenceAssets, ...attachments].map((asset) => [asset.id, asset])).values()), [attachments, referenceAssets]);
    const mentionCandidates = useMemo(() => creativeAssetMentionCandidates(referenceAliasAssets, mentionQuery || "").filter((asset) => asset.type === "image" || asset.type === "video"), [mentionQuery, referenceAliasAssets]);
    const referenceAssetsById = useMemo(() => new Map(referenceAliasAssets.map((asset) => [asset.id, asset])), [referenceAliasAssets]);
    const referenceAliases = useMemo(() => creativeAssetReferenceAliases(referenceAliasAssets, selectedAssetIds), [referenceAliasAssets, selectedAssetIds]);
    const mentionSegments = useMemo(() => creativeAssetMentionSegments(value, referenceAliases), [referenceAliases, value]);
    const hasMentionReferences = mentionSegments.some((segment) => segment.referenced);
    const referenceCounts = creativeReferenceCounts(attachments);
    const visibleAttachments = attachments.filter((asset) => !showVideoFrames || !frameAssetIds.has(asset.id));
    const mediaAttachments = visibleAttachments.filter((asset) => asset.type !== "text");
    const otherAttachments = visibleAttachments.filter((asset) => asset.type === "text");
    const showMediaRow = !compact && (otherAttachments.length > 0 || showVideoFrames || mediaAttachments.length > 0);

    useEffect(() => setReady(true), []);

    useEffect(() => {
        const textarea = inputRef.current?.resizableTextArea?.textArea;
        if (!textarea) return;
        const resizeObserver = new ResizeObserver(() => syncPromptScrollProgress(textarea));
        resizeObserver.observe(textarea);
        const frame = window.requestAnimationFrame(() => syncPromptScrollProgress(textarea));
        return () => {
            window.cancelAnimationFrame(frame);
            resizeObserver.disconnect();
        };
    }, [centered, compact, inputRef, syncPromptScrollProgress, value]);

    useEffect(
        () => () => {
            if (mentionBlurTimeoutRef.current !== null) window.clearTimeout(mentionBlurTimeoutRef.current);
        },
        [],
    );

    const updateMentionAnchor = useCallback(
        (cursor: number, currentValue?: string) => {
            const textarea = inputRef.current?.resizableTextArea?.textArea;
            const container = composerInputContainerRef.current;
            if (!textarea || !container) return;
            const caret = measureTextareaCaretPosition(textarea, cursor, currentValue);
            const textareaRect = textarea.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            setMentionAnchor({
                left: caret.left + textareaRect.left - containerRect.left,
                top: caret.top + textareaRect.top - containerRect.top,
            });
        },
        [inputRef],
    );

    useEffect(() => {
        if (mentionQuery === null) return;
        const textarea = inputRef.current?.resizableTextArea?.textArea;
        const container = composerInputContainerRef.current;
        if (!textarea || !container) return;
        const update = () => updateMentionAnchor(caretRef.current);
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(textarea);
        resizeObserver.observe(container);
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        window.visualViewport?.addEventListener("resize", update);
        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
            window.visualViewport?.removeEventListener("resize", update);
        };
    }, [inputRef, mentionQuery, updateMentionAnchor]);

    useEffect(() => {
        if (!compact) return;
        setModePickerOpen(false);
        setSkillPickerOpen(false);
        setMentionQuery(null);
        setMentionAnchor(null);
    }, [compact]);

    const updateComposerValue = (next: string, cursor: number, allowMentionOpen = false) => {
        caretRef.current = cursor;
        onChange(next);
        updateMentionCursor(next, cursor, allowMentionOpen);
    };

    const closeMention = () => {
        if (mentionBlurTimeoutRef.current !== null) window.clearTimeout(mentionBlurTimeoutRef.current);
        mentionBlurTimeoutRef.current = null;
        setMentionQuery(null);
        setMentionAnchor(null);
    };

    const updateMentionCursor = (next: string, cursor: number, allowMentionOpen = false) => {
        caretRef.current = cursor;
        const mention = creativeAssetMentionAtCursor(next, cursor);
        if (!mention || (!allowMentionOpen && mentionQuery === null)) {
            setMentionQuery(null);
            setMentionAnchor(null);
            return;
        }
        setMentionQuery(mention.query);
        updateMentionAnchor(cursor, next);
    };

    const focusComposerAt = (cursor: number) => {
        window.requestAnimationFrame(() => {
            const textarea = inputRef.current?.resizableTextArea?.textArea;
            inputRef.current?.focus();
            textarea?.setSelectionRange(cursor, cursor);
        });
    };

    const openAssetMention = () => {
        const textarea = inputRef.current?.resizableTextArea?.textArea;
        const currentValue = textarea?.value ?? value;
        const cursor = textarea?.selectionStart ?? currentValue.length;
        const existingMention = creativeAssetMentionAtCursor(currentValue, cursor);
        if (existingMention) {
            caretRef.current = cursor;
            setMentionQuery(existingMention.query);
            updateMentionAnchor(cursor, currentValue);
            focusComposerAt(cursor);
            return;
        }
        const next = `${currentValue.slice(0, cursor)}@${currentValue.slice(cursor)}`;
        updateComposerValue(next, cursor + 1, true);
        focusComposerAt(cursor + 1);
    };

    const selectMentionAsset = (asset: CreativeAsset) => {
        const nextAssetIds = selectedAssetIds.includes(asset.id) ? selectedAssetIds : [...selectedAssetIds, asset.id];
        const alias = creativeAssetReferenceAliases(referenceAliasAssets, nextAssetIds).get(asset.id);
        if (!alias) return;
        const currentValue = inputRef.current?.resizableTextArea?.textArea?.value ?? value;
        const result = replaceCreativeAssetMention(currentValue, caretRef.current, alias);
        onReferenceAsset(asset.id);
        updateComposerValue(result.value, result.cursor);
        closeMention();
        focusComposerAt(result.cursor);
    };

    const estimatedCostSummary =
        estimatedVideoCost === undefined ? null : (
            <span data-testid="video-estimated-cost" aria-label={`预计消耗 ${formatCreditAmount(estimatedVideoCost)} 积分`} className="inline-flex h-8 shrink-0 items-center gap-1 text-[11px] font-medium text-[#356a6b] dark:text-[#9fd0cb]">
                <CreditSymbol className="text-[#4a9690] dark:text-[#9fd0cb]" />
                {formatCreditAmount(estimatedVideoCost)}积分
            </span>
        );

    const composerInput = (compactMode: boolean) => (
        <div ref={composerInputContainerRef} className="relative min-w-0 flex-1 overflow-hidden">
            {hasMentionReferences ? <ComposerMentionPreview previewRef={mentionHighlightRef} scrollTop={inputRef.current?.resizableTextArea?.textArea?.scrollTop || 0} segments={mentionSegments} assetsById={referenceAssetsById} onMentionMouseDown={focusComposerAt} /> : null}
            {promptScrollProgress ? (
                <div className="pointer-events-none absolute inset-y-2 right-1 z-[2] w-1 rounded-full bg-[#e5e9ed] dark:bg-[#3a4149]" aria-hidden="true">
                    <div
                        data-testid="creative-prompt-scroll-progress"
                        role="progressbar"
                        aria-label="提示词滚动位置"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={promptScrollProgress.value}
                        className="absolute left-0 top-0 w-full rounded-full bg-[#7a98a8] dark:bg-[#8db0be]"
                        style={{ height: `${promptScrollProgress.thumbHeight}px`, transform: `translateY(${promptScrollProgress.top}px)` }}
                    />
                </div>
            ) : null}
            <Input.TextArea
                ref={inputRef}
                value={value}
                maxLength={4000}
                spellCheck={false}
                autoSize={compactMode ? { minRows: 1, maxRows: 1 } : { minRows: centered ? 4 : 2, maxRows: 8 }}
                variant="borderless"
                className={cn("creative-composer-input relative z-[1] min-w-0 !border-0 !bg-transparent !py-1 !pl-1 !pr-3 !text-[15px] !leading-7 !shadow-none !outline-none sm:!pl-2", "caret-[#20242a] dark:caret-[#f3f5f7]")}
                placeholder={compactMode ? "输入你的创作想法" : "输入你的创作想法、脚本或画面要求"}
                onFocus={() => {
                    if (mentionBlurTimeoutRef.current !== null) window.clearTimeout(mentionBlurTimeoutRef.current);
                    mentionBlurTimeoutRef.current = null;
                    if (compactMode) onExpand?.();
                }}
                onBlur={(event) => {
                    if (mentionBlurTimeoutRef.current !== null) window.clearTimeout(mentionBlurTimeoutRef.current);
                    mentionBlurTimeoutRef.current = window.setTimeout(() => {
                        mentionBlurTimeoutRef.current = null;
                        closeMention();
                    }, 120);
                }}
                onChange={(event) => {
                    updateComposerValue(event.target.value, event.target.selectionStart, insertsAtSign(value, event.target.value));
                    window.requestAnimationFrame(() => syncPromptScrollProgress(event.target));
                }}
                onClick={() => closeMention()}
                onScroll={(event) => {
                    syncPromptScrollProgress(event.currentTarget);
                    if (mentionQuery !== null) updateMentionAnchor(caretRef.current);
                }}
                onKeyUp={(event) => {
                    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) closeMention();
                }}
                onKeyDown={(event) => {
                    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key) && mentionQuery !== null) {
                        closeMention();
                    }
                    if (event.key === "Backspace" || event.key === "Delete") {
                        const deletion = creativeAssetMentionDeletionAtKey(value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, event.key, referenceAliases);
                        if (deletion) {
                            event.preventDefault();
                            closeMention();
                            onRemoveAttachment(deletion.assetId);
                            focusComposerAt(deletion.cursor);
                            return;
                        }
                    }
                    if (event.key === "Escape" && mentionQuery !== null) {
                        event.preventDefault();
                        closeMention();
                    }
                }}
                onPaste={(event) => {
                    const files = clipboardImageFiles(event.clipboardData);
                    if (!files.length) return;
                    event.preventDefault();
                    onPasteImages(files);
                }}
                onPressEnter={(event) => {
                    if (mentionQuery !== null && mentionCandidates.length) {
                        event.preventDefault();
                        selectMentionAsset(mentionCandidates[0]);
                        return;
                    }
                    if (event.shiftKey) return;
                    event.preventDefault();
                    if (!busy) onSubmit();
                }}
            />
            {mentionQuery !== null && mentionAnchor ? (
                <Popover
                    trigger={[]}
                    placement="topLeft"
                    autoAdjustOverflow={false}
                    arrow={false}
                    open
                    onOpenChange={(open) => {
                        if (!open) closeMention();
                    }}
                    styles={{ container: { padding: 0, borderRadius: 8, overflow: "hidden" } }}
                    content={<CreativeAssetMentionPicker assets={referenceAliasAssets} query={mentionQuery} onSelect={selectMentionAsset} onDismiss={closeMention} />}
                >
                    <span data-testid="creative-mention-caret-anchor" aria-hidden="true" className="pointer-events-none absolute size-px" style={{ left: mentionAnchor.left, top: mentionAnchor.top }} />
                </Popover>
            ) : null}
        </div>
    );

    return (
        <div
            className={cn(
                "pointer-events-auto mx-auto w-full",
                floating ? "overflow-visible" : "overflow-hidden",
                compact ? "max-w-[1036px] px-3 pb-3 sm:px-6 sm:pb-4" : centered ? "max-w-[900px]" : "mb-3 max-w-[1120px] px-3 sm:mb-5 sm:px-6",
            )}
        >
            <div
                data-ready={ready}
                data-compact={compact ? "true" : "false"}
                data-floating={floating ? "true" : "false"}
                className={cn(
                    "creative-composer [background-image:var(--surface-panel-gradient)] transition-[border-radius,padding,box-shadow] duration-200",
                    floating
                        ? "shadow-[0_1px_2px_rgba(17,17,19,0.05),0_12px_28px_-12px_rgba(17,17,19,0.20),0_28px_48px_-26px_rgba(17,17,19,0.16)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_2px_6px_rgba(0,0,0,0.5),0_16px_32px_-12px_rgba(0,0,0,0.62)]"
                        : "shadow-[0_1px_2px_rgba(17,17,19,0.04),0_18px_40px_-30px_rgba(17,17,19,0.20)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_18px_40px_-30px_rgba(0,0,0,0.65)]",
                    compact ? "h-[60px] min-h-[60px] max-h-[60px] rounded-[20px] p-2" : "rounded-[20px] p-0",
                )}
                onClick={compact ? onExpand : undefined}
            >
                {showMediaRow ? (
                    <div data-testid="creative-composer-reference-row" className="flex flex-wrap items-center gap-2 px-3 pb-0.5 pt-3 sm:gap-2.5 sm:px-4">
                        {otherAttachments.map((asset) => {
                            const Icon = asset.type === "image" ? ImageIcon : asset.type === "video" ? FileVideo : FileAudio;
                            return (
                                <span
                                    key={asset.id}
                                    className="flex h-8 max-w-52 shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(34,39,38,0.09)] bg-transparent pl-1.5 pr-1 text-[13px] text-[#3c4340] dark:border-[rgba(255,255,255,0.13)] dark:text-[#c8d0d8]"
                                >
                                    <Icon className="size-3.5 shrink-0" />
                                    <span className="truncate">{asset.title}</span>
                                    <button
                                        type="button"
                                        className="grid size-5 shrink-0 place-items-center rounded text-[#8b949f] transition hover:bg-[rgba(34,39,38,0.06)] hover:text-[#20242a] dark:hover:bg-[rgba(255,255,255,0.08)] dark:hover:text-white"
                                        onClick={() => onRemoveAttachment(asset.id)}
                                        aria-label={`移除${asset.title}`}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </span>
                            );
                        })}
                    </div>
                ) : null}
                {referenceProfile && !compact && !showVideoFrames ? (
                    <div data-testid="video-reference-counts" className="flex flex-wrap gap-x-3 gap-y-1 px-2 pb-2 text-[10px] text-[#77828e] dark:text-[#9ca6b2]">
                        <span>图片 {referenceCountLabel(referenceCounts.image, referenceProfile.maxReferenceImages)}</span>
                        <span>视频 {referenceCountLabel(referenceCounts.video, referenceProfile.maxReferenceVideos)}</span>
                        <span>音频 {referenceCountLabel(referenceCounts.audio, referenceProfile.maxReferenceAudios)}</span>
                    </div>
                ) : null}
                {!compact && selectedSkill ? <div data-testid="creative-composer-skill-row" className="flex items-center gap-2 px-3 py-2 text-sm"><span>{selectedSkill.name}</span><Button type="text" size="small" aria-label="移除 Skill" onClick={onRemoveSkill} icon={<X className="size-3" />} /></div> : null}
                {!compact && (showVideoFrames || mediaAttachments.length > 0) ? (
                    <div data-testid="creative-reference-media-row" aria-label="本轮参考素材" className="relative z-[3] mb-1 flex min-w-0 items-center gap-1.5 overflow-hidden bg-white px-1 dark:bg-[#181b20]">
                        {showVideoFrames ? (
                            <CreativeVideoFrameControls
                                mode={frameMode}
                                images={attachments.filter((asset) => asset.type === "image")}
                                firstFrameAssetId={videoPreference?.firstFrameAssetId}
                                lastFrameAssetId={videoPreference?.lastFrameAssetId}
                                uploading={uploading}
                                placement={composerPopoverPlacement}
                                onSelect={onSelectVideoFrame}
                                onUpload={onUploadVideoFrame}
                                onRemove={onRemoveVideoFrame}
                            />
                        ) : (
                            <>
                                <div className="hide-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden py-1" aria-live="polite">
                                    {mediaAttachments.map((asset) => (
                                        <ComposerMediaThumbnail key={asset.id} asset={asset} onRemove={onRemoveAttachment} />
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                ) : null}
                <div data-testid="creative-composer-input-row" className={cn("flex min-w-0 items-center gap-2 sm:gap-3", compact ? "h-11 min-h-11 max-h-11" : centered ? "min-h-[112px] items-start px-3 pt-3 pb-2 sm:px-4 sm:pt-4" : "min-h-[64px] items-start px-3 pt-3 pb-2 sm:px-4 sm:pt-4")}>
                    {composerInput(compact)}
                    {compact ? (
                        <div className="flex shrink-0 items-center gap-1">
                            <Tooltip title="引用当前对话资产">
                                <Button
                                    type="text"
                                    className={creativeComposerCompactIconButtonClass(mentionQuery !== null)}
                                    icon={<AtSign className="size-[18px]" />}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        openAssetMention();
                                    }}
                                    aria-label="引用当前对话资产"
                                />
                            </Tooltip>
                            <Tooltip title="优化提示词">
                                <Button
                                    type="text"
                                    className={creativeComposerCompactIconButtonClass(false)}
                                    icon={<WandSparkles className="size-[18px]" />}
                                    loading={optimizing}
                                    disabled={busy || !value.trim()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onOptimize();
                                    }}
                                    aria-label={optimizing ? "正在优化提示词" : "优化提示词"}
                                />
                            </Tooltip>
                            {estimatedCostSummary}
                            <Tooltip title={busy ? "停止生成" : "发送"}>
                                <Button
                                    type="primary"
                                    shape="circle"
                                    className={cn(creativeComposerSendButtonClass, "!size-11 !min-w-11 !border-0 disabled:!bg-none disabled:!bg-[#e2e5e8] disabled:!text-[#aeb5bd] disabled:!shadow-none sm:!size-11 sm:!min-w-11 dark:disabled:!bg-[#30353c] dark:disabled:!text-[#68717d]")}
                                    icon={busy ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
                                    disabled={!busy && !value.trim()}
                                    onClick={busy ? onCancel : onSubmit}
                                    aria-label={busy ? "停止生成" : "发送"}
                                />
                            </Tooltip>
                        </div>
                    ) : null}
                </div>
                <div className={cn("min-w-0 items-center gap-2", compact ? "hidden" : "flex px-3 pb-3 pt-1 sm:px-4")}>
                    <Tooltip title={mediaAttachments.length ? "继续添加参考素材" : "添加素材"}>
                        <Button
                            type="text"
                            className={creativeComposerIconButtonClass(false)}
                            icon={<Plus className="size-4" />}
                            onClick={onReferenceUpload}
                            loading={uploading}
                            aria-label={mediaAttachments.length ? "继续添加参考素材" : "添加素材"}
                        />
                    </Tooltip>
                    <div className="hide-scrollbar scroll-fade-x flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                        <Popover
                            trigger="click"
                            placement={composerPopoverPlacement}
                            autoAdjustOverflow={creativeComposerPopoverOverflow(composerPopoverPlacement)}
                            arrow={false}
                            open={modePickerOpen}
                            onOpenChange={setModePickerOpen}
                            content={
                                <div className="hide-scrollbar max-h-[calc(100vh-160px)] w-[calc(100vw-56px)] max-w-[300px] overflow-y-auto py-1 sm:w-72 sm:max-w-none">
                                    <p className="px-2 pb-2 text-sm font-semibold text-[#20242a] dark:text-[#f3f5f7]">创作类型</p>
                                    <div className="space-y-1">
                                        {creativeModeOptions.map((option) => {
                                            const selected = option.value === creationMode;
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    className={cn(
                                                        "flex min-h-12 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-[#eef3f6] dark:hover:bg-[#29323a]",
                                                        selected ? "text-[#20242a] dark:text-white" : "text-[#4f5a67] dark:text-[#bec6cf]",
                                                    )}
                                                    onClick={() => {
                                                        onChangeCreationMode(option.value);
                                                        setModePickerOpen(false);
                                                    }}
                                                >
                                                    <span
                                                        className={cn(
                                                            "grid size-8 shrink-0 place-items-center rounded-lg",
                                                            selected ? "bg-white text-[#28738e] shadow-sm dark:bg-[#394550] dark:text-[#8ec7da]" : "bg-[#f2f4f6] text-[#7b8692] dark:bg-[#30363e] dark:text-[#a0aab5]",
                                                        )}
                                                    >
                                                        <CreativeModeIcon mode={option.value} />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-xs font-medium">{option.label}</span>
                                                        <span className="mt-0.5 block truncate text-[11px] text-[#8b949f] dark:text-[#7f8996]">{option.description}</span>
                                                    </span>
                                                    {selected ? <Check className="size-4 shrink-0" /> : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            }
                        >
                            <Button
                                type="text"
                                className={creativeComposerToolButtonClass(modePickerOpen)}
                                icon={<CreativeModeIcon mode={creationMode} />}
                                aria-label={`当前创作类型：${currentMode.label}`}
                                aria-haspopup="menu"
                                aria-expanded={modePickerOpen}
                            >
                                <span className="hidden text-[13px] font-medium sm:inline">{currentMode.label}</span>
                                <ChevronDown className="hidden size-3.5 sm:block" />
                            </Button>
                        </Popover>
                        <CreativeGenerationControls
                            models={models}
                            selectedModels={selectedModels}
                            smartPlanning={smartPlanning}
                            creationMode={creationMode}
                            generationPreferences={generationPreferences}
                            capabilityProfileOverride={creationMode === "video" ? referenceProfile : undefined}
                            placement={composerPopoverPlacement}
                            onSelectModel={onSelectModel}
                            onClearModels={onClearModels}
                            onToggleSmartPlanning={onToggleSmartPlanning}
                            onCapabilityChange={onChangeGenerationCapability}
                            onChangeGenerationPreference={onChangeGenerationPreference}
                        />
                        <Tooltip title="引用当前对话资产">
                            <Button
                                type="text"
                                className={creativeComposerToolButtonClass(mentionQuery !== null)}
                                icon={<AtSign className="size-4" />}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={openAssetMention}
                                aria-label="引用当前对话资产"
                            >
                                <span className="hidden text-[13px] font-medium sm:inline">引用</span>
                            </Button>
                        </Tooltip>
                        <Popover
                            trigger="click"
                            placement={composerPopoverPlacement}
                            autoAdjustOverflow={creativeComposerPopoverOverflow(composerPopoverPlacement)}
                            arrow={false}
                            open={skillPickerOpen}
                            onOpenChange={setSkillPickerOpen}
                            content={
                                <div className="w-[calc(100vw-56px)] max-w-[300px] py-1 sm:w-80 sm:max-w-none">
                                    <p className="px-2 pb-2 text-sm font-semibold text-[#20242a] dark:text-[#f3f5f7]">选择创作 Skill</p>
                                    {skillsLoading ? <p className="px-2 py-3 text-xs text-[#8b949f] dark:text-[#7f8996]">正在加载...</p> : null}
                                    {!skillsLoading && !skills.length ? <p className="px-2 py-3 text-xs text-[#8b949f] dark:text-[#7f8996]">暂无可用 Skill</p> : null}
                                    {skills.length ? (
                                        <div className="mb-2 grid grid-cols-[28px_minmax(0,1fr)_28px] items-center gap-1">
                                            <button
                                                type="button"
                                                className="grid size-7 place-items-center rounded-md text-[#7c8794] transition hover:bg-[#eef1f4] hover:text-[#20242a] disabled:cursor-default disabled:opacity-30 dark:text-[#929ca8] dark:hover:bg-[#292f37] dark:hover:text-white"
                                                onClick={() => skillCategoryScrollRef.current?.scrollBy({ left: -180, behavior: "smooth" })}
                                                aria-label="向左查看更多 Skill 分类"
                                            >
                                                <ChevronLeft className="size-4" />
                                            </button>
                                            <div
                                                ref={skillCategoryScrollRef}
                                                className="hide-scrollbar flex min-w-0 cursor-grab snap-x gap-1.5 overflow-x-auto overscroll-x-contain px-0.5 [touch-action:pan-x] active:cursor-grabbing"
                                                onWheel={scrollHorizontalCategories}
                                                {...skillCategoryDragScrollProps}
                                                role="tablist"
                                                aria-label="Skill 分类，可左右滑动查看更多"
                                            >
                                                {skillCategories.map((category) => (
                                                    <button
                                                        key={category.id}
                                                        type="button"
                                                        role="tab"
                                                        aria-selected={skillCategory === category.id}
                                                        className={cn(
                                                            "h-8 min-w-[72px] shrink-0 snap-start whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition",
                                                            skillCategory === category.id
                                                                ? "border-[#c9d7e2] bg-[#edf3f7] text-[#315d78] dark:border-[#466175] dark:bg-[#273742] dark:text-[#a8c8dc]"
                                                                : "border-[#e0e4e8] bg-white text-[#66717e] hover:border-[#cbd2d9] hover:bg-[#f5f7f8] hover:text-[#20242a] dark:border-[#343a42] dark:bg-[#1d2127] dark:text-[#a3acb7] dark:hover:border-[#49515b] dark:hover:bg-[#292f37] dark:hover:text-white",
                                                        )}
                                                        onClick={() => setSkillCategory(category.id)}
                                                    >
                                                        {category.label} · {category.count}
                                                    </button>
                                                ))}
                                            </div>
                                            <button
                                                type="button"
                                                className="grid size-7 place-items-center rounded-md text-[#7c8794] transition hover:bg-[#eef1f4] hover:text-[#20242a] dark:text-[#929ca8] dark:hover:bg-[#292f37] dark:hover:text-white"
                                                onClick={() => skillCategoryScrollRef.current?.scrollBy({ left: 180, behavior: "smooth" })}
                                                aria-label="向右查看更多 Skill 分类"
                                            >
                                                <ChevronRight className="size-4" />
                                            </button>
                                        </div>
                                    ) : null}
                                    <div className="relative">
                                        <div className="hide-scrollbar max-h-[142px] space-y-1 overflow-y-auto overscroll-contain [scrollbar-width:none] sm:max-h-[154px] [&::-webkit-scrollbar]:hidden">
                                            {!skillsLoading && skills.length && !visibleSkills.length ? <p className="px-2 py-5 text-center text-xs text-[#8b949f] dark:text-[#7f8996]">当前分类暂无可用 Skill</p> : null}
                                            {visibleSkills.map((skill) => {
                                                const selected = selectedSkill?.id === skill.id;
                                                const visual = skillOptionVisual(skill);
                                                const Icon = visual.icon;
                                                return (
                                                    <button
                                                        key={skill.id}
                                                        type="button"
                                                        className={cn(
                                                            "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition",
                                                            selected ? "bg-[#eef1f4] text-[#20242a] dark:bg-[#292f37] dark:text-white" : "text-[#4d5662] hover:bg-[#f4f6f8] dark:text-[#c2c9d1] dark:hover:bg-[#242930]",
                                                        )}
                                                        onClick={() => {
                                                            onSelectSkill(skill);
                                                            setSkillPickerOpen(false);
                                                        }}
                                                    >
                                                        <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", visual.surfaceClass)}>
                                                            <Icon className={cn("size-3.5", visual.iconClass)} />
                                                        </span>
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block truncate text-xs font-medium">{skill.name}</span>
                                                            <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-[#8b949f] dark:text-[#7f8996]">{skill.description}</span>
                                                        </span>
                                                        {selected ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            }
                        >
                            <Button type="text" className={creativeComposerToolButtonClass(skillPickerOpen)} icon={<Boxes className="size-4" />} aria-label="选择创作 Skill" aria-haspopup="menu" aria-expanded={skillPickerOpen}>
                                <span className="hidden text-[13px] font-medium sm:inline">使用 Skill</span>
                            </Button>
                        </Popover>
                        <Tooltip title="优化提示词">
                            <Button
                                type="text"
                                className={creativeComposerToolButtonClass(false)}
                                icon={<WandSparkles className="size-4" />}
                                loading={optimizing}
                                disabled={busy || !value.trim()}
                                onClick={onOptimize}
                                aria-label={optimizing ? "正在优化提示词" : "优化提示词"}
                            >
                                <span className="hidden text-[13px] font-medium sm:inline">优化</span>
                            </Button>
                        </Tooltip>
                    </div>
                    {estimatedCostSummary}
                    <Tooltip title={busy ? "停止生成" : "发送"}>
                        <Button
                            type="primary"
                            shape="circle"
                            className={creativeComposerSendButtonClass}
                            icon={busy ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
                            disabled={!busy && !value.trim()}
                            onClick={busy ? onCancel : onSubmit}
                            aria-label={busy ? "停止生成" : "发送"}
                        />
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function ComposerMentionPreview({ segments, assetsById, previewRef, scrollTop, onMentionMouseDown }: { segments: CreativeAssetMentionSegment[]; assetsById: ReadonlyMap<string, CreativeAsset>; previewRef: RefObject<HTMLDivElement | null>; scrollTop: number; onMentionMouseDown: (cursor: number) => void }) {
    let promptOffset = 0;
    return (
        <div
            ref={previewRef}
            data-testid="creative-composer-mention-preview"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[2] overflow-visible whitespace-pre-wrap break-words py-1 pl-1 pr-3 text-[15px] leading-7 tracking-normal text-transparent [font-family:inherit] sm:pl-2 dark:text-transparent"
            style={{ transform: `translate3d(0, -${scrollTop}px, 0)` }}
        >
            {segments.map((segment, index) => {
                const segmentStart = promptOffset;
                promptOffset += segment.text.length;
                const asset = segment.assetId ? assetsById.get(segment.assetId) : undefined;
                if (!segment.referenced || !asset) return <span key={`${index}-${segment.text}`}>{segment.text}</span>;
                const coverUrl = asset.type === "video" && typeof asset.metadata.coverUrl === "string" ? asset.metadata.coverUrl : undefined;
                const previewUrl = asset.type === "image" || asset.type === "video" ? asset.serverUrl || asset.remoteUrl : undefined;
                const Icon = asset.type === "video" ? FileVideo : asset.type === "audio" ? FileAudio : asset.type === "image" ? ImageIcon : Sparkles;
                const preview =
                    asset.type === "image" && previewUrl ? (
                        <img src={imagePreviewUrl(previewUrl, 480)} alt="" className="max-h-[144px] max-w-full object-contain" />
                    ) : asset.type === "video" && previewUrl ? (
                        <CreativeHoverVideo src={previewUrl} poster={coverUrl ? imagePreviewUrl(coverUrl, 480) : undefined} autoPlay className="max-h-[144px] w-[min(48vw,192px)] object-contain" />
                    ) : null;
                return (
                    <Popover
                        key={`${asset.id}-${index}`}
                        trigger="hover"
                        placement="top"
                        arrow={false}
                        mouseEnterDelay={0.12}
                        styles={{
                            root: { filter: "none", background: "transparent", border: "none", boxShadow: "none" },
                            container: { padding: 0, border: "none", background: "transparent", boxShadow: "none" },
                            content: { padding: 0, border: "none", background: "transparent", boxShadow: "none" },
                        }}
                        content={
                            preview ? (
                                <div data-testid="creative-composer-mention-media-preview" className="grid max-w-[min(48vw,192px)] place-items-center overflow-hidden rounded-[5px] border border-[#d8dde3] bg-white dark:border-[#414a54] dark:bg-[#20252a]">
                                    {preview}
                                </div>
                            ) : null
                        }
                    >
                        <span
                            data-testid="creative-composer-reference-chip"
                            data-asset-id={asset.id}
                            className="pointer-events-auto relative inline-block align-baseline leading-7 text-transparent"
                            onMouseDown={(event) => {
                                event.preventDefault();
                                onMentionMouseDown(segmentStart + segment.text.length);
                            }}
                        >
                            <span data-mention-token-width className="whitespace-pre">
                                {segment.text}
                            </span>
                            <span
                                data-reference-chip-visual="true"
                                className="absolute inset-0 inline-flex min-w-0 items-center gap-1 overflow-hidden rounded-md border border-[#d9e1e7] bg-[#f0f4f6] px-1 text-[#435261] dark:border-[#414b56] dark:bg-[#252c33] dark:text-[#d3dce4]"
                            >
                                {asset.type === "video" && previewUrl ? (
                                    <CreativeHoverVideo src={previewUrl} poster={coverUrl ? imagePreviewUrl(coverUrl, 96) : undefined} preload={coverUrl ? "none" : "auto"} aria-hidden="true" className="size-4 shrink-0 rounded object-cover" />
                                ) : coverUrl ? (
                                    <img src={imagePreviewUrl(coverUrl, 96)} alt="" className="size-4 shrink-0 rounded object-cover" />
                                ) : asset.type === "image" && previewUrl ? (
                                    <img src={imagePreviewUrl(previewUrl, 96)} alt="" className="size-4 shrink-0 rounded object-cover" />
                                ) : (
                                    <Icon className="size-3.5 shrink-0" />
                                )}
                                <span data-mention-label className="min-w-0 truncate text-xs font-medium">
                                    {segment.text.slice(1)}
                                </span>
                            </span>
                        </span>
                    </Popover>
                );
            })}
        </div>
    );
}

function referenceCountLabel(count: number, max: number | undefined) {
    return max === undefined ? String(count) : `${count}/${max}`;
}

function ComposerMediaThumbnail({ asset, compact = false, onRemove }: { asset: CreativeAsset; compact?: boolean; onRemove: (id: string) => void }) {
    const previewUrl = asset.serverUrl || asset.remoteUrl || "";
    const coverUrl = typeof asset.metadata.coverUrl === "string" ? asset.metadata.coverUrl : "";
    const thumbnailUrl = asset.type === "image" ? previewUrl : "";
    const Icon = asset.type === "video" ? FileVideo : asset.type === "audio" ? FileAudio : ImageIcon;
    return (
        <Popover
            trigger="hover"
            placement="top"
            arrow={false}
            mouseEnterDelay={0.12}
            styles={{
                root: { filter: "none", background: "transparent", border: "none", boxShadow: "none" },
                container: { padding: 0, border: "none", borderRadius: 0, background: "transparent", boxShadow: "none", overflow: "hidden" },
                content: { padding: 0, border: "none", background: "transparent", boxShadow: "none" },
            }}
            content={
                <div data-testid="creative-composer-media-preview" className="grid max-w-[min(48vw,192px)] place-items-center overflow-hidden rounded-[5px] border border-[#d8dde3] bg-white dark:border-[#414a54] dark:bg-[#20252a]">
                    {asset.type === "image" && previewUrl ? (
                        <img src={imagePreviewUrl(previewUrl, 480)} alt="" className="max-h-[144px] max-w-full object-contain" />
                    ) : asset.type === "video" && previewUrl ? (
                        <CreativeHoverVideo src={previewUrl} poster={coverUrl ? imagePreviewUrl(coverUrl, 480) : undefined} autoPlay className="max-h-[144px] w-[min(48vw,192px)] object-contain" />
                    ) : asset.type === "audio" && previewUrl ? (
                        <div className="grid w-[min(48vw,192px)] justify-items-center gap-1 rounded-md bg-white px-1.5 py-2 dark:bg-[#20252b]">
                            <FileAudio className="size-5 text-[#71808d] dark:text-[#b2bdc8]" />
                            <audio src={previewUrl} controls preload="metadata" className="w-full" />
                        </div>
                    ) : (
                        <div className="grid min-h-14 min-w-16 place-items-center gap-1 px-2 py-2 text-[10px] text-[#c5cdd5]">
                            <Icon className="size-5" />
                            <span>暂无可预览内容</span>
                        </div>
                    )}
                </div>
            }
        >
            <div
                data-testid="creative-composer-media-thumbnail"
                data-asset-id={asset.id}
                className={cn("group relative shrink-0", compact ? "size-11 rounded-lg" : "size-12 rounded-lg")}
                aria-label={`已上传${asset.type === "image" ? "图片" : asset.type === "video" ? "视频" : "音频"} ${asset.title}`}
            >
                <div className="size-full overflow-hidden rounded-[7px]">
                    {asset.type === "video" && previewUrl ? (
                        <CreativeHoverVideo
                            src={previewUrl}
                            poster={coverUrl ? imagePreviewUrl(coverUrl, 320) : undefined}
                            preload={coverUrl ? "none" : "auto"}
                            aria-hidden="true"
                            data-testid="creative-composer-video-thumbnail"
                            className="size-full bg-black object-cover"
                        />
                    ) : thumbnailUrl ? (
                        <img src={imagePreviewUrl(thumbnailUrl, 320)} alt="" className="size-full object-cover" />
                    ) : (
                        <span className="grid size-full place-items-center text-[#71808d] dark:text-[#b2bdc8]">
                            <Icon className="size-5" />
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    className="group/remove absolute -right-1.5 -top-1.5 z-10 grid size-7 place-items-center rounded-full !border-0 !bg-transparent !p-0 !text-white opacity-0 shadow-none transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#28738e] focus-visible:ring-offset-1"
                    onClick={(event) => {
                        event.stopPropagation();
                        onRemove(asset.id);
                    }}
                    aria-label={`移除${asset.title}`}
                    title="删除素材"
                >
                    <span
                        data-delete-indicator
                        aria-hidden="true"
                        className="grid size-[22px] place-items-center rounded-full border border-white/95 bg-[#66727f]/95 text-white shadow-[0_2px_7px_rgba(32,36,42,0.3)] transition-colors group-hover/remove:bg-[#bd5b68] group-focus-within/remove:bg-[#bd5b68] dark:bg-[#7d8995]/95 dark:group-hover/remove:bg-[#cf6873] dark:group-focus-within/remove:bg-[#cf6873]"
                    >
                        <X className="size-3.5 stroke-[2.75]" />
                    </span>
                </button>
            </div>
        </Popover>
    );
}

function measureTextareaCaretPosition(textarea: HTMLTextAreaElement, cursor: number, value = textarea.value) {
    const rectangle = textarea.getBoundingClientRect();
    const computed = window.getComputedStyle(textarea);
    const mirror = document.createElement("div");
    const marker = document.createElement("span");
    for (const property of ["font", "letter-spacing", "line-height", "text-align", "text-indent", "text-transform", "word-spacing", "white-space", "word-break", "overflow-wrap", "tab-size", "padding", "border", "box-sizing"]) {
        mirror.style.setProperty(property, computed.getPropertyValue(property));
    }
    mirror.style.position = "fixed";
    mirror.style.left = `${rectangle.left}px`;
    mirror.style.top = `${rectangle.top}px`;
    mirror.style.width = `${rectangle.width}px`;
    mirror.style.height = "auto";
    mirror.style.minHeight = "0";
    mirror.style.overflow = "hidden";
    mirror.style.visibility = "hidden";
    mirror.style.pointerEvents = "none";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.overflowWrap = "break-word";
    mirror.style.zIndex = "-1";
    mirror.textContent = value.slice(0, cursor);
    marker.textContent = value.slice(cursor, cursor + 1) || String.fromCharCode(8203);
    mirror.append(marker);
    document.body.append(mirror);
    const caret = marker.getBoundingClientRect();
    mirror.remove();
    return { left: caret.left - rectangle.left - textarea.scrollLeft, top: caret.top - rectangle.top - textarea.scrollTop };
}

function insertsAtSign(previous: string, next: string) {
    let prefix = 0;
    while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix += 1;
    return next.slice(prefix, next.length - suffix).includes("@");
}

function scrollHorizontalCategories(event: WheelEvent<HTMLDivElement>) {
    if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    event.preventDefault();
    event.currentTarget.scrollLeft += event.deltaY;
}

function useHorizontalMouseDragScroll<T extends HTMLElement>() {
    const scrollRef = useRef<T>(null);
    const dragRef = useRef({ pointerId: -1, startX: 0, startScrollLeft: 0, moved: false });
    const suppressClickRef = useRef(false);

    const onPointerDown: PointerEventHandler<T> = (event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: event.currentTarget.scrollLeft, moved: false };
    };

    const onPointerMove: PointerEventHandler<T> = (event) => {
        const drag = dragRef.current;
        if (drag.pointerId !== event.pointerId) return;
        const distance = event.clientX - drag.startX;
        if (!drag.moved && Math.abs(distance) < 4) return;
        if (!drag.moved) {
            drag.moved = true;
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
        event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
    };

    const finishDrag: PointerEventHandler<T> = (event) => {
        const drag = dragRef.current;
        if (drag.pointerId !== event.pointerId) return;
        if (drag.moved) {
            suppressClickRef.current = true;
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 0);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current.pointerId = -1;
    };

    const onClickCapture: MouseEventHandler<T> = (event) => {
        if (!suppressClickRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClickRef.current = false;
    };

    return {
        scrollRef,
        dragScrollProps: { onPointerDown, onPointerMove, onPointerUp: finishDrag, onPointerCancel: finishDrag, onClickCapture },
    };
}

function skillCategoryOptions(skills: SkillOption[]) {
    const categories: Array<{ id: SkillCategory; label: string }> = [
        { id: "all", label: "全部" },
        { id: "image", label: "图片" },
        { id: "video", label: "视频" },
        { id: "canvas", label: "画布" },
        { id: "drama", label: "短剧" },
        { id: "edit", label: "编辑" },
    ];
    return categories.map((category) => ({ ...category, count: skills.filter((skill) => matchesSkillCategory(skill, category.id)).length })).filter((category) => category.id === "all" || category.count > 0);
}

function matchesSkillCategory(skill: SkillOption, category: SkillCategory) {
    if (category === "all") return true;
    if (category === "edit") return skill.action === "edit";
    return skill.workspaces?.includes(category) === true;
}

function skillOptionVisual(skill: SkillOption) {
    if (skill.action === "edit") return { icon: Sparkles, surfaceClass: "bg-violet-50 dark:bg-violet-400/10", iconClass: "text-violet-600 dark:text-violet-300" };
    if (skill.workspaces?.includes("video")) return { icon: FileVideo, surfaceClass: "bg-emerald-50 dark:bg-emerald-400/10", iconClass: "text-emerald-600 dark:text-emerald-300" };
    if (skill.workspaces?.includes("image")) return { icon: ImageIcon, surfaceClass: "bg-sky-50 dark:bg-sky-400/10", iconClass: "text-sky-600 dark:text-sky-300" };
    return { icon: Boxes, surfaceClass: "bg-slate-100 dark:bg-slate-400/10", iconClass: "text-slate-600 dark:text-slate-300" };
}
