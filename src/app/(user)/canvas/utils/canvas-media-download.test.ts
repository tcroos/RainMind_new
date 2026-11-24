import { afterEach, describe, expect, it, vi } from "vitest";
import { readZip } from "@/lib/zip";

const save = vi.hoisted(() => vi.fn());
vi.mock("file-saver", () => ({ saveAs: save }));

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { downloadCanvasMediaBundle, selectedCanvasMediaNodes } from "./canvas-media-download";

const node = (id: string, type: CanvasNodeType, content?: string): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 240, height: 160, metadata: { content } });

describe("Canvas 选中媒体下载", () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

    it("downloads original image and video bytes through the same-origin route into a zip", async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(new Response("png-original", { headers: { "content-type": "image/png" } }))
            .mockResolvedValueOnce(new Response("mp4-original", { headers: { "content-type": "video/mp4" } }));
        vi.stubGlobal("fetch", fetcher);
        const result = await downloadCanvasMediaBundle([
            node("image", CanvasNodeType.Image, "/api/generation-log-assets/permanent/image.png?format=webp&width=320"),
            node("video", CanvasNodeType.Video, "/api/reference-assets/permanent/video.mp4"),
        ], "画布");
        expect(result).toEqual({ downloaded: 2, failed: 0 });
        expect(fetcher).toHaveBeenCalledWith("/api/generation-log-assets/permanent/image.png?download=original", { headers: { "x-vozeb-download-mode": "same-origin" }, redirect: "error" });
        const entries = await readZip(save.mock.calls[0][0]);
        expect(await Promise.all([...entries.values()].map(blob => blob.text()))).toEqual(["png-original", "mp4-original"]);
    });

    it("只保留已选且有内容的图片、全景图和视频", () => {
        const nodes = [
            node("image", CanvasNodeType.Image, "data:image/png;base64,AA=="),
            node("panorama", CanvasNodeType.Panorama, "data:image/png;base64,AA=="),
            node("video", CanvasNodeType.Video, "data:video/mp4;base64,AA=="),
            node("audio", CanvasNodeType.Audio, "data:audio/mpeg;base64,AA=="),
            node("text", CanvasNodeType.Text, "说明"),
            node("empty-image", CanvasNodeType.Image),
        ];

        expect(selectedCanvasMediaNodes(nodes, new Set(nodes.map((item) => item.id))).map((item) => item.id)).toEqual(["image", "panorama", "video"]);
        expect(selectedCanvasMediaNodes(nodes, new Set(["video", "text"])).map((item) => item.id)).toEqual(["video"]);
    });
});
