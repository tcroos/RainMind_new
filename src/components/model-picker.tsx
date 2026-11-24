"use client";

import { useEffect, useId, useMemo, useState, useRef } from "react";
import { Cpu, Check as CheckIcon } from "lucide-react";
import { Popover, Tooltip } from "antd";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { modelOptionLabel, modelOptionName, modelUserNote, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    allowedModels?: readonly string[];
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    showIcon?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    placement?: "topLeft" | "bottomLeft";
};

export function ModelPicker({ config, value, onChange, capability, allowedModels, className, fullWidth = false, placeholder = "选择模型", onMissingConfig, showIcon = true, open: controlledOpen, onOpenChange, placement = "bottomLeft" }: ModelPickerProps) {
    const pickerId = useId();
    const [localOpen, setLocalOpen] = useState(false);
    const open = controlledOpen ?? localOpen;
    const setOpen = (value: boolean) => {
        setLocalOpen(value);
        onOpenChange?.(value);
    };
    const triggerRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element) || triggerRef.current?.contains(target) || target.closest("[data-model-picker-menu]")) return;
            setOpen(false);
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [open]);
    const configuredOptions = useMemo(() => {
        const available = selectableModelsByCapability(config, capability);
        if (!allowedModels) return available;
        const allowed = new Set(allowedModels);
        return available.filter((model) => allowed.has(model));
    }, [allowedModels, capability, config]);
    const current = !capability || !value || configuredOptions.includes(value) ? value || "" : "";
    const options = useMemo(() => {
        const currentOption = !capability || !value || configuredOptions.includes(value) ? value : "";
        const extra = currentOption && !configuredOptions.includes(currentOption) ? [currentOption] : [];
        return [...extra, ...configuredOptions];
    }, [capability, configuredOptions, value]);
    const hasConfiguredOptions = configuredOptions.length > 0;

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    if (controlledOpen !== undefined)
        return (
            <Popover
                open={open}
                trigger="click"
                placement={placement}
                autoAdjustOverflow={false}
                arrow={false}
                onOpenChange={setOpen}
                content={
                    <div data-model-picker-menu role="listbox" className="max-h-64 min-w-40 overflow-y-auto">
                        {options.map((model) => {
                            const note = modelUserNote(config, model);
                            const option = (
                                <button
                                    key={model}
                                    role="option"
                                    aria-selected={current === model}
                                    type="button"
                                    className={cn(
                                        "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm leading-5 transition-colors hover:bg-[#edf0f2] dark:hover:bg-[#30363e]",
                                        current === model
                                            ? "bg-[#eaf1f5] font-medium text-[#315d78] dark:bg-[#2a3b46] dark:text-[#f3f5f7]"
                                            : "text-[#687481] dark:text-[#f3f5f7]",
                                    )}
                                    onClick={() => {
                                        onChange(model);
                                        setOpen(false);
                                    }}
                                >
                                    <span className="min-w-0 truncate">{modelOptionLabel(config, model)}</span>
                                    {current === model ? <CheckIcon className="size-3.5 shrink-0" aria-hidden /> : null}
                                </button>
                            );
                            return note ? (
                                <Tooltip key={model} placement="top" mouseEnterDelay={0.25} title={<span className="block max-w-[260px] whitespace-pre-wrap text-xs leading-5">{note}</span>}>
                                    {option}
                                </Tooltip>
                            ) : option;
                        })}
                    </div>
                }
            >
                <button
                    ref={triggerRef}
                    type="button"
                    role="combobox"
                    aria-label={current ? `模型：${modelOptionLabel(config, current)}` : placeholder}
                    aria-expanded={open}
                    className={cn("canvas-composer-model-picker inline-flex items-center gap-2 text-sm text-foreground", className)}
                    style={{ background: open ? "var(--canvas-control-active)" : undefined }}
                >
                    <span className="font-medium">{current ? modelOptionLabel(config, current) : placeholder}</span>
                    <span aria-hidden>⌄</span>
                </button>
            </Popover>
        );
    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !hasConfiguredOptions) {
                    setOpen(false);
                    onMissingConfig?.();
                    return;
                }
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                ref={triggerRef}
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                aria-label={current ? `模型：${modelOptionLabel(config, current)}` : placeholder}
            >
                {showIcon ? <ModelIcon model={current} /> : null}
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : placeholder}</span>
            </SelectTrigger>
            <SelectContent
                data-model-picker-menu
                data-canvas-no-zoom
                className="z-[1200] max-h-[min(18rem,calc(100vh-96px))] w-[min(20rem,var(--radix-select-content-available-width))] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-32px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side={placement === "topLeft" ? "top" : "bottom"}
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => (
                        <SelectItem key={model} value={model} textValue={modelOptionLabel(config, model)} className="bg-[#f5f6f7] text-[#687481] data-[state=checked]:bg-[#eaf1f5] data-[state=checked]:font-medium data-[state=checked]:text-[#315d78] dark:bg-[#24282e] dark:text-[#f3f5f7] dark:data-[state=checked]:bg-[#2a3b46] dark:data-[state=checked]:text-[#f3f5f7]">
                            {showIcon ? <ModelLabel config={config} model={model} /> : modelOptionLabel(config, model)}
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return `暂无匹配的${label}模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "请联系管理员在后台配置渠道和模型";
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{modelOptionLabel(config, model)}</span>
        </span>
    );
}

export function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm")) return "/icons/glm.svg";
    return "";
}
