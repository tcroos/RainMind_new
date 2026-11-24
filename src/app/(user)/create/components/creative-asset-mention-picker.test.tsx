import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CreativeAsset } from "@/lib/creative-runtime-contract";

import { CreativeAssetMentionPicker } from "./creative-asset-mention-picker";

describe("CreativeAssetMentionPicker", () => {
    it("shows mixed media as thumbnail and short numbered labels without filenames", () => {
        const markup = renderToStaticMarkup(<CreativeAssetMentionPicker assets={[asset("image-one", "image", 1), asset("video-one", "video", 2), asset("image-two", "image", 3)]} onSelect={() => undefined} onDismiss={() => undefined} />);

        expect(markup).toContain('data-testid="creative-asset-mention-grid"');
        expect(markup).toContain('data-asset-label="图1"');
        expect(markup).toContain('data-asset-label="视频1"');
        expect(markup).toContain('data-asset-label="图2"');
        expect(markup).toContain('aria-label="选择图1"');
        expect(markup).toContain('aria-label="选择视频1"');
        expect(markup).toContain("grid-cols-1");
        expect(markup).toContain("w-[min(12rem,calc(100vw-2rem))]");
        expect(markup).toContain("bg-white");
        expect(markup).toContain("hover:bg-[#f1f3f5]");
        expect(markup).not.toContain("aria-pressed");
        expect(markup).not.toContain("lucide-check");
        expect(markup.indexOf('data-asset-id="image-one"')).toBeLessThan(markup.indexOf('data-asset-id="image-two"'));
        expect(markup).not.toContain("引用素材类型");
        expect(markup).not.toContain('title="图片素材');
        expect(markup).not.toContain(">图片素材 1<");
        expect(markup).not.toContain(">图片素材 2<");
    });

    it("filters by the active query while keeping labels based on the full asset list", () => {
        const markup = renderToStaticMarkup(<CreativeAssetMentionPicker assets={[asset("image-one", "image", 1), asset("image-two", "image", 2)]} query="素材 2" onSelect={() => undefined} onDismiss={() => undefined} />);

        expect(markup).toContain('data-asset-id="image-two"');
        expect(markup).toContain('data-asset-label="图2"');
        expect(markup).not.toContain('data-asset-id="image-one"');
    });

    it("keeps every item in a scrollable category without truncating large result sets", () => {
        const videos = Array.from({ length: 36 }, (_, index) => asset(`video-${index}`, "video", index + 1));
        const markup = renderToStaticMarkup(<CreativeAssetMentionPicker assets={videos} onSelect={() => undefined} onDismiss={() => undefined} />);

        expect(markup.match(/data-asset-id=/g)).toHaveLength(videos.length);
        expect(markup).toContain("max-h-[min(16rem,calc(100dvh-10rem))]");
        expect(markup).toContain("overflow-y-auto");
    });

    it("uses the real video source as the thumbnail when no cover image exists", () => {
        const video = { ...asset("video-no-cover", "video", 1), metadata: {} };
        const markup = renderToStaticMarkup(<CreativeAssetMentionPicker assets={[video]} onSelect={() => undefined} onDismiss={() => undefined} />);

        expect(markup).toContain("<video");
        expect(markup).toContain('src="/media/video-no-cover.mp4"');
        expect(markup).toContain('preload="auto"');
        expect(markup).toContain('aria-hidden="true"');
        expect(markup).not.toContain("controls");
    });
});

function asset(id: string, type: "image" | "video", ordinal: number): CreativeAsset {
    return {
        id,
        userId: "user",
        conversationId: "conversation",
        ordinal,
        type,
        status: "ready",
        title: `${type === "image" ? "图片" : "视频"}素材 ${ordinal}`,
        serverUrl: `/media/${id}.${type === "video" ? "mp4" : "webp"}`,
        metadata: type === "video" ? { coverUrl: `/media/${id}-cover.webp` } : {},
        createdAt: ordinal,
        updatedAt: ordinal,
    };
}
