import { describe, expect, it } from "vitest";

import { buildDramaVideoQuoteItems, confirmedDramaVideoQuote, dramaShotReferenceVideos, dramaShotVideoReady, dramaVideoQuoteReferences, dramaVideoQuoteTargetId, queuedDramaShotsNeedingVideoQuote, shotReferenceImages, storyboardReferenceImages } from "./drama-shot-generation-utils";

describe("storyboardReferenceImages", () => {
    it("marks the storyboard start and end images as explicit video frames", () => {
        const references = storyboardReferenceImages({
            id: "shot-one",
            title: "雨夜相遇",
            storyboardFrameMode: "first_last",
            storyboardImageUrl: "/api/reference-assets/start.png",
            storyboardImageWidth: 1280,
            storyboardImageHeight: 720,
            storyboardEndImageUrl: "/api/reference-assets/end.png",
            storyboardEndImageWidth: 1280,
            storyboardEndImageHeight: 720,
        } as never);

        expect(references).toMatchObject([
            { id: "storyboard-start-shot-one", videoRole: "first_frame", serverUrl: "/api/reference-assets/start.png" },
            { id: "storyboard-end-shot-one", videoRole: "last_frame", serverUrl: "/api/reference-assets/end.png" },
        ]);
    });

    it("keeps storyboard mode as a first-frame-only request", () => {
        const references = storyboardReferenceImages({
            id: "shot-two",
            title: "单帧分镜",
            storyboardFrameMode: "first_frame",
            storyboardImageUrl: "https://cdn.example.com/start.png",
            storyboardEndImageUrl: "https://cdn.example.com/end.png",
        } as never);

        expect(references).toEqual([expect.objectContaining({ id: "storyboard-start-shot-two", videoRole: "first_frame", remoteUrl: "https://cdn.example.com/start.png" })]);
    });

    it("keeps every matching project reference instead of taking the first four", () => {
        const characters = Array.from({ length: 5 }, (_, index) => ({ id: `character-${index}`, name: `角色 ${index}`, references: [{ id: `reference-${index}`, url: `/api/reference-assets/${index}.png` }], primaryReferenceId: `reference-${index}` }));
        const references = shotReferenceImages({ characters, scenes: [], props: [], sourceAssets: [] } as never, { characterIds: characters.map((item) => item.id), propIds: [] } as never);

        expect(references).toHaveLength(5);
        expect(references.at(-1)).toMatchObject({ id: "character-4", serverUrl: "/api/reference-assets/4.png" });
    });
});

