"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { modelOptionLabel, modelUserNote, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { videoModelFamily } from "@/lib/video-model-family";
type Props = {
    config: AiConfig;
    value: string;
    models: readonly string[];
    referenceModels?: readonly string[];
    capability?: ModelCapability;
    themeText: string;
    activeBackground: string;
    panelBackground?: string;
    borderColor?: string;
    onChange: (model: string) => void;
};
type ModelGroup = {
    key: string;
    label: string;
    models: string[];
    order?: number;
};
const OTHER_MODEL_KEY = "__other__";
const RESOLUTION_OR_VARIANT_SUFFIX = /(?:-(?:480|720|1080|2k|4k|768p|1440p)(?:p)?|-(?:max|vip|tg|official|native|stable|value|request|realistic|video))+$/i;
function fallbackGroup(model: string) {
    if (/^minimax-h3-max$/i.test(model)) return { key: "minimax-h3-max", label: "MiniMax H3 max" };
    if (/^wan(?:3\.0|3)(?:-|$)/i.test(model)) return { key: "wan3.0", label: "Wan 3.0" };
    return { key: OTHER_MODEL_KEY, label: "其他模型" };
}
function modelGroup(config: AiConfig, model: string) {
    const logical = config.logicalModels.find((item) => item.id.toLowerCase() === model.toLowerCase());
    if (logical?.group?.trim()) {
        return { key: `group:${logical.group.trim().toLowerCase()}`, label: logical.group.trim(), order: logical.groupOrder, explicit: true };
    }
    const base = model.toLowerCase().replace(RESOLUTION_OR_VARIANT_SUFFIX, "");
    const baseFamily = /^minimax-h3-max$/i.test(model) ? undefined : videoModelFamily(base);
    const family = videoModelFamily(model) || baseFamily;
    const fallback = family ? null : fallbackGroup(model);
    return {
        key: family?.id || fallback?.key || base,
        label: family?.name || fallback?.label || modelOptionLabel(config, model).replace(/\s*(?:\([^)]*\)|（[^）]*）)\s*$/u, "").trim() || model,
        order: logical?.groupOrder,
    };
}
export function groupVideoModels(config: AiConfig, models: readonly string[], referenceModels: readonly string[] = []): ModelGroup[] {
    const reference = new Map<string, ModelGroup>();
    for (const model of referenceModels) {
        const group = modelGroup(config, model);
        if (!reference.has(group.key)) reference.set(group.key, { ...group, models: [] });
    }
    const groups = new Map<string, ModelGroup>();
    const explicitOnly = models.some((model) => modelGroup(config, model).explicit);
    for (const model of models) {
        const resolved = modelGroup(config, model);
        const key = explicitOnly
            ? resolved.explicit
                ? resolved.key
                : OTHER_MODEL_KEY
            : resolved.explicit || reference.size === 0 || reference.has(resolved.key)
              ? resolved.key
              : OTHER_MODEL_KEY;
        const label = key === OTHER_MODEL_KEY ? "其他模型" : reference.get(key)?.label || resolved.label;
        const existing = groups.get(key);
        if (existing) {
            existing.models.push(model);
        } else {
            groups.set(key, { key, label, models: [model], order: resolved.order });
        }
    }
    const referenceOrder = new Map(Array.from(reference.keys()).map((key, index) => [key, index]));
    return Array.from(groups.values())
        .filter((group) => group.key !== OTHER_MODEL_KEY)
        .sort((left, right) => {
            const leftOrder = left.order ?? referenceOrder.get(left.key);
            const rightOrder = right.order ?? referenceOrder.get(right.key);
            return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
        });
}
export function CanvasVideoGroupedModelPicker({ config, value, models, referenceModels = [], capability = "video", themeText, activeBackground, panelBackground, borderColor, onChange }: Props) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [activeKey, setActiveKey] = useState("");
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
    const [notePopup, setNotePopup] = useState<{ text: string; left: number; top: number } | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const groups = useMemo(() => groupVideoModels(config, models, referenceModels), [config, models, referenceModels]);
    const currentGroup = groups.find((group) => group.models.includes(value)) || groups[0];
    const activeGroup = groups.find((group) => group.key === activeKey) || currentGroup;
    const currentLabel = value ? modelOptionLabel(config, value) : "选择模型";
    useEffect(() => {
        if (!open) {
            setPosition(null);
            return;
        }
        setActiveKey(currentGroup?.key || "");
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = 400;
        setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: rect.top - 8 });
        // Keep the popup anchored for its whole lifetime. Re-positioning on
        // scroll/resize made it follow canvas panning and looked like jumping.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element) || triggerRef.current?.contains(target) || target.closest(`[data-canvas-video-grouped-menu="${id}"]`)) return;
            setOpen(false);
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [id, open]);
    useEffect(() => {
        if (!open) return;
        const closeOther = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== id) setOpen(false);
        };
        window.addEventListener("canvas-video-grouped-picker-open", closeOther);
        return () => window.removeEventListener("canvas-video-grouped-picker-open", closeOther);
    }, [id, open]);
    const select = (model: string) => {
        onChange(model);
        setOpen(false);
    };

    const showNote = (event: React.MouseEvent<HTMLElement>, text: string, anchor: "group" | "model") => {
        if (!text.trim()) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const width = 240;
        const panelRight = (position?.left ?? rect.left) + 400;
        let left = anchor === "group" ? panelRight + 8 : rect.right + 8;
        if (left + width > window.innerWidth - 12) left = Math.max(12, rect.left - width - 8);
        const top = Math.max(12, Math.min(rect.top, window.innerHeight - 180));
        setNotePopup({ text, left, top });
    };
    return (
        <div className="relative shrink-0">
            <button
                ref={triggerRef}
                type="button"
                role="combobox"
                aria-label={value ? `模型：${currentLabel}` : "选择模型"}
                aria-expanded={open}
                className="canvas-composer-model-picker inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-medium"
                style={{ color: themeText, background: open ? activeBackground : undefined }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                    const next = !open;
                    if (next) window.dispatchEvent(new CustomEvent("canvas-video-grouped-picker-open", { detail: id }));
                    setOpen(next);
                }}
            >
                <span className="canvas-model-picker-text max-w-[12rem] truncate">{currentLabel}</span>
                <ChevronDown className="canvas-select-chevron size-3.5 shrink-0" aria-hidden />
            </button>
            {open && position && typeof document !== "undefined"
                ? createPortal(
                      <div
                          data-canvas-video-grouped-menu={id}
                          role="dialog"
                          aria-label="选择视频模型"
                          className="z-[1200] overflow-hidden rounded-xl border shadow-xl"
                          style={{ position: "fixed", left: position.left, top: position.top, transform: "translateY(-100%)", width: 400, height: 372, fontSize: 13, lineHeight: "21px", background: panelBackground || "var(--popover)", borderColor: borderColor || "var(--border)", color: themeText }}
                          onPointerDown={(event) => event.stopPropagation()}
                      >
                          <div className="flex h-full">
                              <div className="w-[11rem] shrink-0 border-r border-border/60 p-1.5">
                                  <div className="px-2 pb-1 pt-1 text-[11px] font-normal opacity-60">模型系列</div>
                                  <div className="h-[18.5rem] overflow-y-auto">
                                      {groups.map((group) => {
                                          const active = group.key === activeGroup?.key;
                                          const selected = group.models.includes(value);
                                          return (
                                              <button
                                                  key={group.key}
                                                  type="button"
                                                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left text-xs leading-5 transition-colors hover:bg-[#edf0f2] dark:hover:bg-[#30363e]"
                                                  style={{ color: themeText, background: active ? activeBackground : undefined }}
                                                  onMouseEnter={(event) => { setActiveKey(group.key); const note = group.models.map((model) => config.logicalModels.find((item) => item.id.toLowerCase() === model.toLowerCase())?.userNote?.trim()).find(Boolean) || ""; showNote(event, note, "group"); }}
                                                  onFocus={() => setActiveKey(group.key)}
                                                  onClick={() => setActiveKey(group.key)}
                                                  onPointerLeave={() => setNotePopup(null)}
                                              >
                                                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                                                  {selected ? <Check className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0 opacity-50" aria-hidden />}
                                              </button>
                                          );
                                      })}
                                  </div>
                              </div>
                              <div className="min-w-0 flex-1 p-1.5">
                                  <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
                                      <span className="truncate text-[11px] font-normal opacity-60">{activeGroup?.label || "选择档位"}</span>
                                      <span className="text-xs opacity-45">{activeGroup?.models.length || 0} 个</span>
                                  </div>
                                  <div className="h-[18.5rem] overflow-y-auto">
                                      {(activeGroup?.models || []).map((model) => {
                                          const selected = model === value;
                                          const note = modelUserNote(config, model);
                                          return (
                                              <button
                                                  key={model}
                                                  type="button"
                                                  role="option"
                                                  aria-selected={selected}
                                                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs leading-5 transition-colors hover:bg-[#edf0f2] dark:hover:bg-[#30363e]"
                                                  style={{ color: themeText, background: selected ? activeBackground : undefined }}
                                                  onPointerEnter={(event) => showNote(event, note, "model")}
                                                  onPointerLeave={() => setNotePopup(null)}
                                                  onClick={() => select(model)}
                                              >
                                                  <span className="min-w-0 flex-1 truncate">{modelOptionLabel(config, model)}</span>
                                                  {selected ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
                                              </button>
                                          );
                                      })}
                                  </div>
                              </div>
                          </div>
                      </div>,
                      document.body,
                  )
                : null}
            {open && notePopup && typeof document !== "undefined"
                ? createPortal(
                      <div
                          data-canvas-video-note-popup
                          role="tooltip"
                          className="pointer-events-none z-[1300] max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border px-3 py-2.5 text-xs leading-5 shadow-xl"
                          style={{ position: "fixed", left: notePopup.left, top: notePopup.top, width: 240, background: panelBackground || "var(--popover)", borderColor: borderColor || "var(--border)", color: themeText }}
                      >
                          {notePopup.text}
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}
