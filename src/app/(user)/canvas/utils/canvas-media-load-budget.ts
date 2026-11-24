export const CANVAS_MEDIA_LOW_ZOOM = 0.35;
export const CANVAS_MEDIA_MID_ZOOM = 0.7;

/** Keep a single canvas viewport from firing hundreds of media requests at once. */
export function canvasMediaLoadBudget(scale: number) {
    if (!Number.isFinite(scale)) return 0;
    // Low zoom is bounded by the 30% minimum; keep the original bounded batch.
    if (scale < CANVAS_MEDIA_LOW_ZOOM) return 80;
    if (scale < CANVAS_MEDIA_MID_ZOOM) return 40;
    return 80;
}

export type CanvasMediaLoadCandidate = {
    id: string;
    distance: number;
    forced: boolean;
};

/**
 * Pick which media ids may load for the current viewport.
 *
 * Selection/panel nodes are "forced" and always load, but they still consume the
 * same budget as viewport nodes. Previously forced ids bypassed the budget, so a
 * large selection could fan out unbounded media reads (716 image nodes -> 39 reads
 * in a 29-node viewport). Forced ids win when the budget is smaller than the forced
 * set; otherwise the nearest remaining candidates fill the rest.
 */
export function selectCanvasMediaLoadIds(scale: number, candidates: CanvasMediaLoadCandidate[]) {
    const ids = new Set<string>();
    const budget = canvasMediaLoadBudget(scale);
    if (budget <= 0) return ids;
    const ordered = [...candidates].sort((a, b) => Number(b.forced) - Number(a.forced) || a.distance - b.distance || a.id.localeCompare(b.id));
    for (const candidate of ordered) {
        if (ids.size >= budget) break;
        ids.add(candidate.id);
    }
    return ids;
}
