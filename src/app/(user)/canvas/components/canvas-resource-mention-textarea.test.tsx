import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { canvasResourceMentionAtCursor, canvasResourceReferenceDeletion, CanvasResourceMentionTextarea, CanvasResourceMentionText, formatCanvasReferenceCopyText, normalizeCanvasReferenceTokenSpacing, shouldSubmitOnEnter } from "./canvas-resource-mention-textarea";

describe("Canvas resource mention preview", () => {
    it("deletes the full referenced label at the caret and returns its connection reference", () => {
        const reference = { id: "image-1", nodeId: "image-1", kind: "image" as const, label: "图片1", title: "参考图片", active: true, connectionIds: ["connection-1"] };
        expect(canvasResourceReferenceDeletion("参考 图片1 继续创作", 6, 6, "Backspace", [reference])).toEqual({
            reference,
            value: "参考 继续创作",
            cursor: 3,
        });
    });

    it("deletes the full referenced label from either side in one step", () => {
        const reference = { id: "image-1", nodeId: "image-1", kind: "image" as const, label: "图片1", title: "参考图片", active: true, connectionIds: ["connection-1"] };
        expect(canvasResourceReferenceDeletion("参考 图片1 继续创作", 3, 3, "Delete", [reference])?.value).toBe("参考 继续创作");
        expect(canvasResourceReferenceDeletion("参考 图片1 继续创作", 3, 3, "Backspace", [reference])?.value).toBe("参考 继续创作");
        expect(canvasResourceReferenceDeletion("参考 图片1 继续创作", 7, 7, "Backspace", [reference])?.value).toBe("参考 继续创作");
    });

    it("normalizes reference token spacing without growing on repeated panel opens", () => {
        const labels = ["图片1"];
        const oldValue = "参考 图片1 继续创作";
        const once = normalizeCanvasReferenceTokenSpacing(oldValue, labels);
        const twice = normalizeCanvasReferenceTokenSpacing(once, labels);
        const thrice = normalizeCanvasReferenceTokenSpacing(twice, labels);
        expect(twice).toBe(once);
        expect(thrice).toBe(once);
        expect(once).toContain("图片1");
    });

    it("removes reference labels and reserved whitespace when copying", () => {
        const copied = formatCanvasReferenceCopyText("参考中的\u2009图片1\u2003\u2009\u2009\u2009\u2009人物", ["图片1"]);
        expect(copied).toBe("参考中的人物");
        expect(formatCanvasReferenceCopyText("@图片1 保持人物", ["图片1"])).toBe("保持人物");
    });

    it("opens mentions after existing Chinese prompt text and punctuation", () => {
        const afterText = "生成一张海报@图";
        const afterPunctuation = "保持人物一致，@视";
        const afterDigits = "222@";
        expect(canvasResourceMentionAtCursor(afterText, afterText.length)).toEqual({ start: 6, end: 8, query: "图" });
        expect(canvasResourceMentionAtCursor(afterPunctuation, afterPunctuation.length)).toEqual({ start: 7, end: 9, query: "视" });
        expect(canvasResourceMentionAtCursor(afterDigits, afterDigits.length)).toEqual({ start: 3, end: 4, query: "" });
    });

    it("renders an image thumbnail for a referenced image label", () => {
        const markup = renderToStaticMarkup(
            <CanvasResourceMentionText
                value="请参考 图片1 继续创作"
                references={[
                    {
                        id: "image-1",
                        nodeId: "image-1",
                        kind: "image",
                        label: "图片1",
                        title: "参考图片",
                        previewUrl: "/reference.png",
                        active: true,
                    },
                ]}
            />,
        );

        expect(markup).toContain('data-canvas-resource-reference="image-1"');
        expect(markup).toContain("参考图片");
        expect(markup).toContain("图片1");
        expect(markup).toContain("<img");
    });

    it("keeps node prompt text visible while overlaying image and video reference chips", () => {
        const markup = renderToStaticMarkup(
            <CanvasResourceMentionTextarea
                value="参考 图片1 和 视频1"
                references={[
                    { id: "image-1", nodeId: "image-1", kind: "image", label: "图片1", title: "参考图片", previewUrl: "/reference.png", active: true },
                    { id: "video-1", nodeId: "video-1", kind: "video", label: "视频1", title: "参考视频", previewUrl: "/reference.mp4", active: true },
                ]}
                onChange={() => undefined}
                style={{ color: "#1f2937" }}
            />,
        );

        expect(markup).toContain('data-canvas-resource-reference="image-1"');
        expect(markup).toContain('data-canvas-resource-reference="video-1"');
        expect(markup).toContain("<img");
        expect(markup).toContain("<video");
        expect(markup.slice(markup.indexOf("<textarea"))).toContain("color:#1f2937");
        expect(markup.slice(markup.indexOf("<textarea"))).not.toContain("color:transparent");
        expect(markup).toContain('data-reference-token-width');
        expect(markup).toContain('data-reference-token-visual');
        expect(markup).toContain('spellCheck="false"');
    });

    it("only submits prompt Enter with a modifier when required", () => {
        const enter = { key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false };
        const ctrlEnter = { ...enter, ctrlKey: true };
        const metaEnter = { ...enter, metaKey: true };

        expect(shouldSubmitOnEnter(enter, true)).toBe(false);
        expect(shouldSubmitOnEnter(ctrlEnter, true)).toBe(true);
        expect(shouldSubmitOnEnter(metaEnter, true)).toBe(true);
        expect(shouldSubmitOnEnter(enter, false)).toBe(true);
        expect(shouldSubmitOnEnter(ctrlEnter, false)).toBe(false);
    });
});
