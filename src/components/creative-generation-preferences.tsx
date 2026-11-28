"use client";

import { Button, Popover, Select } from "antd";
import { AudioLines, ChevronDown, ImageIcon, Lightbulb, Sparkles, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { audioFormatLabel, audioFormatOptions, audioVoiceLabel, audioVoiceOptions } from "@/lib/audio-generation";
import type { CreativeModelCapabilityProfile } from "@/lib/creative-model-capabilities";
import type { CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";
import { cn } from "@/lib/utils";

import { creativeComposerPopoverOverflow, creativeComposerPopoverPanelMaxHeight, type CreativeComposerPopoverPlacement } from "./creative-composer-popover";
import { creativeComposerToolButtonClass } from "./creative-composer-styles";
import { PositiveNumberField, SwitchPreference, VideoQualityField } from "./creative-generation-preference-fields";

export type MediaCapability = "image" | "video" | "audio";

export type CreativeGenerationPreferencePatch = {
    size?: string;
    sizeMode?: NonNullable<CreativeGenerationPreferences["image"]>["sizeMode"];
    resolution?: string;
    quality?: string;
    style?: string;
    outputFormat?: string;
    background?: NonNullable<CreativeGenerationPreferences["image"]>["background"];
    moderation?: string;
    responseFormat?: NonNullable<CreativeGenerationPreferences["image"]>["responseFormat"];
    count?: number;
    seconds?: number;
    generateAudio?: boolean;
    watermark?: boolean;
    referenceMode?: NonNullable<CreativeGenerationPreferences["video"]>["referenceMode"];
    firstFrameAssetId?: string;
    lastFrameAssetId?: string;
    voice?: string;
    format?: string;
    speed?: number;
};

const imageRatios = [
    { value: "auto", label: "智能", width: 18, height: 18 },
    { value: "1:1", label: "1:1", width: 18, height: 18 },
    { value: "16:9", label: "16:9", width: 24, height: 14 },
    { value: "4:3", label: "4:3", width: 21, height: 16 },
    { value: "3:2", label: "3:2", width: 23, height: 15 },
    { value: "2:3", label: "2:3", width: 15, height: 23 },
    { value: "3:4", label: "3:4", width: 16, height: 21 },
    { value: "9:16", label: "9:16", width: 14, height: 24 },
] as const;

const videoRatios = [
    { value: "auto", label: "智能", width: 18, height: 18 },
    { value: "21:9", label: "21:9", width: 26, height: 11 },
    { value: "16:9", label: "16:9", width: 24, height: 14 },
    { value: "4:3", label: "4:3", width: 21, height: 16 },
    { value: "1:1", label: "1:1", width: 18, height: 18 },
    { value: "3:4", label: "3:4", width: 16, height: 21 },
    { value: "9:16", label: "9:16", width: 14, height: 24 },
] as const;

const imageQualityOptions = [
    { value: "low", label: "低画质", shortLabel: "低" },
    { value: "medium", label: "中画质", shortLabel: "中" },
    { value: "high", label: "高画质", shortLabel: "高" },
] as const;

const videoQualityOptions = [
    { value: "auto", label: "智能清晰度", shortLabel: "智能" },
    { value: "480", label: "480P", shortLabel: "480P" },
    { value: "720", label: "720P", shortLabel: "720P" },
    { value: "1080", label: "1080P", shortLabel: "1080P" },
] as const;

const videoDurationOptions = [
    { value: 5, label: "5 秒" },
    { value: 10, label: "10 秒" },
] as const;

const generationCountOptions = [
    { value: 1, label: "1 份" },
    { value: 2, label: "2 份" },
    { value: 3, label: "3 份" },
    { value: 4, label: "4 份" },
] as const;

type RatioOption = { value: string; label: string; width: number; height: number };
type ResolutionOption = { value: string; label: string; shortLabel?: string };

export function generationRatioOptions(capability: MediaCapability, profile?: CreativeModelCapabilityProfile): RatioOption[] {
    const defaults = capability === "image" ? imageRatios : videoRatios;
    if (!profile?.aspectRatios?.length) return [...defaults];
    const configuredValues = profile.aspectRatios.filter((value) => value.trim().toLowerCase() !== "auto");
    const configured = configuredValues.map((value) => {
        const preset = defaults.find((option) => option.value.toLowerCase() === value.toLowerCase());
        if (preset) return preset;
        const [width, height] = ratioPreviewSize(value);
        return { value, label: value, width, height };
    });
    const smart = defaults.find((option) => option.value === "auto")!;
    const uniqueConfigured = configured.filter((option, index, options) => options.findIndex((item) => item.value.toLowerCase() === option.value.toLowerCase()) === index);
    return [smart, ...uniqueConfigured];
}

export function generationResolutionOptions(capability: MediaCapability, profile?: CreativeModelCapabilityProfile): ResolutionOption[] {
    const defaults = capability === "image" ? imageQualityOptions : videoQualityOptions;
    if (!profile?.resolutions?.length) return [...defaults];
    const configured = profile.resolutions
        .filter((value) => value.trim().toLowerCase() !== "auto")
        .map((value) => {
            const normalized = normalizeResolution(value);
            const preset = defaults.find((option) => normalizeResolution(option.value) === normalized);
            const label = preset?.label || (/^\d+$/.test(normalized) ? `${normalized}P` : value.toUpperCase());
            return { value, label, shortLabel: preset?.shortLabel || label };
        });
    const smart = defaults.find((option) => option.value === "auto");
    const uniqueConfigured = configured.filter((option, index, options) => options.findIndex((item) => normalizeResolution(item.value) === normalizeResolution(option.value)) === index);
    // 声明了清晰度倍率或只声明单一固定清晰度的模型，"智能"无法计价/无实际意义，不展示。
    const allowSmart = Boolean(smart) && !profile.videoBilling?.resolutionMultipliers && profile.resolutions.length !== 1;
    return [...(allowSmart ? [smart!] : []), ...uniqueConfigured];
}

export function generationImageResolutionOptions(profile?: CreativeModelCapabilityProfile): ResolutionOption[] {
    return (profile?.imageOptions?.resolutions || []).map((value) => ({ value, label: value.toUpperCase(), shortLabel: value.toUpperCase() }));
}

export function generationImageQualityOptions(profile?: CreativeModelCapabilityProfile): ResolutionOption[] {
    const qualities = profile?.imageOptions?.qualities?.length ? profile.imageOptions.qualities : imageQualityOptions.map((option) => option.value);
    const visibleQualities = qualities.filter((value) => value.trim().toLowerCase() !== "auto");
    return visibleQualities.map((value) => ({ value, label: imageQualityLabel(value), shortLabel: imageQualityShortLabel(value) }));
}

export function generationImageQualitySelection(value: string | undefined, options: ResolutionOption[]) {
    const selected = value && value.toLowerCase() !== "auto" ? options.find((option) => option.value.toLowerCase() === value.toLowerCase()) : undefined;
    return selected?.value || options.find((option) => option.value.toLowerCase() === "low")?.value || options[0]?.value || "low";
}

export function generationDurationRange(profile?: CreativeModelCapabilityProfile) {
    const hasCompleteRange = profile?.minDurationSeconds !== undefined && profile.maxDurationSeconds !== undefined;
    const rangeValues = hasCompleteRange ? Array.from({ length: Math.max(0, Math.floor(profile.maxDurationSeconds!) - Math.ceil(profile.minDurationSeconds!) + 1) }, (_, index) => Math.ceil(profile.minDurationSeconds!) + index) : [];
    const values = hasCompleteRange
        ? Array.from(new Set([...rangeValues, ...(profile.durationSeconds || []).filter((value) => value < profile.minDurationSeconds! || value > profile.maxDurationSeconds!)]))
        : profile?.durationSeconds?.filter((value) => (!profile.minDurationSeconds || value >= profile.minDurationSeconds) && (!profile.maxDurationSeconds || value <= profile.maxDurationSeconds)).sort((a, b) => a - b);
    const min = profile?.minDurationSeconds ?? values?.[0] ?? 2;
    const max = profile?.maxDurationSeconds ?? values?.at(-1) ?? 30;
    const normalize = (value: number) => {
        const bounded = Math.min(max, Math.max(min, value));
        return values?.length ? (values.find((duration) => duration >= bounded) ?? values[values.length - 1]) : bounded;
    };
    return { values, min, max, normalize };
}

export function generationDurationOptions(profile?: CreativeModelCapabilityProfile) {
    const range = generationDurationRange(profile);
    if (range.values?.length) return range.values.map((value) => ({ value, label: `${value} 秒` }));
    if (!profile?.minDurationSeconds && !profile?.maxDurationSeconds) return [...videoDurationOptions];
    const values = new Set<number>(videoDurationOptions.map((option) => option.value).filter((value) => (!profile.minDurationSeconds || value >= profile.minDurationSeconds) && (!profile.maxDurationSeconds || value <= profile.maxDurationSeconds)));
    if (profile.minDurationSeconds) values.add(profile.minDurationSeconds);
    if (profile.maxDurationSeconds) values.add(profile.maxDurationSeconds);
    return Array.from(values)
        .sort((left, right) => left - right)
        .map((value) => ({ value, label: `${value} 秒` }));
}

function ratioPreviewSize(value: string): [number, number] {
    const match = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return [18, 18];
    const ratio = Number(match[1]) / Number(match[2]);
    return ratio >= 1 ? [24, Math.max(8, 24 / ratio)] : [Math.max(8, 24 * ratio), 24];
}

function ratioPreviewIcon(ratio: RatioOption) {
    return (
        <span className="grid h-4 w-5 shrink-0 place-items-center" aria-hidden="true">
            <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: ratio.width * 0.64, height: ratio.height * 0.64 }} />
        </span>
    );
}