describe("drama video quote inputs", () => {
    it("resolves selected managed source videos and keeps repeated references billable", () => {
        const project = {
            sourceAssets: [
                { id: "managed", type: "video", title: "站内素材", storageKey: "video/clip.mp4", remoteUrl: "https://cdn.example.com/clip.mp4" },
                { id: "external", type: "video", title: "外链素材", remoteUrl: "https://cdn.example.com/external.mp4" },
            ],
        } as never;
        const shot = { referenceVideoAssetIds: ["managed", "managed", "external"] } as never;

        const videos = dramaShotReferenceVideos(project, shot);

        expect(videos).toEqual([
            { id: "managed", name: "站内素材", type: "video/mp4", url: "/api/reference-assets/video/clip.mp4", storageKey: "video/clip.mp4" },
            { id: "managed", name: "站内素材", type: "video/mp4", url: "/api/reference-assets/video/clip.mp4", storageKey: "video/clip.mp4" },
        ]);
        expect(dramaVideoQuoteReferences([], videos)).toEqual([
            { type: "video", url: "/api/reference-assets/video/clip.mp4" },
            { type: "video", url: "/api/reference-assets/video/clip.mp4" },
        ]);
    });

    it("keeps first and last frame roles separate from ordinary video references", () => {
        const images = storyboardReferenceImages({ id: "shot", title: "分镜", storyboardFrameMode: "first_last", storyboardImageUrl: "/api/reference-assets/start.png", storyboardEndImageUrl: "/api/reference-assets/end.png" } as never);
        const videos = [{ id: "video", name: "参考视频", type: "video/mp4", url: "/api/reference-assets/video.mp4" }];

        expect(dramaVideoQuoteReferences(images, videos)).toEqual([
            { type: "image", url: "/api/reference-assets/start.png", role: "first_frame" },
            { type: "image", url: "/api/reference-assets/end.png", role: "last_frame" },
            { type: "video", url: "/api/reference-assets/video.mp4" },
        ]);
    });

    it("binds a quote target to the exact shot attempt", () => {
        expect(dramaVideoQuoteTargetId("project", "episode", "shot", 1)).not.toBe(dramaVideoQuoteTargetId("project", "episode", "shot", 2));
    });

    it("creates a distinct quote target and duration for each queued shot", () => {
        const project = { id: "project", title: "项目", style: "", ratio: "16:9", defaultVideoMode: "direct", characters: [], scenes: [], props: [], clues: [], sourceAssets: [{ id: "clip", type: "video", title: "素材", storageKey: "clip.mp4" }] } as never;
        const episode = { id: "episode", title: "剧集", shots: [{ id: "one", order: 1, title: "一", videoPrompt: "move", description: "", sourceText: "", duration: 5, characterIds: [], propIds: [], clueIds: [], generationAttempt: 0, referenceVideoAssetIds: ["clip"] }, { id: "two", order: 2, title: "二", videoPrompt: "pan", description: "", sourceText: "", duration: 8, characterIds: [], propIds: [], clueIds: [], generationAttempt: 2 }] } as never;
        const items = buildDramaVideoQuoteItems(project, episode, { model: "video-model", videoModel: "video-model", vquality: "720" } as never, ["one", "two"]);

        expect(items.map((item) => item.targetId)).toEqual([
            "drama-video:project:episode:one:attempt-1",
            "drama-video:project:episode:two:attempt-3",
        ]);
        expect(items.map((item) => item.config.videoSeconds)).toEqual(["5", "8"]);
        expect(items[0].references).toEqual([{ type: "video", url: "/api/reference-assets/clip.mp4" }]);
    });

    it("requotes a queued pre-submission recovery using its existing attempt identity", () => {
        const project = { id: "project", title: "项目", style: "", ratio: "16:9", defaultVideoMode: "direct", characters: [], scenes: [], props: [], clues: [], sourceAssets: [] } as never;
        const episode = { id: "episode", title: "剧集", shots: [{ id: "shot", order: 1, title: "镜头", videoPrompt: "move", description: "", sourceText: "", duration: 5, characterIds: [], propIds: [], clueIds: [], generationStatus: "queued", generationAttempt: 2 }] } as never;

        const [item] = buildDramaVideoQuoteItems(project, episode, { model: "video-model", videoModel: "video-model", vquality: "720" } as never, ["shot"]);

        expect(item.targetId).toBe("drama-video:project:episode:shot:attempt-2");
    });

    it("accepts only the signed quote for the shot's current attempt", () => {
        const quote = { targetId: "drama-video:project:episode:shot:attempt-2", points: 8000 };
        const current = { id: "shot", generationAttempt: 2, generationQuote: { attemptNo: 2, targetId: quote.targetId, quote } };
        const stale = { ...current, generationAttempt: 3 } as never;

        expect(confirmedDramaVideoQuote("project", "episode", current as never)).toBe(quote);
        expect(confirmedDramaVideoQuote("project", "episode", stale)).toBeUndefined();
        expect(confirmedDramaVideoQuote("project", "episode", { id: "shot", generationAttempt: 2 } as never)).toBeUndefined();
    });

    it("does not request a video quote before required storyboard frames are ready", () => {
        const project = { defaultVideoMode: "storyboard" } as never;

        expect(dramaShotVideoReady(project, { id: "shot", storyboardStatus: "queued" } as never)).toBe(false);
        expect(dramaShotVideoReady(project, { id: "shot", storyboardStatus: "success", storyboardImageUrl: "/api/reference-assets/start.png", storyboardFrameMode: "first_last", storyboardEndStatus: "queued" } as never)).toBe(false);
        expect(dramaShotVideoReady(project, { id: "shot", storyboardStatus: "success", storyboardImageUrl: "/api/reference-assets/start.png" } as never)).toBe(true);
    });

    it("returns queued frame-ready shots that still need an attempt quote", () => {
        const project = { id: "project", defaultVideoMode: "storyboard" } as never;
        const shot = {
            id: "shot",
            generationStatus: "queued",
            generationAttempt: 2,
            storyboardStatus: "success",
            storyboardImageUrl: "/api/reference-assets/start.png",
        };
        const episode = { id: "episode", shots: [shot] } as never;

        expect(queuedDramaShotsNeedingVideoQuote(project, episode)).toEqual(["shot"]);
    });
});
