import { describe, expect, it } from "vitest";
import { currentGenerationTaskFence, matchesGenerationTaskFence, withGenerationTaskFence } from "./generation-task-fence";

describe("generation claim fence", () => {
    it("accepts renewal without comparing the original deadline", () => {
        expect(matchesGenerationTaskFence({ workerId: "claim-a", leaseUntil: 300 }, { workerId: "claim-a", leaseUntil: 100 }, 200)).toBe(true);
    });
    it.each([{ workerId: "claim-b", leaseUntil: 300 }, { leaseUntil: undefined }, { workerId: "claim-a", leaseUntil: 100 }])("rejects takeover, webhook release and expiry: %o", record => {
        expect(matchesGenerationTaskFence(record, { workerId: "claim-a", leaseUntil: 100 }, 200)).toBe(false);
    });
    it("propagates the claim to nested refunds while isolating other tasks", async () => {
        await withGenerationTaskFence({ type: "image", taskId: "one", userId: "user", workerId: "a", leaseUntil: 100 }, async () => {
            await Promise.resolve();
            expect(currentGenerationTaskFence("image", "one")?.workerId).toBe("a");
            expect(currentGenerationTaskFence("video", "two")).toBeUndefined();
        });
        expect(currentGenerationTaskFence()).toBeUndefined();
    });
});
