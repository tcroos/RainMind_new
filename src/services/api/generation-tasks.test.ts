import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenerationTask, quoteGenerationTask, createTaskProgressBatcher, isProgressStillRunning, readGenerationTask } from "./generation-tasks";

const summary = (id: string) => ({ id, kind: "image", status: "running", progressPercent: null, taskId: null, error: null, needsReview: false, resultCount: 0 });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("batch progress coordinator", () => {
    it("quotes then creates with the same opaque quoteToken and request identity", async () => {
        const quote = { kind: "video", power: 12, expiresAt: 1000, quoteToken: "opaque-signed-quote" };
        const task = { id: "one", taskId: "one", kind: "video", status: "running", power: 12, needsReview: true };
        const fetchMock = vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(Response.json({ ok: true, data: { quote } }))
            .mockResolvedValueOnce(Response.json({ ok: true, data: { task, warning: "检查原任务" } }, { status: 202 }));
        const input = { config: { model: "video" }, context: { clientRequestId: "request-one" } };
        const result = await quoteGenerationTask("video", input);
        expect(result).toEqual(quote);
        expect(await createGenerationTask("video", input, { quoteToken: result.quoteToken })).toEqual({ task, warning: "检查原任务" });
        expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ kind: "video", input, quoteToken: quote.quoteToken });
    });

    it("retains contract error code and traceId for unsupported quotes", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: false, error: { code: "QUOTE_NOT_SUPPORTED", message: "暂不支持" }, traceId: "trace" }, { status: 422 }));
        await expect(quoteGenerationTask("image", {})).rejects.toMatchObject({ code: "QUOTE_NOT_SUPPORTED", traceId: "trace", status: 422 });
    });
    it("coalesces image and video requests and deduplicates task ids", async () => {
        vi.useFakeTimers();
        const read = vi.fn(async (ids: string[]) => ids.map(id => ({ ...summary(id), kind: id === "video" ? "video" : "image" })));
        const batcher = createTaskProgressBatcher(read);
        const one = batcher.readProgress("image", "image");
        const duplicate = batcher.readProgress("image", "image");
        const two = batcher.readProgress("video", "video");
        await vi.runAllTimersAsync();
        expect(read).toHaveBeenCalledExactlyOnceWith(["image", "video"]);
        expect(await one).toEqual(await duplicate);
        expect((await two)?.kind).toBe("video");
        batcher.dispose();
    });
    it("chunks more than 20 and falls back independently on an API failure", async () => {
        vi.useFakeTimers();
        const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([summary("20")]);
        const batcher = createTaskProgressBatcher(read);
        const pending = Array.from({ length: 21 }, (_, id) => batcher.readProgress(String(id), "image"));
        await vi.runAllTimersAsync();
        const result = await Promise.all(pending);
        expect(read.mock.calls[0][0]).toHaveLength(20);
        expect(result.slice(0, 20)).toEqual(Array(20).fill(null));
        expect(result[20]?.id).toBe("20");
        batcher.dispose();
    });

    it("coalesces 34 review tasks into two batches instead of 34 requests", async () => {
        vi.useFakeTimers();
        const read = vi.fn(async (ids: string[]) => ids.map(id => ({ ...summary(id), status: "success" })));
        const batcher = createTaskProgressBatcher(read);
        const pending = Array.from({ length: 34 }, (_, id) => batcher.readProgress(String(id), "image"));
        await vi.runAllTimersAsync();
        await Promise.all(pending);
        expect(read.mock.calls.map(([ids]) => ids.length)).toEqual([20, 14]);
        batcher.dispose();
    });
    it("missing tasks, review states and terminal states must use existing single-task readers", async () => {
        vi.useFakeTimers();
        const batcher = createTaskProgressBatcher(async () => []);
        const missing = batcher.readProgress("missing", "image");
        await vi.runAllTimersAsync();
        expect(await missing).toBeNull();
        expect(isProgressStillRunning({ ...summary("review"), needsReview: true })).toBe(false);
        expect(isProgressStillRunning({ ...summary("done"), status: "success" })).toBe(false);
        expect(isProgressStillRunning(summary("active"))).toBe(true);
        batcher.dispose();
    });
    it("reads a unified task view and surfaces contract errors", async () => {
        const task = { id: "task-a", kind: "image", status: "success", progressPercent: 100, power: 4, result: { url: "https://example.test/a.png" }, error: null, refundStatus: "not_required" };
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { task }, traceId: "trace-a" }), { status: 200 }));
        await expect(readGenerationTask("image", "task-a")).resolves.toEqual(task);
        expect(fetchMock).toHaveBeenCalledWith("/api/generation-tasks/image/task-a", { cache: "no-store" });
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: { message: "任务不存在" }, traceId: "trace-b" }), { status: 404 }));
        await expect(readGenerationTask("image", "missing")).rejects.toThrow("任务不存在");
        fetchMock.mockRestore();
    });

    it("aborting one waiter does not cancel other tasks and dispose clears pending work", async () => {
        vi.useFakeTimers();
        const read = vi.fn(async () => [summary("other")]);
        const batcher = createTaskProgressBatcher(read);
        const controller = new AbortController();
        const aborted = batcher.readProgress("one", "image", controller.signal);
        const other = batcher.readProgress("other", "image");
        controller.abort();
        await vi.runAllTimersAsync();
        expect(await aborted).toBeNull();
        expect((await other)?.id).toBe("other");
        const pending = batcher.readProgress("later", "image");
        batcher.dispose();
        expect(await pending).toBeNull();
    });
});
