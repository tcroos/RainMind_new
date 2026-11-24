import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreativeRunQuoteConfirmation } from "./creative-run-quote-confirmation";

describe("CreativeRunQuoteConfirmation", () => {
    it("renders each child quote and the confirmed total", () => {
        const html = renderToStaticMarkup(
            <CreativeRunQuoteConfirmation
                quotes={[
                    { targetId: "run:video:1", taskId: "video", copyIndex: 1, title: "分镜视频", model: "wan-fast", outputSeconds: 5, referenceSeconds: 15, totalSeconds: 20, points: 8000 },
                    { targetId: "run:video:2", taskId: "video", copyIndex: 2, title: "分镜视频", model: "wan-fast", outputSeconds: 5, referenceSeconds: 15, totalSeconds: 20, points: 8000 },
                ]}
                totalPoints={16000}
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        expect(html.match(/<th scope="row"/g)).toHaveLength(2);
        expect(html.match(/>20 秒<\/td>/g)).toHaveLength(2);
        expect(html).toContain("合计 16,000 积分");
        expect(html).toContain("确认报价并开始");
        expect(html).toContain("取消任务");
    });

    it("disables both actions while a decision is in flight", () => {
        const html = renderToStaticMarkup(
            <CreativeRunQuoteConfirmation
                quotes={[{ targetId: "run:video:1", taskId: "video", copyIndex: 1, title: "视频任务", model: "wan-fast", outputSeconds: 5, referenceSeconds: 0, totalSeconds: 5, points: 2000 }]}
                totalPoints={2000}
                confirming
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        expect(html.match(/disabled=""/g)).toHaveLength(2);
        expect(html).toContain("正在确认");
    });
});
