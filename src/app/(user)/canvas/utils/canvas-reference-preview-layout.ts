export type ReferencePreviewSize = { width: number; height: number };
export type ReferencePreviewPlacement = "above" | "below";

export const REFERENCE_PREVIEW_MAX = { width: 220, height: 160 } as const;
export const REFERENCE_PREVIEW_PADDING = 5;
const REFERENCE_PREVIEW_MARGIN = 8;

/**
 * Fit an image into the preview box without ever enlarging it.
 *
 * The box is 220x160 and the smallest scale factor wins, so wide images hit the width
 * cap first. These results are intentional; do not "fix" 16:9 to 160x90:
 *   9:16  (180x320)  -> 90x160
 *   4:3   (320x240)  -> 213x160
 *   1:1   (100x100)  -> 100x100
 *   16:9  (320x180)  -> 220x124
 */
export function computeReferencePreviewSize(
    naturalWidth: unknown,
    naturalHeight: unknown,
    max: ReferencePreviewSize = REFERENCE_PREVIEW_MAX,
): ReferencePreviewSize {
    const width = Number(naturalWidth);
    const height = Number(naturalHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        const fallbackScale = Math.min(max.width / 4, max.height / 3);
        return { width: Math.max(1, Math.round(4 * fallbackScale)), height: Math.max(1, Math.round(3 * fallbackScale)) };
    }
    const scale = Math.min(max.width / width, max.height / height, 1);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function computeReferencePreviewAnchor(
    rect: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">,
    imageSize: ReferencePreviewSize,
    viewport: { width: number; height: number },
    options: { placement?: ReferencePreviewPlacement; margin?: number; padding?: number } = {},
) {
    const padding = options.padding ?? REFERENCE_PREVIEW_PADDING;
    const margin = options.margin ?? REFERENCE_PREVIEW_MARGIN;
    const cardWidth = imageSize.width + padding * 2;
    const cardHeight = imageSize.height + padding * 2;
    const center = rect.left + rect.width / 2;
    const left = Math.min(Math.max(center - cardWidth / 2, margin), Math.max(margin, viewport.width - cardWidth - margin));

    const preferred = options.placement ?? "above";
    const aboveTop = rect.top - cardHeight - margin;
    const belowTop = rect.bottom + margin;
    const canShowAbove = aboveTop >= margin;
    const canShowBelow = belowTop + cardHeight <= viewport.height - margin;
    const placement: ReferencePreviewPlacement = preferred === "above"
        ? (canShowAbove || !canShowBelow ? "above" : "below")
        : (canShowBelow || !canShowAbove ? "below" : "above");
    const top = placement === "above" ? Math.max(margin, aboveTop) : Math.min(belowTop, Math.max(margin, viewport.height - cardHeight - margin));

    return { left, top, placement, cardWidth, cardHeight };
}
