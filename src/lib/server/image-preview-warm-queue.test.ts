import { describe, expect, it, vi } from "vitest";

import { enqueueWarmImagePreview } from "./image-preview-warm-queue";

describe("image preview warm queue", () => {
    it("runs one task at a time and continues after a failure", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        let active = 0;
        let maxActive = 0;
        const completed: string[] = [];
        const task = (name: string, fail = false) => async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await Promise.resolve();
            active -= 1;
            if (fail) throw new Error("warm failed");
            completed.push(name);
        };

        enqueueWarmImagePreview(task("first"));
        enqueueWarmImagePreview(task("second", true));
        enqueueWarmImagePreview(task("third"));

        await vi.waitFor(() => expect(completed).toEqual(["first", "third"]));
        expect(maxActive).toBe(1);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
