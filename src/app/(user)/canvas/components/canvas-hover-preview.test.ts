import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockImageInstance = {
    src: string;
    onload: (() => void) | null;
    onerror: (() => void) | null;
};

const instances: MockImageInstance[] = [];

class MockImage {
    src = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
        instances.push(this as unknown as MockImageInstance);
    }
}

function resolve(index: number, loaded = true) {
    const image = instances[index];
    expect(image, `image ${index} was never created`).toBeDefined();
    if (loaded) image.onload?.();
    else image.onerror?.();
}

describe("canvas hover preview preload queue", () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        instances.length = 0;
        vi.stubGlobal("Image", MockImage);
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    async function load() {
        return await import("./canvas-hover-preview");
    }

    it("dedupes a src that is already pending or already loaded", async () => {
        const { preloadCanvasHoverPreview } = await load();
        preloadCanvasHoverPreview("/a.webp");
        preloadCanvasHoverPreview("/a.webp");
        expect(instances).toHaveLength(1);

        resolve(0, true);
        preloadCanvasHoverPreview("/a.webp");
        expect(instances).toHaveLength(1);
    });

    it("caps concurrent preloads at six", async () => {
        const { preloadCanvasHoverPreview } = await load();
        for (let index = 0; index < 10; index += 1) preloadCanvasHoverPreview(`/p${index}.webp`);
        expect(instances).toHaveLength(6);

        resolve(0, true);
        expect(instances).toHaveLength(7);
    });

    it("moves a successful src out of pending so it is never requested again", async () => {
        const { preloadCanvasHoverPreview } = await load();
        preloadCanvasHoverPreview("/ok.webp");
        resolve(0, true);
        preloadCanvasHoverPreview("/ok.webp");
        expect(instances).toHaveLength(1);
    });

    it("lets a failed src be retried", async () => {
        const { preloadCanvasHoverPreview } = await load();
        preloadCanvasHoverPreview("/bad.webp");
        resolve(0, false);
        preloadCanvasHoverPreview("/bad.webp");
        expect(instances).toHaveLength(2);
    });

    it("releases the slot and allows retry when a request never settles", async () => {
        const { preloadCanvasHoverPreview } = await load();
        for (let index = 0; index < 6; index += 1) preloadCanvasHoverPreview(`/stall${index}.webp`);
        expect(instances).toHaveLength(6);
        preloadCanvasHoverPreview("/queued.webp");
        expect(instances).toHaveLength(6);

        await vi.advanceTimersByTimeAsync(15_000);
        expect(instances).toHaveLength(7);

        preloadCanvasHoverPreview("/stall0.webp");
        expect(instances).toHaveLength(8);
    });

    it("ignores a late load event after the timeout already released the slot", async () => {
        const { preloadCanvasHoverPreview } = await load();
        for (let index = 0; index < 6; index += 1) preloadCanvasHoverPreview(`/late${index}.webp`);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(instances).toHaveLength(6);

        for (let index = 0; index < 6; index += 1) preloadCanvasHoverPreview(`/next${index}.webp`);
        expect(instances).toHaveLength(12);

        // Late onload from the timed-out batch must not free a second slot.
        resolve(0, true);
        preloadCanvasHoverPreview("/extra.webp");
        expect(instances).toHaveLength(12);
    });
});