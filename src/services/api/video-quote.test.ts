import { describe, expect, it, vi, afterEach } from "vitest";
import { displayedVideoQuote, quoteVideoGeneration, quoteVideoGenerationBatch, rememberDisplayedVideoQuote, requestVideoQuoteRefresh, subscribeVideoQuoteRefresh } from "./video-quote";
import { GenerationTaskRequestError } from "./generation-task-request-error";
import { useUserStore } from "@/stores/use-user-store";

afterEach(() => vi.unstubAllGlobals());
describe("video quote identity", () => {
    it("isolates panel quotes and clears them across account changes", () => {
        const config = { model: "video", videoSeconds: "5" };
        const refs = [{ type: "video" as const, url: "/api/reference-assets/clip" }];
        const oldQuote = { points: 8000, outputSeconds: 5, referenceSeconds: 15, totalSeconds: 20 };
        const newQuote = { ...oldQuote, points: 9000 };
        rememberDisplayedVideoQuote(config, refs, oldQuote, "panel-one");
        rememberDisplayedVideoQuote(config, refs, newQuote, "panel-two");
        expect(displayedVideoQuote(config, refs, "panel-one")).toEqual(oldQuote);
        expect(displayedVideoQuote(config, refs, "panel-two")).toEqual(newQuote);
        useUserStore.setState({ user: { id: "other" } as never });
        expect(displayedVideoQuote(config, refs, "panel-one")).toBeUndefined();
        useUserStore.setState({ user: null });
        expect(displayedVideoQuote(config, refs, "panel-one")).toBeUndefined();
    });
    it("matches source identity while ignoring expiring URL signatures and retains duplicate counts", () => {
        const config = { model: "video", videoSeconds: "5" };
        const quote = { points: 8000, outputSeconds: 5, referenceSeconds: 15, totalSeconds: 20 };
        rememberDisplayedVideoQuote(config, [{ type: "video", url: "/api/reference-assets/clip?signature=one" }], quote);
        expect(displayedVideoQuote(config, [{ type: "video", url: "/api/reference-assets/clip?signature=two" }])).toEqual(quote);
        expect(displayedVideoQuote(config, [{ type: "video", url: "/api/reference-assets/clip" }, { type: "video", url: "/api/reference-assets/clip" }])).toBeUndefined();
        expect(displayedVideoQuote({ ...config, videoSeconds: "10" }, [{ type: "video", url: "/api/reference-assets/clip" }])).toBeUndefined();
    });
    it("notifies only the matching quote panel when an expired quote needs review", () => {
        const config = { model: "video", videoSeconds: "5" };
        const references = [{ type: "video" as const, url: "/api/reference-assets/clip" }];
        const refresh = vi.fn();
        const unsubscribe = subscribeVideoQuoteRefresh(config, references, "panel-one", refresh);
        requestVideoQuoteRefresh(config, references, "panel-two");
        expect(refresh).not.toHaveBeenCalled();
        requestVideoQuoteRefresh(config, references, "panel-one");
        expect(refresh).toHaveBeenCalledOnce();
        unsubscribe();
        requestVideoQuoteRefresh(config, references, "panel-one");
        expect(refresh).toHaveBeenCalledOnce();
    });
    it("classifies a rejected quote as a pre-submission request failure", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "参考视频无权访问" }, { status: 400 })));
        await expect(quoteVideoGeneration({ model: "video" }, [])).rejects.toBeInstanceOf(GenerationTaskRequestError);
    });
    it("keeps batch quote identities complete and bound to their requested targets", async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ quotes: [
            { targetId: "run:task-one:1", quote: { targetId: "run:task-one:1", outputSeconds: 5, referenceSeconds: 15, totalSeconds: 20, points: 8000, confirmation: "one" } },
            { targetId: "run:task-two:1", quote: { targetId: "run:task-two:1", outputSeconds: 5, referenceSeconds: 15, totalSeconds: 20, points: 8000, confirmation: "two" } },
        ] }));
        vi.stubGlobal("fetch", fetchMock);
        const items = [
            { targetId: "run:task-one:1", config: { model: "video", videoSeconds: "5" }, references: [{ type: "video" as const, url: "/api/reference-assets/clip" }] },
            { targetId: "run:task-two:1", config: { model: "video", videoSeconds: "5" }, references: [{ type: "video" as const, url: "/api/reference-assets/clip" }] },
        ];

        const quotes = await quoteVideoGenerationBatch(items);

        expect(quotes["run:task-one:1"]?.points).toBe(8000);
        expect(quotes["run:task-two:1"]?.confirmation).toBe("two");
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ quoteOnly: true, quoteItems: items });
    });
    it("rejects incomplete or cross-target batch responses", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ quotes: [{ targetId: "wrong", quote: { targetId: "wrong" } }] })));
        await expect(quoteVideoGenerationBatch([{ targetId: "right", config: { model: "video" }, references: [] }])).rejects.toMatchObject({ status: 409 });
    });
});
