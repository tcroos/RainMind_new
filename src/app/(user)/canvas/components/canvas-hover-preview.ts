export const CANVAS_HOVER_PREVIEW_DELAY_MS = 250;
// A 320px WebP normally arrives well under a second. Anything still pending after this
// long is treated as failed so one stalled request cannot hold one of the limited slots.
const PRELOAD_TIMEOUT_MS = 15_000;
const preloadedPreviewUrls = new Set<string>();
const pendingPreviewUrls = new Set<string>();
const previewQueue: string[] = [];
const MAX_CONCURRENT_PRELOADS = 6;
let activePreloads = 0;

export function preloadCanvasHoverPreview(src: string) {
    if (typeof Image === "undefined" || !src || preloadedPreviewUrls.has(src) || pendingPreviewUrls.has(src)) return;
    pendingPreviewUrls.add(src);
    previewQueue.push(src);
    void drainPreviewQueue();
}

function drainPreviewQueue() {
    while (activePreloads < MAX_CONCURRENT_PRELOADS && previewQueue.length) {
        const src = previewQueue.shift()!;
        activePreloads += 1;
        const image = new Image();
        let settled = false;
        let timerId: ReturnType<typeof setTimeout> | null = null;
        const finish = (loaded: boolean) => {
            if (settled) return;
            settled = true;
            if (timerId !== null) clearTimeout(timerId);
            activePreloads -= 1;
            pendingPreviewUrls.delete(src);
            if (loaded) preloadedPreviewUrls.add(src);
            drainPreviewQueue();
        };
        timerId = setTimeout(() => finish(false), PRELOAD_TIMEOUT_MS);
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.src = src;
    }
}

export function scheduleCanvasHoverPreview(callback: () => void) {
    const timer = setTimeout(callback, CANVAS_HOVER_PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
}
