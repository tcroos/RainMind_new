"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type VideoModelTier = "official" | "stable" | "value";
export type VideoTierOption = { value: string; label: string };

type Props = {
    value: string;
    options: ReadonlyArray<VideoTierOption>;
    themeText: string;
    activeBackground: string;
    onChange: (value: string) => void;
};

export function CanvasVideoTierPicker({ value, options, themeText, activeBackground, onChange }: Props) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const currentLabel = options.find((option) => option.value === value)?.label || options[0]?.label || "档位";

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element) || triggerRef.current?.contains(target) || target.closest("[data-video-tier-menu]")) return;
            setOpen(false);
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [open]);

    useEffect(() => {
        const closeOther = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== id) setOpen(false);
        };
        window.addEventListener("video-tier-picker-open", closeOther);
        return () => window.removeEventListener("video-tier-picker-open", closeOther);
    }, [id]);

    useEffect(() => {
        if (!open) {
            setMenuPosition(null);
            return;
        }
        const place = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect) setMenuPosition({ left: rect.left, top: rect.top - 8 });
        };
        place();
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => {
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", place, true);
        };
    }, [open]);

    return (
        <div className="relative shrink-0">
            <button
                ref={triggerRef}
                type="button"
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-medium"
                style={{ color: themeText, background: open ? activeBackground : undefined }}
                aria-label={`模型档位：${currentLabel}`}
                aria-expanded={open}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                    const next = !open;
                    if (next) window.dispatchEvent(new CustomEvent("video-tier-picker-open", { detail: id }));
                    setOpen(next);
                }}
            >
                {currentLabel}
                <ChevronDown className="size-3.5" aria-hidden />
            </button>
            {open && menuPosition && typeof document !== "undefined"
                ? createPortal(
                      <div
                          data-video-tier-menu
                          role="listbox"
                          aria-label="模型档位"
                          className="z-[1200] w-auto min-w-[9.75rem] max-w-[18rem] overflow-hidden rounded-xl border border-border/70 bg-popover p-1 text-popover-foreground shadow-xl"
                          style={{ position: "fixed", left: menuPosition.left, top: menuPosition.top, transform: "translateY(-100%)" }}
                          onPointerDown={(event) => event.stopPropagation()}
                      >
                          {options.map((option) => (
                              <button
                                  key={option.value}
                                  type="button"
                                  role="option"
                                  aria-selected={value === option.value}
                                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm leading-5 transition-colors hover:bg-[#edf0f2] dark:hover:bg-[#30363e] ${value === option.value ? "font-semibold" : ""}`}
                                  style={{ fontSize: "14px", lineHeight: "20px", fontWeight: value === option.value ? 600 : 400, color: themeText, ...(value === option.value ? { backgroundColor: activeBackground } : {}) }}
                                  onClick={() => {
                                      onChange(option.value);
                                      setOpen(false);
                                  }}
                              >
                                  <span className="min-w-0 whitespace-nowrap">{option.label}</span>
                                  {value === option.value ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
                              </button>
                          ))}
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}