function normalizedRatio(value: string) {
    const dimensions = value.trim().match(/^(\d+)x(\d+)$/i);
    const ratio = dimensions ? `${dimensions[1]}:${dimensions[2]}` : value.trim();
    const parts = ratio.split(":").map(Number);
    if (parts.length !== 2 || !parts.every((part) => Number.isFinite(part) && part > 0)) return ratio.toLowerCase();
    const divisor = greatestCommonDivisor(parts[0], parts[1]);
    return `${parts[0] / divisor}:${parts[1] / divisor}`;
}

function greatestCommonDivisor(left: number, right: number): number {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a || 1;
}

function normalizeResolution(value: string) {
    return value.trim().replace(/p$/i, "").toLowerCase();
}

const videoReferenceModeOptions = [
    { value: "reference", label: "智能参考" },
    { value: "first_frame", label: "首帧" },
    { value: "first_last", label: "首尾帧" },
] as const;

export function CreativeGenerationPreferences({
    capability,
    capabilities = [capability],
    unifiedPanel = false,
    preferences,
    capabilityProfile,
    triggerLabel,
    triggerIcon,
    triggerAriaLabel,
    triggerClassName,
    triggerLabelClassName,
    panelClassName,
    placement = "topLeft",
    autoAdjustOverflow,
    fixedSizeLabel,
    compact = false,
    showCount = true,
    videoReferenceContent,
    onOpenChange,
    onCapabilityChange,
    onChange,
    hideVideoReference = false,
    open: controlledOpen,
}: {
    capability: MediaCapability;
    unifiedPanel?: boolean;
    open?: boolean;
    hideVideoReference?: boolean;
    capabilities?: readonly MediaCapability[];
    preferences: CreativeGenerationPreferences;
    capabilityProfile?: CreativeModelCapabilityProfile;
    triggerLabel?: string;
    triggerIcon?: ReactNode;
    triggerAriaLabel?: string;
    triggerClassName?: string | ((open: boolean) => string);
    triggerLabelClassName?: string;
    panelClassName?: string;
    placement?: CreativeComposerPopoverPlacement;
    autoAdjustOverflow?: boolean;
    fixedSizeLabel?: string;
    compact?: boolean;
    showCount?: boolean;
    videoReferenceContent?: ReactNode;
    onOpenChange?: (open: boolean) => void;
    onCapabilityChange?: (capability: MediaCapability) => void;
    onChange: (patch: CreativeGenerationPreferencePatch) => void;
}) {
    const [localOpen, setOpen] = useState(false);
    const open = controlledOpen ?? localOpen;
    const [panelMaxHeight, setPanelMaxHeight] = useState<number>();
    const [measuredPlacement, setMeasuredPlacement] = useState(placement);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const availableCapabilities = capabilities.length ? capabilities : [capability];
    const activeCapability = availableCapabilities.includes(capability) ? capability : availableCapabilities[0];
    const summary = triggerLabel || generationPreferenceSummary(activeCapability, preferences, capabilityProfile);
    const maximumPanelHeight = compact ? 440 : 520;

    const measurePanelHeight = useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        const visualViewport = window.visualViewport;
        const viewportTop = visualViewport?.offsetTop || 0;
        const viewportBottom = viewportTop + (visualViewport?.height || window.innerHeight);
        const rect = trigger.getBoundingClientRect();
        const nextPlacement =
            unifiedPanel && placement.startsWith("bottom") && viewportBottom - rect.bottom < maximumPanelHeight && rect.top - viewportTop > viewportBottom - rect.bottom
                ? (placement.replace("bottom", "top") as CreativeComposerPopoverPlacement)
                : placement;
        setMeasuredPlacement(nextPlacement);
        setPanelMaxHeight(creativeComposerPopoverPanelMaxHeight(nextPlacement, rect, { top: viewportTop, bottom: viewportBottom }, maximumPanelHeight));
    }, [maximumPanelHeight, placement, unifiedPanel]);

    useEffect(() => {
        if (!open) return;
        const visualViewport = window.visualViewport;
        window.addEventListener("resize", measurePanelHeight);
        visualViewport?.addEventListener("resize", measurePanelHeight);
        return () => {
            window.removeEventListener("resize", measurePanelHeight);
            visualViewport?.removeEventListener("resize", measurePanelHeight);
        };
    }, [measurePanelHeight, open]);

    return (
        <Popover
            rootClassName="creative-popover"
            trigger="click"
            placement={measuredPlacement}
            autoAdjustOverflow={autoAdjustOverflow ?? creativeComposerPopoverOverflow(placement)}
            arrow={false}
            open={open}
            onOpenChange={(nextOpen) => {
                if (nextOpen) measurePanelHeight();
                setOpen(nextOpen);
                onOpenChange?.(nextOpen);
            }}
            styles={{ container: { padding: compact ? 8 : 12, borderRadius: compact ? 14 : 18 } }}
            content={
                <div
                    data-canvas-no-drag
                    data-creative-generation-preferences
                    className={cn("hide-scrollbar min-w-0 max-w-[calc(100vw-32px)] overflow-x-hidden overflow-y-auto overscroll-contain", compact ? "w-[316px]" : "w-[360px]", panelClassName)}
                    style={{ maxHeight: panelMaxHeight === undefined ? `min(${maximumPanelHeight}px, calc(100dvh - 96px))` : panelMaxHeight }}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.stopPropagation()}
                >
                    {availableCapabilities.length > 1 ? (
                        <div
                            className={cn(
                                compact ? "mb-1.5 grid gap-1 rounded-lg bg-[#f1f3f5] p-0.5 dark:bg-[#252a31]" : "mb-2 grid gap-1 rounded-lg bg-[#f1f3f5] p-0.5 dark:bg-[#252a31]",
                                availableCapabilities.length === 2 ? "grid-cols-2" : "grid-cols-3",
                            )}
                        >
                            {availableCapabilities.map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    className={cn(
                                        "inline-flex items-center justify-center gap-1.5 rounded-[7px] text-[11px] font-medium transition",
                                        compact ? "h-7" : "h-8",
                                        activeCapability === item
                                            ? "bg-white text-[#20242a] shadow-sm dark:bg-[#343b44] dark:text-white"
                                            : "text-[#7b8591] hover:bg-white/60 hover:text-[#20242a] dark:text-[#8f99a5] dark:hover:bg-[#30363e] dark:hover:text-white",
                                    )}
                                    onClick={() => onCapabilityChange?.(item)}
                                    aria-pressed={activeCapability === item}
                                >
                                    <CreativeModeIcon mode={item} />
                                    {mediaCapabilityLabel(item)}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <PreferencePanel
                        capability={activeCapability}
                        preferences={preferences}
                        capabilityProfile={capabilityProfile}
                        fixedSizeLabel={fixedSizeLabel}
                        compact={compact}
                        showCount={showCount}
                        videoReferenceContent={videoReferenceContent}
                        hideVideoReference={hideVideoReference}
                        onChange={onChange}
                    />
                </div>
            }
        >
            <Button
                ref={triggerRef}
                type="text"
                className={typeof triggerClassName === "function" ? triggerClassName(open) : triggerClassName || creativeComposerToolButtonClass(open)}
                icon={triggerIcon || <PreferenceSummaryIcon capability={activeCapability} preferences={preferences} />}
                aria-label={triggerAriaLabel || `生成参数：${summary}`}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <span className={cn("max-w-[132px] truncate text-[13px] font-medium sm:max-w-[176px]", triggerLabelClassName)}>{summary}</span>
                <ChevronDown className="size-3.5 shrink-0" />
            </Button>
        </Popover>
    );
}

function PreferencePanel({
    hideVideoReference,
    capability,
    preferences,
    capabilityProfile,
    fixedSizeLabel,
    compact,
    showCount,
    videoReferenceContent,
    onChange,
}: {
    capability: MediaCapability;
    hideVideoReference?: boolean;
    preferences: CreativeGenerationPreferences;
    capabilityProfile?: CreativeModelCapabilityProfile;
    fixedSizeLabel?: string;
    compact: boolean;
    showCount: boolean;
    videoReferenceContent?: ReactNode;
    onChange: (patch: CreativeGenerationPreferencePatch) => void;
}) {
    const ratios = generationRatioOptions(capability, capabilityProfile);
    const qualityOptions = generationResolutionOptions(capability, capabilityProfile);
    const imageOptions = capability === "image" ? capabilityProfile?.imageOptions : undefined;
    const imageResolutions = generationImageResolutionOptions(capabilityProfile);
    const imageQualities = generationImageQualityOptions(capabilityProfile);
    const { values: durationValues, min: durationMin, max: durationMax, normalize: normalizeDuration } = generationDurationRange(capabilityProfile);
    const currentDuration = normalizeDuration(preferences.video?.seconds || 5);
    const sliderCurrent = durationValues?.length ? durationValues.indexOf(currentDuration) : currentDuration;
    const [durationDraft, setDurationDraft] = useState<number | null>(null);
    const sliderValue = durationDraft ?? sliderCurrent;
    const displayedDuration = durationDraft === null
        ? currentDuration
        : durationValues?.length
          ? durationValues[durationDraft]
          : normalizeDuration(durationDraft);
    useEffect(() => {
        setDurationDraft(null);
    }, [sliderCurrent]);
    const commitDurationDraft = (value?: number) => {
        const draft = value ?? durationDraft;
        if (draft === null || draft === undefined) return;
        const seconds = durationValues?.length ? durationValues[draft] : normalizeDuration(draft);
        setDurationDraft(null);
        onChange({ seconds });
    };
    const selectedSize = capability === "image" ? preferences.image?.size || "auto" : preferences.video?.size || "auto";
    const selectedQuality = capability === "image" ? generationImageQualitySelection(preferences.image?.quality, qualityOptions) : resolveVideoQualitySelection(preferences.video?.quality, qualityOptions);
    const selectedImageQuality = generationImageQualitySelection(preferences.image?.quality, imageQualities);
    const selectedImageResolution = preferences.image?.resolution || imageResolutions[0]?.value || "1K";
    const selectedSizeMode = preferences.image?.sizeMode || "auto";
    const selectedCount = capability === "image" ? preferences.image?.count || 1 : preferences.video?.count || 1;
    const standardRatios = ratios.filter((ratio) => !parseCustomDimensions(ratio.value));
    const pixelSizes = ratios.filter((ratio) => parseCustomDimensions(ratio.value));

    if (capability === "audio") {
        return (
            <div className="grid grid-cols-2 gap-1.5">
                <PreferenceSelect label="音色" ariaLabel="选择音色" value={preferences.audio?.voice || "alloy"} options={audioVoiceOptions} onChange={(voice) => onChange({ voice })} />
                <PreferenceSelect label="格式" ariaLabel="选择音频格式" value={preferences.audio?.format || "mp3"} options={audioFormatOptions} onChange={(format) => onChange({ format })} />
                <PositiveNumberField className="col-span-2" label="语速" ariaLabel="输入音频语速" value={preferences.audio?.speed || 1} suffix="x" onChange={(speed) => onChange({ speed })} />
            </div>
        );
    }

    return (
        <div className={cn("grid min-w-0", compact ? "gap-1.5" : "gap-2.5")}>
            <div className={cn("grid min-w-0", compact ? "gap-1.5" : "gap-2.5")}>
                {hideVideoReference ? null : capability === "video" && videoReferenceContent ? (
                    videoReferenceContent
                ) : capability === "video" ? (
                    <CompactOptionGroup label="参考方式" ariaLabel="选择视频参考方式" value={preferences.video?.referenceMode || "reference"} options={videoReferenceModeOptions} columns={3} onChange={(referenceMode) => onChange({ referenceMode })} />
                ) : null}
                {capability === "image" && imageOptions ? (
                    <div className={cn("grid min-w-0", compact ? "gap-1.5" : "gap-2")}>
                        <CompactOptionGroup
                            label="尺寸"
                            ariaLabel="选择图片尺寸"
                            value={selectedSizeMode === "auto" ? "auto" : selectedSizeMode === "custom" ? (pixelSizes.some((option) => option.value === selectedSize) ? selectedSize : "custom") : selectedSize}
                            options={[
                                ...(imageOptions.sizeModes?.includes("auto") ? [{ value: "auto", label: "自动", icon: <Sparkles className="size-3.5 shrink-0" /> }] : []),
                                ...(imageOptions.sizeModes?.includes("ratio")
                                    ? ratios.filter((option) => option.value !== "auto" && !parseCustomDimensions(option.value)).map((option) => ({ value: option.value, label: option.label, icon: ratioPreviewIcon(option) }))
                                    : []),
                                ...(imageOptions.sizeModes?.includes("custom") ? pixelSizes.map((option) => ({ value: option.value, label: formatSizeLabel(option.value, "image") })) : []),
                            ]}
                            columns={4}
                            onChange={(value) => onChange(value === "auto" ? { sizeMode: "auto", size: "auto" } : parseCustomDimensions(value) ? { sizeMode: "custom", size: value } : { sizeMode: "ratio", size: value })}
                        />
                        {imageOptions.sizeModes?.includes("ratio") && imageResolutions.length ? (
                            <CompactOptionGroup
                                label="分辨率"
                                ariaLabel="选择图片分辨率"
                                value={selectedImageResolution}
                                options={imageResolutions}
                                onChange={(resolution) =>
                                    onChange({
                                        sizeMode: "ratio",
                                        size: selectedSizeMode === "ratio" && !parseCustomDimensions(selectedSize) ? selectedSize : ratios.find((option) => option.value !== "auto" && !parseCustomDimensions(option.value))?.value || "1:1",
                                        resolution,
                                    })
                                }
                            />
                        ) : null}
                    </div>
                ) : fixedSizeLabel ? (
                    <div className="flex h-9 items-center justify-between rounded-lg bg-[#f5f6f7] px-3 text-[11px] dark:bg-[#24282e]">
                        <span className="font-medium text-[#7b8591] dark:text-[#98a2ae]">尺寸</span>
                        <span className="text-[#20242a] dark:text-white">{fixedSizeLabel}</span>
                    </div>
                ) : (
                    <div className="grid min-w-0 gap-1.5">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-[12px] font-medium text-[var(--ink-2)]">比例</p>
                            <span className="text-[11px] text-[var(--ink-3)]">{selectedSize === "auto" ? "智能" : formatSizeLabel(selectedSize, capability)}</span>
                        </div>
                        <div className="grid min-w-0 grid-cols-4 gap-1">
                            {standardRatios.map((ratio) => (
                                <button
                                    key={ratio.value}
                                    type="button"
                                    className={cn(
                                        "inline-flex min-w-0 items-center justify-center gap-1 rounded-lg px-1 text-[11px] transition",
                                        compact ? "h-8" : "h-9",
                                        selectedSize === ratio.value
                                            ? "bg-[var(--surface-panel)] font-medium text-[var(--ink-1)] shadow-[inset_0_0_0_1.5px_var(--ink-1)]"
                                            : "bg-[var(--surface-soft)] text-[var(--ink-2)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]",
                                    )}
                                    onClick={() => onChange({ size: ratio.value })}
                                    aria-label={`选择${capability === "image" ? "图片" : "视频"}比例 ${ratio.label}`}
                                    aria-pressed={selectedSize === ratio.value}
                                >
                                    <span className="grid h-4 w-5 shrink-0 place-items-center">
                                        {ratio.value === "auto" ? <Sparkles className="size-3.5" /> : <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: ratio.width * 0.64, height: ratio.height * 0.64 }} />}
                                    </span>
                                    <span>{ratio.label}</span>
                                </button>
                            ))}
                        </div>
                        {pixelSizes.length ? (
                            <CompactOptionGroup
                                label="尺寸"
                                ariaLabel={`选择${capability === "image" ? "图片" : "视频"}尺寸`}
                                value={selectedSize}
                                options={pixelSizes.map((option) => ({ value: option.value, label: formatSizeLabel(option.value, capability) }))}
                                columns={2}
                                onChange={(size) => onChange({ size })}
                            />
                        ) : null}
                    </div>
                )}
            </div>
            <div className={cn("grid", compact ? "gap-1.5" : "gap-2.5")}>
                {capability === "image" && imageOptions ? (
                    imageQualities.length ? (
                        <CompactOptionGroup label="画质" ariaLabel="选择图片画质" value={selectedImageQuality} options={imageQualities} onChange={(quality) => onChange({ quality })} />
                    ) : null
                ) : capability === "video" ? (
                    <VideoQualityField value={selectedQuality} options={qualityOptions} allowCustom={!capabilityProfile?.resolutions?.length} onChange={(quality) => onChange({ quality })} />
                ) : (
                    <CompactOptionGroup label="画质" ariaLabel="选择图片画质" value={selectedQuality} options={qualityOptions} onChange={(quality) => onChange({ quality })} />
                )}
                {showCount && !(capability === "image" && imageOptions) ? <GenerationCountGroup key={capability} capability={capability} value={selectedCount} maxCount={capabilityProfile?.maxBatchSize} onChange={(count) => onChange({ count })} /> : null}
                {capability === "image" && imageOptions ? (
                    <ImageAdvancedOptions preferences={preferences.image || {}} options={imageOptions} count={selectedCount} maxCount={capabilityProfile?.maxBatchSize} showCount={showCount} onChange={onChange} />
                ) : null}
                {capability === "video" ? (
                    <>
                        <label className={cn("grid text-xs", compact ? "gap-1.5" : "gap-2")}>
                            时长
                            <div className="flex items-center gap-3">
                                <input
                                    aria-label="拖动视频时长"
                                    type="range"
                                    min={durationValues?.length ? 0 : durationMin}
                                    max={durationValues?.length ? durationValues.length - 1 : durationMax}
                                    step={1}
                                    value={sliderValue}
                                    className="min-w-0 flex-1"
                                    onChange={(event) => setDurationDraft(Number(event.target.value))}
                                    onPointerUp={(event) => commitDurationDraft(Number(event.currentTarget.value))}
                                    onPointerCancel={(event) => commitDurationDraft(Number(event.currentTarget.value))}
                                    onKeyUp={(event) => commitDurationDraft(Number(event.currentTarget.value))}
                                    onBlur={(event) => commitDurationDraft(Number(event.currentTarget.value))}
                                />
                                <span className="inline-flex items-center gap-1">
                                    <input
                                        aria-label="输入视频时长"
                                        type="number"
                                        min={durationMin}
                                        max={durationMax}
                                        value={displayedDuration}
                                        className="w-14 rounded-md border border-current/20 bg-transparent px-2 py-1"
                                        onChange={(event) => {
                                            if (!event.target.value) return;
                                            setDurationDraft(null);
                                            onChange({ seconds: normalizeDuration(Number(event.target.value)) });
                                        }}
                                    />
                                    s
                                </span>
                            </div>
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[#e3e8ec] bg-[#fafbfc] p-2 dark:border-[#343b44] dark:bg-[#1f242a]">
                            <SwitchPreference label="生成声音" checked={preferences.video?.generateAudio ?? true} onChange={(generateAudio) => onChange({ generateAudio })} />
                            <SwitchPreference label="添加水印" checked={preferences.video?.watermark ?? false} onChange={(watermark) => onChange({ watermark })} />
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
}

function ImageAdvancedOptions({
    preferences,
    options,
    count,
    maxCount,
    showCount,
    onChange,
}: {
    preferences: NonNullable<CreativeGenerationPreferences["image"]>;
    options: NonNullable<CreativeModelCapabilityProfile["imageOptions"]>;
    count: number;
    maxCount?: number;
    showCount: boolean;
    onChange: (patch: CreativeGenerationPreferencePatch) => void;
}) {
    const countOptions = generationCountSelectionOptions(maxCount, count);
    const countSelect = showCount ? <PreferenceSelect label="数量" ariaLabel="选择图片生成数量" value={count} options={countOptions} onChange={(nextCount) => onChange({ count: nextCount })} /> : null;
    const hasTransparentToggle = options.backgrounds?.includes("transparent") && options.backgrounds.includes("opaque") && !options.backgrounds.includes("auto");
    const transparencyToggle = (
        <SwitchPreference
            label="透明背景"
            checked={(preferences.background || options.backgrounds?.[0]) === "transparent"}
            onChange={(checked) => onChange({ background: checked ? "transparent" : options.backgrounds?.includes("opaque") ? "opaque" : "auto" })}
        />
    );

    return (
        <div className="grid grid-cols-2 gap-1.5">
            {options.styles?.length ? (
                <PreferenceSelect label="风格" ariaLabel="选择图片风格" value={preferences.style || options.styles[0]} options={options.styles.map((value) => ({ value, label: value }))} onChange={(style) => onChange({ style })} />
            ) : null}
            {options.outputFormats?.length ? (
                <PreferenceSelect
                    label="格式"
                    ariaLabel="选择图片输出格式"
                    value={preferences.outputFormat || options.outputFormats[0]}
                    options={options.outputFormats.map((value) => ({ value, label: value.toUpperCase() }))}
                    onChange={(outputFormat) => onChange({ outputFormat })}
                />
            ) : null}
            {options.moderations?.length ? (
                <PreferenceSelect
                    label="审核"
                    ariaLabel="选择图片审核模式"
                    value={preferences.moderation || options.moderations[0]}
                    options={options.moderations.map((value) => ({ value, label: value }))}
                    onChange={(moderation) => onChange({ moderation })}
                />
            ) : null}
            {options.responseFormats?.length ? (
                <PreferenceSelect
                    label="响应"
                    ariaLabel="选择图片响应格式"
                    value={preferences.responseFormat || options.responseFormats[0]}
                    options={options.responseFormats.map((value) => ({ value, label: value }))}
                    onChange={(responseFormat) => onChange({ responseFormat: responseFormat as "url" | "b64_json" })}
                />
            ) : null}
            {hasTransparentToggle ? (
                <>
                    {showCount ? transparencyToggle : <div className="col-span-2">{transparencyToggle}</div>}
                    {countSelect}
                </>
            ) : options.backgrounds?.length ? (
                <PreferenceSelect label="背景" ariaLabel="选择图片背景" value={preferences.background || options.backgrounds[0]} options={options.backgrounds.map((value) => ({ value, label: value }))} onChange={(background) => onChange({ background })} />
            ) : null}
            {!hasTransparentToggle ? countSelect : null}
        </div>
    );
}

function imageQualityShortLabel(value: string) {
    return ({ auto: "自动", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高", standard: "标准" } as Record<string, string>)[value.toLowerCase()] || value;
}

function GenerationCountGroup({ capability, value, maxCount, onChange }: { capability: Extract<MediaCapability, "image" | "video">; value: number; maxCount?: number; onChange: (value: number) => void }) {
    const options = maxCount ? generationCountOptions.filter((option) => option.value <= maxCount) : generationCountOptions;
    const allowCustom = !maxCount || maxCount > generationCountOptions.length;
    const customSelected = !options.some((option) => option.value === value);
    const [draft, setDraft] = useState(customSelected ? String(value) : "");
    const [error, setError] = useState("");
    const lastEmittedValueRef = useRef(value);

    useEffect(() => {
        if (value !== lastEmittedValueRef.current) setDraft(options.some((option) => option.value === value) ? "" : String(value));
        setError("");
        lastEmittedValueRef.current = value;
    }, [value]);

    const changeDraft = (next: string) => {
        const normalized = next.replace(/[^0-9]/g, "");
        const count = normalizeGenerationCount(normalized);
        setDraft(count && options.some((option) => option.value === count) ? "" : normalized);
        setError(normalized && (!count || Boolean(maxCount && count > maxCount)) ? (maxCount ? `最多生成 ${maxCount} 份` : "请输入正整数") : "");
        if (count && (!maxCount || count <= maxCount)) {
            lastEmittedValueRef.current = count;
            onChange(count);
        }
    };

    return (
        <div className="grid gap-1.5">
            <p className="text-[12px] font-medium text-[var(--ink-2)]">数量</p>
            <div className="grid gap-1" style={optionGridStyle(options.length + (allowCustom ? 1 : 0))} role="group" aria-label={`选择${capability === "image" ? "图片" : "视频"}生成数量`}>
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        className={cn(
                            "h-8 min-w-0 rounded-lg px-1 text-[11px] transition",
                            value === option.value
                                ? "bg-[var(--surface-panel)] font-medium text-[var(--ink-1)] shadow-[inset_0_0_0_1.5px_var(--ink-1)]"
                                : "bg-[var(--surface-soft)] text-[var(--ink-2)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]",
                        )}
                        onClick={() => {
                            setDraft("");
                            setError("");
                            lastEmittedValueRef.current = option.value;
                            onChange(option.value);
                        }}
                        aria-label={`选择${capability === "image" ? "图片" : "视频"}生成数量 ${option.label}`}
                        aria-pressed={value === option.value}
                    >
                        {option.label}
                    </button>
                ))}
                {allowCustom ? (
                    <label
                        className={cn(
                            "relative h-8 min-w-0 rounded-lg text-[11px] transition",
                            customSelected
                                ? "bg-[var(--surface-panel)] font-medium text-[var(--ink-1)] shadow-[inset_0_0_0_1.5px_var(--ink-1)]"
                                : "bg-[var(--surface-soft)] text-[var(--ink-2)] focus-within:bg-[var(--surface-panel)] focus-within:text-[var(--ink-1)] focus-within:shadow-[inset_0_0_0_1.5px_var(--ink-3)] hover:bg-[var(--surface-inset)]",
                        )}
                        title="输入正整数，修改后立即生效"
                    >
                        <input
                            aria-label="自定义生成数量"
                            inputMode="numeric"
                            type="text"
                            value={draft}
                            onChange={(event) => changeDraft(event.target.value)}
                            placeholder="自定义"
                            className="size-full min-w-0 bg-transparent px-1 text-center text-[11px] font-medium outline-none placeholder:font-normal placeholder:text-current"
                        />
                        {draft ? <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[9px] opacity-70">份</span> : null}
                    </label>
                ) : null}
            </div>
            {error ? <p className="text-[10px] text-[#b85c5c] dark:text-[#e39a9a]">{error}</p> : null}
        </div>
    );
}

function optionGridStyle(itemCount: number) {
    return { gridTemplateColumns: `repeat(${Math.max(1, Math.min(itemCount, 5))}, minmax(0, 1fr))` };
}

export function normalizeGenerationCount(value: string | number) {
    const normalized = String(value).trim();
    if (!/^\d+$/.test(normalized)) return 0;
    const count = Number(normalized);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

export function generationCountSelectionOptions(maxCount?: number, currentCount = 1) {
    const optionCount = maxCount && Number.isSafeInteger(maxCount) && maxCount > 0 ? maxCount : generationCountOptions.length;
    const options = Array.from({ length: optionCount }, (_, index) => ({ value: index + 1, label: `${index + 1} 份` }));
    if (!maxCount && normalizeGenerationCount(currentCount) && !options.some((option) => option.value === currentCount)) {
        options.push({ value: currentCount, label: `${currentCount} 份` });
    }
    return options;
}

function CompactOptionGroup<T extends string | number>({
    label,
    ariaLabel,
    value,
    options,
    columns = 4,
    onChange,
}: {
    label: string;
    ariaLabel: string;
    value: T;
    options: readonly { value: T; label: string; shortLabel?: string; icon?: ReactNode }[];
    columns?: 2 | 3 | 4;
    onChange: (value: T) => void;
}) {
    return (
        <div className="grid gap-1.5">
            <p className="text-[12px] font-medium text-[var(--ink-2)]">{label}</p>
            <div className={cn("grid gap-1.5", columns === 2 ? "grid-cols-2" : columns === 3 ? "grid-cols-3" : "grid-cols-4")} role="group" aria-label={ariaLabel}>
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        className={cn(
                            "h-9 min-w-0 rounded-[10px] px-1 text-[12px] transition-[background-color,box-shadow,color] duration-150",
                            option.icon ? "inline-flex items-center justify-center gap-1" : "",
                            /* 选中：白底 + 深色描边（与首页快捷 Skill 的选中语言一致）；未选：浅灰底 */
                            value === option.value
                                ? "bg-[var(--surface-panel)] font-medium text-[var(--ink-1)] shadow-[inset_0_0_0_1.5px_var(--ink-1)]"
                                : "bg-[var(--surface-soft)] text-[var(--ink-2)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]",
                        )}
                        onClick={() => onChange(option.value)}
                        aria-label={`${ariaLabel} ${option.label}`}
                        aria-pressed={value === option.value}
                    >
                        {option.icon}
                        {option.shortLabel || option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function PreferenceSelect<T extends string | number>({ label, ariaLabel, value, options, onChange }: { label: string; ariaLabel: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
    return (
        <label className="grid min-w-0 gap-0.5 rounded-lg bg-[#f5f6f7] px-2 py-1 text-[10px] text-[#8b949f] dark:bg-[#24282e] dark:text-[#7f8996]">
            {label}
            <Select size="small" variant="borderless" className="w-full" value={value} options={[...options]} onChange={onChange} aria-label={ariaLabel} placement="topLeft" />
        </label>
    );
}

function PreferenceSummaryIcon({ capability, preferences }: { capability: MediaCapability; preferences: CreativeGenerationPreferences }) {
    if (capability === "audio") return <AudioLines className="size-4" />;
    const size = capability === "image" ? preferences.image?.size : preferences.video?.size;
    const ratio = (capability === "image" ? imageRatios : videoRatios).find((item) => item.value === size);
    const custom = ratio ? null : parseCustomDimensions(size);
    if (custom) {
        return (
            <span className="grid size-4 place-items-center" aria-hidden="true">
                <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: Math.max(8, Math.min(14, (Number(custom[0]) / Number(custom[1])) * 10)), height: Math.max(7, Math.min(14, (Number(custom[1]) / Number(custom[0])) * 10)) }} />
            </span>
        );
    }
    if (!ratio || ratio.value === "auto") return <Sparkles className="size-4" />;
    return (
        <span className="grid size-4 place-items-center" aria-hidden="true">
            <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: Math.max(8, ratio.width * 0.55), height: Math.max(7, ratio.height * 0.55) }} />
        </span>
    );
}

export function generationPreferenceSummary(capability: MediaCapability, preferences: CreativeGenerationPreferences, capabilityProfile?: CreativeModelCapabilityProfile) {
    if (capability === "audio") return `${audioVoiceLabel(preferences.audio?.voice || "alloy")} · ${audioFormatLabel(preferences.audio?.format || "mp3")} · ${preferences.audio?.speed || 1}x`;
    const size = capability === "image" ? preferences.image?.size || "auto" : preferences.video?.size || "auto";
    const quality = capability === "image" ? preferences.image?.quality || "auto" : preferences.video?.quality || "auto";
    const count = capability === "image" ? preferences.image?.count || 1 : preferences.video?.count || 1;
    const countLabel = count > 1 ? ` · ${count}${capability === "image" ? "张" : "条"}` : "";
    const sizeLabel = size === "auto" ? "智能比例" : formatSizeLabel(size, capability);
    if (capability === "image" && capabilityProfile?.imageOptions) {
        const image = preferences.image;
        const mode = image?.sizeMode || "auto";
        const imageSize = mode === "auto" ? "自动尺寸" : mode === "custom" ? formatSizeLabel(size, "image") : `${image?.resolution || capabilityProfile.imageOptions.resolutions?.[0] || ""} · ${sizeLabel}`;
        const qualityOptions = generationImageQualityOptions(capabilityProfile);
        const quality = imageQualityLabel(generationImageQualitySelection(image?.quality, qualityOptions));
        return `${imageSize} · ${quality}${countLabel}`;
    }
    const imageQuality = capability === "image" ? generationImageQualitySelection(preferences.image?.quality, generationResolutionOptions("image", capabilityProfile)) : undefined;
    const qualityLabel = capability === "image" ? imageQualityOptions.find((item) => item.value === imageQuality)?.label || imageQualityLabel(imageQuality || quality) : videoQualityLabel(quality);
    const referenceLabel = capability === "video" ? videoReferenceModeOptions.find((item) => item.value === (preferences.video?.referenceMode || "reference"))?.label : undefined;
    if (capability === "image") return size === "auto" && quality === "auto" ? `智能参数${countLabel}` : `${sizeLabel} · ${qualityLabel}${countLabel}`;
    const parameterLabel = size === "auto" && quality === "auto" ? "智能参数" : `${sizeLabel} · ${qualityLabel}`;
    const audioLabel = (preferences.video?.generateAudio ?? true) ? "有声" : "无声";
    const watermarkLabel = (preferences.video?.watermark ?? false) ? "带水印" : "无水印";
    const defaultSeconds = generationDurationOptions(capabilityProfile)[0]?.value || capabilityProfile?.minDurationSeconds || 5;
    return `${parameterLabel} · ${preferences.video?.seconds ?? defaultSeconds}秒 · ${audioLabel} · ${watermarkLabel}${referenceLabel && referenceLabel !== "智能参考" ? ` · ${referenceLabel}` : ""}${countLabel}`;
}

export function imageQualityLabel(value: string) {
    return ({ auto: "自动", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高", standard: "标准" } as Record<string, string>)[value.toLowerCase()] || value;
}

export function resolveVideoQualitySelection(value: string | undefined, options: ResolutionOption[]) {
    const current = (value || "").trim();
    if (options.length) {
        const matched = options.find((option) => normalizeResolution(option.value) === normalizeResolution(current));
        return matched?.value || options[0].value;
    }
    return current || "auto";
}

function videoQualityLabel(value: string) {    const preset = videoQualityOptions.find((item) => item.value === value)?.label;
    if (preset) return preset;
    return /^\d+$/.test(value) ? `${value}P` : value;
}

function parseCustomDimensions(value?: string) {
    const match = typeof value === "string" ? value.trim().match(/^(\d+)x(\d+)$/i) : null;
    if (!match || !normalizeDimension(match[1]) || !normalizeDimension(match[2])) return null;
    return [match[1], match[2]] as const;
}

function normalizeDimension(value: string) {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return "";
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : "";
}

function formatSizeLabel(value: string, capability: Extract<MediaCapability, "image" | "video">) {
    const preset = (capability === "image" ? imageRatios : videoRatios).find((item) => item.value === value);
    if (preset) return preset.label;
    const dimensions = parseCustomDimensions(value);
    return dimensions ? `${dimensions[0]}×${dimensions[1]}` : value;
}

export function mediaCapabilityLabel(capability: MediaCapability) {
    return capability === "image" ? "图片" : capability === "video" ? "视频" : "音频";
}

export function CreativeModeIcon({ mode }: { mode: "agent" | MediaCapability }) {
    if (mode === "image") return <ImageIcon className="size-4" />;
    if (mode === "video") return <Video className="size-4" />;
    if (mode === "audio") return <AudioLines className="size-4" />;
    return <Lightbulb className="size-4" />;
}

export const creativeModeOptions = [
    { value: "agent", label: "Agent 模式", description: "自动理解需求并匹配能力" },
    { value: "image", label: "图片生成", description: "生成或编辑图片" },
    { value: "video", label: "视频生成", description: "文生视频或图生视频" },
    { value: "audio", label: "音频生成", description: "配音、旁白和音频" },
] as const;
